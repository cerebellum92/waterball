import test from 'node:test';
import assert from 'node:assert/strict';
import { TermBuf } from '../src/term_buf.js';

class Element {
  constructor() {
    this.children = []; this.style = {}; this.value = ''; this.textContent = ''; this.disabled = false; this.events = {}; this.classes = new Set();
    this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c), contains: c => this.classes.has(c),
      toggle: (c, force) => { const on = force ?? !this.classes.has(c); if (on) this.classes.add(c); else this.classes.delete(c); return on; } };
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ''; }
  addEventListener(name, callback) { this.events[name] = callback; }
  appendChild(child) { this.children.push(child); return child; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...((selector === 'button' && child.tag === 'button') || (selector === '.push-item-text' && child.className === 'push-item-text') ? [child] : []), ...child.querySelectorAll(selector)]); }
  focus() {} select() {}
}
let elements;
globalThis.document = { getElementById: id => elements.get(id) || (elements.set(id, new Element()), elements.get(id)),
  createElement: tag => Object.assign(new Element(), { tag }) };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { PushHelper } = await import('../src/push_helper.js');
const READING = '瀏覽 第 1/1 頁 (100%) 目前顯示: 第 01~24 行 (X)推文';
const CHOICE = '您覺得這篇文章: 1)值得推薦 2)給他劣文 3)只加意見 (1/2/3)?';
const INPUT = '請輸入您的意見:';
const CONFIRM = '確定要儲存檔案嗎(Y/N)? [N]';

function fixture(options = {}) {
  elements = new Map();
  const buf = new TermBuf(80, 24);
  const tab = { id: 'one', address: 'bbs@ptt.cc:22', encoding: 'big5', isConnected: true, buf };
  let active = tab, session = 'session-1', lease = null, now = 0, pending = null, echoRow = 6;
  const writes = [], events = []; let helper;
  const row = (index, text) => { buf.gotoPos(0, index); buf.eraseLine(2); buf.puts(text); };
  const footer = text => { row(22, ''); row(23, text); };
  row(0, '作者: OriginalID (作者) 看板: Test'); row(1, '標題: [測試] 同一篇文章'); row(2, '時間: Fri Oct 23 12:00:00 2026'); footer(options.initial || READING);
  const schedule = (delay, action) => events.push({ at: now + delay, action });
  const echo = (segment = pending, id = helper.idInput.value || 'readerID') => row(echoRow++, `→ ${id}: ${segment} 10/23 12:00`);
  const normal = data => {
    if (data === '%') footer(CHOICE);
    else if (['1', '2', '3'].includes(data)) footer(INPUT);
    else if (data === 'y\r') { echo(); footer(READING); pending = null; }
    else if (data.endsWith('\r')) { pending = data.slice(0, -1); footer(CONFIRM); }
    else throw new Error('unexpected command');
  };
  helper = new PushHelper(null, () => active, {
    getTabById: id => id === tab.id ? tab : null,
    getSession: async () => session,
    acquireInput: () => { if (lease) return null; return lease = Symbol('owner'); },
    releaseInput: (_id, token) => { assert.equal(token, lease); lease = null; },
    sendToTab: async (id, data, expectedSession, token) => {
      assert.equal(id, tab.id); assert.equal(expectedSession, session); assert.equal(token, lease);
      writes.push(data);
      if (options.onSend) await options.onSend(data, api); else normal(data);
    },
    now: () => now, promptTimeoutMs: 1000, maxRunMs: 300000,
    sleep: options.nativeSleep ? undefined : async (ms, signal) => {
      if (signal.aborted) throw new Error('已停止發送');
      now += ms;
      for (let i = events.length - 1; i >= 0; i--) if (events[i].at <= now) { const [event] = events.splice(i, 1); event.action(); }
      await options.onSleep?.(ms, api);
    },
  });
  helper.idInput.value = 'readerID'; helper.typeSelect.value = '1'; helper.strategySelect.value = 'fill'; helper.delaySelect.value = 'auto'; helper.textInput.value = '第一段\n第二段'; helper.currentSegments = ['第一段', '第二段'];
  const api = { helper, tab, buf, writes, row, footer, normal, echo, schedule,
    get now() { return now; }, get lease() { return lease; }, set active(value) { active = value; }, set session(value) { session = value; },
    set pending(value) { pending = value; }, get pending() { return pending; } };
  return api;
}
const pump = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await Promise.resolve(); } throw new Error('test did not reach checkpoint'); };

