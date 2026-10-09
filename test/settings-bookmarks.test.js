import assert from 'node:assert/strict';
import test from 'node:test';

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
};

const { DEFAULT_BOOKMARKS, settingsManager } = await import('../src/settings.js');

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

