import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { TerminalPasteTransaction } from '../src/paste_transaction.js';
import { extractClipboardImage } from '../src/platform.js';

// Exercise the actual App handlers with transport/upload boundaries replaced.
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function fixture() {
  const a = { id: 'a', address: 'ptt.cc', isConnected: true };
  const b = { id: 'b', address: 'ptt.cc', isConnected: true };
  let active = a, session = 'one', listener, capture, complete;
  const writes = [], notices = [], copied = [], reads = [];
  const ime = { value: '', tagName: 'TEXTAREA' };
  const input = { value: 'hello world', selectionStart: 6, selectionEnd: 11, isConnected: true, tagName: 'TEXTAREA', dispatchEvent() {} };
  const transaction = new TerminalPasteTransaction({
    getActiveTab: () => active, getTabById: id => id === 'a' ? a : b,
    getSession: async () => session, send: async (...args) => writes.push(args),
    confirm: async () => true, onFailure: draft => notices.push(draft.error),
  });
  const context = {
    imageUploadHistory: { persistenceError: null }, terminalPaste: transaction, settingsManager: { settings: {} },
    showGlobalToast: text => notices.push(text), writeClipboardText: async url => copied.push(url),
    uploadImageToHost: () => { reads.push('upload'); return new Promise(resolve => { complete = resolve; }); },
    readClipboardText: async () => { reads.push('text'); return 'plain text'; },
    readClipboardImage: async () => { reads.push('image'); return new Blob(['x'], { type: 'image/png' }); },
    extractClipboardImage, isInteractiveInputElement: el => el !== ime && ['INPUT', 'TEXTAREA'].includes(el?.tagName),
    isAnyModalOpen: () => false, document: { activeElement: ime, getElementById: () => null }, imeInput: ime,
    pushHelper: { isOpen: true, textInput: input }, Event: class {}, console,
    window: { addEventListener: (type, handler, options) => { if (type === 'paste') listener = handler; if (type === 'keydown' && options?.capture) capture = handler; } },
  };
  vm.runInNewContext(source.slice(source.indexOf('async function uploadClipboardImage('), source.indexOf('// Comprehensive Keyboard Mapping')), context);
  const tick = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
  return { a, b, input, ime, context, transaction, notices, reads, writes, copied, tick,
    switchTab: () => { active = b; }, reconnect: () => { session = 'two'; },
    finish: () => complete('https://host/image.png'), paste: event => listener(event), escape: event => capture(event) };
}
function imageEvent() {
  return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
    clipboardData: { items: [{ type: 'image/png', getAsFile: () => new Blob(['x'], { type: 'image/png' }) }], getData: () => '' } };
}

