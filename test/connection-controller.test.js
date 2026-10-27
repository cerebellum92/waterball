import assert from 'node:assert/strict';
import test from 'node:test';

const listeners = new Map();
const sent = [];
let invokeHook = null;

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        if (command === 'send_input') {
          sent.push(args.data);
        }
        if (invokeHook) {
          return await invokeHook(command, args);
        }
      },
    },
    event: {
      listen: (name, listener) => {
        listeners.set(name, listener);
      },
    },
  },
};

const { ConnectionController } = await import('../src/connection_controller.js');

function createController() {
  listeners.clear();
  sent.length = 0;
  invokeHook = null;
  const buffer = {
    cols: 80,
    rows: 24,
    cur_x: 0,
    cur_y: 0,
    syncOutputEndGeneration: 0,
    syncOutputOrphanEndGeneration: 0,
    synchronizedOutputActive: false,
    getText: () => '',
  };
  const tab = { id: 'tab-1', buf: buffer, parser: { state: 0 }, isConnected: true };
  const controller = new ConnectionController({
    tabManager: {
      getActiveTab: () => tab,
      getTabById: () => tab,
      feedData: (_tabId, data) => data,
      updateTabStatus: (_tabId, _status) => {},
    },
    autoLoginManager: {
      hasActiveSession: () => false,
      stopSession: () => {},
    },
    notificationManager: {},
    elements: {},
  });
  controller.scheduleNotificationScrape = () => {};
  return controller;
}

test('quick login OTP reserves one try per connection and binds the send', async () => {
  const c = createController();
  const attempt = Symbol('connection');
  c.connectionAttempts.set('tab-1', attempt);
  c.getConnectionSession = async () => 'session-1';
  const writes = [];
  c.sendDataToTabAndWait = async (...args) => { writes.push(args); };
  const signal = new AbortController().signal;
  await c.sendQuickLoginOtp('tab-1', attempt, '123456', signal);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], '123456\r');
  assert.equal(writes[0][2], 'session-1');
  assert.equal(writes[0][5], true);
  await assert.rejects(c.sendQuickLoginOtp('tab-1', attempt, '654321', signal), /已嘗試過/);
  assert.equal(writes.length, 1);
});

test('quick login OTP aborts when connection changes during session lookup', async () => {
  const c = createController();
  const attempt = Symbol('connection');
  c.connectionAttempts.set('tab-1', attempt);
  c.getConnectionSession = async () => { c.connectionAttempts.set('tab-1', Symbol('new')); return 'old'; };
  let wrote = false;
  c.sendDataToTabAndWait = async () => { wrote = true; };
  await assert.rejects(c.sendQuickLoginOtp('tab-1', attempt, '123456', new AbortController().signal), /取消/);
  assert.equal(wrote, false);
});

test('terminal data does not capture full-screen diagnostics outside development', () => {
  const controller = createController();
  let screenReads = 0;
  controller.tabManager.getActiveTab().buf.getText = () => {
    screenReads++;
    return '';
  };

  listeners.get('terminal-data')({
    payload: { tab_id: 'tab-1', data: 'hello', raw_big5: false },
  });

  assert.equal(screenReads, 0);
});

