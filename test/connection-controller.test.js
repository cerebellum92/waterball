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
          await invokeHook(command, args);
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
