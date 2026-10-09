import test from 'node:test';
import assert from 'node:assert/strict';
import { WaterballManager } from '../src/waterball_manager.js';

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
}

test('WaterballManager adds incoming and outgoing messages and groups by contact', () => {
  const storage = new MockStorage();
  const manager = new WaterballManager(storage);

  assert.equal(manager.getTotalUnreadCount(), 0);

  // Incoming message from "userA"
  const m1 = manager.addIncomingMessage({
    sender: 'userA',
    message: '安安，在嗎？',
    timeStr: '12:00:00',
  });
  assert.ok(m1);
  assert.equal(m1.sender, 'userA');
  assert.equal(m1.isMine, false);
  assert.equal(m1.isRead, false);

  assert.equal(manager.getTotalUnreadCount(), 1);

  // Outgoing message to "userA"
  const m2 = manager.addOutgoingMessage({
    receiver: 'userA',
    message: '在喔！什麼事？',
    timeStr: '12:01:00',
  });
  assert.ok(m2);
  assert.equal(m2.isMine, true);
  assert.equal(m2.isRead, true);

  // Incoming from "UserB" (test case insensitivity)
  manager.addIncomingMessage({
    sender: 'UserB',
    message: '推文看到你的文章，寫得很好！',
  });
  assert.equal(manager.getTotalUnreadCount(), 2);

  const contacts = manager.getContacts();
  assert.equal(contacts.length, 2);

  // Verify userA conversation
  const userAMsgs = manager.getMessages('usera');
  assert.equal(userAMsgs.length, 2);
  assert.equal(userAMsgs[0].message, '安安，在嗎？');
  assert.equal(userAMsgs[1].message, '在喔！什麼事？');

  // Mark read for userA
  manager.markRead('USERA');
  assert.equal(manager.getTotalUnreadCount(), 1);

  // Delete conversation with userB
  const del = manager.deleteConversation('userB');
  assert.equal(del, true);
  assert.equal(manager.getContacts().length, 1);
  assert.equal(manager.getTotalUnreadCount(), 0);
});

test('WaterballManager export and import works properly', () => {
  const storage = new MockStorage();
  const manager = new WaterballManager(storage);

  manager.addIncomingMessage({ sender: 'claus', message: 'Hello BBS!' });
  const exported = manager.exportJson();
  assert.ok(exported.includes('Hello BBS!'));

  manager.clearAll();
  assert.equal(manager.getContacts().length, 0);

  const res = manager.importJson(exported);
  assert.equal(res.success, true);
  assert.equal(res.count, 1);
  assert.equal(manager.getMessages('claus').length, 1);
});
