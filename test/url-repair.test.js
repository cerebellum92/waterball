import test from 'node:test';
import assert from 'node:assert/strict';
import { repairBrokenUrl, bbsColumns } from '../src/url_repair.js';
import { TermBuf } from '../src/term_buf.js';

class MockElement {
  constructor() {
    this.children = [];
    this.classes = new Set();
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      contains: (c) => this.classes.has(c),
      toggle: (c) => {
        if (this.classes.has(c)) { this.classes.delete(c); return false; }
        this.classes.add(c); return true;
      }
    };
    this.style = {};
    this.dataset = {};
  }
  addEventListener() {}
  removeEventListener() {}
  appendChild(child) { this.children.push(child); return child; }
  querySelector() { return new MockElement(); }
  querySelectorAll() { return []; }
}

globalThis.document ||= {
  body: new MockElement(),
  createElement: () => new MockElement(),
  getElementById: () => null,
  querySelectorAll: () => [],
};
globalThis.localStorage ||= { getItem: () => null, setItem() {} };
globalThis.window ||= { addEventListener() {} };

const { ArticleParser, ArticleReaderModal } = await import('../src/article_reader.js');
const { TermView } = await import('../src/term_view.js');

// Positive fixtures must actually occupy 80 BBS cells, not just end in '/'.
function wrapped(text, columns = 80) {
  const prefix = text.match(/^(?:[:>]\s*|[推噓→]\s+[A-Za-z0-9_]+:\s*)/)?.[0] || '';
  return prefix + ' '.repeat(columns - bbsColumns(text)) + text.slice(prefix.length);
}
function pushLine(user, content, tag = '推') {
  const prefix = `${tag} ${user}: `, suffix = ' 10/23 16:31';
  return prefix + wrapped(content, 80 - bbsColumns(prefix) - bbsColumns(suffix)) + suffix;
}

test('repairBrokenUrl handles PTT broken article URLs across lines', () => {
  // Case 1: PTT article URL split before extension
  const l1 = wrapped('請參考這篇文章：https://www.ptt.cc/bbs/Gossiping/M.1698000000.A.');
  const l2 = 'B12.html 相關資訊都在裡面';
  const res = repairBrokenUrl(l1, l2);
  assert.ok(res);
  assert.equal(res.repairedUrl, 'https://www.ptt.cc/bbs/Gossiping/M.1698000000.A.B12.html');
  assert.equal(res.contToken, 'B12.html');
});

