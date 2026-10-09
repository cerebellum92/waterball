import test from 'node:test';
import assert from 'node:assert/strict';
import { UserTagsManager, TAG_COLORS } from '../src/user_tags.js';

class MockStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

test('UserTagsManager sets, retrieves and removes tags with case-insensitivity', () => {
  const storage = new MockStorage();
  const manager = new UserTagsManager(storage);

  assert.equal(manager.getTag('robertabcd'), null);
  assert.equal(manager.hasTag('robertabcd'), false);

  const ok = manager.setTag('robertabcd', {
    tag: '神級開發者',
    color: 'purple',
    note: 'PttChrome 作者',
  });
  assert.equal(ok, true);

  // Retrieve with different case
  const tagUpper = manager.getTag('ROBERTABCD');
  assert.ok(tagUpper);
  assert.equal(tagUpper.userId, 'robertabcd');
  assert.equal(tagUpper.tag, '神級開發者');
  assert.equal(tagUpper.color, 'purple');
  assert.equal(tagUpper.note, 'PttChrome 作者');

  assert.equal(manager.hasTag('robertabcd'), true);
  assert.equal(manager.hasTag('Robertabcd'), true);

  // Remove tag
  const removed = manager.removeTag('ROBERTABCD');
  assert.equal(removed, true);
  assert.equal(manager.hasTag('robertabcd'), false);
  assert.equal(manager.getTag('robertabcd'), null);
});

test('UserTagsManager defaults color to blue and rejects invalid user IDs', () => {
  const storage = new MockStorage();
  const manager = new UserTagsManager(storage);

  // User ID too short (< 2 chars)
  assert.equal(manager.setTag('a', { tag: '短帳號' }), false);

  // Invalid color defaults to blue
  manager.setTag('claus', { tag: '版主', color: 'non_existent_color' });
  const tag = manager.getTag('claus');
  assert.equal(tag.color, 'blue');

  // Empty tag and note deletes the tag
  manager.setTag('claus', { tag: '', note: '' });
  assert.equal(manager.hasTag('claus'), false);
});

test('UserTagsManager persists to storage and reloads', () => {
  const storage = new MockStorage();
  const manager1 = new UserTagsManager(storage);

  manager1.setTag('userA', { tag: '推坑王', color: 'green', note: '常發好文' });
  manager1.setTag('userB', { tag: '交易黑單', color: 'red', note: '棄單累犯' });

  // Instantiate second manager with same storage
  const manager2 = new UserTagsManager(storage);
  assert.equal(manager2.getAllTags().length, 2);

  const a = manager2.getTag('usera');
  assert.equal(a.tag, '推坑王');
  assert.equal(a.color, 'green');

  const b = manager2.getTag('userb');
  assert.equal(b.tag, '交易黑單');
  assert.equal(b.color, 'red');
});

test('UserTagsManager exportJson and importJson correctly merge and validate', () => {
  const storage = new MockStorage();
  const manager = new UserTagsManager(storage);

  manager.setTag('dev1', { tag: '前端高手', color: 'cyan', note: 'React/Vite' });
  const exported = manager.exportJson();
  assert.ok(exported.includes('前端高手'));

  // Clear and verify empty
  manager.clear();
  assert.equal(manager.getAllTags().length, 0);

  // Import back
  const result = manager.importJson(exported);
  assert.equal(result.success, true);
  assert.equal(result.count, 1);
  assert.equal(manager.hasTag('dev1'), true);

  // Invalid JSON returns error
  const fail = manager.importJson('invalid-json{{{');
  assert.equal(fail.success, false);
});

test('UserTagsManager fires change listeners on mutations', () => {
  const storage = new MockStorage();
  const manager = new UserTagsManager(storage);

  let notifiedCount = 0;
  const listener = () => { notifiedCount++; };

  manager.addListener(listener);
  manager.setTag('testUser', { tag: '測試' });
  assert.equal(notifiedCount, 1);

  manager.removeTag('testUser');
  assert.equal(notifiedCount, 2);

  manager.removeListener(listener);
  manager.setTag('testUser', { tag: '再測' });
  assert.equal(notifiedCount, 2);
});
