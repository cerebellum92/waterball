import assert from 'node:assert/strict';
import test from 'node:test';
import { AutoLoginManager } from '../src/auto_login.js';

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new AutoLoginManager();
  const sent = [];
  const statuses = [];
  const errors = [];
  manager.onStatusChange = (_id, text) => statuses.push(text);
  manager.onLoginError = (_id, text) => errors.push(text);
  manager.startSession('tab', { username: 'user', password: 'password' }, value => sent.push(value));
  return { manager, sent, statuses, errors };
}

function sendCredentials(t, manager) {
  manager.feedData('tab', '請輸入代號');
  t.mock.timers.tick(120);
  t.mock.timers.tick(100);
  manager.feedData('tab', '請輸入密碼');
  t.mock.timers.tick(120);
  t.mock.timers.tick(100);
}

test('2FA pauses automatic keys until a clear post-login screen', t => {
  const { manager, sent, statuses } = setup(t);
  sendCredentials(t, manager);
  assert.deepEqual(sent, ['user', '\r', 'password', '\r']);
  manager.feedData('tab', '\x1b[31m請輸入動');
  manager.feedData('tab', '態驗證碼(OTP)或是APP通知授權:');
  assert.equal(manager.sessions.get('tab').state, 'WAIT_2FA');
  assert.match(statuses.at(-1), /手動輸入動態驗證碼/);
  manager.checkScreenBuffer('tab', '請輸入動態驗證碼: 請按任意鍵');
  t.mock.timers.tick(60000);
  assert.deepEqual(sent, ['user', '\r', 'password', '\r']);
  assert.equal(manager.sessions.get('tab').state, 'WAIT_2FA');
  manager.checkScreenBuffer('tab', '您想刪除其他重複登入的連線嗎');
  t.mock.timers.tick(100);
  assert.equal(sent.at(-1), 'y\r');
  manager.checkScreenBuffer('tab', '您想刪除其他重複登入的連線嗎');
  t.mock.timers.tick(100);
  assert.equal(sent.filter(value => value === 'y\r').length, 1);
});

test('OTP prompt cancels an already scheduled any-key send', t => {
  const { manager, sent } = setup(t);
  sendCredentials(t, manager);
  manager.feedData('tab', '請按任意鍵');
  manager.feedData('tab', '請輸入動態驗證碼:');
  t.mock.timers.tick(1000);
  assert.deepEqual(sent, ['user', '\r', 'password', '\r']);
  assert.equal(manager.sessions.get('tab').state, 'WAIT_2FA');
});

test('ordinary login still reaches the main menu', t => {
  const { manager, statuses } = setup(t);
  sendCredentials(t, manager);
  manager.feedData('tab', '主功能表');
  assert.equal(manager.sessions.get('tab').state, 'DONE');
  assert.equal(statuses.at(-1), '自動登入完成');
});

test('2FA errors stop automation without sending or closing the connection', t => {
  const { manager, sent, errors } = setup(t);
  sendCredentials(t, manager);
  manager.feedData('tab', '請輸入動態驗證碼:');
  manager.checkScreenBuffer('tab', '驗證碼錯誤');
  assert.equal(manager.hasActiveSession('tab'), false);
  assert.match(errors.at(-1), /驗證失敗/);
  t.mock.timers.tick(60000);
  assert.deepEqual(sent, ['user', '\r', 'password', '\r']);
});

test('stopping or replacing a session cancels pending nested sends', t => {
  const { manager, sent } = setup(t);
  manager.feedData('tab', '請輸入代號');
  t.mock.timers.tick(120);
  assert.deepEqual(sent, ['user']);
  manager.stopSession('tab');
  manager.startSession('tab', { username: 'new', password: 'newpass' }, value => sent.push(value));
  t.mock.timers.tick(1000);
  assert.deepEqual(sent, ['user']);
  assert.equal(manager.sessions.get('tab').username, 'new');
});

test('OTP arriving while password Enter is pending is handled after sending', t => {
  const { manager, sent } = setup(t);
  manager.feedData('tab', '請輸入代號');
  t.mock.timers.tick(120);
  t.mock.timers.tick(100);
  manager.feedData('tab', '請輸入密碼');
  t.mock.timers.tick(120);
  manager.feedData('tab', '請輸入動態驗證碼:');
  t.mock.timers.tick(100);
  assert.equal(manager.sessions.get('tab').state, 'WAIT_2FA');
  assert.deepEqual(sent, ['user', '\r', 'password', '\r']);
});

test('autofills OTP when otpCode is provided and continues to post-login prompt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new AutoLoginManager();
  const sent = [];
  const statuses = [];
  manager.onStatusChange = (_id, text) => statuses.push(text);
  manager.startSession('tab', { username: 'user', password: 'password', otpCode: '654321' }, value => sent.push(value), '', { sendOtp: async value => sent.push(value + '\r') });

  sendCredentials(t, manager);
  assert.deepEqual(sent, ['user', '\r', 'password', '\r']);

  manager.feedData('tab', '請輸入動態驗證碼(OTP)或是APP通知授權:');
  t.mock.timers.tick(120);
  await Promise.resolve();
  assert.deepEqual(sent, ['user', '\r', 'password', '\r', '654321\r']);

  // OTP in memory must be cleared immediately after consumption
  assert.equal(manager.sessions.get('tab').otpCode, '');
  assert.equal(manager.sessions.get('tab').otpSent, true);

  // Repeated OTP prompt must not trigger another send
  manager.feedData('tab', '請輸入動態驗證碼:');
  t.mock.timers.tick(1000);
  assert.deepEqual(sent, ['user', '\r', 'password', '\r', '654321\r']);

  // Post-login prompt arrives
  manager.checkScreenBuffer('tab', '您想刪除其他重複登入的連線嗎');
  t.mock.timers.tick(100);
  assert.equal(sent.at(-1), 'y\r');
});