test('author headers accept canonical IDs and brackets; compare case-insensitively and restore controls', () => {
  const f = fixture(); f.row(0, '作者: [OriginalID] (作者) 看板: Test');
  assert.equal(f.helper.detectArticleAuthor(), 'OriginalID');
  f.helper.idInput.value = 'originalid'; assert.equal(f.helper.checkAuthorMode(), true);
  assert.equal(f.helper.typeSelect.value, 'author'); assert.equal(f.helper.typeSelect.disabled, true);
  f.helper.idInput.value = 'otheruser'; assert.equal(f.helper.checkAuthorMode(), false);
  assert.equal(f.helper.typeSelect.value, '1'); assert.equal(f.helper.typeSelect.disabled, false);
  f.row(0, '作者: 1234 (not an account)'); assert.equal(f.helper.detectArticleAuthor(), null);
});

test('only active footer prompts are classified; prose, password screens and unrelated confirmations fail closed', () => {
  const f = fixture();
  for (const [text, state] of [[READING, 'idle'], [CHOICE, 'choose-type'], [INPUT, 'input-content'], ['加註意見 (→):', 'input-content'], [CONFIRM, 'confirm-save'], ['這裡寫著值得推薦與請輸入您的意見', 'unknown'], ['請輸入密碼:', 'unknown'], ['確定要刪除檔案嗎(Y/N)? [N]', 'unknown']]) {
    f.footer(text); assert.equal(f.helper.detectPushState(), state, text);
  }
  f.row(22, '推 readerID: 請輸入您的意見: 10/23 12:00'); f.row(23, READING);
  assert.equal(f.helper.detectPushState(), 'idle');
});

test('cooldown variants are anchored, positive and bounded', () => {
  const f = fixture();
  for (const text of ['◆ 請勿快速連續推文，請等待 5 秒', '◆ 請勿快速連續推文, 請等待 5 秒', '◆ 距離上次發文或推文間隔需 5 秒', '◆ 需間隔 5 秒才能再次推文', '請勿在 5 秒內連續推文']) {
    f.footer(text); assert.equal(f.helper.detectCooldownSeconds(), 5);
  }
  for (const text of ['推 someone: 請稍候 5 秒 10/23 12:00', '◆ 請稍候 999999 秒', '◆ 請稍候 0 秒', '◆ 請稍候 -1 秒']) { f.footer(text); assert.equal(f.helper.detectCooldownSeconds(), null); }
});

test('already-input state sends neither percent nor a type; confirmation is owned by this payload', async () => {
  const f = fixture({ initial: INPUT });
  const result = await f.helper.sendSegmentSequence('防止 %1', '1');
  assert.equal(result.status, 'confirmed'); assert.deepEqual(f.writes, ['防止 %1\r', 'y\r']);
});

test('known original author cannot send type 1 or 2 even if selected programmatically', async () => {
  for (const type of ['1', '2']) {
    const f = fixture({ initial: CHOICE }); f.helper.idInput.value = 'originalid';
    assert.equal((await f.helper.sendSegmentSequence('原PO補充', type)).status, 'confirmed');
    assert.deepEqual(f.writes, ['3', '原PO補充\r', 'y\r']);
  }
});

test('unknown identity uses arrow; recognized readers may select type once, later segments use arrow', async () => {
  const f = fixture();
  assert.equal((await f.helper.startPushing()).status, 'confirmed');
  assert.deepEqual(f.writes, ['%', '1', '第一段\r', 'y\r', '%', '3', '第二段\r', 'y\r']);
  const unknown = fixture({ initial: CHOICE }); unknown.helper.idInput.value = '';
  assert.equal((await unknown.helper.sendSegmentSequence('未知 ID', '2')).status, 'confirmed');
  assert.equal(unknown.writes[0], '3');
});

