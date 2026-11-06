import test from 'node:test';
import assert from 'node:assert/strict';

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.classes = new Set();
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      contains: (c) => this.classes.has(c),
      toggle: (c, force) => {
        if (typeof force === 'boolean') {
          if (force) this.classes.add(c); else this.classes.delete(c);
          return force;
        }
        if (this.classes.has(c)) { this.classes.delete(c); return false; }
        this.classes.add(c); return true;
      }
    };
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this._innerHTML = '';
    this.queryNodes = new Map();
  }

  get className() {
    return Array.from(this.classes).join(' ');
  }

  set className(val) {
    this.classes = new Set(String(val || '').split(/\s+/).filter(Boolean));
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = String(val || '');
    this.children = [];
    this.queryNodes.clear();
  }

  get textContent() {
    return this._textContent || this._innerHTML.replace(/<[^>]*>/g, '');
  }

  set textContent(val) {
    this._textContent = String(val || '');
    this._innerHTML = String(val || '');
  }

  addEventListener(event, fn) {
    this.listeners[event] ||= [];
    this.listeners[event].push(fn);
  }

  removeEventListener(event, fn) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== fn);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type || event] || [];
    for (const fn of list) fn({ ...event, currentTarget: this, target: this, stopPropagation() {} });
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this.classes.has(cls)) return this;
      for (const ch of this.children) {
        const found = ch.querySelector?.(selector);
        if (found) return found;
      }
      // Stable synthetic descendants: successive lookups must reach the same
      // event listener and retain the actual class="... hidden" state.
      if (this.queryNodes.has(selector)) return this.queryNodes.get(selector);
      for (const match of this._innerHTML.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
        const classes = match[2].match(/\bclass="([^"]*)"/)?.[1] || '';
        if (!classes.split(/\s+/).includes(cls)) continue;
        const mock = new MockElement(match[1]);
        mock.className = classes;
        for (const attr of match[2].matchAll(/\bdata-([a-z-]+)="([^"]*)"/g)) {
          mock.dataset[attr[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = attr[2];
        }
        this.queryNodes.set(selector, mock);
        return mock;
      }
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this.classes.has(cls)) results.push(this);
      for (const ch of this.children) {
        if (ch.querySelectorAll) results.push(...ch.querySelectorAll(selector));
      }
    }
    return results;
  }
}

globalThis.document ||= {
  body: new MockElement('body'),
  createElement: (tag) => new MockElement(tag),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.localStorage ||= {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; }
};
globalThis.window ||= { addEventListener() {} };

const { ArticleReaderModal, ArticleParser } = await import('../src/article_reader.js');

test('groupConsecutivePushes handles empty list and single push', () => {
  const reader = Object.create(ArticleReaderModal.prototype);
  assert.deepEqual(reader.groupConsecutivePushes([]), []);
  assert.deepEqual(reader.groupConsecutivePushes(null), []);

  const single = [{ floor: 1, sourceLine: 10, user: 'alice', tag: '推', content: '好文推推', time: '10/23 18:00', ip: '1.2.3.4' }];
  const grouped = reader.groupConsecutivePushes(single);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].floorLabel, '1F');
  assert.equal(grouped[0].user, 'alice');
  assert.equal(grouped[0].content, '好文推推');
  assert.equal(grouped[0].pushes.length, 1);
});

test('groupConsecutivePushes merges contiguous same-author pushes with compatible tags', () => {
  const reader = Object.create(ArticleReaderModal.prototype);
  const rawPushes = [
    { floor: 1, sourceLine: 10, user: 'alice', tag: '推', content: '第一段文字，', time: '10/23 18:00' },
    { floor: 2, sourceLine: 11, user: 'alice', tag: '→', content: '第二段文字，', time: '10/23 18:01' },
    { floor: 3, sourceLine: 12, user: 'alice', tag: '→', content: '收尾第三段。', time: '10/23 18:01', ip: '1.2.3.4' },
  ];

  const grouped = reader.groupConsecutivePushes(rawPushes);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].floorLabel, '1~3F');
  assert.equal(grouped[0].tag, '推');
  assert.equal(grouped[0].user, 'alice');
  assert.equal(grouped[0].content, '第一段文字，第二段文字，收尾第三段。');
  assert.equal(grouped[0].time, '10/23 18:01');
  assert.equal(grouped[0].ip, '1.2.3.4');
  assert.deepEqual(grouped[0].sourceLines, [10, 11, 12]);
  assert.equal(grouped[0].pushes.length, 3);
});

