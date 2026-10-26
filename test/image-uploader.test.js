import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSupportedImageBlob,
  uploadImageToHost,
  deleteUploadedImage,
  ImageUploadHistoryManager,
  imageUploadHistory,
  IMGUR_DEFAULT_CLIENT_ID,
  MAX_UPLOAD_BYTES,
} from '../src/image_uploader.js';

test('isSupportedImageBlob validates blob objects', () => {
  const blob = new Blob([new Uint8Array(1024)], { type: 'image/png' });
  assert.equal(isSupportedImageBlob(blob), true);
  assert.equal(isSupportedImageBlob(null), false);
  assert.equal(isSupportedImageBlob(undefined), false);
  assert.equal(isSupportedImageBlob('not-a-blob'), false);
  assert.equal(isSupportedImageBlob(12345), false);
});

test('uploadImageToHost rejects oversized blobs', async () => {
  const oversizedBlob = {
    size: MAX_UPLOAD_BYTES + 1024,
    type: 'image/png',
    arrayBuffer: async () => new ArrayBuffer(10),
  };
  await assert.rejects(
    () => uploadImageToHost(oversizedBlob),
    /超過 20MB 上傳限制/
  );
});

test('uploadImageToHost successfully uploads to Imgur (default)', async () => {
  let capturedUrl = null;
  let capturedHeaders = null;
  let capturedBody = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = options.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          link: 'http://i.imgur.com/waterball123.png',
        },
      }),
    };
  };

  const blob = new Blob([new Uint8Array(2048)], { type: 'image/png' });

  const resultUrl = await uploadImageToHost(blob, {
    fetchFn: mockFetch,
  });

  assert.equal(capturedUrl, 'https://api.imgur.com/3/image');
  assert.equal(capturedHeaders.Authorization, `Client-ID ${IMGUR_DEFAULT_CLIENT_ID}`);
  assert.ok(capturedBody instanceof FormData);
  // Should upgrade http:// to https://
  assert.equal(resultUrl, 'https://i.imgur.com/waterball123.png');
});

test('uploadImageToHost respects custom Imgur client ID', async () => {
  let capturedHeaders = null;

  const mockFetch = async (url, options) => {
    capturedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { link: 'https://i.imgur.com/customId123.png' },
      }),
    };
  };

  const blob = new Blob([new Uint8Array(1024)], { type: 'image/png' });

  const resultUrl = await uploadImageToHost(blob, {
    fetchFn: mockFetch,
    imgurClientId: 'my-custom-client-id-xyz',
  });

  assert.equal(capturedHeaders.Authorization, 'Client-ID my-custom-client-id-xyz');
  assert.equal(resultUrl, 'https://i.imgur.com/customId123.png');
});

test('uploadImageToHost falls back to Catbox when Imgur fails', async () => {
  const calledUrls = [];

  const mockFetch = async (url) => {
    calledUrls.push(url);
    if (url.includes('imgur.com')) {
      return {
        ok: false,
        status: 429,
        json: async () => ({ data: { error: 'Rate limit exceeded' } }),
      };
    }
    if (url.includes('catbox.moe')) {
      return {
        ok: true,
        status: 200,
        text: async () => 'https://files.catbox.moe/fallback123.png\n',
      };
    }
    throw new Error('Unknown url');
  };

  const blob = new Blob([new Uint8Array(1024)], { type: 'image/png' });

  const resultUrl = await uploadImageToHost(blob, {
    provider: 'imgur',
    autoFallback: true,
    fetchFn: mockFetch,
  });

  assert.deepEqual(calledUrls, [
    'https://api.imgur.com/3/image',
    'https://catbox.moe/user/api.php',
  ]);
  assert.equal(resultUrl, 'https://files.catbox.moe/fallback123.png');
});

test('uploadImageToHost can directly upload to Catbox provider', async () => {
  let capturedBody = null;

  const mockFetch = async (url, options) => {
    capturedBody = options.body;
    return {
      ok: true,
      status: 200,
      text: async () => 'https://files.catbox.moe/direct123.png',
    };
  };

  const blob = new Blob([new Uint8Array(1024)], { type: 'image/png' });

  const resultUrl = await uploadImageToHost(blob, {
    provider: 'catbox',
    fetchFn: mockFetch,
  });

  assert.equal(resultUrl, 'https://files.catbox.moe/direct123.png');
  assert.ok(capturedBody instanceof FormData);
  assert.equal(capturedBody.get('reqtype'), 'fileupload');
});