test('autofills 2FA with live PTT prompt (請輸入兩階段(2FA)驗證碼) and handles welcome screen', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new AutoLoginManager();
  const sent = [];
  const statuses = [];
  manager.onStatusChange = (_id, text) => statuses.push(text);
  manager.startSession('tab', { username: 'user', password: 'password', otpCode: '654321' }, value => sent.push(value), '', { sendOtp: async value => sent.push(value + '\r') });

  sendCredentials(t, manager);
  assert.deepEqual(sent, ['user', '\r', 'password', '\r']);

  // Live PTT 2FA prompt
  manager.feedData('tab', '請輸入兩階段(2FA)驗證碼(6位限時數字 或8位救援碼):');
  t.mock.timers.tick(120);
  await Promise.resolve();
  assert.deepEqual(sent, ['user', '\r', 'password', '\r', '654321\r']);
  assert.equal(manager.sessions.get('tab').otpCode, '');
  assert.equal(manager.sessions.get('tab').otpSent, true);

  // Welcome screen after 2FA verification
  manager.checkScreenBuffer('tab', '歡迎您再度拜訪，上次您是在 2026/10/26 18:00:00 登入\n[請按任意鍵繼續]');
  t.mock.timers.tick(100);
  assert.equal(sent.at(-1), '\r');

  // Main menu
  manager.feedData('tab', '【 主功能表 】');
  assert.equal(manager.sessions.get('tab').state, 'DONE');
  assert.equal(statuses.at(-1), '自動登入完成');
});

test('wrong OTP with autofill triggers emergency brake without retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new AutoLoginManager();
  const sent = [];
  const errors = [];
  manager.onLoginError = (_id, text) => errors.push(text);
  manager.startSession('tab', { username: 'user', password: 'password', otpCode: '000000' }, value => sent.push(value), '', { sendOtp: async value => sent.push(value + '\r') });

  sendCredentials(t, manager);
  manager.feedData('tab', '請輸入動態驗證碼:');
  t.mock.timers.tick(120);
  await Promise.resolve();
  assert.deepEqual(sent, ['user', '\r', 'password', '\r', '000000\r']);

  manager.checkScreenBuffer('tab', '驗證碼錯誤，請重新輸入');
  assert.equal(manager.hasActiveSession('tab'), false);
  assert.match(errors.at(-1), /驗證失敗/);
  t.mock.timers.tick(1000);
  assert.deepEqual(sent, ['user', '\r', 'password', '\r', '000000\r']);
});

test('startSession fast-forwards directly if initial buffer is at password prompt', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new AutoLoginManager();
  const sent = [];
  manager.startSession('tab', { username: 'user', password: 'mypassword' }, value => sent.push(value), '請輸入密碼:');

  t.mock.timers.tick(120);
  assert.equal(sent.at(-1), 'mypassword');
  t.mock.timers.tick(100);
  assert.equal(sent.at(-1), '\r');
  assert.deepEqual(sent, ['mypassword', '\r']);
});

test('startSession fast-forwards directly if initial buffer is at OTP prompt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new AutoLoginManager();
  const sent = [];
  manager.startSession('tab', { username: 'user', password: 'mypassword', otpCode: '888999' }, value => sent.push(value), '請輸入動態驗證碼:', { sendOtp: async value => sent.push(value + '\r') });

  t.mock.timers.tick(120);
  await Promise.resolve();
  assert.deepEqual(sent, ['888999\r']);
});

test('ambiguous initial login screen never sends credentials', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new AutoLoginManager();
  const sent = [];
  manager.startSession('tab', { username: 'user', password: 'pass', otpCode: '123456' }, value => sent.push(value), '請輸入帳號\n請輸入動態驗證碼:');
  t.mock.timers.tick(1000);
  assert.deepEqual(sent, []);
  assert.equal(manager.hasActiveSession('tab'), false);
});

test('an error during OTP send cancels the session and ignores a late completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new AutoLoginManager();
  let resolveSend;
  let signal;
  const sent = [];
  manager.startSession('tab', { username: 'u', otpCode: '123456' }, value => sent.push(value), '請輸入動態驗證碼:', {
    sendOtp: (_code, s) => { signal = s; return new Promise(resolve => { resolveSend = resolve; }); },
  });
  t.mock.timers.tick(120);
  manager.feedData('tab', '驗證碼錯誤');
  assert.equal(signal.aborted, true);
  resolveSend();
  await Promise.resolve();
  assert.equal(manager.hasActiveSession('tab'), false);
  assert.deepEqual(sent, []);
});
