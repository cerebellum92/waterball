import test from 'node:test';
import assert from 'node:assert/strict';
import { TermBuf } from '../src/term_buf.js';
import { AnsiParser } from '../src/ansi_parser.js';
import { TermView } from '../src/term_view.js';

class Element {
  constructor() { this.value = ''; this.textContent = ''; this.disabled = false; this.events = {}; this.classes = new Set();
    this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c), toggle: (c, on) => { if (on) this.classes.add(c); else this.classes.delete(c); } }; }
  addEventListener(name, callback) { this.events[name] = callback; }
  focus() {} select() {}
}
let elements;
globalThis.document = { getElementById: id => elements.get(id) || (elements.set(id, new Element()), elements.get(id)) };
const { AidJumpModal } = await import('../src/aid_jump_modal.js');

function fixture(options = {}) {
  elements = new Map();
  const buf = new TermBuf(80, 24);
  let state = 'article-list', board = 'Gossiping', active, session = 'session-1', lease, now = 0, acquired = 0, released = 0;
  const tab = { id: 'one', address: 'bbs@ptt.cc:22', encoding: 'big5', isConnected: true, buf, view: { getBbsState: () => state } };
  if (options.realView) tab.view = Object.assign(Object.create(TermView.prototype), { buf });
  active = tab;
  const writes = [], toasts = [];
  const row = (index, text) => { buf.gotoPos(0, index); buf.eraseLine(2); buf.puts(text); };
  function render(next, nextBoard = board) {
    state = next; board = nextBoard;
    for (const index of [0, 1, 2, 21, 22, 23]) row(index, '');
    row(0, next === 'reading' ? `作者  reader (讀者) 看板  ${board}` : `【板主: reader】 看板《${board}》`);
    row(23, ({ reading: '瀏覽 第 1/1 頁 (100%) 目前顯示: 第 01~24 行', 'article-list': '文章列表',
      'board-input': '請輸入看板名稱(按空白鍵搜尋):', 'aid-input': '搜尋文章代碼(AID): #', compose: '請輸入密碼:',
      'main-menu': '主功能表', 'board-list': '看板列表', error: '找不到這篇文章，按任意鍵繼續' })[next] || '不明畫面');
  }
  render(options.initial || 'article-list');
  const normal = data => {
    if (data === 'q') render('article-list');
    else if (data === 's') render('board-input');
    else if (data === '#') render('aid-input');
    else if (state === 'board-input') render('article-list', data.trim());
    else if (state === 'aid-input') render('article-list');
    else throw new Error('unexpected command');
  };
  const modal = new AidJumpModal({ getActiveTab: () => active, getTabById: id => id === tab.id ? tab : null,
    getSession: async () => options.onSession ? options.onSession(api) : session,
    acquireInput: () => { if (lease || options.locked) return null; acquired++; return lease = Symbol('owner'); },
    releaseInput: (_id, token) => { assert.equal(token, lease); released++; lease = null; },
    sendToTab: async (id, data, expectedSession, token) => {
      assert.equal(id, tab.id); assert.equal(expectedSession, session); assert.equal(token, lease);
      writes.push(data); if (options.onSend) return options.onSend(data, api); normal(data);
    },
    onShowToast: message => toasts.push(message), readClipboard: options.clipboard || (async () => ''),
    writeClipboard: options.writeClipboard || (async () => {}), openUrl: options.openUrl || (async () => {}),
    now: () => now, promptTimeoutMs: options.promptTimeoutMs ?? 300, maxRunMs: 2000, sessionTimeoutMs: options.sessionTimeoutMs,
    sleep: async ms => { now += ms; await options.onSleep?.(api); },
  });
  const api = { modal, tab, buf, writes, toasts, row, render, normal,
    get lease() { return lease; }, get acquired() { return acquired; }, get released() { return released; },
    set active(value) { active = value; }, set session(value) { session = value; },
    async open(value = '#1d5ve04Z (Gossiping)') { await modal.open(value); } };
  return api;
}
const pump = async predicate => { for (let n = 0; n < 200; n++) { if (predicate()) return; await Promise.resolve(); } throw new Error('checkpoint not reached'); };

// ptt/pttbbs mbbsd/bbs.c:do_select and board.c:board_cmd_search_global
// move to (0,0), print a heading and newline, then start name completion.
const topBoardPrompt = heading => `\x1b[1;1H\x1b[2K\x1b[7m${heading}\x1b[0m\r\n請輸入看板名稱(按空白鍵自動搜尋): \x1b[K`;
const gossipingContinue = ' ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ 請按任意鍵繼續 ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄';

// User-provided header/footer text, rendered as native fixed-width fields.
// The cursor is already on the target-looking row before the AID is sent: that
// alone must not cause success or skip the actual # / AID exchange.
function recruitingList(parser, board = 'China-Drama') {
  parser.feed('\x1b[2J\x1b[1;1H【徵求中】 [中劇] 讓空降來得更猛烈些吧！' +
    '\x1b[1;62H看板《' + board + '》' +
    '\x1b[2;1H[→]閱讀 [z]精華區 [Tab]文摘 [s]選擇看板 [b]進板 [i]看板設定 [^X]轉錄 [/]搜尋' +
    '\x1b[8;1H● 135000 + 10/24 evenscho □ Re: [閒聊] 蘭香如故 媽生如故' +
    '\x1b[21;1H    ★  m10 5/12 evenscho     □ [公告] 中劇板｜快樂追劇，請先詳閱本使用說明書' +
    '\x1b[22;1H    ★  !   3/30 ice6409      □ [公告] 無板主看板管理辦法' +
    '\x1b[23;1H    ★  +爆10/01 hueisung     □ [閒聊] 十月版友閒聊文(置底)' +
    '\x1b[24;1H 文章列表  (^P)發表 (y)回應 (X)推文 (d)刪除 (→)閱讀 (b)進板  (←)離開 (h)說明' +
    '\x1b[8;1H');
}