test('groupConsecutivePushes separates pushes with different users or non-contiguous lines', () => {
  const reader = Object.create(ArticleReaderModal.prototype);
  const rawPushes = [
    { floor: 1, sourceLine: 10, user: 'alice', tag: '推', content: '我是愛麗絲' },
    { floor: 2, sourceLine: 11, user: 'bob', tag: '推', content: '我是鮑伯' },
    { floor: 3, sourceLine: 12, user: 'alice', tag: '推', content: '我又來了' },
    { floor: 4, sourceLine: 15, user: 'alice', tag: '推', content: '中間隔了兩行' }, // line gap (12 -> 15)
  ];

  const grouped = reader.groupConsecutivePushes(rawPushes);
  assert.equal(grouped.length, 4);
  assert.equal(grouped[0].floorLabel, '1F');
  assert.equal(grouped[0].user, 'alice');
  assert.equal(grouped[1].floorLabel, '2F');
  assert.equal(grouped[1].user, 'bob');
  assert.equal(grouped[2].floorLabel, '3F');
  assert.equal(grouped[2].user, 'alice');
  assert.equal(grouped[3].floorLabel, '4F');
  assert.equal(grouped[3].user, 'alice');
});

test('groupConsecutivePushes rejects merging opposite polarity tags (推 followed by 噓)', () => {
  const reader = Object.create(ArticleReaderModal.prototype);
  const rawPushes = [
    { floor: 1, sourceLine: 10, user: 'alice', tag: '推', content: '我先推' },
    { floor: 2, sourceLine: 11, user: 'alice', tag: '噓', content: '我又噓' },
  ];

  const grouped = reader.groupConsecutivePushes(rawPushes);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].tag, '推');
  assert.equal(grouped[0].floorLabel, '1F');
  assert.equal(grouped[1].tag, '噓');
  assert.equal(grouped[1].floorLabel, '2F');
});

test('groupConsecutivePushes formats English word boundary with space and Chinese without space', () => {
  const reader = Object.create(ArticleReaderModal.prototype);
  const enPushes = [
    { floor: 1, sourceLine: 10, user: 'charlie', tag: '推', content: 'Hello' },
    { floor: 2, sourceLine: 11, user: 'charlie', tag: '→', content: 'World' },
  ];
  const zhPushes = [
    { floor: 1, sourceLine: 10, user: 'charlie', tag: '推', content: '這是一段' },
    { floor: 2, sourceLine: 11, user: 'charlie', tag: '→', content: '中文推文' },
  ];

  const enGrouped = reader.groupConsecutivePushes(enPushes);
  assert.equal(enGrouped[0].content, 'Hello World');

  const zhGrouped = reader.groupConsecutivePushes(zhPushes);
  assert.equal(zhGrouped[0].content, '這是一段中文推文');
});

test('renderPushList toggles between 1:1 view and merged view', () => {
  const originalGet = document.getElementById;
  const listEl = new MockElement();
  const trackingBarEl = new MockElement();
  document.getElementById = (id) => {
    if (id === 'push-list') return listEl;
    if (id === 'push-tracking-bar') return trackingBarEl;
    return null;
  };

  const article = {
    author: 'op_user (OP)',
    pushList: [
      { floor: 1, sourceLine: 10, user: 'alice', tag: '推', content: '第一行', time: '10/23 18:00' },
      { floor: 2, sourceLine: 11, user: 'alice', tag: '→', content: '第二行', time: '10/23 18:00' },
      { floor: 3, sourceLine: 12, user: 'bob', tag: '推', content: '鮑伯說話', time: '10/23 18:01' },
    ]
  };

  const reader = Object.create(ArticleReaderModal.prototype);
  Object.assign(reader, {
    currentArticle: article,
    currentFilter: 'all',
    pushSearchQuery: '',
    highlightedUser: null,
    mergeConsecutive: false,
    revealedPushes: new Set(),
  });

  // 1. Unmerged mode
  reader.renderPushList();
  assert.equal(listEl.children.length, 3);
  assert.ok(listEl.children[0].innerHTML.includes('1F'));
  assert.ok(listEl.children[1].innerHTML.includes('2F'));
  assert.ok(listEl.children[2].innerHTML.includes('3F'));

  // 2. Merged mode
  reader.mergeConsecutive = true;
  listEl.children = [];
  reader.renderPushList();
  assert.equal(listEl.children.length, 2);
  assert.ok(listEl.children[0].innerHTML.includes('1~2F'));
  assert.ok(listEl.children[0].innerHTML.includes('第一行第二行'));
  assert.ok(listEl.children[1].innerHTML.includes('3F'));
  assert.ok(listEl.children[1].innerHTML.includes('鮑伯說話'));

  document.getElementById = originalGet;
});

