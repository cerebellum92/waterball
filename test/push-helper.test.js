import test from 'node:test';
import assert from 'node:assert/strict';
import { TermBuf } from '../src/term_buf.js';

class Element {
  constructor() {
    this.children = [];
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.events = {};
    this.classes = new Set();
    this.classList = {
      add: c => this.classes.add(c),
      remove: c => this.classes.delete(c),
      contains: c => this.classes.has(c),
      toggle: (c, force) => {
        const on = force ?? !this.classes.has(c);
        if (on) this.classes.add(c);
        else this.classes.delete(c);
        return on;
      },
    };
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ''; }
  addEventListener(name, callback) { this.events[name] = callback; }
  appendChild(child) { this.children.push(child); return child; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...((selector === 'button' && child.tag === 'button') || (selector === '.push-item-text' && child.className === 'push-item-text') ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  focus() {}
  select() {}
}

let elements;
globalThis.document = {
  getElementById: id => elements.get(id) || (elements.set(id, new Element()), elements.get(id)),
  createElement: tag => Object.assign(new Element(), { tag }),
};
globalThis.localStorage = { getItem: () => null, setItem() {} };

const { PushHelper } = await import('../src/push_helper.js');

const READING = '  瀏覽 第 1/5 頁 ( 20%)  目前顯示: 第 01~22 行  (y)回應(X)推文(^X)轉錄 (=)極端值';
const CHOICE = '您覺得這篇文章 1.值得推薦 2.給它噓聲 3.只加→註解 [1]? ';
const INPUT = '推 readerID: ';
const CONFIRM = '確定[y/N]: ';

function fixture(options = {}) {
  elements = new Map();
  const buf = new TermBuf(80, 24);
  const tab = { id: 'one', address: options.address || 'bbs@ptt.cc:22', encoding: 'big5', isConnected: true, buf };
  let active = tab, session = 'session-1', lease = null, now = 0, pending = null, echoRow = 6;
  const writes = [];
  let helper;
  const row = (index, text) => { buf.gotoPos(0, index); buf.eraseLine(2); buf.puts(text); };
  const footer = text => { row(22, ''); row(23, text); };
  row(0, '作者: OriginalID (作者) 看板: Test');
  row(1, '標題: [測試] 同一篇文章');
  row(2, '時間: Fri Oct 23 12:00:00 2026');
  footer(options.initial || READING);

  const normal = data => {
    if (data === 'X' || data === '%') {
      footer(CHOICE);
    } else if (['1', '2', '3'].includes(data)) {
      footer(INPUT);
    } else if (data === 'y\r') {
      footer(READING);
      pending = null;
    } else if (data.endsWith('\r')) {
      pending = data.slice(0, -1);
      footer(CONFIRM);
    }
  };

  helper = new PushHelper(null, () => active, {
    getTabById: id => (id === tab.id ? tab : null),
    getSession: async () => session,
    acquireInput: () => (lease ? null : (lease = Symbol('owner'))),
    releaseInput: (_id, token) => {
      assert.equal(token, lease);
      lease = null;
    },
    sendToTab: async (id, data, expectedSession, token) => {
      assert.equal(id, tab.id);
      assert.equal(expectedSession, session);
      writes.push(data);
      if (options.onSend) await options.onSend(data, api);
      else api.normal(data);
    },
    now: () => now,
    sleep: async (ms, signal) => {
      if (signal?.aborted) return;
      now += ms;
      await options.onSleep?.(ms, api);
    },
  });

  helper.idInput.value = 'readerID';
  helper.typeSelect.value = '1';
  helper.strategySelect.value = 'fill';
  helper.delaySelect.value = '1500';
  helper.textInput.value = '第一段\n第二段';
  helper.currentSegments = ['第一段', '第二段'];

  const api = {
    helper,
    tab,
    buf,
    writes,
    row,
    footer,
    normal,
    get now() { return now; },
    get lease() { return lease; },
    set active(value) { active = value; },
    set session(value) { session = value; },
    set pending(value) { pending = value; },
    get pending() { return pending; },
  };
  return api;
}

test('author headers accept canonical IDs and brackets; detectArticleAuthor extracts author cleanly', () => {
  const f = fixture();
  f.row(0, '作者: [OriginalID] (作者) 看板: Test');
  assert.equal(f.helper.detectArticleAuthor(), 'OriginalID');
  assert.equal(f.helper.typeSelect.disabled, false);
});

test('cooldown variants are anchored, positive and bounded', () => {
  const f = fixture();
  for (const text of [
    '◆ 請勿快速連續推文，請等待 5 秒',
    '◆ 請勿快速連續推文, 請等待 5 秒',
    '◆ 距離上次發文或推文間隔需 5 秒',
    '◆ 需間隔 5 秒才能再次推文',
    '請勿在 5 秒內連續推文',
  ]) {
    f.footer(text);
    assert.equal(f.helper.detectCooldownSeconds(), 5);
  }
  for (const text of ['推 someone: 請稍候 5 秒 10/23 12:00', '◆ 請稍候 999999 秒', '◆ 請稍候 0 秒', '◆ 請稍候 -1 秒']) {
    f.footer(text);
    assert.equal(f.helper.detectCooldownSeconds(), null);
  }
});

test('already-input state sends neither X nor a type; directly sends text and confirms', async () => {
  const f = fixture({ initial: INPUT });
  const result = await f.helper.sendSegmentSequence('防止 %1', '1');
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(f.writes, ['防止 %1\r', 'y\r']);
});

test('reader at choice prompt sends chosen type', async () => {
  const f = fixture({ initial: CHOICE });
  assert.equal((await f.helper.sendSegmentSequence('讀者補充', '1')).status, 'confirmed');
  assert.deepEqual(f.writes, ['1', '讀者補充\r', 'y\r']);
});

test('author mode prompt (作者本人, 使用 → 加註方式) skips 1/2/3 choice entirely', async () => {
  const f = fixture();
  f.helper.idInput.value = 'originalid';
  f.normal = data => {
    if (data === 'X') {
      f.row(22, '作者本人, 使用 → 加註方式');
      f.row(23, '→ originalid: ');
    } else if (data === 'y\r') {
      f.footer(READING);
    } else if (data.endsWith('\r')) {
      f.row(23, '→ originalid: ' + data.slice(0, -1) + ' 確定[y/N]:');
    }
  };
  const result = await f.helper.sendSegmentSequence('作者親自回覆', '1');
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(f.writes, ['X', '作者親自回覆\r', 'y\r']);
});

test('recognized readers push type 1 on first segment and 3 (arrow) on second segment', async () => {
  const f = fixture();
  const result = await f.helper.startPushing();
  assert.equal(result.status, 'confirmed');
  assert.equal(result.confirmed, 2);
  assert.deepEqual(f.writes, ['X', '1', '第一段\r', 'y\r', 'X', '3', '第二段\r', 'y\r']);
});

test('pushing from article list works seamlessly with X', async () => {
  const f = fixture({ initial: '文章選單 (h)說明 (p)發文 (d)刪除 (z)精華區 方向鍵:移動' });
  const result = await f.helper.sendSegmentSequence('列表推文', '1');
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(f.writes, ['X', '1', '列表推文\r', 'y\r']);
});

test('open() starts with empty progress indicators and resets running UI', () => {
  const f = fixture();
  f.helper.progressBox.classList.remove('hidden');
  f.helper.progressLabel.textContent = '殘留訊息';
  f.helper.open();
  assert.equal(f.helper.progressLabel.textContent, '');
  assert.equal(f.helper.progressCountdown.textContent, '');
  assert.equal(f.helper.progressBox.classList.contains('hidden'), true);
});

test('abort stops pushing immediately and preserves remaining segments', async () => {
  const f = fixture({
    onSend(data, api) {
      api.normal(data);
      if (data === '第一段\r') {
        api.helper.abort();
      }
    },
  });
  const result = await f.helper.startPushing();
  assert.equal(result.status, 'aborted');
  assert.equal(f.helper.currentSegments.length, 2);
  assert.equal(f.helper.textInput.value, '第一段\n第二段');
});

test('Maple BBS sends percent instead of X', async () => {
  const f = fixture({ address: 'bbs@maple.tw:23' });
  f.normal = data => {
    if (data === '%') f.footer(CHOICE);
    else if (data === '1\r') f.footer(INPUT);
    else if (data.endsWith('\r')) f.footer(CONFIRM);
  };
  const result = await f.helper.sendSegmentSequence('楓橋推文', '1');
  assert.equal(result.status, 'confirmed');
  assert.equal(f.writes[0], '%');
});