test('uploadImageToHost uploads to custom endpoint with JSON or text return', async () => {
  const blob = new Blob([new Uint8Array(1024)], { type: 'image/png' });

  // Case 1: Custom endpoint returning JSON
  const mockFetchJson = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ url: 'https://my-cloud.org/images/pic1.jpg' }),
  });

  const url1 = await uploadImageToHost(blob, {
    provider: 'custom',
    customEndpoint: 'https://my-cloud.org/upload',
    fetchFn: mockFetchJson,
  });
  assert.equal(url1, 'https://my-cloud.org/images/pic1.jpg');

  // Case 2: Custom endpoint returning plain text URL
  const mockFetchText = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/plain' },
    text: async () => 'https://my-cloud.org/images/pic2.jpg\n',
  });

  const url2 = await uploadImageToHost(blob, {
    provider: 'custom',
    customEndpoint: 'https://my-cloud.org/upload',
    fetchFn: mockFetchText,
  });
  assert.equal(url2, 'https://my-cloud.org/images/pic2.jpg');
});

for (const provider of ['imgur', 'catbox', 'custom']) {
  for (const payload of ['https://host/image.png\r\x04', 'https://host/image.png\ncommand', 'https://host/\x1b[31m.png', 'javascript:alert(1)', 'https://user:password@host/image.png']) {
    test(`${provider} rejects unsafe response ${JSON.stringify(payload)}`, async () => {
      const fetchFn = async () => ({ ok: true, headers: { get: () => 'application/json' },
        json: async () => provider === 'imgur' ? { data: { link: payload } } : { url: payload }, text: async () => payload });
      await assert.rejects(uploadImageToHost(new Blob(['x'], { type: 'image/png' }), {
        provider, customEndpoint: 'https://host/upload', autoFallback: false, fetchFn,
      }));
    });
  }
}
test('custom endpoint rejects non-HTTPS before sending any image', async () => {
  let requests = 0;
  await assert.rejects(uploadImageToHost(new Blob(['x']), { provider: 'custom', customEndpoint: 'http://host/upload',
    fetchFn: async () => { requests++; } }), /HTTPS/);
  assert.equal(requests, 0);
});
test('Imgur timeout aborts request, then Catbox fallback succeeds', async () => {
  const requests = [];
  const url = await uploadImageToHost(new Blob(['x']), { autoFallback: true, timeoutMs: 5, fetchFn: async (url, options) => {
    requests.push(url);
    if (url.includes('imgur')) return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
    return { ok: true, text: async () => 'https://files.catbox.moe/image.png\n' };
  } });
  assert.equal(url, 'https://files.catbox.moe/image.png'); assert.equal(requests.length, 2);
});
test('failed fallback preserves original provider error and disabled fallback makes one request', async () => {
  for (const autoFallback of [true, false]) {
    let requests = 0;
    await assert.rejects(uploadImageToHost(new Blob(['x']), { autoFallback, fetchFn: async () => {
      requests++; throw new Error(requests === 1 ? 'original failure' : 'fallback failure');
    } }), /original failure/);
    assert.equal(requests, autoFallback ? 2 : 1);
  }
});

test('ImageUploadHistoryManager adds, lists, marks deleted and clears entries', () => {
  const history = new ImageUploadHistoryManager('test_history_' + Date.now(), 5);
  history.add({ url: 'https://i.imgur.com/abc.png', deletehash: 'hash123', provider: 'imgur' });
  assert.equal(history.getEntries().length, 1);
  assert.equal(history.findByUrl('https://i.imgur.com/abc.png')?.deletehash, 'hash123');

  history.markDeleted('https://i.imgur.com/abc.png');
  assert.equal(history.findByUrl('https://i.imgur.com/abc.png')?.deleted, true);

  history.clear();
  assert.equal(history.getEntries().length, 0);
});

test('deleteUploadedImage deletes from Imgur using deletehash', async () => {
  let capturedUrl = null;
  let capturedMethod = null;
  let capturedHeaders = null;
  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedMethod = options.method;
    capturedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: true }),
    };
  };

  const res = await deleteUploadedImage({
    deletehash: 'del_hash_999',
    provider: 'imgur',
    fetchFn: mockFetch,
  });

  assert.equal(res, true);
  assert.equal(capturedUrl, 'https://api.imgur.com/3/image/del_hash_999');
  assert.equal(capturedMethod, 'DELETE');
  assert.equal(capturedHeaders.Authorization, `Client-ID ${IMGUR_DEFAULT_CLIENT_ID}`);
});