test('renderPushList user click tracking highlights target user and dims others', () => {
  const originalGet = document.getElementById;
  const listEl = new MockElement();
  const trackingBarEl = new MockElement();
  document.getElementById = (id) => {
    if (id === 'push-list') return listEl;
    if (id === 'push-tracking-bar') return trackingBarEl;
    return null;
  };

  const article = {
    author: 'op_user',
    pushList: [
      { floor: 1, sourceLine: 10, user: 'alice', tag: '推', content: '第一行', time: '10/23 18:00' },
      { floor: 2, sourceLine: 11, user: 'bob', tag: '推', content: '鮑伯留言', time: '10/23 18:01' },
      { floor: 3, sourceLine: 12, user: 'alice', tag: '推', content: '第二行', time: '10/23 18:02' },
    ]
  };

  const reader = Object.create(ArticleReaderModal.prototype);
  Object.assign(reader, {
    currentArticle: article,
    currentFilter: 'all',
    pushSearchQuery: '',
    highlightedUser: null,
    mergeConsecutive: false,
    revealedPushes: new Set(),
  });

  reader.renderPushList();
  listEl.children[0].querySelector('.push-user-name').dispatchEvent({ type: 'click' });
  assert.equal(reader.highlightedUser, 'alice');
  assert.equal(listEl.children.length, 3);
  assert.ok(listEl.children[0].classList.contains('is-user-highlighted'));
  assert.ok(listEl.children[1].classList.contains('is-user-dimmed'));
  assert.ok(listEl.children[2].classList.contains('is-user-highlighted'));
  assert.equal(trackingBarEl.classList.contains('hidden'), false);
  assert.ok(trackingBarEl.innerHTML.includes('alice'));
  assert.ok(trackingBarEl.innerHTML.includes('共 2 則推文'));

  // Exercise the real cancel handler rather than assigning state directly.
  trackingBarEl.querySelector('.push-tracking-clear-btn').dispatchEvent({ type: 'click' });
  assert.equal(reader.highlightedUser, null);
  assert.equal(listEl.children[0].classList.contains('is-user-highlighted'), false);
  assert.equal(listEl.children[0].classList.contains('is-user-dimmed'), false);
  assert.equal(trackingBarEl.classList.contains('hidden'), true);

  document.getElementById = originalGet;
});

test('renderPushList highlights OP pushes with author badge and class', () => {
  const originalGet = document.getElementById;
  const listEl = new MockElement();
  document.getElementById = (id) => id === 'push-list' ? listEl : null;

  const article = {
    author: 'author_op (大師)',
    pushList: [
      { floor: 1, sourceLine: 10, user: 'author_op', tag: '→', content: '原PO補充說明', time: '10/23 18:00' },
      { floor: 2, sourceLine: 11, user: 'reader1', tag: '推', content: '感謝作者說明', time: '10/23 18:01' },
    ]
  };

  const reader = Object.create(ArticleReaderModal.prototype);
  Object.assign(reader, {
    currentArticle: article,
    currentFilter: 'all',
    pushSearchQuery: '',
    highlightedUser: null,
    mergeConsecutive: false,
    revealedPushes: new Set(),
  });

  reader.renderPushList();
  assert.ok(listEl.children[0].classList.contains('is-author-push'));
  assert.ok(listEl.children[0].innerHTML.includes('✍️ 原PO'));
  assert.equal(listEl.children[1].classList.contains('is-author-push'), false);
  listEl.children[0].querySelector('.push-author-badge').dispatchEvent({ type: 'click' });
  assert.equal(reader.highlightedUser, 'author_op');
  assert.ok(listEl.children[1].classList.contains('is-user-dimmed'));
  listEl.children[0].querySelector('.push-author-badge').dispatchEvent({ type: 'click' });
  assert.equal(reader.highlightedUser, null);

  document.getElementById = originalGet;
});