test('a pre-existing confirmation or nonempty input draft is never submitted', async () => {
  for (const initial of [CONFIRM, '請輸入您的意見: 使用者原有草稿']) {
    const f = fixture({ initial }); const result = await f.helper.sendSegmentSequence('新文字', '1');
    assert.equal(result.status, 'failed'); assert.deepEqual(f.writes, []);
  }
});

test('unknown screens never receive percent or payload', async () => {
  const f = fixture({ initial: '主功能表' });
  const result = await f.helper.startPushing(); assert.equal(result.status, 'failed'); assert.deepEqual(f.writes, []);
});

test('slow prompts are waited for; type timeout never sends text or an unconditional y', async () => {
  const slow = fixture({ onSend(data, f) { if (data === '%') f.schedule(800, () => f.footer(CHOICE)); else f.normal(data); } });
  assert.equal((await slow.helper.sendSegmentSequence('慢回應', '1')).status, 'confirmed');
  assert.ok(slow.now >= 800);
  const timeout = fixture({ onSend(data, f) { if (data === '%') f.footer(CHOICE); } });
  assert.equal((await timeout.helper.sendSegmentSequence('不可送出', '1')).status, 'failed');
  assert.deepEqual(timeout.writes, ['%', '1']);
});

test('no confirmation means no y and no automatic resend; uncertain text stays available', async () => {
  const f = fixture({ initial: INPUT, onSend() {} });
  const result = await f.helper.sendSegmentSequence('結果未知', '1');
  assert.equal(result.uncertain, true); assert.deepEqual(f.writes, ['結果未知\r']);
  assert.equal(f.helper.textInput.value, '結果未知'); assert.equal(f.helper.sendBtn.disabled, true);
  assert.equal((await f.helper.startPushing()).status, 'needs-review');
  assert.deepEqual(f.writes, ['結果未知\r']);
});

test('reading footer without a new matching echo does not count as delivery', async () => {
  const f = fixture({ onSend(data, api) { if (data === 'y\r') api.footer(READING); else api.normal(data); } });
  const result = await f.helper.sendSegmentSequence('不可假裝成功', '1');
  assert.equal(result.status, 'failed'); assert.equal(result.uncertain, true); assert.equal(result.confirmed, 0);
  assert.equal(f.writes.filter(data => data === 'y\r').length, 1);
});

test('a delayed new echo can confirm delivery without repeating save', async () => {
  const f = fixture({ onSend(data, api) { if (data === 'y\r') { api.footer(READING); api.schedule(700, () => api.echo()); } else api.normal(data); } });
  assert.equal((await f.helper.sendSegmentSequence('延遲回顯', '1')).status, 'confirmed');
  assert.equal(f.writes.filter(data => data === 'y\r').length, 1);
});

test('an explicit pre-payload cooldown can retry the same segment without sending content during rejection', async () => {
  let rejected = false;
  const f = fixture({ onSend(data, api) { if (data === '%' && !rejected) { rejected = true; api.footer('◆ 請勿快速連續推文，請等待 2 秒'); } else api.normal(data); } });
  assert.equal((await f.helper.sendSegmentSequence('冷卻重試', '1')).status, 'confirmed');
  assert.deepEqual(f.writes, ['%', '%', '1', '冷卻重試\r', 'y\r']); assert.ok(f.now >= 2500);
});

test('explicit rejection after text but before save is the only payload retry path', async () => {
  let rejected = false;
  const f = fixture({ onSend(data, api) { if (data === '冷卻重試\r' && !rejected) { rejected = true; api.footer('◆ 需間隔 1 秒才能再次推文'); } else api.normal(data); } });
  assert.equal((await f.helper.sendSegmentSequence('冷卻重試', '1')).status, 'confirmed');
  assert.equal(f.writes.filter(data => data === '冷卻重試\r').length, 2);
  assert.equal(f.writes.filter(data => data === 'y\r').length, 1);
});

test('post-confirmation cooldown is uncertain and must not cause a duplicate retry', async () => {
  const f = fixture({ onSend(data, api) { if (data === 'y\r') api.footer('◆ 請勿快速連續推文，請等待 1 秒'); else api.normal(data); } });
  const result = await f.helper.sendSegmentSequence('不重複', '1');
  assert.equal(result.status, 'failed'); assert.equal(result.uncertain, true);
  assert.equal(f.writes.filter(data => data === '不重複\r').length, 1);
});