test('repairBrokenUrl handles query parameter split with & or = or ?', () => {
  // Case 2: URL ends with &
  const l1 = wrapped('經典影片：https://www.youtube.com/watch?v=dQw4w9WgXcQ&');
  const l2 = 'feature=shared 超棒';
  const res = repairBrokenUrl(l1, l2);
  assert.ok(res);
  assert.equal(res.repairedUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=shared');
});

test('repairBrokenUrl handles Imgur image link split across lines', () => {
  // Case 3: Imgur trailing slash
  const l1 = wrapped('附圖：https://i.imgur.com/');
  const l2 = 'abcdefg.jpg 拍攝得很清楚';
  const res = repairBrokenUrl(l1, l2);
  assert.ok(res);
  assert.equal(res.repairedUrl, 'https://i.imgur.com/abcdefg.jpg');
});

test('repairBrokenUrl handles push lines from the same author', () => {
  // Case 4: Push lines with same author
  const l1 = wrapped('推 user1: 網址是 https://www.youtube.com/watch?v=12345');
  const l2 = '→ user1: 67890.html 參考看看';
  const res = repairBrokenUrl(l1, l2, 'user1');
  assert.ok(res);
  assert.equal(res.repairedUrl, 'https://www.youtube.com/watch?v=1234567890.html');
  assert.equal(res.contToken, '67890.html');
});

test('repairBrokenUrl rejects push lines from different authors', () => {
  const l1 = wrapped('推 user1: 網址是 https://i.imgur.com/');
  const l2 = '推 user2: 不是這樣吧';
  const res = repairBrokenUrl(l1, l2, 'user1');
  assert.equal(res, null);
});

test('repairBrokenUrl handles quoted reply lines with : or > prefix', () => {
  const l1 = wrapped(': 請參考資料 https://example.com/long/path/document-');
  const l2 = ': v2.pdf 這是最新版';
  const res = repairBrokenUrl(l1, l2);
  assert.ok(res);
  assert.equal(res.repairedUrl, 'https://example.com/long/path/document-v2.pdf');
});

test('repairBrokenUrl ignores complete URLs followed by regular English text', () => {
  const l1 = wrapped('首頁是 https://google.com');
  const l2 = 'today is a good day';
  const res = repairBrokenUrl(l1, l2);
  assert.equal(res, null);
});

test('repairBrokenUrl does not stitch when line2 starts with a new URL', () => {
  const l1 = wrapped('兩個好網站：https://site1.com/a/');
  const l2 = 'https://site2.com/b/';
  const res = repairBrokenUrl(l1, l2);
  assert.equal(res, null);
});

test('TermBuf detects and repairs broken URLs across adjacent rows without altering buffer cells', () => {
  const buf = new TermBuf(80, 24);
  
  // Write line 2 with broken URL at the end
  const line2Str = wrapped('精選推薦請看：https://www.youtube.com/watch?v=rickroll&');
  buf.gotoPos(0, 2);
  buf.puts(line2Str);

  // Write line 3 with continuation token
  const line3Str = 'feature=shared 真的很耐聽';
  buf.gotoPos(0, 3);
  buf.puts(line3Str);

  // 1. Verify buffer cells themselves are 100% UNTOUCHED (true to raw BBS terminal)
  assert.equal(buf.getRowText(buf.lines[2]).trimEnd(), line2Str);
  assert.equal(buf.getRowText(buf.lines[3]).trimEnd(), line3Str);

  // 2. Querying row 2 URL on part 1
  const start = buf.getUrlsInRow(2)[0].startCol;
  const snapshot = JSON.stringify({ lines: buf.lines, x: buf.cur_x, y: buf.cur_y });
  const urlOnRow2 = buf.findUrlAt(start, 2);
  assert.ok(urlOnRow2, 'Should find URL on row 2');
  assert.equal(urlOnRow2.url, 'https://www.youtube.com/watch?v=rickroll&feature=shared');
  assert.equal(urlOnRow2.repaired, true);

  // 3. Querying row 3 on the continuation token
  const urlOnRow3 = buf.findUrlAt(4, 3);
  assert.ok(urlOnRow3, 'Should find continuation URL on row 3');
  assert.equal(urlOnRow3.url, 'https://www.youtube.com/watch?v=rickroll&feature=shared');
  assert.equal(urlOnRow3.isContinuation, true);
  assert.equal(JSON.stringify({ lines: buf.lines, x: buf.cur_x, y: buf.cur_y }), snapshot);
});

test('ArticleParser repairs broken image URLs in body and extracts image previews', () => {
  const rawLines = [
    '作者: testuser (測試者) 看板: Gossiping',
    '標題: [爆卦] 這是測試文章',
    '時間: Fri Oct 23 16:30:00 2026',
    '───────────────────',
    wrapped('大家看看這張照片：https://i.imgur.com/'),
    'AbCdEf12.jpg 拍得非常漂亮！',
    '※ 發信站: 批踢踢實業坊(ptt.cc)'
  ];

  const parsed = ArticleParser.parseLines(rawLines);
  assert.ok(parsed.bodyBlocks.length >= 2);
  // Image should be successfully repaired and extracted
  const blockWithImg = parsed.bodyBlocks.find((b) => b.images && b.images.length > 0);
  assert.ok(blockWithImg, 'Should extract repaired image');
  assert.equal(blockWithImg.images[0].url, 'https://i.imgur.com/AbCdEf12.jpg');
});

test('ArticleParser repairs broken URLs in consecutive push lines from same author', () => {
  const rawLines = [
    '作者: testuser (測試者) 看板: Gossiping',
    '標題: [爆卦] 這是測試文章',
    '時間: Fri Oct 23 16:30:00 2026',
    '───────────────────',
    '內文行',
    pushLine('userA', '附圖是 https://i.imgur.com/'),
    pushLine('userA', '99887766.png 請過目', '→')
  ];

  const parsed = ArticleParser.parseLines(rawLines);
  assert.equal(parsed.pushList.length, 2);
  assert.ok(parsed.pushList[0].images.length > 0, 'First push should have extracted repaired image');
  assert.equal(parsed.pushList[0].images[0].url, 'https://i.imgur.com/99887766.png');
});

test('short complete URLs, fifty-column lines and padding are not wrap evidence', () => {
  for (const first of ['https://example.com/', ' '.repeat(30) + 'https://example.com/', 'https://example.com/'.padEnd(80)]) {
    assert.equal(repairBrokenUrl(first, 'Thanks for reading'), null);
  }
  assert.equal(repairBrokenUrl(wrapped('https://example.com/'), 'Thanks for reading'), null);
  assert.equal(repairBrokenUrl(wrapped('https://example.com/image.jpg'), 'another.jpg'), null);
});

test('authority/userinfo cannot be completed or changed even at the actual margin', () => {
  for (const [first, second] of [
    ['https://trusted.example', '@evil.example/path'],
    ['https://trusted.example', '.evil.example/path'],
    ['https://trusted.example:8', '080/path'],
    ['https://name@trusted.example/', 'picture.jpg'],
    ['https://name:secret@trusted.example/', 'picture.jpg'],
  ]) assert.equal(repairBrokenUrl(wrapped(first), second), null);
  const result = repairBrokenUrl(wrapped('https://trusted.example/path/'), 'picture.jpg');
  assert.equal(new URL(result.repairedUrl).origin, 'https://trusted.example');
});

test('fresh protocols/short URLs, quote changes, control sequences and structural rows do not join', () => {
  for (const next of ['reurl.cc/new', 'tinyurl.com/new', 'www.example.com/new', 'mailto:user@example.com', 'javascript:alert(1)', '> picture.jpg', '推 someone: picture.jpg', '※ photo.jpg', 'pic\x1b[31mture.jpg']) {
    assert.equal(repairBrokenUrl(wrapped('https://example.com/path/'), next), null, next);
  }
  assert.equal(repairBrokenUrl(wrapped('標題: https://example.com/path/'), 'picture.jpg'), null);
  assert.equal(repairBrokenUrl(wrapped(': https://example.com/path/'), '> picture.jpg'), null);
});

test('BBS display columns include Chinese and surrogate-pair cells', () => {
  assert.equal(bbsColumns('中文😀A'), 7);
  const first = wrapped('中文😀 https://example.com/path/');
  assert.equal(bbsColumns(first), 80);
  const buf = new TermBuf(80, 24); buf.gotoPos(0, 2); buf.puts(first); buf.gotoPos(0, 3); buf.puts('picture.jpg');
  const found = buf.getUrlsInRow(2)[0];
  assert.equal(found.startCol, 80 - 'https://example.com/path/'.length);
  assert.equal(found.url, 'https://example.com/path/picture.jpg');
});

test('reader linkifies raw intervals before escaping query parameters and HTML characters', () => {
  const { prototype: reader } = ArticleReaderModal;
  const first = wrapped('https://example.com/path?x=1&'), next = "name=O'Reilly&y=2";
  const repair = repairBrokenUrl(first, next);
  const firstHtml = reader.formatLineHtml(first, repair), secondHtml = reader.formatLineHtml(next, null, repair);
  const escaped = reader.escapeHtml(repair.repairedUrl);
  assert.ok(firstHtml.includes(`href="${escaped}"`));
  assert.ok(secondHtml.includes(`href="${escaped}"`));
  assert.ok(secondHtml.includes('name=O&#039;Reilly&amp;y=2</a>'));
  assert.equal((firstHtml.match(/<a /g) || []).length, 1);
  assert.equal((secondHtml.match(/<a /g) || []).length, 1);
  assert.equal(reader.formatLineHtml('<img src=x onerror="bad()">').includes('<img'), false);
});

test('body/push boundaries and nonadjacent same-author pushes never join', () => {
  const bodyToPush = ArticleParser.parseLines(['', wrapped('https://example.com/path/'), pushLine('someone', 'picture.jpg')]);
  assert.equal(bodyToPush.bodyBlocks[0].repairedCont, undefined);
  assert.equal(bodyToPush.bodyBlocks[0].images.length, 0);
  for (const separator of ['', 'ordinary paragraph', '瀏覽 第 1/2 頁']) {
    const parsed = ArticleParser.parseLines(['', pushLine('someone', 'https://example.com/path/'), separator, pushLine('someone', 'picture.jpg', '→')]);
    assert.equal(parsed.pushList[0].repairedCont, undefined);
  }
  const different = ArticleParser.parseLines(['', pushLine('someone', 'https://example.com/path/'), pushLine('otheruser', 'picture.jpg', '→')]);
  assert.equal(different.pushList[0].repairedCont, undefined);
});

test('short timestamped comments from the same author are not assumed to wrap', () => {
  const parsed = ArticleParser.parseLines(['', '推 someone: https://example.com/    10/23 16:31', '→ someone: Thanks for reading     10/23 16:32']);
  assert.equal(parsed.pushList[0].repairedCont, undefined);
});

test('repair replaces partial image/video previews instead of appending false candidates', () => {
  const article = ArticleParser.parseLines(['', wrapped('https://i.imgur.com/abc'), 'def.jpg']);
  assert.deepEqual(article.bodyBlocks[0].images.map(image => image.url), ['https://i.imgur.com/abcdef.jpg']);
  const pushes = ArticleParser.parseLines(['', pushLine('someone', 'https://i.imgur.com/abc'), pushLine('someone', 'def.jpg', '→')]);
  assert.deepEqual(pushes.pushList[0].images.map(image => image.url), ['https://i.imgur.com/abcdef.jpg']);
  const video = ArticleParser.parseLines(['', wrapped('https://youtu.be/dQw4w'), '9WgXcQ']);
  assert.deepEqual(video.bodyBlocks[0].youtubes.map(yt => yt.videoId), ['dQw4w9WgXcQ']);
});

test('a neighboring row update invalidates cached URL metadata even after dirty flags clear', () => {
  const buf = new TermBuf(80, 24), view = Object.create(TermView.prototype);
  Object.assign(view, { buf, rowUrlCache: new Map() });
  buf.gotoPos(0, 2); buf.puts(wrapped('https://example.com/path/')); buf.gotoPos(0, 3); buf.puts('first.jpg');
  assert.equal(view.getCachedRowUrls(3)[0].url, 'https://example.com/path/first.jpg');
  buf.gotoPos(0, 2); buf.puts(wrapped('https://changed.example/path/')); buf.clearDirty();
  assert.equal(view.getCachedRowUrls(3)[0].url, 'https://changed.example/path/first.jpg');
});

test('masked source or continuation blocks cross-row hover/click access until both are revealed', () => {
  const buf = new TermBuf(80, 24), view = Object.create(TermView.prototype);
  Object.assign(view, { buf, rowUrlCache: new Map() });
  const masked = new Set([2]); view.isRowMasked = row => masked.has(row);
  buf.gotoPos(0, 2); buf.puts(wrapped('https://example.com/secret/')); buf.gotoPos(0, 3); buf.puts('picture.jpg');
  const sourceCol = buf.getUrlsInRow(2)[0].startCol;
  assert.ok(buf.findUrlAt(0, 3));
  assert.equal(view.getAccessibleUrlAt(0, 3), null);
  masked.clear(); masked.add(3);
  assert.equal(view.getAccessibleUrlAt(sourceCol, 2), null);
  masked.clear();
  assert.equal(view.getAccessibleUrlAt(0, 3).url, 'https://example.com/secret/picture.jpg');
});

test('reader filtering and masked partners cannot expose a reconstructed media URL', async t => {
  const { blacklistManager } = await import('../src/blacklist.js');
  const originalGet = document.getElementById;
  const article = ArticleParser.parseLines(['', pushLine('someone', 'https://i.imgur.com/abc'), pushLine('someone', 'secret.jpg', '→')]);
  const reader = Object.create(ArticleReaderModal.prototype);
  Object.assign(reader, { currentArticle: article, currentFilter: 'all', revealedPushes: new Set() });
  blacklistManager.storage = null;
  blacklistManager.importFromJSON({ version: '2.0', blacklist: [], keywords: ['secret'], settings: { enabled: true, mode: 'mask', enableKeywords: true, enableGreatTreasure: false } }, { replace: true });
  t.after(() => {
    document.getElementById = originalGet;
    blacklistManager.importFromJSON({ version: '2.0', blacklist: [], keywords: [], settings: { enabled: true, mode: 'dim', enableKeywords: true, enableGreatTreasure: false } }, { replace: true });
  });
  let parent = new MockElement();
  document.getElementById = id => id === 'push-list' ? parent : null;
  reader.renderPushList();
  assert.equal(parent.children[0].innerHTML.includes('abcsecret.jpg'), false);
  assert.equal(parent.children[0].children.length, 0);
  reader.currentFilter = 'push'; parent = new MockElement();
  reader.renderPushList();
  assert.equal(parent.children.length, 1);
  assert.equal(parent.children[0].innerHTML.includes('abcsecret.jpg'), false);
});


test('Imgur normalization preserves repaired PNGs and only rewrites actual page hosts', async () => {
  const { normalizeImageUrl } = await import('../src/image_preview.js');
  assert.equal(normalizeImageUrl('https://i.imgur.com/abc.png?x=1'), 'https://i.imgur.com/abc.png?x=1');
  assert.equal(normalizeImageUrl('https://imgur.com/abc.png?x=1'), 'https://i.imgur.com/abc.png?x=1');
  assert.equal(normalizeImageUrl('https://imgur.com/abc'), 'https://i.imgur.com/abc.jpg');
  assert.equal(normalizeImageUrl('https://fake-imgur.com/abc'), 'https://fake-imgur.com/abc');
});