test('renderPushList aggregates and deduplicates media in merged consecutive pushes', () => {
  const originalGet = document.getElementById;
  const listEl = new MockElement();
  document.getElementById = (id) => id === 'push-list' ? listEl : null;

  const article = {
    author: 'someone',
    pushList: [
      {
        floor: 1,
        sourceLine: 10,
        user: 'alice',
        tag: '推',
        content: '第一張圖 https://i.imgur.com/pic1.jpg',
        images: [{ url: 'https://i.imgur.com/pic1.jpg' }],
        youtubes: [],
      },
      {
        floor: 2,
        sourceLine: 11,
        user: 'alice',
        tag: '→',
        content: '第二張圖 https://i.imgur.com/pic2.jpg 以及重複圖 https://i.imgur.com/pic1.jpg',
        images: [{ url: 'https://i.imgur.com/pic2.jpg' }, { url: 'https://i.imgur.com/pic1.jpg' }],
        youtubes: [{ videoId: 'abc12345', url: 'https://youtu.be/abc12345' }],
      },
    ]
  };

  const reader = Object.create(ArticleReaderModal.prototype);
  Object.assign(reader, {
    currentArticle: article,
    currentFilter: 'all',
    pushSearchQuery: '',
    highlightedUser: null,
    mergeConsecutive: true,
    revealedPushes: new Set(),
    createYoutubeCard: (yt) => {
      const card = new MockElement('div');
      card.dataset.yt = yt.videoId;
      return card;
    }
  });

  reader.renderPushList();
  assert.equal(listEl.children.length, 1);
  const row = listEl.children[0];
  // 2 unique images + 1 youtube card
  const imgElements = row.children.filter(c => c.tagName === 'IMG');
  assert.equal(imgElements.length, 2);
  assert.equal(imgElements[0].src, 'https://i.imgur.com/pic1.jpg');
  assert.equal(imgElements[1].src, 'https://i.imgur.com/pic2.jpg');
  const ytElements = row.children.filter(c => c.dataset?.yt === 'abc12345');
  assert.equal(ytElements.length, 1);

  document.getElementById = originalGet;
});

const { BlacklistManager, blacklistManager } = await import('../src/blacklist.js');

function renderFixture(t, pushes, { mode = 'dim', users = [], keywords = [], merge = true, highlighted = null } = {}) {
  const originalGet = document.getElementById;
  const list = new MockElement(), tracking = new MockElement();
  document.getElementById = id => id === 'push-list' ? list : id === 'push-tracking-bar' ? tracking : null;
  t.after(() => { document.getElementById = originalGet; });
  const rules = new BlacklistManager(null);
  rules.saveSettings({ ...rules.settings, mode });
  for (const user of users) rules.add(user);
  for (const keyword of keywords) rules.addKeyword(keyword);
  for (const name of ['getMode', 'isBlacklisted', 'isKeywordBlacklisted', 'hasUserRule']) {
    const original = blacklistManager[name];
    blacklistManager[name] = rules[name].bind(rules);
    t.after(() => { blacklistManager[name] = original; });
  }
  const reader = Object.create(ArticleReaderModal.prototype);
  Object.assign(reader, { currentArticle: { author: 'alice (OP)', pushList: pushes }, mergeConsecutive: merge,
    highlightedUser: highlighted, currentFilter: 'all', pushSearchQuery: '', revealedPushes: new Set() });
  reader.renderPushList();
  return { reader, list, tracking, rules };
}
function push(floor, content, { user = 'alice', tag = '→', sourceLine = floor } = {}) {
  return { floor, sourceLine, user, tag, content, images: [], youtubes: [], time: '' };
}
function repairedPair() {
  const first = push(1, 'https://example.com/se', { tag: '推' });
  const second = push(2, 'cret.png');
  const repair = { urlStartCol: 0, urlPart1: first.content, repairedUrl: 'https://example.com/secret.png',
    contStartCol: 0, contToken: second.content };
  Object.assign(first, { repairedCont: repair, repairNextLine: 2, images: [{ url: repair.repairedUrl }] });
  Object.assign(second, { previousRepair: repair, repairPreviousLine: 1 });
  return [first, second];
}
const click = (node, selector) => { const target = node.querySelector(selector); assert.ok(target, selector); target.dispatchEvent({ type: 'click' }); };