for (const sameBoard of [false, true]) {
  test(`China-Drama recruitment header uses real TermView and still sends the actual AID (${sameBoard ? 'same board' : 'cross board'})`, async () => {
    let parser;
    const f = fixture({ realView: true, onSend(data) {
      if (data === 's') parser.feed(topBoardPrompt('【 選擇看板 】'));
      else if (data === 'China-Drama\r' || data === '1gtBxPqV\r') recruitingList(parser);
      else if (data === '#') parser.feed('\x1b[24;1H\x1b[2K搜尋文章代碼(AID): #');
      else throw new Error('unexpected command');
    } });
    parser = new AnsiParser(f.buf);
    if (sameBoard) recruitingList(parser);
    else parser.feed('\x1b[2J\x1b[1;1H【主功能表】\x1b[24;1H主功能表');
    await f.open('#1gtBxPqV(China-Drama)');
    assert.equal((await f.modal.executeJump()).status, 'submitted');
    assert.deepEqual(f.writes, [...(sameBoard ? [] : ['s', 'China-Drama\r']), '#', '1gtBxPqV\r']);
    assert.equal(f.modal.snapshot(f.tab).state, 'article-list');
  });
}

test('recruitment header on a wrong board does not receive #', async () => {
  let parser;
  const f = fixture({ realView: true, onSend(data) {
    if (data === 's') parser.feed(topBoardPrompt('【 選擇看板 】'));
    else recruitingList(parser, 'Wrong-Drama');
  } });
  parser = new AnsiParser(f.buf); parser.feed('\x1b[2J\x1b[1;1H【主功能表】');
  await f.open('#1gtBxPqV(China-Drama)'); assert.equal((await f.modal.executeJump()).status, 'failed');
  assert.deepEqual(f.writes, ['s', 'China-Drama\r']);
});

test('a correct-looking cursor on a recruitment list is not success without the AID input prompt', async () => {
  const f = fixture({ realView: true, onSend() {} }); const parser = new AnsiParser(f.buf); recruitingList(parser);
  await f.open('#1gtBxPqV(China-Drama)'); assert.equal((await f.modal.executeJump()).status, 'failed');
  assert.deepEqual(f.writes, ['#']);
});

test('user-reported Gossiping block banner passes and completes navigation through actual ANSI parsing', async () => {
  let parser;
  const f = fixture({ initial: 'main-menu', onSend(data, api) {
    if (data === 'Gossiping\r') {
      parser.feed('\x1b[2J\x1b[23;1H         ║                  ║                  ║                  ║\x1b[24;1H\x1b[7m' + gossipingContinue + '\x1b[0m');
      const before = JSON.stringify({ lines: api.buf.lines, x: api.buf.cur_x, y: api.buf.cur_y });
      assert.equal(api.modal.snapshot(api.tab).state, 'waiting-enter');
      assert.equal(JSON.stringify({ lines: api.buf.lines, x: api.buf.cur_x, y: api.buf.cur_y }), before);
    } else if (data === '\r') api.render('article-list', 'Gossiping');
    else api.normal(data);
  } });
  parser = new AnsiParser(f.buf); await f.open('#1gtNnlt8(Gossiping)');
  assert.equal((await f.modal.executeJump()).status, 'submitted');
  assert.deepEqual(f.writes, ['s', 'Gossiping\r', '\r', '#', '1gtNnlt8\r']);
});

test('Unicode box drawing, block elements and punctuation are accepted as continuation decoration', () => {
  for (const border of ['▄', '▀', '█', '▓', '║', '═', '─', '...', '．．．', '…']) {
    const f = fixture(); f.row(23, `${border} 請按任意鍵繼續 ${border}`);
    assert.equal(f.modal.snapshot(f.tab).state, 'waiting-enter', border);
  }
});

test('the same block-decorated banner never bypasses refusal, password, Y/N or an extra instruction', async () => {
  for (const [other, banner] of [
    ['您沒有進入此看板的權限！', gossipingContinue],
    ['請輸入看板密碼:', gossipingContinue],
    ['是否刪除資料？ [y/N]', gossipingContinue],
    ['', gossipingContinue + ' [y/N]'],
    ['', gossipingContinue + ' 請輸入標題：'],
  ]) {
    const f = fixture({ initial: 'main-menu', onSend(data, api) {
      if (data === 'Gossiping\r') { api.row(22, other); api.row(23, banner); }
      else api.normal(data);
    } });
    await f.open('#1gtNnlt8(Gossiping)'); assert.equal((await f.modal.executeJump()).status, 'failed');
    assert.deepEqual(f.writes, ['s', 'Gossiping\r']);
  }
});

test('a fragmented Gossiping banner waits for the full continuation text before sending Enter', async () => {
  let parser, pending = false, polls = 0;
  const f = fixture({ initial: 'main-menu', promptTimeoutMs: 1000, onSend(data, api) {
    if (data === 'Gossiping\r') { parser.feed('\x1b[2J\x1b[24;1H▄▄▄▄ 請按任意鍵繼'); pending = true; }
    else if (data === '\r') api.render('article-list', 'Gossiping'); else api.normal(data);
  }, onSleep(api) {
    if (pending) {
      assert.deepEqual(api.writes, ['s', 'Gossiping\r']);
      if (++polls === 2) { pending = false; parser.feed('續 ▄▄▄▄'); }
    }
  } });
  parser = new AnsiParser(f.buf); await f.open('#1gtNnlt8(Gossiping)');
  assert.equal((await f.modal.executeJump()).status, 'submitted'); assert.equal(polls, 2);
  assert.deepEqual(f.writes, ['s', 'Gossiping\r', '\r', '#', '1gtNnlt8\r']);
});

