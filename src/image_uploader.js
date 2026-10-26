// Image Uploader Service for Waterball
// Supports Imgur (default), Catbox.moe, and custom API endpoints.
import { isTauri, safeInvoke } from './platform.js';

export const IMGUR_DEFAULT_CLIENT_ID = '66f9b381f0785a5';
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

export class ImageUploadHistoryManager {
  constructor(storageKey = 'waterball_image_upload_history', maxItems = 20) {
    this.storageKey = storageKey;
    this.maxItems = maxItems;
    this.listeners = new Set();
    this._memoryEntries = [];
  }

  getEntries() {
    // A failed write must not hide a newly received deletion key behind old data.
    if (this.persistenceError) return this._memoryEntries;
    try {
      if (typeof localStorage === 'undefined') return this._memoryEntries;
      const parsed = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
      this._memoryEntries = Array.isArray(parsed)
        ? parsed.filter(e => e && typeof e.url === 'string').slice(0, this.maxItems) : [];
    } catch {
      // Keep the most recently known entries when storage is unreadable.
    }
    return this._memoryEntries;
  }

  saveEntries(entries) {
    this._memoryEntries = entries.slice(0, this.maxItems);
    this.persistenceError = null;
    try {
      if (typeof localStorage === 'undefined') throw new Error('本機儲存不可用');
      localStorage.setItem(this.storageKey, JSON.stringify(this._memoryEntries));
    } catch (error) { this.persistenceError = error; }
    this.notify();
  }

  add(entry) {
    if (!entry?.url) return;
    const entries = this.getEntries().filter(e => e.url !== entry.url);
    entries.unshift({
      id: entry.id || null,
      url: entry.url,
      deletehash: entry.deletehash || null,
      provider: entry.provider || 'imgur',
      clientId: entry.clientId || null,
      timestamp: entry.timestamp || Date.now(),
      size: entry.size || 0,
      deleted: false,
    });
    this.saveEntries(entries);
  }

  findByUrl(url) {
    if (!url) return null;
    const cleanUrl = url.trim();
    return this.getEntries().find(e => e.url === cleanUrl) || null;
  }

  markDeleted(url) {
    const cleanUrl = url?.trim();
    const entries = this.getEntries().map(e => {
      if (e.url === cleanUrl) {
        return { ...e, deleted: true, deletedAt: Date.now() };
      }
      return e;
    });
    this.saveEntries(entries);
  }

  clear() {
    this.saveEntries([]);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try { listener(this.getEntries()); } catch {}
    }
  }
}

export const imageUploadHistory = new ImageUploadHistoryManager();

// Validate before URL parsing: URL() silently removes some control characters.
// Hosts may surround plain-text responses with a newline; never retain it.
export function validateImageUrl(value, { upgradeHttp = false, httpsOnly = false } = {}) {
  if (typeof value !== 'string') throw new Error('圖床回傳無效網址');
  const text = value.trim();
  if (!text || /[\s\x00-\x1f\x7f-\x9f]/u.test(text)) throw new Error('圖床網址含空白或控制字元');
  let url;
  try { url = new URL(text); } catch { throw new Error('圖床回傳無效網址'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('圖床網址必須為不含帳密的 HTTP(S) 網址');
  }
  if (httpsOnly && url.protocol !== 'https:') throw new Error('自訂圖床 API 必須使用 HTTPS');
  if (upgradeHttp && url.protocol === 'http:') url.protocol = 'https:';
  return url.href;
}

export function isSupportedImageBlob(blob) {
  return Boolean(blob && (blob instanceof Blob || typeof blob?.arrayBuffer === 'function'));
}

// Response limits apply to both successful and error payloads.
export const MAX_RESPONSE_BYTES = 64 * 1024;
function checkCancelled(signal) {
  if (signal?.aborted) throw new Error('貼上已取消；未啟動新的上傳請求');
}

export async function readUploadResponse(res) {
  const advertised = Number(res.headers?.get?.('content-length'));
  if (advertised > MAX_RESPONSE_BYTES) {
    await res.body?.cancel?.();
    throw new Error('圖床回應超過 64KB 限制');
  }
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '', size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error('圖床回應超過 64KB 限制');
        }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally { reader.releaseLock(); }
  }
  // Also supports non-streaming response adapters used by embedders/tests.
  const text = typeof res.text === 'function' ? await res.text() : JSON.stringify(await res.json());
  if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) throw new Error('圖床回應超過 64KB 限制');
  return text;
}

function parseJson(text) { try { return JSON.parse(text); } catch { return null; } }