test('type filtering precedes grouping and cannot bridge removed source lines', t => {
  const f = renderFixture(t, [push(1, '先推', { tag: '推' }), push(2, '箭頭一'), push(3, '改噓', { tag: '噓' }), push(4, '箭頭二')]);
  for (const [filter, expected] of [['push', ['1F']], ['boo', ['3F']], ['arrow', ['2F', '4F']]]) {
    f.reader.currentFilter = filter; f.reader.renderPushList();
    assert.equal(f.list.children.length, expected.length);
    expected.forEach((floor, index) => assert.ok(f.list.children[index].innerHTML.includes(floor)));
  }
});

test('tracking counts original pushes across merge, type and search filters; hide excludes hidden cards', t => {
  const f = renderFixture(t, [push(1, '第一段', { tag: '推' }), push(2, '第二段'), push(3, '其他', { user: 'bob' })], { highlighted: 'alice' });
  assert.equal(f.list.children.length, 2); assert.match(f.tracking.innerHTML, /目前篩選結果共 2 則推文/);
  f.reader.mergeConsecutive = false; f.reader.renderPushList(); assert.match(f.tracking.innerHTML, /共 2 則推文/);
  f.reader.currentFilter = 'arrow'; f.reader.renderPushList(); assert.match(f.tracking.innerHTML, /共 1 則推文/);
  f.reader.currentFilter = 'all'; f.reader.pushSearchQuery = '不存在'; f.reader.renderPushList(); assert.match(f.tracking.innerHTML, /共 0 則推文/);
  f.reader.pushSearchQuery = ''; f.rules.add('alice'); f.rules.saveSettings({ ...f.rules.settings, mode: 'hide' });
  f.reader.renderPushList(); assert.match(f.tracking.innerHTML, /共 0 則推文/); assert.equal(f.list.children.length, 1);
});

for (const mode of ['hide', 'mask', 'dim']) test(`joined keyword obeys ${mode} rules`, t => {
  const f = renderFixture(t, [push(1, '劇', { tag: '推' }), push(2, '透')], { mode, keywords: ['劇透'] });
  if (mode === 'hide') { assert.equal(f.list.children.length, 0); return; }
  assert.ok(f.list.children[0].classList.contains('blacklisted-push'));
  if (mode === 'mask') assert.ok(f.list.children[0].querySelector('.push-masked-body').classList.contains('hidden'));
});

test('repair visibility shares joined-keyword protection and reveals media only after explicit consent', t => {
  const f = renderFixture(t, repairedPair(), { mode: 'mask', keywords: ['secret'] });
  assert.ok(!f.list.children[0].innerHTML.includes('href="https://example.com/secret.png"'));
  assert.equal(f.list.children[0].querySelector('.push-masked-body').children.length, 0);
  click(f.list.children[0], '.push-mask-reveal-btn');
  const revealed = f.list.children[0];
  assert.ok(!revealed.querySelector('.push-masked-body').classList.contains('hidden'));
  assert.ok(revealed.innerHTML.includes('href="https://example.com/secret.png"'));
  assert.equal(revealed.querySelector('.push-masked-body').children.filter(node => node.tagName === 'IMG').length, 1);
  click(revealed, '.push-user-name');
  assert.equal(f.reader.highlightedUser, 'alice');
  assert.ok(!f.list.children[0].querySelector('.push-masked-body').classList.contains('hidden'));
  assert.equal(f.list.children[0].querySelector('.push-masked-body').children.filter(node => node.tagName === 'IMG').length, 1);
  click(f.list.children[0], '.push-mask-reveal-btn');
  assert.ok(f.list.children[0].querySelector('.push-masked-body').classList.contains('hidden'));
  assert.ok(!f.list.children[0].innerHTML.includes('href="https://example.com/secret.png"'));
});