for (const initial of ['main-menu', 'board-list', 'reading', 'article-list', 'board-input']) {
  test(`PTT source-layout ANSI navigation from ${initial}: top board prompt then 搜尋文章代碼(AID)`, async () => {
    let parser;
    const f = fixture({ initial, onSend(data, api) {
      if (data === 's') parser.feed(topBoardPrompt('【 搜尋全站看板 】 (若要限定搜尋範圍為目前列表請改用 Ctrl-S)'));
      else if (data === 'Stock\r') api.render('article-list', 'Stock');
      else if (data === '#') parser.feed('\x1b[24;1H\x1b[2K搜尋文章代碼(AID): #');
      else if (data === '1gtDZ4N9\r') api.render('article-list', 'Stock');
      else api.normal(data);
    } });
    parser = new AnsiParser(f.buf);
    if (initial === 'board-input') parser.feed(topBoardPrompt('【 選擇看板 】'));
    await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'submitted');
    assert.deepEqual(f.writes, [...(initial === 'reading' ? ['q'] : []), ...(initial === 'board-input' ? [] : ['s']), 'Stock\r', '#', '1gtDZ4N9\r']);
  });
}

test('active empty input may be anywhere on screen, while an inactive old footer cannot override it', () => {
  for (const r of [0, 1, 4, 10, 22, 23]) {
    const f = fixture(); f.row(23, '請選擇功能:'); f.row(r, '請輸入看板名稱(按空白鍵自動搜尋):');
    assert.equal(f.modal.snapshot(f.tab).state, 'board-input'); assert.equal(f.modal.snapshot(f.tab).promptRow, r);
  }
});

test('top-row input draft, password and editor states never receive navigation keys', async () => {
  for (const text of ['請輸入看板名稱(按空白鍵自動搜尋): Stock', '請輸入密碼:']) {
    const f = fixture({ initial: 'main-menu' }); f.row(1, text); await f.open('#1gtDZ4N9(Stock)');
    assert.equal((await f.modal.executeJump()).status, 'failed'); assert.deepEqual(f.writes, []);
  }
  const f = fixture(); f.row(23, '[Ctrl-X] 儲存離開'); f.row(1, '請輸入看板名稱:'); await f.open('#1gtDZ4N9(Stock)');
  assert.equal((await f.modal.executeJump()).status, 'failed'); assert.deepEqual(f.writes, []);
});

test('fragmented top-row prompt waits for both complete text and active cursor before sending the board', async () => {
  let parser, polls = 0;
  const f = fixture({ initial: 'main-menu', onSend(data, api) {
    if (data === 's') parser.feed('\x1b[1;1H\x1b[2K【 選擇看板 】\r\n請輸入看板名稱(按空白');
    else if (data === 'Stock\r') api.render('article-list', 'Stock');
    else api.normal(data);
  }, onSleep(api) {
    assert.deepEqual(api.writes, ['s']);
    if (++polls === 1) { parser.feed('鍵自動搜尋): '); api.buf.gotoPos(0, 4); }
    if (polls === 3) parser.feed('\x1b[2;45H');
  } });
  parser = new AnsiParser(f.buf); await f.open('#1gtDZ4N9(Stock)');
  assert.equal((await f.modal.executeJump()).status, 'submitted'); assert.equal(polls, 3);
  assert.deepEqual(f.writes, ['s', 'Stock\r', '#', '1gtDZ4N9\r']);
});

test('actual PTT Read() refusal messages stop before an automatic key or AID', async () => {
  for (const message of ['您沒有進入此看板的權限！', '無法建立或進入看板目錄！']) {
    const f = fixture({ onSend(data, api) {
      if (data === 'Stock\r') { api.row(22, message); api.row(23, '[請按任意鍵繼續]'); }
      else api.normal(data);
    } });
    await f.open('#1gtDZ4N9(Stock)'); const result = await f.modal.executeJump();
    assert.match(result.error, /PTT 拒絕定位/); assert.deepEqual(f.writes, ['s', 'Stock\r']);
  }
});

test('same-board navigation waits for # input; completed means submitted, not article verified', async () => {
  const f = fixture(); await f.open(); const result = await f.modal.executeJump();
  assert.equal(result.status, 'submitted'); assert.equal(f.modal.isOpen, false); assert.deepEqual(f.writes, ['#', '1d5ve04Z\r']);
  assert.match(f.toasts.at(-1), /請核對/); assert.equal(f.acquired, 1); assert.equal(f.released, 1);
  assert.equal(f.modal.inputEl.value, '#1d5ve04Z (Gossiping)');
});

test('reading and cross-board navigation verify every source and destination prompt', async () => {
  const f = fixture({ initial: 'reading' }); await f.open('#1d5ve04Z (Stock)');
  const result = await f.modal.executeJump(); assert.equal(result.status, 'submitted');
  assert.deepEqual(f.writes, ['q', 's', 'Stock\r', '#', '1d5ve04Z\r']);
});

for (const initial of ['main-menu', 'board-list']) test(`explicit board from ${initial} is selected before AID`, async () => {
  const f = fixture({ initial }); await f.open('#1d5ve04Z (Stock)');
  assert.equal((await f.modal.executeJump()).status, 'submitted');
  assert.deepEqual(f.writes, ['s', 'Stock\r', '#', '1d5ve04Z\r']);
});

for (const initial of ['compose', 'unknown', 'waiting-enter', 'mail-list', 'friend-list']) test(`${initial} rejects all writes`, async () => {
  const f = fixture({ initial }); await f.open(); assert.equal((await f.modal.executeJump()).status, 'failed');
  assert.deepEqual(f.writes, []); assert.equal(f.modal.inputEl.disabled, false);
});

test('later reading pages without a board header return to a verified list and explicitly select the target', async () => {
  const f = fixture({ initial: 'reading' }); f.row(0, ''); await f.open('#1d5ve04Z (Stock)');
  assert.equal((await f.modal.executeJump()).status, 'submitted'); assert.deepEqual(f.writes, ['q', 's', 'Stock\r', '#', '1d5ve04Z\r']);
});