async function waitForSent(count) {
  for (let attempt = 0; attempt < 20 && sent.length < count; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(sent.length, count);
}

test('navigation keys are sent immediately with zero artificial delay', async () => {
  const controller = createController();
  controller.sendData('\x1b[C');
  await waitForSent(1);
  assert.deepEqual(sent, ['\x1b[C']);

  // Second key is sent immediately without needing ?2026l or any timeout
  controller.sendData('\x1b[D');
  await waitForSent(2);
  assert.deepEqual(sent, ['\x1b[C', '\x1b[D']);
});

test('rapid repeated horizontal input keeps only the newest pending direction', async () => {
  const controller = createController();
  let releaseFirst;
  invokeHook = () => new Promise((resolve) => { releaseFirst = resolve; });

  // First key is sent and held in-flight
  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight' });
  await waitForSent(1);

  // Subsequent repeated keys arrive while first is in-flight
  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight', isRepeat: true });
  controller.sendData('\x1b[D', { sourceKey: 'ArrowLeft', isRepeat: true });

  // Queue collapses to only the latest pending direction (\x1b[D)
  assert.equal(controller.sendQueue.length, 1);
  assert.equal(controller.sendQueue[0].data, '\x1b[D');

  // Let the first finish
  invokeHook = null;
  releaseFirst();
  await waitForSent(2);
  assert.deepEqual(sent, ['\x1b[C', '\x1b[D']);
});

test('discrete rapid taps of navigation keys are never dropped', async () => {
  const controller = createController();
  let releaseFirst;
  invokeHook = () => new Promise((resolve) => { releaseFirst = resolve; });

  // First discrete key (ArrowRight) is sent and held in-flight
  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight', isRepeat: false });
  await waitForSent(1);

  // User taps ArrowLeft then ArrowDown without holding
  controller.cancelQueuedRepeatedNavigation('ArrowRight');
  controller.sendData('\x1b[D', { sourceKey: 'ArrowLeft', isRepeat: false });
  controller.cancelQueuedRepeatedNavigation('ArrowLeft');
  controller.sendData('\x1bOB', { sourceKey: 'ArrowDown', isRepeat: false });

  // All discrete keys are preserved in order in queue
  assert.equal(controller.sendQueue.length, 2);
  assert.equal(controller.sendQueue[0].data, '\x1b[D');
  assert.equal(controller.sendQueue[1].data, '\x1bOB');

  // Let all finish
  invokeHook = null;
  releaseFirst();
  await waitForSent(3);
  assert.deepEqual(sent, ['\x1b[C', '\x1b[D', '\x1bOB']);
});

test('keyup discards repeated horizontal keys still queued', async () => {
  const controller = createController();
  let releaseFirst;
  invokeHook = () => new Promise((resolve) => { releaseFirst = resolve; });

  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight' });
  await waitForSent(1);

  controller.sendData('\x1b[D', { sourceKey: 'ArrowLeft', isRepeat: true });
  assert.equal(controller.sendQueue.length, 1);

  controller.cancelQueuedRepeatedNavigation('ArrowLeft');
  assert.equal(controller.sendQueue.length, 0);

  invokeHook = null;
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(sent, ['\x1b[C']);
});

test('repeated horizontal keydowns are cancelled on keyup even without isRepeat flag', async () => {
  const controller = createController();
  let releaseFirst;
  invokeHook = () => new Promise((resolve) => { releaseFirst = resolve; });

  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight' });
  await waitForSent(1);

  // Second keydown from auto-repeat without isRepeat explicitly set
  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight' });
  assert.equal(controller.sendQueue.length, 1);
  assert.equal(controller.sendQueue[0].isRepeat, true);

  controller.cancelQueuedRepeatedNavigation('ArrowRight');
  assert.equal(controller.sendQueue.length, 0);

  invokeHook = null;
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(sent, ['\x1b[C']);
});

test('a separate tap after keyup is preserved', async () => {
  const controller = createController();
  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight' });
  await waitForSent(1);

  controller.cancelQueuedRepeatedNavigation('ArrowRight');

  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight' });
  await waitForSent(2);
  assert.deepEqual(sent, ['\x1b[C', '\x1b[C']);
});

test('PageUp and PageDown keep the latest pending direction and stop on release', async () => {
  const controller = createController();
  let releaseFirst;
  invokeHook = () => new Promise((resolve) => { releaseFirst = resolve; });

  controller.sendData('\x1b[5~', { sourceKey: 'PageUp' });
  await waitForSent(1);

  controller.sendData('\x1b[5~', { sourceKey: 'PageUp', isRepeat: true });
  controller.sendData('\x1b[6~', { sourceKey: 'PageDown', isRepeat: true });
  assert.equal(controller.sendQueue.length, 1);
  assert.equal(controller.sendQueue[0].data, '\x1b[6~');

  controller.cancelQueuedRepeatedNavigation('PageDown');
  assert.equal(controller.sendQueue.length, 0);

  invokeHook = null;
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(sent, ['\x1b[5~']);
});

test('clearHeldScreenNavigationKeys clears all held navigation keys and queued repeats', async () => {
  const controller = createController();
  let releaseFirst;
  invokeHook = () => new Promise((resolve) => { releaseFirst = resolve; });

  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight' });
  await waitForSent(1);

  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight', isRepeat: true });
  assert.equal(controller.sendQueue.length, 1);

  controller.clearHeldScreenNavigationKeys();
  assert.equal(controller.sendQueue.length, 0);
  assert.equal(controller.heldScreenNavigationKeys.size, 0);

  invokeHook = null;
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(sent, ['\x1b[C']);
});

test('disconnect purges send queue for that tab', async () => {
  const controller = createController();
  let releaseFirst;
  invokeHook = () => new Promise((resolve) => { releaseFirst = resolve; });

  controller.sendData('\x1b[C', { sourceKey: 'ArrowRight' });
  await waitForSent(1);

  controller.sendData('\x1b[D', { sourceKey: 'ArrowLeft' });
  assert.equal(controller.sendQueue.length, 1);

  listeners.get('connection-status')({ payload: { tab_id: 'tab-1', status: 'disconnected' } });
  assert.equal(controller.sendQueue.length, 0);

  invokeHook = null;
  releaseFirst();
});

test('sendWaterball locks target via Ctrl+R and sends message when caller matches', async () => {
  const controller = createController();
  let lineText = '★對 alice 丟水球:';
  controller.getBottomLineText = () => lineText;

  const res = await controller.sendWaterball('alice', '你好！');
  assert.equal(res.success, true);
  assert.ok(sent.includes('\x12')); // Sent Ctrl+R
  assert.ok(sent.includes('你好！\r'));
});

test('sendWaterball cycles Ctrl+R and falls back to Ctrl+U macro when target not in queue', async () => {
  const controller = createController();
  // Simulates that bottom line has bob, not alice
  let callCount = 0;
  controller.getBottomLineText = () => {
    callCount++;
    if (callCount <= 3) return '★對 bob 丟水球:';
    if (callCount <= 5) return '【 在線名單 】';
    return '★對 alice 丟水球:';
  };

  const res = await controller.sendWaterball('alice', '主動密你！');
  assert.equal(res.success, true);
  assert.ok(sent.includes('\x15')); // Sent Ctrl+U
  assert.ok(sent.includes('salice\r')); // Searched user
  assert.ok(sent.includes('w主動密你！\r')); // Sent waterball
  assert.ok(sent.includes('q')); // Exited back
});

test('sendWaterball detects offline recipient and returns failure', async () => {
  const controller = createController();
  let step = 0;
  controller.getBottomLineText = () => {
    step++;
    if (step <= 2) return '【無人呼叫】';
    return '【 此使用者目前不在線上 】';
  };

  const res = await controller.sendWaterball('offlineUser', '你在嗎？');
  assert.equal(res.success, false);
  assert.equal(res.reason, 'offline');
  assert.ok(sent.includes('q')); // Returned to safety
});

test('sendMail sends PTT mail via Ctrl+U macro', async () => {
  const controller = createController();
  controller.getBottomLineText = () => '【 使用者列表 】';

  const res = await controller.sendMail('bob', '[水球留言] 午餐', '要一起吃嗎？');
  assert.equal(res.success, true);
  assert.ok(sent.includes('\x15')); // Ctrl+U
  assert.ok(sent.includes('sbob\r')); // Search user
  assert.ok(sent.includes('m')); // Mail
  assert.ok(sent.includes('[水球留言] 午餐\r')); // Title
  assert.ok(sent.includes('要一起吃嗎？\r\x18s\r\r')); // Content and save
  assert.ok(sent.includes('q')); // Exit
});


test('ACK send waits for transport completion and carries immutable backend session token', async () => {
  const c=createController();let release;let captured;
  invokeHook=(command,args)=>{captured=args;return new Promise(resolve=>{release=resolve;});};
  let completed=false;const task=c.sendDataToTabAndWait('tab-1','hello','session-1').then(()=>{completed=true;});
  await waitForSent(1);assert.equal(completed,false);assert.equal(captured.expectedSession,'session-1');release();await task;assert.equal(completed,true);
});
test('failed transport cancels queued ACK writes instead of continuing a partial stream', async () => {
  const c=createController();let fail;invokeHook=()=>new Promise((resolve,reject)=>{fail=reject;});
  const first=c.sendDataToTabAndWait('tab-1','first','session-1');const second=c.sendDataToTabAndWait('tab-1','second','session-1');
  const results=Promise.allSettled([first,second]);await waitForSent(1);fail(new Error('broken stream'));
  const settled=await results;assert.ok(settled.every(r=>r.status==='rejected'));assert.deepEqual(sent,['first']);
});
test('disconnect rejects unsent ACK items so paste cannot hang waiting forever', async () => {
  const c=createController();let release;invokeHook=()=>new Promise(resolve=>{release=resolve;});
  const first=c.sendDataToTabAndWait('tab-1','first','session-1');const second=c.sendDataToTabAndWait('tab-1','second','session-1');
  const rejected=assert.rejects(second,/中斷/);await waitForSent(1);
  listeners.get('connection-status')({payload:{tab_id:'tab-1',status:'disconnected'}});await rejected;release();await first;
});

test('paste session query rejects missing tokens and returns the backend identity', async () => {
  const c=createController();invokeHook=async command=>command==='connection_session'?'backend-session':undefined;
  assert.equal(await c.getConnectionSession('tab-1'),'backend-session');invokeHook=async()=>null;
  await assert.rejects(c.getConnectionSession('tab-1'),/連線身分/);
});

test('slow writes on one tab do not block another connected tab', async () => {
  const c=createController();let release;
  invokeHook=async(command,args)=>{if(args.tabId==='tab-1')await new Promise(resolve=>{release=resolve;});};
  const first=c.sendDataToTabAndWait('tab-1','slow','one');
  const second=c.sendDataToTabAndWait('tab-2','fast','two');
  await second;assert.deepEqual(sent,['slow','fast']);release();await first;
});

test('desktop WSS continues to use native IPC with native charset and session', async () => {
  const c = createController(), commands = [];
  c.elements.addressInput = { value: 'wss://ws.ptt.cc/bbs' };
  c.elements.encodingSelect = { value: 'gbk' };
  invokeHook = async (command, args) => {
    commands.push([command, args]);
    if (command === 'connection_session') return 'native-session';
  };
  await c.connect();
  const connect = commands.find(([command]) => command === 'connect')[1];
  assert.equal(connect.transport, 'wss');
  assert.equal(connect.charset, 'gbk');
  assert.equal(await c.getConnectionSession('tab-1'), 'native-session');
  await c.disconnectTab('tab-1');
  assert.equal(commands.at(-1)[0], 'disconnect');
});

test('native close cancels the handshake attempt and tagged old events are ignored', async () => {
  const c = createController(), tab = c.tabManager.getActiveTab();
  c.elements.addressInput = { value: 'wss://ws.ptt.cc/bbs' };
  const pendingCommands = [], statuses = [], fed = [];
  let release;
  c.tabManager.updateTabStatus = (_id, status) => statuses.push(status);
  c.tabManager.feedData = (_id, data) => fed.push(data);
  invokeHook = async (command, args) => {
    pendingCommands.push([command, args]);
    if (command === 'connect') await new Promise(resolve => { release = resolve; });
  };
  const pending = c.connect();
  const oldId = pendingCommands[0][1].attemptId;
  assert.ok(oldId);
  await c.disconnectTab(tab.id);
  assert.equal(pendingCommands[1][1].attemptId, oldId);
  const count = statuses.length;
  listeners.get('connection-status')({ payload: { tab_id: tab.id, status: 'connected', attempt_id: oldId } });
  listeners.get('terminal-data')({ payload: { tab_id: tab.id, data: 'late', attempt_id: oldId } });
  release(); await pending;
  assert.equal(statuses.length, count);
  assert.deepEqual(fed, []);
  c.nativeAttempts.set(tab.id, 'replacement');
  listeners.get('connection-status')({ payload: { tab_id: tab.id, status: 'disconnected', attempt_id: oldId } });
  assert.equal(statuses.length, count);
  listeners.get('connection-status')({ payload: { tab_id: tab.id, status: 'connected', attempt_id: 'replacement' } });
  assert.equal(statuses.at(-1), 'connected');
});

test('failed native attempts remain addressable for cleanup without unscoped duplicate disconnects', async () => {
  const c = createController(), commands = [];
  c.elements.addressInput = { value: 'wss://ws.ptt.cc/bbs' };
  invokeHook = async (command, args) => {
    commands.push([command, args]);
    if (command === 'connect') throw new Error('handshake failed');
  };
  await c.connect();
  const attemptId = commands[0][1].attemptId;
  assert.equal(c.nativeAttempts.get('tab-1'), attemptId);
  await c.disconnectTab('tab-1');
  await c.disconnectTab('tab-1');
  assert.deepEqual(commands.filter(([command]) => command === 'disconnect').map(([,args]) => args), [{ tabId: 'tab-1', attemptId }]);
});

test('input owner blocks legacy and acknowledged producers while owner can send to its bound session', async () => {
  const c = createController();
  const lease = c.acquireInputLease('tab-1'); assert.ok(lease);
  assert.equal(c.acquireInputLease('tab-1'), null);
  assert.equal(c.sendDataToTab('tab-1', 'unexpected navigation'), false);
  await assert.rejects(c.sendDataToTabAndWait('tab-1', 'other producer', 'session'), /其他發送流程/);
  await c.sendDataToTabAndWait('tab-1', 'owned', 'session', lease);
  assert.deepEqual(sent, ['owned']);
  c.releaseInputLease('tab-1', Symbol('wrong owner'));
  assert.equal(c.sendDataToTab('tab-1', 'still blocked'), false);
  c.releaseInputLease('tab-1', lease);
  await assert.rejects(c.sendDataToTabAndWait('tab-1', 'stale producer', 'session', lease), /其他發送流程/);
  await c.sendDataToTabAndWait('tab-1', 'normal', 'session');
  assert.deepEqual(sent, ['owned', 'normal']);
});

test('input owner cannot be acquired while a previous write is still unresolved', async () => {
  const c = createController(); let release;
  invokeHook = async () => new Promise(resolve => { release = resolve; });
  const pending = c.sendDataToTabAndWait('tab-1', 'in flight', 'session');
  assert.equal(c.acquireInputLease('tab-1'), null);
  release(); await pending;
  assert.ok(c.acquireInputLease('tab-1'));
});

test('paste lease blocks mouse/macros and cancellation rejects queued URL without disconnecting', async () => {
  const { TerminalPasteTransaction } = await import('../src/paste_transaction.js');
  const c = createController(); let finishUpload;
  c.getConnectionSession = async () => 'session-1';
  const paste = new TerminalPasteTransaction({
    getActiveTab: () => c.tabManager.getActiveTab(), getTabById: id => c.tabManager.getTabById(id),
    getSession: id => c.getConnectionSession(id), acquireInput: id => c.acquireInputLease(id),
    releaseInput: (id, token) => c.releaseInputLease(id, token),
    send: (id, text, session, token, signal) => c.sendDataToTabAndWait(id, text, session, token, signal),
  });
  const task = paste.paste(() => new Promise(resolve => { finishUpload = resolve; }));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(c.sendDataToTab('tab-1', '\x1b[6~'), false);
  assert.equal(c.sendDataToTab('tab-1', '\r'), false);
  finishUpload('https://host/image.png'); await task;
  assert.deepEqual(sent, ['https://host/image.png']);
  assert.ok(c.acquireInputLease('tab-1'));
});

test('cancelled queued URL is discarded before transport and keeps connection alive', async () => {
  const c = createController(); let release;
  invokeHook = () => new Promise(resolve => { release = resolve; });
  const first = c.sendDataToTabAndWait('tab-1', 'first', 'session-1');
  const abort = new AbortController();
  const second = c.sendDataToTabAndWait('tab-1', 'https://host/image.png', 'session-1', null, abort.signal);
  const rejected = assert.rejects(second, /取消/);
  abort.abort(); release(); await first; await rejected;
  assert.deepEqual(sent, ['first']); assert.equal(c.tabManager.getActiveTab().isConnected, true);
});
