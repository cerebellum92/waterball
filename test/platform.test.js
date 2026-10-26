import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sendNativeNotification,
  requestNotificationPermission,
  readClipboardText,
  readClipboardImage,
  isTauri,
  safeInvoke,
  openExternalUrl,
  platformStorage,
} from '../src/platform.js';

test('readClipboardText reads via navigator.clipboard in web fallback', async () => {
  const origClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { readText: async () => 'hello clipboard' },
    configurable: true,
  });
  try {
    const text = await readClipboardText();
    assert.equal(text, 'hello clipboard');
  } finally {
    if (origClipboard) {
      Object.defineProperty(globalThis.navigator, 'clipboard', origClipboard);
    } else {
      delete globalThis.navigator.clipboard;
    }
  }
});

test('readClipboardText safely returns empty string on error', async () => {
  const origClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: {
      readText: async () => {
        throw new Error('Permission denied');
      },
    },
    configurable: true,
  });
  try {
    const text = await readClipboardText();
    assert.equal(text, '');
  } finally {
    if (origClipboard) {
      Object.defineProperty(globalThis.navigator, 'clipboard', origClipboard);
    } else {
      delete globalThis.navigator.clipboard;
    }
  }
});

test('sendNativeNotification invokes send_system_notification when in Tauri environment', async () => {
  let invokedCommand = null;
  let invokedPayload = null;

  global.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd, payload) => {
          invokedCommand = cmd;
          invokedPayload = payload;
          return true;
        },
      },
    },
  };

  const result = await sendNativeNotification(
    '📢 [Stock] 新文章通知',
    '台積電最新營收創歷史新高 (analyst | 爆推)',
    null,
    { sound: true, subtitle: '[Stock]', url: 'https://www.ptt.cc/bbs/Stock/M.123.html' }
  );

  assert.equal(result, true);
  assert.equal(invokedCommand, 'send_system_notification');
  assert.equal(invokedPayload.title, '📢 [Stock] 新文章通知');
  assert.equal(invokedPayload.body, '台積電最新營收創歷史新高 (analyst | 爆推)');
  assert.equal(invokedPayload.subtitle, '[Stock]');
  assert.equal(invokedPayload.url, 'https://www.ptt.cc/bbs/Stock/M.123.html');
  assert.equal(invokedPayload.sound, true);

  delete global.window;
});

test('sendNativeNotification falls back to Web Notification when window.Notification is available', async () => {
  let createdNotification = null;

  class MockNotification {
    constructor(title, options) {
      createdNotification = { title, ...options };
    }
    static permission = 'granted';
    static async requestPermission() {
      return 'granted';
    }
  }

  global.window = {
    Notification: MockNotification,
  };
  global.Notification = MockNotification;

  const result = await sendNativeNotification('測試標題', '測試內文', null, { sound: false });

  assert.equal(result, true);
  assert.equal(createdNotification.title, '測試標題');
  assert.equal(createdNotification.body, '測試內文');
  assert.equal(createdNotification.silent, true);

  delete global.window;
  delete global.Notification;
});

test('sendNativeNotification returns false and does not pretend to succeed when send_system_notification fails', async () => {
  let webNotifCalled = false;
  class MockNotification {
    constructor() {
      webNotifCalled = true;
    }
    static permission = 'granted';
  }

  global.window = {
    Notification: MockNotification,
    __TAURI__: {
      core: {
        invoke: async () => {
          throw new Error('系統推播權限遭拒絕');
        },
      },
    },
  };
  global.Notification = MockNotification;

  const result = await sendNativeNotification('標題', '內容', null, {
    url: 'https://www.ptt.cc/bbs/Stock/M.123.html',
  });
  assert.equal(result, false);
  assert.equal(webNotifCalled, false);

  await assert.rejects(
    () =>
      sendNativeNotification('標題', '內容', null, {
        url: 'https://www.ptt.cc/bbs/Stock/M.123.html',
        throwOnError: true,
      }),
    /系統推播權限遭拒絕/
  );

  delete global.window;
  delete global.Notification;
});

test('safeInvoke rejects unsupported operations instead of acknowledging success', async () => {
  await assert.rejects(safeInvoke('connect'), /尚未支援原生操作/);
  await assert.rejects(safeInvoke('send_input'), /尚未支援原生操作/);
});