test('reading without a known board or an explicit target never guesses a destination', async () => {
  const f = fixture({ initial: 'reading' }); f.row(0, ''); await f.open('#1d5ve04Z');
  assert.equal((await f.modal.executeJump()).status, 'failed'); assert.deepEqual(f.writes, []);
});

test('later reading pages do not proceed if q fails to return a recognizable article list', async () => {
  const f = fixture({ initial: 'reading', onSend(_data, api) { api.render('unknown'); } });
  f.row(0, ''); await f.open('#1d5ve04Z(Stock)');
  assert.equal((await f.modal.executeJump()).status, 'failed'); assert.deepEqual(f.writes, ['q']);
});

test('payload waits for delayed prompt, and fragmented prompts never receive commands', async () => {
  let polls = 0;
  const f = fixture({ onSend(data, api) { if (data === '#') api.row(23, '請輸入文章'); else api.normal(data); },
    onSleep(api) { if (++polls === 3) { assert.deepEqual(api.writes, ['#']); api.render('aid-input'); } } });
  await f.open(); assert.equal((await f.modal.executeJump()).status, 'submitted'); assert.ok(polls >= 3);
});

test('missing prompt times out without sending AID or clearing input', async () => {
  const f = fixture({ onSend() {} }); await f.open(); const result = await f.modal.executeJump();
  assert.equal(result.status, 'failed'); assert.deepEqual(f.writes, ['#']); assert.equal(f.released, 1);
  assert.equal(f.modal.inputEl.value, '#1d5ve04Z (Gossiping)');
});

test('board refusal or wrong-board return never receives #', async () => {
  for (const error of [true, false]) {
    const f = fixture({ onSend(data, api) { if (data === 'Stock\r') api.render(error ? 'error' : 'article-list', 'Gossiping'); else api.normal(data); } });
    await f.open('#1d5ve04Z (Stock)'); assert.equal((await f.modal.executeJump()).status, 'failed');
    assert.deepEqual(f.writes, ['s', 'Stock\r']);
  }
});

test('false and rejected writes never emit completion, release lease, and preserve text', async () => {
  for (const rejects of [false, true]) {
    const f = fixture({ onSend() { if (rejects) throw new Error('network error'); return false; } });
    await f.open(); assert.equal((await f.modal.executeJump()).status, 'failed');
    assert.ok(f.toasts.every(text => !text.includes('定位指令已完成'))); assert.equal(f.released, 1);
  }
});

test('input lease busy and unsupported host do not send', async () => {
  for (const mode of ['lease', 'host', 'session']) {
    const f = fixture({ locked: mode === 'lease' }); await f.open();
    if (mode === 'host') f.tab.address = 'bbs@evilptt.cc:22';
    if (mode === 'session') f.modal.context.session = null;
    assert.equal((await f.modal.executeJump()).status, 'failed'); assert.deepEqual(f.writes, []);
  }
});

test('switching tab after opening cannot retarget or read a new default board', async () => {
  const f = fixture(); await f.open(); f.active = { ...f.tab, id: 'two' };
  assert.equal((await f.modal.executeJump()).status, 'failed'); assert.deepEqual(f.writes, []);
});

test('session change, disconnect, or tab switch stops remaining keys', async () => {
  for (const mode of ['session', 'disconnect', 'tab']) {
    const f = fixture({ onSend(data, api) { api.normal(data); if (mode === 'session') api.session = 'other';
      if (mode === 'disconnect') api.tab.isConnected = false; if (mode === 'tab') api.active = { ...api.tab }; } });
    await f.open(); assert.equal((await f.modal.executeJump()).status, 'failed'); assert.deepEqual(f.writes, ['#']);
  }
});

test('abort keeps unresolved write owned, prevents reopen/duplicate submit, then releases once', async () => {
  let resolveWrite;
  const f = fixture({ onSend: async (data, api) => { await new Promise(resolve => resolveWrite = resolve); api.normal(data); } });
  await f.open(); const pending = f.modal.executeJump(); await pump(() => resolveWrite);
  f.modal.close(); assert.ok(f.modal.run); assert.ok(f.lease);
  assert.equal((await f.modal.executeJump()).status, 'busy'); await f.modal.open('#1Kcjcttm (Stock)');
  resolveWrite(); assert.equal((await pending).status, 'failed'); assert.equal(f.released, 1); assert.deepEqual(f.writes, ['#']);
});

test('abort interrupts a read-only session lookup without waiting indefinitely', async () => {
  let hang = false;
  const f = fixture({ onSession: () => hang ? new Promise(() => {}) : 'session-1' });
  await f.open(); hang = true; const pending = f.modal.executeJump(); await pump(() => f.modal.run);
  f.modal.close(); assert.equal((await pending).status, 'failed'); assert.equal(f.released, 1); assert.deepEqual(f.writes, []);
});

test('IME Enter and repeating Enter never execute navigation', () => {
  const f = fixture(); let count = 0; f.modal.executeJump = () => count++;
  const key = { key: 'Enter', preventDefault() {}, stopPropagation() {} };
  f.modal.inputEl.events.keydown({ ...key, isComposing: true });
  f.modal.inputEl.events.keydown({ ...key, keyCode: 229 });
  f.modal.inputEl.events.keydown({ ...key, repeat: true }); assert.equal(count, 0);
  f.modal.inputEl.events.keydown(key); assert.equal(count, 1);
});

test('late clipboard never overwrites edits, including edit-then-undo', async () => {
  for (const undo of [false, true]) {
    let resolveClip;
    const f = fixture({ clipboard: () => new Promise(resolve => resolveClip = resolve) });
    const pending = f.modal.open(); f.modal.inputEl.value = '#1Kcjcttm (Stock)'; f.modal.inputEl.events.input();
    if (undo) f.modal.inputEl.value = '';
    resolveClip('#1d5ve04Z (Gossiping)'); await pending;
    assert.equal(f.modal.inputEl.value, undo ? '' : '#1Kcjcttm (Stock)');
  }
});