test('original push reveal identities survive render and merge toggles without disclosing an unrevealed partner', t => {
  const originals = repairedPair(), before = JSON.stringify(originals);
  const f = renderFixture(t, originals, { mode: 'mask', users: ['alice'], merge: false });
  click(f.list.children[0], '.push-mask-reveal-btn');
  assert.ok(!f.list.children[0].querySelector('.push-masked-body').classList.contains('hidden'));
  assert.ok(f.list.children[1].querySelector('.push-masked-body').classList.contains('hidden'));
  f.reader.mergeConsecutive = true; f.reader.renderPushList();
  assert.ok(f.list.children[0].querySelector('.push-masked-body').classList.contains('hidden'));
  for (let attempt = 0; attempt < 5; attempt++) {
    click(f.list.children[0], '.push-mask-reveal-btn');
    assert.ok(!f.list.children[0].querySelector('.push-masked-body').classList.contains('hidden'));
    assert.equal(f.reader.revealedPushes.size, 2);
    f.reader.renderPushList();
    assert.ok(!f.list.children[0].querySelector('.push-masked-body').classList.contains('hidden'));
    click(f.list.children[0], '.push-mask-reveal-btn');
    assert.equal(f.reader.revealedPushes.size, 0);
  }
  assert.equal(JSON.stringify(originals), before, 'merging/revealing must not mutate parser data');
});

test('same user name toggles off and the actual tracking cancel handler restores other rows', t => {
  const f = renderFixture(t, [push(1, '第一段'), push(2, '其他', { user: 'bob' })]);
  click(f.list.children[0], '.push-user-name'); assert.equal(f.reader.highlightedUser, 'alice');
  assert.ok(f.list.children[1].classList.contains('is-user-dimmed'));
  click(f.list.children[0], '.push-user-name'); assert.equal(f.reader.highlightedUser, null);
  click(f.list.children[0], '.push-author-badge'); assert.equal(f.reader.highlightedUser, 'alice');
  click(f.tracking, '.push-tracking-clear-btn'); assert.equal(f.reader.highlightedUser, null);
  assert.ok(!f.list.children[1].classList.contains('is-user-dimmed'));
});

test('clearPushSection immediately empties push list, stats, filter counts, search input, and tracking state', t => {
  const f = renderFixture(t, [push(1, '推文一'), push(2, '推文二', { user: 'bob' })]);
  assert.equal(f.list.children.length, 2);
  f.reader.highlightedUser = 'alice';
  f.reader.pushSearchQuery = '推文';

  const stats = new MockElement(); stats.innerHTML = '<span>stats</span>';
  const countAll = new MockElement(); countAll.textContent = '2';
  const countPush = new MockElement(); countPush.textContent = '2';
  const searchInput = new MockElement(); searchInput.value = '推文';
  const filterBtnAll = new MockElement(); filterBtnAll.dataset.filter = 'all';
  const filterBtnPush = new MockElement(); filterBtnPush.dataset.filter = 'push'; filterBtnPush.classList.add('active');

  const origGet = document.getElementById;
  t.after(() => { document.getElementById = origGet; });
  document.getElementById = (id) => {
    if (id === 'push-list') return f.list;
    if (id === 'push-stats') return stats;
    if (id === 'push-tracking-bar') return f.tracking;
    if (id === 'push-search-input') return searchInput;
    if (id === 'count-all') return countAll;
    if (id === 'count-push') return countPush;
    return null;
  };
  f.reader.modalEl = {
    querySelectorAll: (sel) => sel === '.push-filter-btn' ? [filterBtnAll, filterBtnPush] : [],
  };

  f.reader.clearPushSection();

  assert.equal(f.reader.currentArticle, null);
  assert.equal(f.reader.highlightedUser, null);
  assert.equal(f.reader.pushSearchQuery, '');
  assert.equal(f.reader.currentFilter, 'all');
  assert.equal(f.list.innerHTML, '');
  assert.equal(stats.innerHTML, '');
  assert.equal(f.tracking.innerHTML, '');
  assert.ok(f.tracking.classList.contains('hidden'));
  assert.equal(searchInput.value, '');
  assert.equal(countAll.textContent, '0');
  assert.equal(countPush.textContent, '0');
  assert.ok(filterBtnAll.classList.contains('active'));
  assert.ok(!filterBtnPush.classList.contains('active'));
});

