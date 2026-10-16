import test from 'node:test';
import assert from 'node:assert/strict';
import { sendNativeNotification, requestNotificationPermission } from '../src/platform.js';

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