test('old clipboard result after close/reopen does not replace new prefill', async () => {
  let resolveClip;
  const f = fixture({ clipboard: () => new Promise(resolve => resolveClip = resolve) });
  const first = f.modal.open(); f.modal.close(); await f.modal.open('#1Kcjcttm (Stock)');
  resolveClip('#1d5ve04Z (Gossiping)'); await first; assert.equal(f.modal.inputEl.value, '#1Kcjcttm (Stock)');
});

test('clipboard denial remains optional and unknown-board web action is disabled', async () => {
  const f = fixture({ clipboard: async () => { throw new Error('denied'); } });
  await f.modal.open(); assert.equal(f.modal.isOpen, true); f.row(0, ''); f.modal.inputEl.value = '#1d5ve04Z';
  f.modal.updateInfo(); assert.equal(f.modal.btnReader.disabled, true); assert.equal(f.modal.btnCopy.disabled, false);
});

test('web and clipboard exceptions are handled and retain input', async () => {
  const f = fixture({ openUrl: async () => { throw new Error('denied'); }, writeClipboard: async () => { throw new Error('denied'); } });
  await f.open(); await f.modal.openInReader(); await f.modal.copyUrl();
  assert.match(f.toasts.join('\n'), /開啟網頁版失敗/); assert.match(f.toasts.join('\n'), /複製失敗/);
  assert.equal(f.modal.inputEl.value, '#1d5ve04Z (Gossiping)');
});

test('real PTT board search prompt with 自動搜尋 and header advances navigation', async () => {
  const f = fixture({
    initial: 'board-list',
    onSend(data, api) {
      if (data === 's') {
        api.row(22, '【 搜尋全站看板 】  (若要限定搜尋範圍為目前列表請改用 Ctrl-S)');
        api.row(23, '請輸入看板名稱(按空白鍵自動搜尋): ');
      } else if (data === 'Gossiping\r') {
        api.render('article-list', 'Gossiping');
      } else if (data === '#') {
        api.row(23, '請輸入文章代碼: #');
      } else if (data === '1gtDZ4N9\r') {
        api.render('article-list', 'Gossiping');
      } else {
        throw new Error('unexpected command ' + data);
      }
    }
  });
  await f.open('#1gtDZ4N9(Gossiping)');
  const result = await f.modal.executeJump();
  assert.equal(result.status, 'submitted');
  assert.deepEqual(f.writes, ['s', 'Gossiping\r', '#', '1gtDZ4N9\r']);
  assert.match(f.toasts.at(-1), /定位指令已完成：#1gtDZ4N9 \(Gossiping\)/);
});

test('snapshot handles prompt variations including full-width colons and parentheses', () => {
  const f = fixture();
  const testCases = [
    { row22: '', row23: '請輸入看板名稱(按空白鍵自動搜尋): ', expected: 'board-input' },
    { row22: '', row23: '請輸入看板名稱（按空白鍵自動搜尋）：', expected: 'board-input' },
    { row22: '【 搜尋全站看板 】', row23: '請輸入看板名稱(按空白鍵自動搜尋): ', expected: 'board-input' },
    { row22: '', row23: '【 選擇看板】請輸入看板名稱(按空白鍵自動搜尋):', expected: 'board-input' },
    { row22: '', row23: '請輸入看板名稱:', expected: 'board-input' },
    { row22: '', row23: '請輸入文章代碼: #', expected: 'aid-input' },
    { row22: '', row23: '請輸入文章代碼： #', expected: 'aid-input' },
    { row22: '', row23: '請輸入文章代碼(AID): #', expected: 'aid-input' },
  ];
  for (const { row22, row23, expected } of testCases) {
    f.row(22, row22);
    f.row(23, row23);
    const snap = f.modal.snapshot(f.tab);
    assert.equal(snap.state, expected, `Prompt "${row23}" should be detected as ${expected}`);
  }
});

test('recovering from already-opened board-input prompt directly sends board without resending s', async () => {
  const f = fixture({
    initial: 'board-input',
    onSend(data, api) {
      if (data === 'Gossiping\r') {
        api.render('article-list', 'Gossiping');
      } else if (data === '#') {
        api.row(23, '請輸入文章代碼: #');
      } else if (data === '1gtDZ4N9\r') {
        api.render('article-list', 'Gossiping');
      } else {
        throw new Error('unexpected command ' + data);
      }
    }
  });
  f.row(22, '【 搜尋全站看板 】  (若要限定搜尋範圍為目前列表請改用 Ctrl-S)');
  f.row(23, '請輸入看板名稱(按空白鍵自動搜尋): ');
  await f.open('#1gtDZ4N9(Gossiping)');
  const result = await f.modal.executeJump();
  assert.equal(result.status, 'submitted');
  assert.deepEqual(f.writes, ['Gossiping\r', '#', '1gtDZ4N9\r']);
});

test('active prompt may be on row 23 with a separate header on row 24', () => {
  const f = fixture();
  f.row(22, '請輸入看板名稱（按空白鍵自動搜尋）：');
  f.row(23, '【 選擇看板 】');
  f.buf.gotoPos(46, 22);
  assert.equal(f.modal.snapshot(f.tab).state, 'board-input');
});

test('prompt followed by a blank active input line is supported without accepting unrelated cursor rows', () => {
  const f = fixture(); f.row(22, '請輸入看板名稱(按空白鍵自動搜尋):'); f.row(23, ''); f.buf.gotoPos(0, 23);
  assert.equal(f.modal.snapshot(f.tab).state, 'board-input');
  f.buf.gotoPos(1, 23); assert.equal(f.modal.snapshot(f.tab).state, 'unknown');
  f.buf.gotoPos(0, 4); assert.equal(f.modal.snapshot(f.tab).state, 'unknown');
});

test('stale footer prompts, input drafts and unrelated annotations never receive keys', async () => {
  for (const text of ['請輸入密碼:', '請輸入看板名稱(按空白鍵自動搜尋): Stock', '請輸入看板名稱(按 Enter 刪除草稿):']) {
    const f = fixture(); f.row(22, '請輸入看板名稱:'); f.row(23, text);
    await f.open('#1gtDZ4N9(Gossiping)'); assert.equal((await f.modal.executeJump()).status, 'failed');
    assert.deepEqual(f.writes, []);
  }
});

test('a cursor-position packet arriving later releases a complete prompt only after it becomes active', async () => {
  let polls = 0;
  const f = fixture({ onSend(data, api) {
    api.normal(data); if (data === '#') api.buf.gotoPos(0, 4);
  }, onSleep(api) {
    assert.deepEqual(api.writes, ['#']); if (++polls === 2) api.buf.gotoPos(20, 23);
  } });
  await f.open(); assert.equal((await f.modal.executeJump()).status, 'submitted'); assert.equal(polls, 2);
});

test('owned board-entry pauses advance with exactly the advertised key, then verify the target board', async () => {
  for (const [prompt, key] of [['[請按任意鍵繼續]', '\r'], ['請按空白鍵繼續', ' '], ['[請按 空白鍵 繼續]', ' '], ['【請按任何鍵或是 Enter 繼續】', '\r']]) {
    const f = fixture({ onSend(data, api) {
      if (data === 'Stock\r') { api.render('unknown', 'Stock'); api.row(23, prompt); }
      else if (data === key) api.render('article-list', 'Stock');
      else api.normal(data);
    } });
    await f.open('#1gtDZ4N9(Stock)'); const result = await f.modal.executeJump();
    assert.equal(result.status, 'submitted');
    assert.deepEqual(f.writes, ['s', 'Stock\r', key, '#', '1gtDZ4N9\r']); assert.equal(f.released, 1);
    assert.equal(f.modal.inputEl.value, '#1gtDZ4N9(Stock)');
  }
});

// Comparison target: iamchucky/PttChrome 30bd49f, term_buf.js:setPageState.
// These samples satisfy its text-based PASS branch; test actual dispatch too,
// rather than accepting a classification result as proof of successful routing.
for (const prompt of ['歡迎來到 Stock [請按任意鍵繼續]', '★ 請按任意鍵繼續 ★', '────請按任意鍵繼續────', '[請按 空白鍵 繼續]']) {
  test(`PttChrome PASS compatibility: ${prompt}`, async () => {
    assert.ok(prompt.indexOf('請按任意鍵繼續') > 0 || prompt.indexOf('請按 空白鍵 繼續') > 0);
    const key = prompt.includes('空白') ? ' ' : '\r';
    const f = fixture({ onSend(data, api) {
      if (data === 'Stock\r') api.row(23, prompt);
      else if (data === key) api.render('article-list', 'Stock'); else api.normal(data);
    } });
    await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'submitted');
    assert.deepEqual(f.writes, ['s', 'Stock\r', key, '#', '1gtDZ4N9\r']);
  });
}