test('native text paste performs just one text read', async () => {
  const f = fixture(); await f.context.doPaste();
  assert.deepEqual(f.reads, ['text']); assert.equal(f.writes[0][1], 'plain text');
});
for (const textReadThrows of [false, true]) test(`native image-only paste works when text read ${textReadThrows ? 'rejects' : 'is empty'}`, async () => {
  const f = fixture();
  f.context.readClipboardText = async () => { if (textReadThrows) throw new Error('no text'); return ''; };
  const task = f.context.doPaste(); await f.tick();
  assert.equal(f.transaction.busy, true); f.finish(); await task;
  assert.equal(f.writes[0][1], 'https://host/image.png');
});
test('event text is captured synchronously and does not read system clipboard', async () => {
  const f = fixture(); let available = true;
  const event = { preventDefault() {}, clipboardData: { items: [], getData: () => available ? 'snapshot' : '' } };
  f.paste(event); available = false; await f.tick();
  assert.deepEqual(f.reads, []); assert.equal(f.writes[0][1], 'snapshot');
});
for (const change of ['switch', 'reconnect', 'cancel', 'disconnect']) test(`upload owns lock/session across ${change}`, async () => {
  const f = fixture(), event = imageEvent(); f.paste(event);
  assert.equal(event.defaultPrevented, true); assert.equal(f.transaction.busy, true);
  await f.tick(); assert.equal((await f.transaction.paste('second')).status, 'busy');
  if (change === 'switch') f.switchTab();
  if (change === 'reconnect') f.reconnect();
  if (change === 'cancel') f.transaction.cancel();
  if (change === 'disconnect') f.a.isConnected = false;
  f.finish(); await f.tick();
  assert.equal(f.transaction.busy, false);
  if (change === 'switch') { assert.equal(f.writes.length, 1); assert.equal(f.writes[0][0], 'a'); }
  else { assert.equal(f.writes.length, 0); assert.ok(!f.notices.includes('✅ 貼上完成')); }
});
test('unrelated forms never upload; PushHelper cancels synchronously and inserts at original selection', async () => {
  const f = fixture(); f.context.document.activeElement = { tagName: 'INPUT' };
  const other = imageEvent(); f.paste(other); assert.equal(other.defaultPrevented, false); assert.deepEqual(f.reads, []);
  f.context.document.activeElement = f.input;
  const event = imageEvent(); f.paste(event); assert.equal(event.defaultPrevented, true);
  f.input.selectionStart = f.input.selectionEnd = 0;
  f.finish(); await f.tick();
  assert.equal(f.input.value, 'hello https://host/image.png'); assert.equal(f.writes.length, 0);
});
test('PushHelper refuses concurrent image uploads and preserves an edited draft', async () => {
  const f = fixture(); f.context.document.activeElement = f.input;
  f.paste(imageEvent()); f.paste(imageEvent()); assert.deepEqual(f.reads, ['upload']);
  f.input.value = 'new draft'; f.finish(); await f.tick();
  assert.equal(f.input.value, 'new draft'); assert.deepEqual(f.copied, ['https://host/image.png']);
});
test('disabled image upload preserves native input behavior and terminal text', async () => {
  const f = fixture(); f.context.settingsManager.settings.imageUploadEnabled = false;
  f.context.document.activeElement = f.input;
  const event = imageEvent(); f.paste(event); assert.equal(event.defaultPrevented, false);
  f.context.document.activeElement = f.ime; await f.context.doPaste(); assert.deepEqual(f.reads, ['text']);
});
test('desktop CSP permits HTTPS hosts, and browser shortcut preserves native paste dispatch', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  assert.match(config.app.security.csp, /connect-src[^;]*\bhttps:/);
  const branch = source.slice(source.indexOf('  if (isPaste) {'), source.indexOf('  if (handled && seq)'));
  let prevented = false, calls = 0;
  const run = vm.runInNewContext(`(function(){${branch}})`, { isTauri: () => false, isPaste: true,
    e: { preventDefault: () => { prevented = true; } }, doPaste: () => calls++, imeInput: {} });
  run(); assert.equal(prevented, false); assert.equal(calls, 0);
});

test('mixed clipboard text wins over image for terminal and PushHelper', async () => {
  const f = fixture();
  const terminal = imageEvent(); terminal.clipboardData.getData = () => 'plain before image';
  f.paste(terminal); await f.tick();
  assert.deepEqual(f.reads, []);
  assert.equal(f.writes[0][1], 'plain before image');
  f.context.document.activeElement = f.input;
  const editor = imageEvent(); editor.clipboardData.getData = () => 'keep native text paste';
  f.paste(editor);
  assert.equal(editor.defaultPrevented, false); assert.deepEqual(f.reads, []);
});

test('capture Escape cancels upload despite focused search or modal; URL never inserts or copies', async () => {
  const f = fixture(); f.paste(imageEvent()); await f.tick();
  f.context.document.activeElement = { tagName: 'INPUT' };
  let stopped = false, prevented = false;
  f.escape({ key: 'Escape', preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  assert.equal(prevented, true); assert.equal(stopped, true);
  f.finish(); await f.tick();
  assert.deepEqual(f.writes, []); assert.deepEqual(f.copied, []);
  assert.equal(f.transaction.failedDraft.remaining, 'https://host/image.png');
});

test('capture Escape resolves an open paste confirmation through its cancel handler', async () => {
  const f = fixture(); f.paste(imageEvent()); await f.tick(); let cancelled = false;
  f.context.document.getElementById = () => ({ open: true, dispatchEvent() { cancelled = true; } });
  f.escape({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(cancelled, true);
  f.finish(); await f.tick(); assert.deepEqual(f.writes, []);
});