test('cooldown retries are finite, stale initial warnings are not adopted, and invalid delays stop', async () => {
  const f = fixture({ onSend(_data, api) { api.footer('◆ 請稍候 1 秒'); } });
  assert.equal((await f.helper.sendSegmentSequence('有限重試', '1')).status, 'failed');
  assert.deepEqual(f.writes, ['%', '%', '%', '%']); assert.equal(f.lease, null);
  const stale = fixture({ initial: '◆ 請稍候 1 秒' });
  assert.equal((await stale.helper.sendSegmentSequence('不接手舊警告', '1')).status, 'failed'); assert.deepEqual(stale.writes, []);
  const invalid = fixture({ onSend(_data, api) { api.footer('◆ 請稍候 999999 秒'); } });
  assert.equal((await invalid.helper.sendSegmentSequence('不等無限久', '1')).status, 'failed'); assert.deepEqual(invalid.writes, ['%']);
});

test('cancel during cooldown immediately stops future writes and preserves pending segments', async () => {
  const f = fixture({ onSend(_data, api) { api.footer('◆ 請稍候 5 秒'); }, onSleep(_ms, api) { api.helper.abort(); } });
  const result = await f.helper.startPushing();
  assert.equal(result.status, 'aborted'); assert.deepEqual(f.writes, ['%']); assert.equal(f.helper.textInput.value, '第一段\n第二段');
});

test('cancel and reopen cannot release an unresolved transport or start a competing run', async () => {
  let release;
  const f = fixture({ onSend: () => new Promise(resolve => { release = resolve; }) });
  const running = f.helper.startPushing(); await pump(() => Boolean(release));
  f.helper.abort(); f.helper.open();
  assert.equal(f.helper.isPushing, true); assert.ok(f.lease);
  assert.equal((await f.helper.startPushing()).status, 'busy');
  release(); assert.equal((await running).status, 'aborted');
  assert.equal(f.lease, null); assert.deepEqual(f.writes, ['%']);
});

test('tab switches, reconnects and article changes stop the bound transaction', async () => {
  for (const change of [f => { f.active = { ...f.tab, id: 'other' }; }, f => { f.session = 'new-session'; }, f => { f.row(1, '標題: 另一篇文章'); }, f => { f.tab.isConnected = false; }]) {
    const f = fixture({ onSend(data, api) { api.normal(data); if (data === '%') change(api); } });
    assert.equal((await f.helper.startPushing()).status, 'failed'); assert.deepEqual(f.writes, ['%']); assert.equal(f.lease, null);
  }
});

test('transport failure preserves uncertain content and restores UI without claiming success', async () => {
  const f = fixture({ initial: INPUT, onSend() { throw new Error('write failed'); } });
  const result = await f.helper.startPushing(); assert.equal(result.status, 'failed'); assert.equal(result.uncertain, true);
  assert.equal(f.helper.isPushing, false); assert.equal(f.helper.textInput.disabled, false); assert.equal(f.helper.sendBtn.disabled, true); assert.equal(f.lease, null);
});

test('confirmed prefix is not automatically repeated after a later failure', async () => {
  const f = fixture({ onSend(data, api) { if (data === '第二段\r') throw new Error('uncertain second segment'); api.normal(data); } });
  const result = await f.helper.startPushing();
  assert.equal(result.confirmed, 1); assert.equal(result.uncertain, true); assert.equal(f.helper.textInput.value, '第二段');
  assert.deepEqual(f.helper.lastRun.originalSegments, ['第一段', '第二段']);
  assert.equal(f.writes.filter(data => data === '第一段\r').length, 1);
});

test('single-send shares the same lock and preserves other edited draft segments', async () => {
  const f = fixture();
  assert.equal((await f.helper.runSegments(['第二段'], '1', { singleIndex: 1 })).status, 'confirmed');
  assert.deepEqual(f.helper.currentSegments, ['第一段']); assert.equal(f.helper.textInput.value, '第一段');
});

test('control characters and edited over-limit segments are rejected before any write', async () => {
  for (const segment of ['text\rY', 'text\nnext', '\x1b[31m', '\x07', '中'.repeat(24), '']) {
    const f = fixture(); const result = await f.helper.sendSegmentSequence(segment, '1');
    assert.equal(result.status, 'failed', JSON.stringify(segment)); assert.deepEqual(f.writes, []);
  }
});