for (const page of ['2', '2/5']) {
  test(`PttChrome reading footer compatibility, page ${page} without a board header`, async () => {
    const f = fixture({ initial: 'reading' }); f.row(0, '');
    f.row(23, `  瀏覽 第 ${page} 頁 ( 40%)  目前顯示: 第 025~048 行 (y)回應 (X/%)推文 (h)說明 (←/q)離開 `);
    await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'submitted');
    assert.deepEqual(f.writes, ['q', 's', 'Stock\r', '#', '1gtDZ4N9\r']);
  });
}

test('a PASS substring cannot override password, yes/no, refusal or an appended instruction', async () => {
  for (const prompt of ['請輸入密碼：請按任意鍵繼續', '權限不足，請按任意鍵繼續', '請按任意鍵繼續 [y/N]', '[請按任意鍵繼續] 請輸入標題：']) {
    const f = fixture({ onSend(data, api) {
      if (data === 'Stock\r') api.row(23, prompt); else api.normal(data);
    } });
    await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'failed');
    assert.deepEqual(f.writes, ['s', 'Stock\r']);
  }
});

test('navigation started on a recognized PASS clears it and plans from the returned reading screen', async () => {
  const f = fixture({ promptTimeoutMs: 1000, onSend(data, api) {
    if (data === '\r') api.render('reading', 'Gossiping'); else api.normal(data);
  } });
  f.row(23, '歡迎光臨 [請按任意鍵繼續]');
  await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'submitted');
  assert.deepEqual(f.writes, ['\r', 'q', 's', 'Stock\r', '#', '1gtDZ4N9\r']);
});

test('initial PASS does not infer a target from an unknown board, and unsafe initial prompts receive no key', async () => {
  const f = fixture(); f.row(0, ''); f.row(23, '[請按任意鍵繼續]'); await f.open('#1gtDZ4N9');
  assert.equal((await f.modal.executeJump()).status, 'failed'); assert.deepEqual(f.writes, []);
  for (const prompt of ['權限不足，請按任意鍵繼續', '請輸入密碼：請按任意鍵繼續']) {
    const g = fixture(); g.row(23, prompt); await g.open('#1gtDZ4N9(Stock)');
    assert.equal((await g.modal.executeJump()).status, 'failed'); assert.deepEqual(g.writes, []);
  }
});

test('initial PASS returning to an editor stops instead of issuing board commands', async () => {
  const f = fixture({ onSend(_data, api) { api.render('compose'); } });
  f.row(23, '[請按任意鍵繼續]'); await f.open('#1gtDZ4N9(Stock)');
  assert.equal((await f.modal.executeJump()).status, 'failed'); assert.deepEqual(f.writes, ['\r']);
});