test('platformStorage supports local fallback and get/set/remove', async () => {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  await platformStorage.set('test_key', { foo: 'bar' });
  const val = await platformStorage.get('test_key');
  assert.deepEqual(val, { foo: 'bar' });

  await platformStorage.remove('test_key');
  const removedVal = await platformStorage.get('test_key', 'default');
  assert.equal(removedVal, 'default');

  delete global.localStorage;
});



test('external links use the registered native command', async () => {
  const calls = [];
  global.window = { __TAURI__: { core: { invoke: async (...args) => calls.push(args) } } };
  try {
    await openExternalUrl('https://www.ptt.cc');
    assert.deepEqual(calls, [['open_browser_url', { url: 'https://www.ptt.cc' }]]);
  } finally { delete global.window; }
});

function mockClipboard(t, { native = null, permission = null } = {}) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
  let webCalls = 0, nativeCalls = 0;
  globalThis.window = native ? { __TAURI_INTERNALS__: { invoke: async command => {
    assert.equal(command, 'plugin:clipboard-manager|read_text'); nativeCalls++; return native();
  } } } : {};
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => { webCalls++; return 'mock web clipboard'; } } });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: permission ? { query: permission } : undefined });
  t.after(() => {
    for (const [owner, key, descriptor] of [[globalThis, 'window', originalWindow], [navigator, 'clipboard', originalClipboard], [navigator, 'permissions', originalPermissions]]) {
      if (descriptor) Object.defineProperty(owner, key, descriptor); else delete owner[key];
    }
  });
  return { get webCalls() { return webCalls; }, get nativeCalls() { return nativeCalls; } };
}

test('noninteractive Tauri native failure cannot fall through to a WebKit Paste request', async t => {
  const calls = mockClipboard(t, { native: () => { throw new Error('native read denied'); }, permission: async () => ({ state: 'granted' }) });
  assert.equal(await readClipboardText({ interactive: false }), ''); assert.equal(calls.nativeCalls, 1); assert.equal(calls.webCalls, 0);
});

test('noninteractive native success uses only the Tauri clipboard', async t => {
  const calls = mockClipboard(t, { native: () => 'mock native clipboard' });
  assert.equal(await readClipboardText({ interactive: false }), 'mock native clipboard'); assert.equal(calls.webCalls, 0);
});

for (const kind of ['missing', 'unsupported', 'prompt', 'denied', 'granted']) test(`background web clipboard requires an explicitly granted readable permission: ${kind}`, async t => {
  const permission = kind === 'missing' ? null : async () => { if (kind === 'unsupported') throw new Error('unsupported'); return { state: kind }; };
  const calls = mockClipboard(t, { permission });
  assert.equal(await readClipboardText({ interactive: false }), kind === 'granted' ? 'mock web clipboard' : '');
  assert.equal(calls.webCalls, kind === 'granted' ? 1 : 0);
});

test('readClipboardImage extracts image from clipboardData items', async () => {
  const mockFile = { name: 'test.png', type: 'image/png' };
  const fakeClipboardData = {
    items: [
      { type: 'text/plain', getAsFile: () => null },
      { type: 'image/png', getAsFile: () => mockFile },
    ],
  };
  const img = await readClipboardImage({ clipboardData: fakeClipboardData });
  assert.equal(img, mockFile);
});

test('readClipboardImage extracts image from clipboardData files', async () => {
  const mockFile = { name: 'test.jpg', type: 'image/jpeg' };
  const fakeClipboardData = {
    items: [],
    files: [mockFile],
  };
  const img = await readClipboardImage({ clipboardData: fakeClipboardData });
  assert.equal(img, mockFile);
});

test('readClipboardImage returns null when clipboardData contains only text', async () => {
  const fakeClipboardData = {
    items: [{ type: 'text/plain', getAsFile: () => null }],
    files: [],
  };
  const img = await readClipboardImage({ clipboardData: fakeClipboardData });
  assert.equal(img, null);
});

function nativeClipboardHarness(t, invoke) {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const webCalls = [], nativeCalls = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    nativeCalls.push(command); return invoke(command, args);
  } } };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    read: async () => { webCalls.push('image'); return []; },
    readText: async () => { webCalls.push('text'); return 'unexpected web fallback'; },
  } });
  t.after(() => {
    for (const [owner, key, descriptor] of [[globalThis, 'window', windowDescriptor], [navigator, 'clipboard', clipboardDescriptor]]) {
      if (descriptor) Object.defineProperty(owner, key, descriptor); else delete owner[key];
    }
  });
  return { webCalls, nativeCalls };
}

