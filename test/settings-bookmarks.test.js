import assert from 'node:assert/strict';
import test from 'node:test';

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
};

const { DEFAULT_BOOKMARKS, settingsManager } = await import('../src/settings.js');
const { extractHostFromAddress, resolveBookmarkName } = await import('../src/tab_manager.js');

test('WSS is not automatically added to bookmarks', () => {
  assert.equal(DEFAULT_BOOKMARKS.some((bookmark) => bookmark.id === 'ptt-wss'), false);

  const bookmarks = [{ id: 'ptt-ssh', address: 'bbs@ptt.cc:22' }];
  stored.set('bbsterm_bookmarks', JSON.stringify(bookmarks));
  assert.deepEqual(settingsManager.loadBookmarks(), bookmarks);
  assert.equal(stored.has('bbsterm_wss_bookmark_migrated'), false);
});

test('existing user-created WSS bookmarks are preserved', () => {
  const bookmarks = [{ id: 'custom-wss', address: 'wss://ws.ptt.cc/bbs' }];
  stored.set('bbsterm_bookmarks', JSON.stringify(bookmarks));
  assert.deepEqual(settingsManager.loadBookmarks(), bookmarks);
});

test('ptt.cc:23 is not in DEFAULT_BOOKMARKS and is pruned from saved bookmarks', () => {
  assert.equal(DEFAULT_BOOKMARKS.some((bookmark) => bookmark.id === 'ptt-telnet' || bookmark.address === 'ptt.cc:23'), false);

  const bookmarks = [
    { id: 'ptt-ssh', address: 'bbs@ptt.cc:22' },
    { id: 'ptt-telnet', address: 'ptt.cc:23' },
  ];
  stored.set('bbsterm_bookmarks', JSON.stringify(bookmarks));
  assert.deepEqual(settingsManager.loadBookmarks(), [{ id: 'ptt-ssh', address: 'bbs@ptt.cc:22' }]);
  assert.equal(JSON.parse(stored.get('bbsterm_bookmarks')).some((bm) => bm.address === 'ptt.cc:23'), false);
});

test('extractHostFromAddress parses WebSocket, SSH, and Telnet addresses cleanly without returning protocol as host', () => {
  assert.equal(extractHostFromAddress('wss://ws.ptt.cc/bbs'), 'ws.ptt.cc');
  assert.equal(extractHostFromAddress('ws://ws.ptt.cc:443/bbs'), 'ws.ptt.cc');
  assert.equal(extractHostFromAddress('bbs@ptt.cc:22'), 'ptt.cc');
  assert.equal(extractHostFromAddress('ptt.cc:23'), 'ptt.cc');
  assert.equal(extractHostFromAddress('bbs.gamer.com.tw'), 'bbs.gamer.com.tw');
  assert.equal(extractHostFromAddress('nckugibbs.duckdns.org'), 'nckugibbs.duckdns.org');
});

test('resolveBookmarkName resolves bookmark name for WSS and SSH addresses', () => {
  const bookmarks = [
    { id: 'ptt-wss', name: '批踢踢實業坊 (PTT WebSocket)', address: 'wss://ws.ptt.cc/bbs' },
    { id: 'gamer', name: '巴哈姆特電玩資訊站', address: 'bbs.gamer.com.tw:23' },
  ];

  // Exact address match
  assert.equal(resolveBookmarkName('wss://ws.ptt.cc/bbs', bookmarks), '批踢踢實業坊 (PTT WebSocket)');
  // Host match
  assert.equal(resolveBookmarkName('bbs.gamer.com.tw', bookmarks), '巴哈姆特電玩資訊站');
  // PTT host substring fallback
  assert.equal(resolveBookmarkName('ws.ptt.cc', bookmarks), '批踢踢實業坊 (PTT WebSocket)');
  // Unknown address
  assert.equal(resolveBookmarkName('unknown-bbs.org', bookmarks), null);
});