test('board policy prose is not a permission refusal or an interactive confirmation', async () => {
  const f = fixture({ onSend(data, api) {
    if (data === 'Stock\r') {
      api.row(10, '本板僅限討論股票，請遵守板規');
      api.row(21, '您尚未看完公告，請繼續閱讀');
      api.row(22, '閱讀後請確認板規；請記得儲存帳號密碼');
      api.row(23, '[請按任意鍵繼續]');
    } else if (data === '\r') api.render('article-list', 'Stock'); else api.normal(data);
  } });
  await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'submitted');
  assert.deepEqual(f.writes, ['s', 'Stock\r', '\r', '#', '1gtDZ4N9\r']);
});

test('explicit alternate password and parenthesized Y/N prompts still prevent continuation', async () => {
  for (const prompt of ['請再次輸入密碼:', '是否儲存資料 (y/N):']) {
    const f = fixture({ onSend(data, api) {
      if (data === 'Stock\r') { api.row(10, prompt); api.row(23, '[請按任意鍵繼續]'); }
      else api.normal(data);
    } });
    await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'failed');
    assert.deepEqual(f.writes, ['s', 'Stock\r']);
  }
});

test('ordinary article prose and titles containing confirmation/save words do not block navigation', async () => {
  for (const initial of ['article-list', 'reading']) {
    const f = fixture({ initial, onSend(data, api) {
      api.normal(data);
      if (data === 's' || data === '#') {
        api.row(21, '本文說明如何儲存設定及確認密碼');
        api.row(22, '請確認板規，沒有要求輸入任何選項');
        api.buf.gotoPos(20, 23);
      }
    } });
    f.row(21, ' 123 10/25 reader □ [新聞] 公司確認投資案');
    f.row(22, ' 124 10/25 reader □ [教學] 儲存與密碼管理');
    f.buf.gotoPos(79, 23);
    await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'submitted');
    assert.deepEqual(f.writes, [...(initial === 'reading' ? ['q'] : []), 's', 'Stock\r', '#', '1gtDZ4N9\r']);
  }
});

test('an unchanged pause is acknowledged once and times out without repeated Enter or AID', async () => {
  const f = fixture({ onSend(data, api) {
    if (data === 'Stock\r') api.row(23, '[請按任意鍵繼續]');
    else if (data !== '\r') api.normal(data);
  } });
  await f.open('#1gtDZ4N9(Stock)'); const result = await f.modal.executeJump();
  assert.match(result.error, /逾時/); assert.deepEqual(f.writes, ['s', 'Stock\r', '\r']);
});

test('multiple distinct entry pages are bounded to three acknowledgements per board-entry step', async () => {
  let pages = 0;
  const f = fixture({ promptTimeoutMs: 1500, onSend(data, api) {
    if (data === 'Stock\r' || data === '\r') {
      api.row(10, `進板公告第 ${++pages} 頁`); api.row(23, '[請按任意鍵繼續]');
    } else api.normal(data);
  } });
  await f.open('#1gtDZ4N9(Stock)'); const result = await f.modal.executeJump();
  assert.match(result.error, /上限/); assert.deepEqual(f.writes, ['s', 'Stock\r', '\r', '\r', '\r']);
  assert.equal(f.released, 1);
});

test('two distinct announcements followed by the target list finish normally', async () => {
  let pages = 0;
  const f = fixture({ promptTimeoutMs: 1000, onSend(data, api) {
    if (data === 'Stock\r' || (data === '\r' && pages < 2)) {
      api.row(10, `公告 ${++pages}`); api.row(23, '[請按任意鍵繼續]');
    } else if (data === '\r') api.render('article-list', 'Stock'); else api.normal(data);
  } });
  await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'submitted');
  assert.deepEqual(f.writes, ['s', 'Stock\r', '\r', '\r', '#', '1gtDZ4N9\r']);
});

test('an old Ctrl-S search annotation does not turn an ordinary entry pause into an editor prompt', async () => {
  const f = fixture({ onSend(data, api) {
    if (data === 'Stock\r') {
      api.row(22, '【 搜尋全站看板 】 (若要限定搜尋範圍為目前列表請改用 Ctrl-S)');
      api.row(23, '[請按任意鍵繼續]');
    } else if (data === '\r') api.render('article-list', 'Stock'); else api.normal(data);
  } });
  await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'submitted');
  assert.deepEqual(f.writes, ['s', 'Stock\r', '\r', '#', '1gtDZ4N9\r']);
});

test('pause outside board entry cannot bypass an AID error or an unexpected reading transition', async () => {
  for (const initial of ['article-list', 'reading']) {
    const f = fixture({ initial, onSend(_data, api) { api.row(23, '[請按任意鍵繼續]'); } });
    await f.open(); const result = await f.modal.executeJump();
    assert.match(result.error, /非進板步驟/); assert.deepEqual(f.writes, [initial === 'reading' ? 'q' : '#']);
  }
});

test('a partial pause or a neighbouring password/confirmation prompt never receives an acknowledgement', async () => {
  for (const [other, prompt] of [['', '[請按任意鍵繼'], ['請輸入密碼:', '[請按任意鍵繼續]'], ['是否刪除資料? [y/N]', '[請按任意鍵繼續]']]) {
    const f = fixture({ onSend(data, api) {
      if (data === 'Stock\r') { api.row(22, other); api.row(23, prompt); } else api.normal(data);
    } });
    await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'failed');
    assert.deepEqual(f.writes, ['s', 'Stock\r']);
  }
});

test('password or yes/no input above the footer is not treated as an entry announcement', async () => {
  for (const prompt of ['請輸入看板密碼:', '密碼：', '刪除資料? [Y/n]']) {
    const f = fixture({ onSend(data, api) {
      if (data === 'Stock\r') { api.row(10, prompt); api.row(23, '[請按任意鍵繼續]'); }
      else api.normal(data);
    } });
    await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'failed');
    assert.deepEqual(f.writes, ['s', 'Stock\r']);
  }
});