test('desktop text paste probes a missing native image and then reads native text without a WebKit request', async t => {
  const h = nativeClipboardHarness(t, command => {
    if (command.endsWith('read_image')) throw new Error('clipboard has no image');
    if (command.endsWith('read_text')) return '原生剪貼簿文字';
    throw new Error('unexpected command');
  });
  assert.equal(await readClipboardImage(), null);
  assert.equal(await readClipboardText(), '原生剪貼簿文字');
  assert.deepEqual(h.nativeCalls, ['plugin:clipboard-manager|read_image', 'plugin:clipboard-manager|read_text']);
  assert.deepEqual(h.webCalls, []);
});

test('explicit desktop text read failure reports an error without falling back to WebKit', async t => {
  const h = nativeClipboardHarness(t, () => { throw new Error('permission denied'); });
  await assert.rejects(readClipboardText(), /無法讀取系統剪貼簿/);
  assert.deepEqual(h.webCalls, []);
});

test('text-only paste event never rereads either system clipboard API', async t => {
  const h = nativeClipboardHarness(t, () => { throw new Error('should not run'); });
  assert.equal(await readClipboardImage({ clipboardData: { items: [{ type: 'text/plain' }], files: [] } }), null);
  assert.deepEqual(h.nativeCalls, []); assert.deepEqual(h.webCalls, []);
});

test('background web image reads do not prompt when the permission API is unavailable', async t => {
  const h = nativeClipboardHarness(t, () => { throw new Error('should not run'); });
  globalThis.window = {};
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'permissions');
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
  t.after(() => { if (descriptor) Object.defineProperty(navigator, 'permissions', descriptor); else delete navigator.permissions; });
  assert.equal(await readClipboardImage({ interactive: false }), null); assert.deepEqual(h.webCalls, []);
});

test('explicit web image read remains available outside Tauri', async t => {
  const h = nativeClipboardHarness(t, () => { throw new Error('should not run'); });
  globalThis.window = {};
  const blob = new Blob(['web image'], { type: 'image/png' });
  navigator.clipboard.read = async () => { h.webCalls.push('image'); return [{ types: ['image/png'], getType: async () => blob }]; };
  assert.equal(await readClipboardImage(), blob); assert.deepEqual(h.nativeCalls, []); assert.deepEqual(h.webCalls, ['image']);
});

for (const conversionFails of [false, true]) test(`native image paste retains image support and closes the resource (conversion failure: ${conversionFails})`, async t => {
  const blob = new Blob(['native image'], { type: 'image/png' });
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: () => ({ getContext: () => ({
    createImageData: () => { if (conversionFails) throw new Error('canvas failure'); return { data: new Uint8ClampedArray(4) }; },
    putImageData() {},
  }), toBlob: done => done(blob) }) };
  t.after(() => { if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else delete globalThis.document; });
  const h = nativeClipboardHarness(t, command => {
    if (command.endsWith('read_image')) return 42;
    if (command === 'plugin:image|size') return { width: 1, height: 1 };
    if (command === 'plugin:image|rgba') return [255, 0, 0, 255];
    if (command === 'plugin:resources|close') return;
    throw new Error('unexpected command');
  });
  assert.equal(await readClipboardImage(), conversionFails ? null : blob);
  assert.equal(h.nativeCalls.filter(command => command === 'plugin:resources|close').length, 1);
  assert.deepEqual(h.webCalls, []);
});

test('oversized native clipboard dimensions are rejected before RGBA allocation and still close the resource', async t => {
  const h = nativeClipboardHarness(t, command => {
    if (command.endsWith('read_image')) return 42;
    if (command === 'plugin:image|size') return { width: 100000, height: 100000 };
    if (command === 'plugin:resources|close') return;
    throw new Error('must not fetch RGBA or allocate canvas');
  });
  await assert.rejects(readClipboardImage(), /尺寸過大/);
  assert.equal(h.nativeCalls.includes('plugin:image|rgba'), false);
  assert.equal(h.nativeCalls.filter(c => c === 'plugin:resources|close').length, 1);
});