test('deleteUploadedImage rejects unsupported provider or missing deletehash', async () => {
  await assert.rejects(
    deleteUploadedImage({ url: 'https://files.catbox.moe/abc.png', provider: 'catbox' }),
    { message: /此圖片沒有可用的撤回金鑰/ }
  );
  await assert.rejects(
    deleteUploadedImage({ deletehash: 'xyz', provider: 'catbox' }),
    { message: /不支援透過 API 自動撤回刪除/ }
  );
});

test('Imgur failure does not silently upload to another host by default', async () => {
  const requests = [];
  await assert.rejects(uploadImageToHost(new Blob(['x']), { fetchFn: async url => {
    requests.push(url); throw new Error('offline');
  } }), /offline/);
  assert.deepEqual(requests, ['https://api.imgur.com/3/image']);
});

test('cancellation after Imgur failure prevents even explicitly enabled fallback', async () => {
  const controller = new AbortController(); const requests = [];
  await assert.rejects(uploadImageToHost(new Blob(['x']), { signal: controller.signal, autoFallback: true,
    fetchFn: async url => { requests.push(url); controller.abort(); throw new Error('lost response'); },
  }), /取消/);
  assert.equal(requests.length, 1);
});

test('an in-flight success after cancellation retains its deletion key', async () => {
  const controller = new AbortController();
  const url = await uploadImageToHost(new Blob(['x']), { signal: controller.signal, fetchFn: async () => {
    controller.abort(); return { ok: true, json: async () => ({ data: { link: 'https://i.imgur.com/cancelled.png', deletehash: 'cancelledhash' } }) };
  } });
  assert.equal(imageUploadHistory.findByUrl(url).deletehash, 'cancelledhash');
});

test('quota failure keeps latest deletion keys and deletion state in memory', t => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => '[]', setItem: () => { throw new Error('quota'); } };
  t.after(() => { globalThis.localStorage = originalStorage; });
  const history = new ImageUploadHistoryManager();
  history.add({ url: 'https://i.imgur.com/quota.png', deletehash: 'quota-key' });
  assert.equal(history.findByUrl('https://i.imgur.com/quota.png').deletehash, 'quota-key');
  assert.ok(history.persistenceError);
  history.markDeleted('https://i.imgur.com/quota.png');
  assert.equal(history.getEntries()[0].deleted, true);
  history.clear(); assert.deepEqual(history.getEntries(), []);
});

test('all desktop providers use native IPC including Custom and reject redirects in web transport', async t => {
  const originalWindow = globalThis.window, originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.window = { __TAURI__: { core: { invoke: async (command, args) => {
    calls.push({ command, args });
    if (args.url.includes('imgur')) return JSON.stringify({ data: { link: 'https://i.imgur.com/native.png' } });
    if (args.url.includes('catbox')) return 'https://files.catbox.moe/native.png';
    return JSON.stringify({ url: 'https://host/native.png' });
  } } } };
  globalThis.fetch = () => { throw new Error('desktop must not use WebKit fetch'); };
  t.after(() => { globalThis.window = originalWindow; globalThis.fetch = originalFetch; });
  for (const provider of ['imgur', 'catbox', 'custom']) {
    await uploadImageToHost(new Blob(['x']), { provider, customEndpoint: 'https://host/upload' });
  }
  assert.equal(calls.length, 3); assert.ok(calls.every(c => c.command === 'upload_image_native'));
  assert.deepEqual(calls[2].args.fileFields, ['file', 'image']);
});

test('responses are streamed with a byte cap and cancelled when oversized', async () => {
  const { MAX_RESPONSE_BYTES, readUploadResponse } = await import('../src/image_uploader.js');
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(readUploadResponse(response), /64KB/); assert.equal(cancelled, true);
});

test('web upload rejects redirects and deletion requires provider confirmation', async () => {
  await uploadImageToHost(new Blob(['x']), { fetchFn: async (url, options) => {
    assert.equal(options.redirect, 'error'); return { ok: true, json: async () => ({ data: { link: 'https://i.imgur.com/redirect.png' } }) };
  } });
  await assert.rejects(deleteUploadedImage({ deletehash: 'validHash', provider: 'imgur', fetchFn: async (url, options) => {
    assert.equal(options.redirect, 'error'); return { ok: true, json: async () => ({ success: false, data: false }) };
  } }), /未確認刪除成功/);
});