test('a fragmented permission refusal arriving during pause settling prevents automatic continuation', async () => {
  let polls = 0;
  const f = fixture({ onSend(data, api) {
    if (data === 'Stock\r') api.row(23, '[請按任意鍵繼續]'); else api.normal(data);
  }, onSleep(api) {
    if (++polls === 2) api.row(12, '◆ 您的上站次數不足，無法進入看板');
  } });
  await f.open('#1gtDZ4N9(Stock)'); const result = await f.modal.executeJump();
  assert.match(result.error, /PTT 拒絕定位/); assert.deepEqual(f.writes, ['s', 'Stock\r']);
});

test('a refusal arriving during final session validation is re-read before any automatic key', async () => {
  let reads = 0;
  const f = fixture({ onSend(data, api) {
    if (data === 'Stock\r') api.row(23, '[請按任意鍵繼續]'); else api.normal(data);
  }, onSession(api) {
    if (api.writes.at(-1) === 'Stock\r' && ++reads === 6) api.row(22, '權限不足，無法進入看板');
    return 'session-1';
  } });
  await f.open('#1gtDZ4N9(Stock)'); const result = await f.modal.executeJump();
  assert.match(result.error, /PTT 拒絕定位/); assert.deepEqual(f.writes, ['s', 'Stock\r']);
});

test('wrong board after a passed announcement never receives # or the article code', async () => {
  const f = fixture({ onSend(data, api) {
    if (data === 'Stock\r') api.row(23, '[請按任意鍵繼續]');
    else if (data === '\r') api.render('article-list', 'Gossiping'); else api.normal(data);
  } });
  await f.open('#1gtDZ4N9(Stock)'); assert.equal((await f.modal.executeJump()).status, 'failed');
  assert.deepEqual(f.writes, ['s', 'Stock\r', '\r']);
});

test('closing while an automatic continuation write is pending retains ownership until the write settles', async () => {
  let resolveWrite;
  const f = fixture({ onSend(data, api) {
    if (data === 'Stock\r') api.row(23, '[請按任意鍵繼續]');
    else if (data === '\r') return new Promise(resolve => { resolveWrite = () => { api.render('article-list', 'Stock'); resolve(); }; });
    else api.normal(data);
  } });
  await f.open('#1gtDZ4N9(Stock)'); const pending = f.modal.executeJump(); await pump(() => resolveWrite);
  f.modal.close(); assert.ok(f.lease); assert.equal(f.released, 0);
  resolveWrite(); assert.equal((await pending).status, 'failed'); assert.equal(f.released, 1);
  assert.deepEqual(f.writes, ['s', 'Stock\r', '\r']);
});

test('permission failure followed by a continue prompt remains an error, never a splash bypass', async () => {
  const f = fixture({ onSend(data, api) {
    if (data === 'Stock\r') { api.row(22, '權限不足，無法進入看板'); api.row(23, '[請按任意鍵繼續]'); } else api.normal(data);
  } });
  await f.open('#1gtDZ4N9(Stock)'); const result = await f.modal.executeJump();
  assert.match(result.error, /PTT 拒絕定位/); assert.deepEqual(f.writes, ['s', 'Stock\r']);
});

test('aid-input resumes only on its own known board and rejects cross-board requests', async () => {
  const same = fixture({ initial: 'aid-input' }); await same.open('#1gtDZ4N9(Gossiping)');
  assert.equal((await same.modal.executeJump()).status, 'submitted'); assert.deepEqual(same.writes, ['1gtDZ4N9\r']);
  const other = fixture({ initial: 'aid-input' }); await other.open('#1gtDZ4N9(Stock)');
  assert.match((await other.modal.executeJump()).error, /其他看板/); assert.deepEqual(other.writes, []);
});

test('pending clipboard does not delay session readiness, open completion or manual navigation', async () => {
  let resolveClip;
  const f = fixture({ clipboard: () => new Promise(resolve => resolveClip = resolve) });
  await f.modal.open(); assert.ok(f.modal.context.session);
  f.modal.inputEl.value = '#1gtDZ4N9(Gossiping)'; f.modal.inputEl.events.input(); assert.equal(f.modal.btnJump.disabled, false);
  assert.equal((await f.modal.executeJump()).status, 'submitted');
  resolveClip('#1Kcjcttm (Stock)'); await Promise.resolve();
  assert.equal(f.modal.inputEl.value, '#1gtDZ4N9(Gossiping)');
});

test('pending write can reopen a visible busy modal, but cannot release lease or submit twice', async () => {
  let resolveWrite;
  const f = fixture({ onSend: async (data, api) => { await new Promise(resolve => resolveWrite = resolve); api.normal(data); } });
  await f.open(); const pending = f.modal.executeJump(); await pump(() => resolveWrite);
  f.modal.close(); assert.equal(f.modal.isOpen, false); assert.ok(f.lease);
  await f.modal.open(); assert.equal(f.modal.isOpen, true); assert.equal(f.modal.btnJump.disabled, true);
  assert.match(f.modal.btnJump.textContent, /等待寫入/); assert.equal((await f.modal.executeJump()).status, 'busy');
  assert.equal(f.released, 0); resolveWrite(); await pending; assert.equal(f.released, 1);
  assert.deepEqual(f.writes, ['#']); assert.equal(f.modal.btnJump.disabled, false);
});

test('hung session identity is bounded both when opening and during navigation', async () => {
  let hang = true;
  const f = fixture({ sessionTimeoutMs: 5, onSession: () => hang ? new Promise(() => {}) : 'session-1' });
  await f.open(); assert.equal(f.modal.context.session, null); assert.match(f.toasts.at(-1), /無法確認連線身分/);
  hang = false; await f.open(); hang = true;
  assert.match((await f.modal.executeJump()).error, /身分逾時/); assert.equal(f.released, 1); assert.deepEqual(f.writes, []);
});
