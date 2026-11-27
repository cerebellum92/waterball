// Lightweight IndexedDB history store & PTT Web HTML push importer for Live Chat Mode
import { isTauri, safeInvoke } from './platform.js';
import { aidToFilename, validBoard } from './aid_helper.js';
import { ArticleParser } from './article_reader.js';

const MAX_WEB_HTML_BYTES = 12 * 1024 * 1024;
const VALID_FILENAME_RE = /^(M\.\d{1,10}\.A(?:\.[0-9A-Fa-f]{3})?)(?:\.html)?$/;

export function buildArticleHistoryKey(board, aidOrFilename) {
  const cleanBoard = validBoard(board);
  if (!cleanBoard || typeof aidOrFilename !== 'string') return null;
  const trimmed = aidOrFilename.trim();
  let filename = aidToFilename(trimmed);
  if (!filename) {
    const match = trimmed.match(VALID_FILENAME_RE);
    if (match) {
      const parts = match[1].split('.');
      filename = parts.length === 4 ? `M.${parts[1]}.A.${parts[3].toUpperCase()}` : match[1];
    }
  }
  return filename ? `${cleanBoard}:${filename}` : null;
}

export function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
}

function stripTagsToText(html) {
  if (!html) return '';
  return decodeHtmlEntities(String(html).replace(/<[^>]+>/g, ''));
}

function normalizeTag(rawTag) {
  const t = String(rawTag || '').trim();
  if (t.startsWith('推')) return '推';
  if (t.startsWith('噓')) return '噓';
  return '→';
}

function splitIpAndTime(rawIpDateTime) {
  const trimmed = String(rawIpDateTime || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return { ip: '', time: '' };
  const match = trimmed.match(/^(?:(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{3,39})\s+)?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?:\s+\d{1,2}:\d{2})?)$/i);
  if (match) {
    return { ip: match[1] || '', time: match[2] || '' };
  }
  return { ip: '', time: trimmed };
}

export function parsePttWebArticlePushes(html) {
  if (typeof html !== 'string' || !html) {
    return { ok: false, title: '', author: '', pushes: [] };
  }
  if (/over18-notice|問您是否已滿十八歲/i.test(html)) {
    return { ok: false, title: '', author: '', pushes: [] };
  }
  const mainStart = html.indexOf('id="main-content"');
  if (mainStart === -1) {
    return { ok: false, title: '', author: '', pushes: [] };
  }

  let title = '';
  let author = '';
  const metaRegex = /<span class="article-meta-tag">([^<]*)<\/span>\s*<span class="article-meta-value">([\s\S]*?)<\/span>/gi;
  let metaMatch;
  while ((metaMatch = metaRegex.exec(html.slice(mainStart, mainStart + 4096))) !== null) {
    const key = stripTagsToText(metaMatch[1]).trim();
    const val = stripTagsToText(metaMatch[2]).trim();
    if (key === '作者' && !author) author = val;
    else if (key === '標題' && !title) title = val;
  }

  const pushes = [];
  const pushBlockRegex = /<div class="push"[^>]*>([\s\S]*?)<\/div>/gi;
  let blockMatch;
  while ((blockMatch = pushBlockRegex.exec(html)) !== null) {
    const inner = blockMatch[1];
    const tagMatch = inner.match(/<span[^>]*class="[^"]*\bpush-tag\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const userMatch = inner.match(/<span[^>]*class="[^"]*\bpush-userid\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const contentMatch = inner.match(/<span[^>]*class="[^"]*\bpush-content\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const timeMatch = inner.match(/<span[^>]*class="[^"]*\bpush-ipdatetime\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (!userMatch || !contentMatch) continue;

    const user = stripTagsToText(userMatch[1]).trim();
    if (!user) continue;
    const tag = normalizeTag(tagMatch ? stripTagsToText(tagMatch[1]) : '→');
    let content = stripTagsToText(contentMatch[1]).replace(/^\s*[:：]\s*/, '').trimEnd();
    const { ip, time } = splitIpAndTime(timeMatch ? stripTagsToText(timeMatch[1]) : '');
    const floor = pushes.length + 1;
    pushes.push({
      tag,
      user,
      content,
      ip,
      time,
      floor,
      sourceLine: floor,
    });
  }

  if (pushes.length === 0) {
    const bodyText = stripTagsToText(
      html
        .slice(mainStart)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:div|p|li|tr)>/gi, '\n')
    );
    const rawLines = bodyText.split('\n').filter((line) => /^\s*\|/.test(line));
    if (rawLines.length > 0) {
      const fallbackParsed = ArticleParser.parseLines(['', ...rawLines]);
      if (Array.isArray(fallbackParsed.pushList) && fallbackParsed.pushList.length > 0) {
        return {
          ok: true,
          title,
          author,
          pushes: fallbackParsed.pushList,
        };
      }
    }
  }

  return {
    ok: pushes.length > 0,
    title,
    author,
    pushes,
  };
}