test('reader extracts the complete current PTT article URL', async () => {
  const parsed = ArticleParser.parseLines([
    '作者  User (讀者)  看板  Baseball', '標題  測試文章', '時間  日期', '',
    '內文', '※ 文章網址: https://www.ptt.cc/bbs/Baseball/M.1793727494.A.D45.html',
  ]);
  assert.equal(parsed.webUrl, 'https://www.ptt.cc/bbs/Baseball/M.1793727494.A.D45.html');
  assert.equal(parsed.articleId, 'M.1793727494.A.D45');
});

test('reader ignores cross-board quoted URLs and preserves matching board identity', async () => {
  const lines = [
    '作者: someone (某人) 看板: HatePolitics',
    '標題: [討論] 政治討論文',
    '時間: Wed Nov  4 12:00:00 2026',
    '───────────────────────────────────────',
    '這是一篇政黑文章，內文引用了八卦板文章：',
    '※ 文章網址: https://www.ptt.cc/bbs/Gossiping/M.999.A.888.html',
    '以上是引文，以下是本文真實網址：',
    '※ 發信站: 批踢踢實業坊(ptt.cc)',
    '※ 文章網址: https://www.ptt.cc/bbs/HatePolitics/M.111.A.222.html',
  ];

  const parsed = ArticleParser.parseLines(lines);
  assert.equal(parsed.board, 'HatePolitics');
  assert.equal(parsed.webUrl, 'https://www.ptt.cc/bbs/HatePolitics/M.111.A.222.html');
  assert.equal(parsed.articleId, 'M.111.A.222');
});

test('reader prioritizes explicit 文章網址 over same-board quoted bare URL in body', async () => {
  const lines = [
    '作者: someone (某人) 看板: Gossiping',
    '標題: Re: [問卦] 回文討論',
    '時間: Wed Nov  4 12:00:00 2026',
    '───────────────────────────────────────',
    '※ 引述《other (他人)》之銘言：',
    '引述內文包含同看板文章網址：https://www.ptt.cc/bbs/Gossiping/M.1111111111.A.111.html',
    '以下是本文作者自身論述內容...',
    '※ 發信站: 批踢踢實業坊(ptt.cc)',
    '※ 文章網址: https://www.ptt.cc/bbs/Gossiping/M.2222222222.A.222.html',
  ];

  const parsed = ArticleParser.parseLines(lines);
  assert.equal(parsed.board, 'Gossiping');
  assert.equal(parsed.webUrl, 'https://www.ptt.cc/bbs/Gossiping/M.2222222222.A.222.html');
  assert.equal(parsed.articleId, 'M.2222222222.A.222');
});

test('adjustFontSize scales font and updates container, content and AI summary card', () => {
  const fontVal = new MockElement('span');
  const content = new MockElement('div');
  const summaryCard = new MockElement('div');
  const container = new MockElement('div');
  const elements = {
    'reader-font-val': fontVal,
    'reader-article-content': content,
    'reader-ai-summary-card': summaryCard,
    'reader-scroll-container': { querySelector: () => container },
  };
  const origGetElementById = document.getElementById;
  document.getElementById = (id) => elements[id] || null;

  try {
    const reader = Object.create(ArticleReaderModal.prototype);
    reader.fontSize = 16;
    reader.applyFontSize();

    assert.equal(fontVal.textContent, '16px');
    assert.equal(content.style.fontSize, '16px');
    assert.equal(container.style['--reader-font-size'], '16px');
    assert.equal(summaryCard.style['--reader-font-size'], '16px');

    // Increase font size
    reader.adjustFontSize(2);
    assert.equal(reader.fontSize, 18);
    assert.equal(fontVal.textContent, '18px');
    assert.equal(content.style.fontSize, '18px');
    assert.equal(container.style['--reader-font-size'], '18px');
    assert.equal(summaryCard.style['--reader-font-size'], '18px');
    assert.equal(localStorage.getItem('bbsterm_reader_font_size'), '18');

    // Bounds checking: max 26, min 12
    reader.adjustFontSize(20);
    assert.equal(reader.fontSize, 26);
    reader.adjustFontSize(-30);
    assert.equal(reader.fontSize, 12);
  } finally {
    document.getElementById = origGetElementById;
  }
});