test('blank preview clears stale segments; Big5 symbol estimates are conservative', async () => {
  const f = fixture(); f.helper.textInput.value = ''; f.helper.updatePreview();
  assert.deepEqual(f.helper.currentSegments, []); assert.equal((await f.helper.startPushing()).status, 'failed'); assert.deepEqual(f.writes, []);
  assert.equal(f.helper.getStringByteWidth('Aé→😀'), 7);
  for (const segment of f.helper.splitText('中é→😀'.repeat(30), 46, 'punct')) assert.ok(f.helper.getStringByteWidth(segment) <= 46);
});

test('unsupported stations, incompatible encoding and missing acknowledged transport fail closed', async () => {
  const bad = fixture(); bad.tab.address = 'evilptt.example';
  assert.equal((await bad.helper.startPushing()).status, 'failed'); assert.deepEqual(bad.writes, []);
  const utf8 = fixture(); utf8.tab.encoding = 'utf-8'; assert.equal((await utf8.helper.startPushing()).status, 'failed');
  const unbound = fixture(); unbound.helper.sendToTab = null; assert.equal((await unbound.helper.startPushing()).status, 'failed');
});

test('native sleeps remove their timer when aborted', async () => {
  const controller = new AbortController();
  const waiting = PushHelper.prototype.sleep(10000, controller.signal);
  controller.abort(); await assert.rejects(waiting, /已停止/);
});

test('identity-unknown UI shows and locks the conservative arrow selection', () => {
  const f = fixture(); f.helper.idInput.value = ''; f.helper.checkAuthorMode();
  assert.equal(f.helper.typeSelect.value, '3'); assert.equal(f.helper.typeSelect.disabled, true);
});

test('partial TCP prompt fragments do not release payload or save keys', async () => {
  const f = fixture({ onSend(data, api) {
    if (data === '%') { api.footer('您覺得這篇'); api.schedule(300, () => api.footer(CHOICE)); }
    else if (data === '1') { api.footer('請輸入您的'); api.schedule(300, () => api.footer(INPUT)); }
    else if (data === '完整提示\r') { api.pending = '完整提示'; api.footer('確定要儲存檔案'); api.schedule(300, () => api.footer(CONFIRM)); }
    else api.normal(data);
  } });
  assert.equal((await f.helper.sendSegmentSequence('完整提示', '1')).status, 'confirmed');
  assert.deepEqual(f.writes, ['%', '1', '完整提示\r', 'y\r']); assert.ok(f.now >= 900);
});

test('a stale prompt away from the terminal cursor is not an active input state', () => {
  const f = fixture({ initial: INPUT }); f.buf.cur_y = 5;
  assert.equal(f.helper.detectPushState(), 'unknown');
});

test('deadline and invalid options terminate without unlimited retries', async () => {
  const f = fixture({ onSend(_data, api) { api.footer('◆ 請稍候 120 秒'); } }); f.helper.maxRunMs = 500;
  assert.equal((await f.helper.startPushing()).status, 'failed'); assert.deepEqual(f.writes, ['%']); assert.equal(f.lease, null);
  const invalid = fixture(); invalid.helper.delaySelect.value = 'NaN';
  assert.equal((await invalid.helper.startPushing()).status, 'failed'); assert.deepEqual(invalid.writes, []);
});


test('colonless native headers participate in article identity checks', async () => {
  const f = fixture({ onSend(data, api) {
    api.normal(data);
    if (data === '%') api.row(1, '標題  [測試] 另一篇文章');
  } });
  f.row(0, '作者  OriginalID (作者) 看板: Test');
  f.row(1, '標題  [測試] 同一篇文章');
  f.row(2, '時間  Fri Oct 23 12:00:00 2026');
  assert.equal(f.helper.detectArticleAuthor(), 'OriginalID');
  assert.ok(f.helper.articleIdentity(f.tab));
  const result = await f.helper.startPushing();
  assert.equal(result.status, 'failed');
  assert.match(result.error, /文章標頭已變更/);
  assert.deepEqual(f.writes, ['%']);
});
