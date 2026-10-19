import test from 'node:test';
import assert from 'node:assert/strict';
import { WaterballManager, waterballManager } from '../src/waterball_manager.js';
import { NotificationManager } from '../src/notifications.js';

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

test('NotificationManager.feedScreenLines ignores article titles and pinned announcements', () => {
  const notif = new NotificationManager();
  notif.playChime = () => {};

  const contactsBefore = waterballManager.getContacts().length;

  // Feed pinned announcement lines (like the one reported by user)
  notif.feedScreenLines('tab1', [
    '★ 81140 9/24 ubcs 轉 [公告] 板務部小組長培訓中心招募培訓人員(發錢…',
  ]);
  notif.feedScreenLines('tab1', [
    '★             9/24 ubcs         轉 [公告] 板務部小組長培訓中心招募培訓人員(發錢…',
  ]);
  notif.feedScreenLines('tab1', [
    '★ 12345 10/18 testuser □ [新聞] 某某新聞標題',
  ]);

  // None of the article lines should create a contact or message
  assert.equal(waterballManager.getContacts().length, contactsBefore);

  // Real waterball line with valid PTT username format
  notif.feedScreenLines('tab1', [
    '★ubcs 呼叫: 嗨在嗎？ [10:20]',
  ]);
  const newContacts = waterballManager.getContacts();
  const ubcsContact = newContacts.find(c => c.contactId === 'ubcs');
  assert.ok(ubcsContact);
  assert.equal(ubcsContact.lastMessage, '嗨在嗎？');

  // Clean up
  waterballManager.deleteConversation('ubcs');
});

test('WaterballManager stitches fragmented packets when prefix matches within 1.5s', () => {
  const manager = new WaterballManager();
  manager.clearAll();

  // Packet 1: partial message
  manager.addIncomingMessage({
    sender: 'alice',
    message: '你好今天',
    timeStr: '10:30',
  });
  assert.equal(manager.getMessages('alice').length, 1);
  assert.equal(manager.getMessages('alice')[0].message, '你好今天');

  // Packet 2: completed message arriving within 1.5s
  manager.addIncomingMessage({
    sender: 'alice',
    message: '你好今天天氣真好',
    timeStr: '10:30',
  });
  // Must NOT create a second message; must update in-place
  assert.equal(manager.getMessages('alice').length, 1);
  assert.equal(manager.getMessages('alice')[0].message, '你好今天天氣真好');

  // Same for outgoing messages
  manager.addOutgoingMessage({
    receiver: 'alice',
    message: '我正在',
  });
  assert.equal(manager.getMessages('alice').length, 2);
  manager.addOutgoingMessage({
    receiver: 'alice',
    message: '我正在寫程式',
  });
  assert.equal(manager.getMessages('alice').length, 2);
  assert.equal(manager.getMessages('alice')[1].message, '我正在寫程式');

  manager.clearAll();
});

test('TermBuf triggers onBell callback when ASCII 0x07 (Bell) is received', async () => {
  const { TermBuf } = await import('../src/term_buf.js');
  const buf = new TermBuf(80, 24);
  let bellCount = 0;
  buf.onBell = () => {
    bellCount++;
  };

  buf.puts('Hello\x07World\x07');
  assert.equal(bellCount, 2);
});

test('Rapid consecutive waterballs from multiple senders are all captured without drops', () => {
  const notif = new NotificationManager();
  notif.playChime = () => {};

  waterballManager.clearAll();

  // 3 distinct waterballs in rapid succession
  notif.feedScreenLines('tab1', ['★alice 呼叫: 嗨！ [11:00]']);
  notif.feedScreenLines('tab1', ['★bob 呼叫: 在忙嗎？ [11:00]']);
  notif.feedScreenLines('tab1', ['★charlie 呼叫: 午餐吃什麼？ [11:00]']);

  const contacts = waterballManager.getContacts();
  assert.equal(contacts.length, 3);
  assert.equal(waterballManager.getMessages('alice')[0].message, '嗨！');
  assert.equal(waterballManager.getMessages('bob')[0].message, '在忙嗎？');
  assert.equal(waterballManager.getMessages('charlie')[0].message, '午餐吃什麼？');

  waterballManager.clearAll();
});