export async function fetchPttArticleHtml(board, filename, { fetchImpl = null, timeoutMs = 12000 } = {}) {
  const key = buildArticleHistoryKey(board, filename);
  if (!key) return null;
  const [cleanBoard, cleanFilename] = key.split(':');

  if (!fetchImpl && isTauri()) {
    try {
      const html = await safeInvoke('fetch_ptt_article_html', { board: cleanBoard, filename: cleanFilename });
      return typeof html === 'string' && html.length <= MAX_WEB_HTML_BYTES ? html : null;
    } catch {
      return null;
    }
  }

  const doFetch = fetchImpl || (typeof globalThis.fetch === 'function' && Boolean(globalThis.location?.protocol) ? globalThis.fetch.bind(globalThis) : null);
  if (!doFetch) return null;

  const url = `https://www.ptt.cc/bbs/${cleanBoard}/${cleanFilename}.html`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  timer?.unref?.();

  try {
    const res = await doFetch(url, controller ? { signal: controller.signal } : undefined);
    if (!res?.ok) return null;
    const html = await res.text();
    if (typeof html !== 'string' || html.length > MAX_WEB_HTML_BYTES) return null;
    return html;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function makePushSignature(p) {
  if (p?.commentSeq != null) {
    return `new:${p.commentSeq}:${String(p.user || '').trim().toLowerCase()}`;
  }
  return `${p?.tag || ''}:${String(p?.user || '').trim().toLowerCase()}:${String(p?.content || '').trim()}:${p?.time || ''}`;
}

function toStoredPushRecord(articleKey, seq, p) {
  const user = String(p?.user || '').trim();
  return {
    pk: `${articleKey}#${String(seq).padStart(7, '0')}`,
    articleKey,
    seq,
    userLower: user.toLowerCase(),
    tag: p?.tag || '→',
    user,
    content: p?.content || '',
    ip: p?.ip || '',
    time: p?.time || '',
    floor: p?.floor ?? seq,
    ...(p?.commentFormat ? { commentFormat: p.commentFormat } : {}),
    ...(p?.commentSeq != null ? { commentSeq: p.commentSeq } : {}),
    ...(p?.isEdited ? { isEdited: true } : {}),
    ...(p?.isDeleted ? { isDeleted: true } : {}),
  };
}

function toClientPushItem(record) {
  const out = {
    tag: record.tag,
    user: record.user,
    content: record.content,
    ip: record.ip || '',
    time: record.time || '',
    floor: record.floor ?? record.seq,
    sourceLine: record.floor ?? record.seq,
  };
  if (record.commentFormat) out.commentFormat = record.commentFormat;
  if (record.commentSeq != null) out.commentSeq = record.commentSeq;
  if (record.isEdited) out.isEdited = true;
  if (record.isDeleted) out.isDeleted = true;
  return out;
}

function matchesPushFilterType(p, filterType) {
  if (filterType === 'push') return p.tag === '推';
  if (filterType === 'boo') return p.tag === '噓';
  if (filterType === 'arrow') return p.tag !== '推' && p.tag !== '噓';
  return true;
}

export class LiveChatHistoryStore {
  constructor({
    dbName = 'waterball_live_chat_v1',
    maxArticles = 20,
    ttlMs = 7 * 24 * 60 * 60 * 1000,
    indexedDBImpl = (typeof indexedDB !== 'undefined' ? indexedDB : null),
  } = {}) {
    this.dbName = dbName;
    this.maxArticles = maxArticles;
    this.ttlMs = ttlMs;
    this.indexedDB = indexedDBImpl;
    this._dbPromise = null;
    this._useMemoryFallback = !this.indexedDB;
    this._memArticles = new Map();
    this._memPushes = new Map(); // articleKey -> Array<record>
  }

  async _getDb() {
    if (this._useMemoryFallback || !this.indexedDB) return null;
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise((resolve) => {
      try {
        const req = this.indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('articles')) {
            db.createObjectStore('articles', { keyPath: 'articleKey' });
          }
          if (!db.objectStoreNames.contains('pushes')) {
            const pushStore = db.createObjectStore('pushes', { keyPath: 'pk' });
            pushStore.createIndex('by_article_seq', ['articleKey', 'seq'], { unique: true });
            pushStore.createIndex('by_article_user', ['articleKey', 'userLower'], { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          this._useMemoryFallback = true;
          resolve(null);
        };
        req.onblocked = () => {
          this._useMemoryFallback = true;
          resolve(null);
        };
      } catch {
        this._useMemoryFallback = true;
        resolve(null);
      }
    });

    return this._dbPromise;
  }

  _idbReq(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
    });
  }

  _idbTxDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async _deleteArticleRecordsIdb(db, articleKey) {
    const tx = db.transaction(['articles', 'pushes'], 'readwrite');
    tx.objectStore('articles').delete(articleKey);
    const index = tx.objectStore('pushes').index('by_article_seq');
    const range = IDBKeyRange.bound([articleKey, 0], [articleKey, Number.MAX_SAFE_INTEGER]);
    await new Promise((resolve, reject) => {
      const cursorReq = index.openKeyCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve();
          return;
        }
        tx.objectStore('pushes').delete(cursor.primaryKey);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    await this._idbTxDone(tx);
  }

  async getArticleMeta(articleKey, now = Date.now()) {
    if (!articleKey) return null;
    const db = await this._getDb();
    if (!db) {
      const meta = this._memArticles.get(articleKey) || null;
      if (!meta) return null;
      if (this.ttlMs > 0 && now - meta.updatedAt > this.ttlMs) {
        this._memArticles.delete(articleKey);
        this._memPushes.delete(articleKey);
        return null;
      }
      return { ...meta };
    }
    const tx = db.transaction(['articles'], 'readonly');
    const meta = await this._idbReq(tx.objectStore('articles').get(articleKey));
    if (!meta) return null;
    if (this.ttlMs > 0 && now - meta.updatedAt > this.ttlMs) {
      await this.clearArticle(articleKey);
      return null;
    }
    return meta;
  }

  async clearArticle(articleKey) {
    if (!articleKey) return;
    this._memArticles.delete(articleKey);
    this._memPushes.delete(articleKey);
    const db = await this._getDb();
    if (!db) return;
    await this._deleteArticleRecordsIdb(db, articleKey);
  }

  async pruneOldArticles(now = Date.now()) {
    const db = await this._getDb();
    if (!db) {
      const entries = Array.from(this._memArticles.values());
      const toDelete = [];
      const active = [];
      for (const meta of entries) {
        if (this.ttlMs > 0 && now - meta.updatedAt > this.ttlMs) {
          toDelete.push(meta.articleKey);
        } else {
          active.push(meta);
        }
      }
      if (active.length > this.maxArticles) {
        active.sort((a, b) => a.updatedAt - b.updatedAt);
        const overflow = active.length - this.maxArticles;
        for (let i = 0; i < overflow; i++) toDelete.push(active[i].articleKey);
      }
      for (const key of toDelete) {
        this._memArticles.delete(key);
        this._memPushes.delete(key);
      }
      return;
    }

    const tx = db.transaction(['articles'], 'readonly');
    const all = await this._idbReq(tx.objectStore('articles').getAll());
    const toDelete = [];
    const active = [];
    for (const meta of all || []) {
      if (this.ttlMs > 0 && now - meta.updatedAt > this.ttlMs) {
        toDelete.push(meta.articleKey);
      } else {
        active.push(meta);
      }
    }
    if (active.length > this.maxArticles) {
      active.sort((a, b) => a.updatedAt - b.updatedAt);
      const overflow = active.length - this.maxArticles;
      for (let i = 0; i < overflow; i++) toDelete.push(active[i].articleKey);
    }
    for (const key of toDelete) {
      await this._deleteArticleRecordsIdb(db, key);
    }
  }

  async saveWebHistory(articleKey, {
    board = '',
    filename = '',
    aid = '',
    title = '',
    author = '',
    pushes = [],
    source = 'web',
    now = Date.now(),
  } = {}) {
    if (!articleKey) return { articleKey: null, totalCount: 0 };
    const cleanPushes = Array.isArray(pushes) ? pushes : [];
    const records = cleanPushes.map((p, idx) => toStoredPushRecord(articleKey, idx + 1, p));
    const meta = {
      articleKey,
      board,
      filename,
      aid,
      title,
      author,
      totalCount: records.length,
      source,
      webSyncedAt: now,
      updatedAt: now,
    };

    const db = await this._getDb();
    if (!db) {
      this._memArticles.set(articleKey, meta);
      this._memPushes.set(articleKey, records);
      await this.pruneOldArticles(now);
      return { articleKey, totalCount: records.length };
    }

    await this._deleteArticleRecordsIdb(db, articleKey);
    const tx = db.transaction(['articles', 'pushes'], 'readwrite');
    tx.objectStore('articles').put(meta);
    const pushStore = tx.objectStore('pushes');
    for (const rec of records) {
      pushStore.put(rec);
    }
    await this._idbTxDone(tx);
    await this.pruneOldArticles(now);
    return { articleKey, totalCount: records.length };
  }

  async _getTailRecords(articleKey, limit = 120) {
    const db = await this._getDb();
    if (!db) {
      const arr = this._memPushes.get(articleKey) || [];
      return arr.slice(Math.max(0, arr.length - limit));
    }
    const tx = db.transaction(['pushes'], 'readonly');
    const index = tx.objectStore('pushes').index('by_article_seq');
    const range = IDBKeyRange.bound([articleKey, 0], [articleKey, Number.MAX_SAFE_INTEGER]);
    const records = [];
    await new Promise((resolve, reject) => {
      const req = index.openCursor(range, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || records.length >= limit) {
          resolve();
          return;
        }
        records.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    records.reverse();
    return records;
  }

  async _getAllArticleRecords(articleKey) {
    const db = await this._getDb();
    if (!db) {
      return [...(this._memPushes.get(articleKey) || [])];
    }
    const tx = db.transaction(['pushes'], 'readonly');
    const index = tx.objectStore('pushes').index('by_article_seq');
    const range = IDBKeyRange.bound([articleKey, 0], [articleKey, Number.MAX_SAFE_INTEGER]);
    return (await this._idbReq(index.getAll(range))) || [];
  }

  async appendPushes(articleKey, newPushes = [], metaPatch = {}) {
    if (!articleKey || !Array.isArray(newPushes) || newPushes.length === 0) {
      const meta = await this.getArticleMeta(articleKey);
      return { totalCount: meta?.totalCount || 0, addedCount: 0, updatedCount: 0 };
    }

    const now = metaPatch.now || Date.now();
    const meta = (await this.getArticleMeta(articleKey, now)) || {
      articleKey,
      board: metaPatch.board || '',
      filename: metaPatch.filename || '',
      aid: metaPatch.aid || '',
      title: metaPatch.title || '',
      author: metaPatch.author || '',
      totalCount: 0,
      source: metaPatch.source || 'terminal',
      webSyncedAt: 0,
      updatedAt: now,
    };

    const existing = await this._getTailRecords(articleKey, Math.max(200, newPushes.length * 2));
    const tailSigSet = new Set(existing.map(makePushSignature));
    const bySeqKey = new Map();
    for (const rec of existing) {
      if (rec.commentSeq != null) {
        bySeqKey.set(makePushSignature(rec), rec);
      }
    }

    const toPut = [];
    let addedCount = 0;
    let updatedCount = 0;
    let nextSeq = (meta.totalCount || 0) + 1;

    for (const p of newPushes) {
      const sig = makePushSignature(p);
      if (p?.commentSeq != null && bySeqKey.has(sig)) {
        const prev = bySeqKey.get(sig);
        const changed = prev.content !== (p.content || '')
          || Boolean(prev.isEdited) !== Boolean(p.isEdited)
          || Boolean(prev.isDeleted) !== Boolean(p.isDeleted)
          || (prev.ip || '') !== (p.ip || '')
          || (prev.time || '') !== (p.time || '');
        if (changed) {
          const updated = { ...prev, ...toStoredPushRecord(articleKey, prev.seq, p) };
          updated.pk = prev.pk;
          toPut.push(updated);
          bySeqKey.set(sig, updated);
          updatedCount++;
        }
        continue;
      }
      if (tailSigSet.has(sig)) continue;
      tailSigSet.add(sig);
      const rec = toStoredPushRecord(articleKey, nextSeq++, p);
      toPut.push(rec);
      if (rec.commentSeq != null) bySeqKey.set(sig, rec);
      addedCount++;
    }

    const nextMeta = {
      ...meta,
      ...metaPatch,
      totalCount: nextSeq - 1,
      updatedAt: now,
    };
    delete nextMeta.now;

    if (addedCount === 0 && updatedCount === 0) {
      return { totalCount: nextMeta.totalCount, addedCount: 0, updatedCount: 0 };
    }

    const db = await this._getDb();
    if (!db) {
      this._memArticles.set(articleKey, nextMeta);
      const list = this._memPushes.get(articleKey) || [];
      for (const rec of toPut) {
        const idx = list.findIndex((item) => item.pk === rec.pk);
        if (idx !== -1) list[idx] = rec;
        else list.push(rec);
      }
      this._memPushes.set(articleKey, list);
      return { totalCount: nextMeta.totalCount, addedCount, updatedCount };
    }

    const tx = db.transaction(['articles', 'pushes'], 'readwrite');
    tx.objectStore('articles').put(nextMeta);
    const pushStore = tx.objectStore('pushes');
    for (const rec of toPut) {
      pushStore.put(rec);
    }
    await this._idbTxDone(tx);
    return { totalCount: nextMeta.totalCount, addedCount, updatedCount };
  }

  async getRecentWindow(articleKey, limit = 200) {
    const meta = await this.getArticleMeta(articleKey);
    const totalCount = meta?.totalCount || 0;
    if (!totalCount) {
      return { pushes: [], oldestSeq: null, newestSeq: null, totalCount: 0, hasMore: false };
    }
    const startSeq = Math.max(1, totalCount - limit + 1);
    return this._getSeqRange(articleKey, startSeq, totalCount, totalCount);
  }

  async getWindowBefore(articleKey, beforeSeq, limit = 200) {
    const meta = await this.getArticleMeta(articleKey);
    const totalCount = meta?.totalCount || 0;
    if (!totalCount || !beforeSeq || beforeSeq <= 1) {
      return { pushes: [], oldestSeq: beforeSeq || null, newestSeq: null, totalCount, hasMore: false };
    }
    const endSeq = beforeSeq - 1;
    const startSeq = Math.max(1, endSeq - limit + 1);
    return this._getSeqRange(articleKey, startSeq, endSeq, totalCount);
  }

  async _getSeqRange(articleKey, startSeq, endSeq, totalCount) {
    const db = await this._getDb();
    let records = [];
    if (!db) {
      const list = this._memPushes.get(articleKey) || [];
      records = list.filter((rec) => rec.seq >= startSeq && rec.seq <= endSeq);
    } else {
      const tx = db.transaction(['pushes'], 'readonly');
      const index = tx.objectStore('pushes').index('by_article_seq');
      const range = IDBKeyRange.bound([articleKey, startSeq], [articleKey, endSeq]);
      records = (await this._idbReq(index.getAll(range))) || [];
    }
    records.sort((a, b) => a.seq - b.seq);
    const oldestSeq = records.length > 0 ? records[0].seq : null;
    const newestSeq = records.length > 0 ? records[records.length - 1].seq : null;
    return {
      pushes: records.map(toClientPushItem),
      oldestSeq,
      newestSeq,
      totalCount,
      hasMore: Boolean(oldestSeq && oldestSeq > 1),
    };
  }

  async findPushSeq(articleKey, push) {
    if (!articleKey || !push) return null;
    const sig = makePushSignature(push);
    const records = await this._getAllArticleRecords(articleKey);
    for (const rec of records) {
      if (makePushSignature(rec) === sig) return rec.seq;
    }
    return null;
  }

  async queryPushes(articleKey, { user = null, filterType = 'all', limit = 1200 } = {}) {
    if (!articleKey) return { pushes: [], totalMatched: 0, truncated: false };
    const cleanUser = user ? String(user).trim().toLowerCase() : null;
    const db = await this._getDb();
    let records = [];

    if (!db) {
      const list = this._memPushes.get(articleKey) || [];
      records = cleanUser ? list.filter((r) => r.userLower === cleanUser) : [...list];
    } else {
      const tx = db.transaction(['pushes'], 'readonly');
      if (cleanUser) {
        const idx = tx.objectStore('pushes').index('by_article_user');
        records = (await this._idbReq(idx.getAll(IDBKeyRange.only([articleKey, cleanUser])))) || [];
      } else {
        const idx = tx.objectStore('pushes').index('by_article_seq');
        const range = IDBKeyRange.bound([articleKey, 0], [articleKey, Number.MAX_SAFE_INTEGER]);
        records = (await this._idbReq(idx.getAll(range))) || [];
      }
    }

    records.sort((a, b) => a.seq - b.seq);
    const filtered = filterType === 'all'
      ? records
      : records.filter((rec) => matchesPushFilterType(rec, filterType));
    const totalMatched = filtered.length;
    const truncated = limit > 0 && totalMatched > limit;
    const sliced = truncated ? filtered.slice(totalMatched - limit) : filtered;
    return {
      pushes: sliced.map(toClientPushItem),
      totalMatched,
      truncated,
    };
  }
}

export const liveChatHistoryStore = new LiveChatHistoryStore();