test('article identity ignores push URLs, quoted footer lines and bare links', () => {
  const prefix = ['作者  User (讀者)  看板  Baseball', '標題  測試', '時間  日期', ''];
  const real = 'https://www.ptt.cc/bbs/Baseball/M.2.A.222.html';
  const old = 'https://www.ptt.cc/bbs/Baseball/M.1.A.111.html';
  const parsed = ArticleParser.parseLines([...prefix, old, `> ※ 文章網址: ${old}`, '※ 發信站: 批踢踢實業坊(ptt.cc)', `※ 文章網址: ${real}`, `推 someone: 文章網址: ${old}`, `※ 文章網址: ${old}`]);
  assert.equal(parsed.webUrl, real);
  assert.equal(ArticleParser.parseLines([...prefix, old]).webUrl, '');
  assert.equal(ArticleParser.parseLines([...prefix, `※ 文章網址: ${old}`, `※ 文章網址: ${real}`]).webUrl, '');
  assert.equal(ArticleParser.parseLines(['', old, `※ 文章網址: ${real}`]).webUrl, '');
});

test('article identity and headers accept terminal leading whitespace and split author/board', () => {
  const prefix = [
    ' 作者  BigCarp (BigCarp)                                          看板  Stock',
    ' 標題  台指期 空單平倉',
    ' 時間  Fri Nov  6 00:45:14 2026',
    '',
  ];
  const real = 'https://www.ptt.cc/bbs/Stock/M.1793897116.A.060.html';
  const parsed = ArticleParser.parseLines([
    ...prefix,
    '1. 標的：小型台指期',
    ' ※ 發信站: 批踢踢實業坊(ptt.cc), 來自: 42.72.138.241 (臺灣)',
    ` ※ 文章網址: ${real}`,
    ' 推 InfoWars    : 厲害了兄弟 11/06 00:45',
  ]);
  assert.equal(parsed.author, 'BigCarp (BigCarp)');
  assert.equal(parsed.title, '台指期 空單平倉');
  assert.equal(parsed.time, 'Fri Nov  6 00:45:14 2026');
  assert.equal(parsed.board, 'Stock');
  assert.equal(parsed.webUrl, real);
  assert.equal(parsed.articleId, 'M.1793897116.A.060');
  assert.equal(parsed.aid, '#1gxBAS1W');
  assert.equal(parsed.pushList.length, 1);
  assert.equal(parsed.pushList[0].user, 'InfoWars');
  assert.equal(parsed.pushList[0].tag, '推');
  assert.equal(parsed.pushList[0].content, '厲害了兄弟');
});

test('crawlFullArticle streams lines progressively and notifies page updates', async () => {
  const reader = Object.create(ArticleReaderModal.prototype);
  const tab = { id: 'stream-tab', buf: {} };
  const writes = [];
  reader.getConnectionSession = async id => 'stream-session';
  reader.waitForBufferUpdate = async () => {};
  let currentStep = 0;
  reader.getScreenLines = () => {
    currentStep++;
    return Array.from({ length: 24 }, (_, row) => {
      if (row === 23) {
        return currentStep >= 2 ? '瀏覽 第 2/2 頁 (100%)' : '瀏覽 第 1/2 頁 ( 50%)';
      }
      return `Page ${currentStep} Row ${row}`;
    });
  };
  reader.sendToTab = async (...args) => writes.push(args);

  const updates = [];
  await reader.crawlFullArticle(tab, null, (lines, status) => {
    updates.push({ totalLines: lines.length, page: status.pageCount, isLastPage: status.isLastPage });
  });

  assert.equal(updates.length, 2);
  assert.equal(updates[0].page, 1);
  assert.equal(updates[0].isLastPage, false);
  assert.equal(updates[1].page, 2);
  assert.equal(updates[1].isLastPage, true);
});