async function requestUpload(blob, request, options, fetchFn, timeoutMs) {
  checkCancelled(options.signal);
  if (!options.fetchFn && isTauri()) {
    const buffer = await blob.arrayBuffer();
    if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error('圖片超過 20MB 上傳限制');
    checkCancelled(options.signal);
    // Do not abort an issued upload merely to stop insertion: we need its
    // successful response/deletehash for manual recovery and withdrawal.
    return await safeInvoke('upload_image_native', {
      url: request.url, fileField: request.fileFields[0],
      fileFields: request.fileFields, fileName: 'image.png',
      fileBytes: Array.from(new Uint8Array(buffer)),
      fields: request.fields || [], headers: request.headers || null,
    });
  }
  const formData = new FormData();
  for (const field of request.fileFields) formData.append(field, blob, 'image.png');
  for (const [key, value] of request.fields || []) formData.append(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    checkCancelled(options.signal);
    const res = await fetchFn(request.url, {
      method: 'POST', headers: request.headers, body: formData,
      signal: controller.signal, redirect: 'error',
    });
    const text = await readUploadResponse(res);
    if (!res.ok) {
      const data = parseJson(text);
      const detail = data?.data?.error;
      const error = typeof detail === 'string' ? detail : detail?.message || data?.errors?.[0]?.detail || '';
      throw new Error(`HTTP ${res.status}${error ? ': ' + error : ''}`);
    }
    return text;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('圖床上傳逾時；伺服器可能已收件，請檢查圖床');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function uploadImageToHost(blob, options = {}) {
  if (!isSupportedImageBlob(blob)) throw new TypeError('無效的圖片資料 (Expected Blob or File)');
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error(`圖片過大，超過 20MB 上傳限制`);
  checkCancelled(options.signal);
  const provider = options.provider || 'imgur';
  const fetchFn = options.fetchFn || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 25000;
  if ((!isTauri() || options.fetchFn) && typeof fetchFn !== 'function') throw new Error('未提供可用的 fetch 函式');
  let result;
  if (provider === 'imgur') {
    try { result = await uploadToImgur(blob, options, fetchFn, timeoutMs); }
    catch (error) {
      // Cross-host fallback is opt-in. Cancellation never starts a new upload.
      checkCancelled(options.signal);
      if (options.autoFallback !== true) throw error;
      try { result = await uploadToCatbox(blob, options, fetchFn, timeoutMs); }
      catch { throw error; }
    }
  } else if (provider === 'catbox') result = await uploadToCatbox(blob, options, fetchFn, timeoutMs);
  else if (provider === 'custom') result = await uploadToCustom(blob, options, fetchFn, timeoutMs);
  else throw new Error(`不支援的圖床服務：${provider}`);

  // Preserve successful remote results even after Esc. The transaction checks
  // cancellation before sending, and uses this URL for its recovery dialog.
  imageUploadHistory.add({ ...result, timestamp: Date.now(), size: blob.size || 0 });
  return options.returnObject ? result : result.url;
}

async function uploadToImgur(blob, options, fetchFn, timeoutMs) {
  const clientId = (options.imgurClientId || '').trim() || IMGUR_DEFAULT_CLIENT_ID;
  let text;
  try {
    text = await requestUpload(blob, {
      url: 'https://api.imgur.com/3/image', fileFields: ['image'],
      fields: [['type', 'file']], headers: { Authorization: `Client-ID ${clientId}` },
    }, options, fetchFn, timeoutMs);
  } catch (error) {
    const message = error.message || String(error);
    throw new Error(`Imgur 上傳失敗：${message}${message.includes('429') ? ' (配額已滿，請至設定填寫個人 Client ID 或更換圖床)' : ''}`);
  }
  const data = parseJson(text);
  if (data?.success === false || !data?.data?.link) throw new Error('Imgur 回傳資料中未找到圖片網址');
  return { url: validateImageUrl(data.data.link, { upgradeHttp: true }),
    deletehash: typeof data.data.deletehash === 'string' ? data.data.deletehash : null,
    id: data.data.id || null, provider: 'imgur', clientId };
}

async function uploadToCatbox(blob, options, fetchFn, timeoutMs) {
  const text = await requestUpload(blob, { url: 'https://catbox.moe/user/api.php',
    fileFields: ['fileToUpload'], fields: [['reqtype', 'fileupload']],
  }, options, fetchFn, timeoutMs);
  return { url: validateImageUrl(text, { upgradeHttp: true }), provider: 'catbox' };
}

async function uploadToCustom(blob, options, fetchFn, timeoutMs) {
  if (!options.customEndpoint?.trim()) throw new Error('未設定自訂圖床 API 端點網址');
  const endpoint = validateImageUrl(options.customEndpoint, { httpsOnly: true });
  const text = await requestUpload(blob, { url: endpoint, fileFields: ['file', 'image'] }, options, fetchFn, timeoutMs);
  const data = parseJson(text);
  const link = data ? data.url || data.link || data.data?.url || data.data?.link || data.file?.url : text;
  return { url: validateImageUrl(link), provider: 'custom' };
}

export async function deleteUploadedImage({ url, deletehash, provider, clientId, fetchFn } = {}) {
  const entry = imageUploadHistory.findByUrl(url);
  const targetHash = deletehash || entry?.deletehash;
  const targetProvider = provider || entry?.provider;
  if (!targetHash) throw new Error('此圖片沒有可用的撤回金鑰 (deletehash)，無法自動撤回');
  if (targetProvider && targetProvider !== 'imgur') throw new Error(`圖床服務「${targetProvider}」不支援透過 API 自動撤回刪除`);
  if (typeof targetHash !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(targetHash)) throw new Error('無效的圖片撤回金鑰');
  const cid = (clientId || entry?.clientId || '').trim() || IMGUR_DEFAULT_CLIENT_ID;
  const target = `https://api.imgur.com/3/image/${targetHash}`;
  let text;
  if (!fetchFn && isTauri()) {
    text = await safeInvoke('delete_image_native', { url: target, headers: { Authorization: `Client-ID ${cid}` } });
  } else {
    const effectiveFetch = fetchFn || globalThis.fetch;
    if (typeof effectiveFetch !== 'function') throw new Error('未提供可用的 fetch 函式');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await effectiveFetch(target, { method: 'DELETE', headers: { Authorization: `Client-ID ${cid}` },
        signal: controller.signal, redirect: 'error' });
      text = await readUploadResponse(res);
      if (!res.ok) throw new Error(`Imgur 撤回刪除失敗：HTTP ${res.status}`);
    } finally { clearTimeout(timer); }
  }
  const result = parseJson(text);
  if (result?.success !== true || result?.data !== true) throw new Error('圖床未確認刪除成功，請保留撤回紀錄並稍後重試');
  if (url) imageUploadHistory.markDeleted(url);
  return true;
}
