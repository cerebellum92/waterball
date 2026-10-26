import test from 'node:test';
import assert from 'node:assert/strict';

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

import {
  PTT_B64_TABLE,
  aidToFilename,
  filenameToAid,
  aidToUrl,
  urlToAid,
  parseAidInput,
  extractAidsFromLine,
  detectCurrentBoard,
  generateJumpSequence
} from '../src/aid_helper.js';

test('PTT_B64_TABLE has exactly 64 unique characters', () => {
  assert.equal(PTT_B64_TABLE.length, 64);
  const unique = new Set(PTT_B64_TABLE);
  assert.equal(unique.size, 64);
});

test('aidToFilename and filenameToAid bi-directional conversion', () => {
  const cases = [
    { aid: '#1Kcjcttm', filename: 'M.1419434423.A.DF0' },
    { aid: '#1d5ve04Z', filename: 'M.1729600000.A.123' },
    { aid: '#1abcdefg', filename: null }, // Will compute expected
    { aid: '#10000000', filename: 'M.1073741824.A.000' },
  ];

  for (const c of cases) {
    if (c.filename) {
      assert.equal(aidToFilename(c.aid), c.filename, `aidToFilename(${c.aid})`);
      assert.equal(filenameToAid(c.filename), c.aid, `filenameToAid(${c.filename})`);
    } else {
      const filename = aidToFilename(c.aid);
      assert.ok(filename, `aidToFilename(${c.aid}) should succeed`);
      const roundtrip = filenameToAid(filename);
      assert.equal(roundtrip, c.aid, `Roundtrip for ${c.aid}`);
    }
  }
});

test('aidToFilename handles optional # and rejects invalid formats', () => {
  assert.equal(aidToFilename('1Kcjcttm'), 'M.1419434423.A.DF0');
  assert.equal(aidToFilename('  #1Kcjcttm  '), 'M.1419434423.A.DF0');

  // Too short / too long
  assert.equal(aidToFilename('#1234567'), null);
  assert.equal(aidToFilename('#123456789'), null);
  // Invalid characters not in PTT base64 table (e.g. '@', '$', Chinese)
  assert.equal(aidToFilename('#12345@78'), null);
  assert.equal(aidToFilename('#測試文章代碼'), null);
  // Non-string
  assert.equal(aidToFilename(null), null);
  assert.equal(aidToFilename(12345), null);
});

test('filenameToAid rejects invalid filenames', () => {
  assert.equal(filenameToAid('invalid.txt'), null);
  assert.equal(filenameToAid('M.notanumber.A.123'), null);
  assert.equal(filenameToAid('M.12345.B.123'), null);
  assert.equal(filenameToAid(null), null);
});

test('aidToUrl and urlToAid conversions', () => {
  const url = aidToUrl('Gossiping', '#1d5ve04Z');
  assert.equal(url, 'https://www.ptt.cc/bbs/Gossiping/M.1729600000.A.123.html');

  const parsed = urlToAid('https://www.ptt.cc/bbs/Gossiping/M.1729600000.A.123.html');
  assert.ok(parsed);
  assert.equal(parsed.board, 'Gossiping');
  assert.equal(parsed.aid, '#1d5ve04Z');
  assert.equal(parsed.filename, 'M.1729600000.A.123');

  // Works without protocol or with trailing slash
  const parsed2 = urlToAid('www.ptt.cc/bbs/C_Chat/M.1419434423.A.DF0.html');
  assert.ok(parsed2);
  assert.equal(parsed2.board, 'C_Chat');
  assert.equal(parsed2.aid, '#1Kcjcttm');

  // Invalid board characters rejected in aidToUrl
  assert.equal(aidToUrl('Bad Board!', '#1d5ve04Z'), null);
});

test('parseAidInput parses diverse input formats', () => {
  // 1. Full URL
  const resUrl = parseAidInput('https://www.ptt.cc/bbs/Stock/M.1729600000.A.123.html');
  assert.equal(resUrl.isValid, true);
  assert.equal(resUrl.board, 'Stock');
  assert.equal(resUrl.aid, '#1d5ve04Z');
  assert.equal(resUrl.cleanAid, '1d5ve04Z');

  // 2. Full formatted text: 文章代碼(AID): #1d5ve04Z (Gossiping)
  const resFull = parseAidInput('文章代碼(AID): #1d5ve04Z (Gossiping)');
  assert.equal(resFull.isValid, true);
  assert.equal(resFull.board, 'Gossiping');
  assert.equal(resFull.aid, '#1d5ve04Z');
  assert.equal(resFull.url, 'https://www.ptt.cc/bbs/Gossiping/M.1729600000.A.123.html');

  // 3. AID with board in parentheses (including full-width and no spaces)
  const resWithBoard = parseAidInput('#1d5ve04Z (Beauty)');
  assert.equal(resWithBoard.isValid, true);
  assert.equal(resWithBoard.board, 'Beauty');
  assert.equal(resWithBoard.aid, '#1d5ve04Z');

  const resCompact = parseAidInput('#1gtDZ4N9(Gossiping)');
  assert.equal(resCompact.isValid, true);
  assert.equal(resCompact.board, 'Gossiping');
  assert.equal(resCompact.aid, '#1gtDZ4N9');

  const resFullWidth = parseAidInput('#1gtDZ4N9（Gossiping）');
  assert.equal(resFullWidth.isValid, true);
  assert.equal(resFullWidth.board, 'Gossiping');
  assert.equal(resFullWidth.aid, '#1gtDZ4N9');

  // 4. Standalone AID with defaultBoard fallback
  const resDefault = parseAidInput('#1d5ve04Z', 'Baseball');
  assert.equal(resDefault.isValid, true);
  assert.equal(resDefault.board, 'Baseball');
  assert.equal(resDefault.url, 'https://www.ptt.cc/bbs/Baseball/M.1729600000.A.123.html');

  // 5. Standalone AID without board
  const resNoBoard = parseAidInput('1d5ve04Z');
  assert.equal(resNoBoard.isValid, true);
  assert.equal(resNoBoard.aid, '#1d5ve04Z');
  assert.equal(resNoBoard.board, null);
  assert.equal(resNoBoard.url, null);

  // 6. Invalid inputs
  assert.equal(parseAidInput('').isValid, false);
  assert.equal(parseAidInput('#short').isValid, false);
  assert.equal(parseAidInput('#not_valid_because_length').isValid, false);
});

test('extractAidsFromLine finds AIDs in text and ignores false positives', () => {
  const line = '請大家參考 文章代碼(AID): #1d5ve04Z (Gossiping) 這篇討論，另外 #1Kcjcttm 也很精采';
  const aids = extractAidsFromLine(line);
  assert.equal(aids.length, 2);

  assert.equal(aids[0].aid, '#1d5ve04Z');
  assert.equal(aids[0].board, 'Gossiping');
  assert.equal(aids[0].cleanAid, '1d5ve04Z');
  assert.equal(aids[0].url, 'https://www.ptt.cc/bbs/Gossiping/M.1729600000.A.123.html');
  assert.equal(line.slice(aids[0].startCol, aids[0].endCol + 1), '文章代碼(AID): #1d5ve04Z (Gossiping)');

  assert.equal(aids[1].aid, '#1Kcjcttm');
  assert.equal(aids[1].board, null);
  assert.equal(line.slice(aids[1].startCol, aids[1].endCol + 1), '#1Kcjcttm');

  // Negative tests: Hex colors and short tags should not match
  const line2 = '顏色是 #ffffff 和 #abc，hashtag 是 #PTT 和 #Gossiping';
  const aids2 = extractAidsFromLine(line2);
  assert.equal(aids2.length, 0);
});

test('detectCurrentBoard extracts board from header rows', () => {
  const mockBuf1 = {
    rows: 24,
    lines: [
      { text: '【板主:xxx/yyy】               看板《Gossiping》' },
      { text: ' 12345 + 10/23 author □ 標題' },
    ],
    getRowText(line) { return line?.text || ''; }
  };
  assert.equal(detectCurrentBoard(mockBuf1), 'Gossiping');

  const mockBuf2 = {
    rows: 24,
    lines: [
      { text: '作者: cerebellum (水球) 看板: C_Chat' },
      { text: '標題: [閒聊] 動漫討論' },
    ],
    getRowText(line) { return line?.text || ''; }
  };
  assert.equal(detectCurrentBoard(mockBuf2), 'C_Chat');

  const mockBufEmpty = {
    rows: 24,
    lines: [{ text: '主功能表' }],
    getRowText(line) { return line?.text || ''; }
  };
  assert.equal(detectCurrentBoard(mockBufEmpty), null);
});

test('user-reported China-Drama recruitment header preserves exact board detection', () => {
  const text = '【徵求中】               [中劇] 讓空降來得更猛烈些吧！      看板《China-Drama》';
  const buf = { rows: 24, lines: [text], getRowText: row => row || '' };
  assert.equal(detectCurrentBoard(buf), 'China-Drama');
  for (const invalid of [
    '內文引用 ' + text,
    '【其他內容】 看板《China-Drama》',
    '【徵求中途】 看板《China-Drama》',
    text.replace('China-Drama》', 'China-Drama'),
    text.replace('China-Drama', 'Bad Board'),
  ]) {
    buf.lines = [invalid]; assert.equal(detectCurrentBoard(buf), null, invalid);
  }
});

test('generateJumpSequence generates correct keystrokes across BBS states', () => {
  // 1. In article list on same board
  const seq1 = generateJumpSequence({
    aid: '#1d5ve04Z',
    targetBoard: 'Gossiping',
    currentBoard: 'Gossiping',
    bbsState: 'article-list',
  });
  assert.equal(seq1, '#1d5ve04Z\r');

  // 2. In reading state on same board (must exit with 'q' first)
  const seq2 = generateJumpSequence({
    aid: '#1d5ve04Z',
    targetBoard: 'Gossiping',
    currentBoard: 'Gossiping',
    bbsState: 'reading',
  });
  assert.equal(seq2, 'q#1d5ve04Z\r');

  // 3. In reading state with different board (exit 'q', switch board 'sStock\r', then '#aid\r')
  const seq3 = generateJumpSequence({
    aid: '#1d5ve04Z',
    targetBoard: 'Stock',
    currentBoard: 'Gossiping',
    bbsState: 'reading',
  });
  assert.equal(seq3, 'qsStock\r#1d5ve04Z\r');

  // 4. In board-list or main-menu with target board
  const seq4 = generateJumpSequence({
    aid: '#1d5ve04Z',
    targetBoard: 'Beauty',
    bbsState: 'board-list',
  });
  assert.equal(seq4, 'sBeauty\r#1d5ve04Z\r');

  // 5. In board-input (already at board search prompt, don't resend 's')
  const seq5 = generateJumpSequence({
    aid: '#1gtDZ4N9',
    targetBoard: 'Gossiping',
    bbsState: 'board-input',
  });
  assert.equal(seq5, 'Gossiping\r#1gtDZ4N9\r');

  // 6. In aid-input (already at # prompt, just send aid\r)
  const seq6 = generateJumpSequence({
    aid: '#1gtDZ4N9',
    targetBoard: 'Gossiping',
    currentBoard: 'Gossiping',
    bbsState: 'aid-input',
  });
  assert.equal(seq6, '1gtDZ4N9\r');
});

test('TermBuf detects AIDs in row and matches column coordinates without touching cells', async () => {
  const { TermBuf } = await import('../src/term_buf.js');
  const buf = new TermBuf(80, 24);

  // Set row 0 header to Gossiping
  buf.gotoPos(0, 0);
  buf.puts('【板主:admin】                     看板《Gossiping》');

  // Set row 3 text with AID
  const line3 = '推薦好文 文章代碼(AID): #1d5ve04Z (Gossiping) 必看';
  buf.gotoPos(0, 3);
  buf.puts(line3);

  const snapshot = JSON.stringify({ lines: buf.lines, x: buf.cur_x, y: buf.cur_y });
  const aids = buf.getAidsInRow(3);
  assert.equal(aids.length, 1);
  assert.equal(aids[0].aid, '#1d5ve04Z');
  assert.equal(aids[0].board, 'Gossiping');
  assert.equal(aids[0].url, 'https://www.ptt.cc/bbs/Gossiping/M.1729600000.A.123.html');

  // Hit test
  const found = buf.findAidAt(aids[0].startCol + 2, 3);
  assert.ok(found);
  assert.equal(found.aid, '#1d5ve04Z');

  // Miss test
  assert.equal(buf.findAidAt(0, 3), null);

  // Buffer state must remain 100% untouched
  assert.equal(JSON.stringify({ lines: buf.lines, x: buf.cur_x, y: buf.cur_y }), snapshot);
});

test('ArticleReader formatLineHtml linkifies AID into reader-aid-link', async () => {
  const { ArticleReaderModal } = await import('../src/article_reader.js');
  const reader = Object.create(ArticleReaderModal.prototype);

  const html = reader.formatLineHtml('請參考 #1Kcjcttm (C_Chat) 這篇文章');
  assert.ok(html.includes('class="reader-link reader-aid-link"'));
  assert.ok(html.includes('href="https://www.ptt.cc/bbs/C_Chat/M.1419434423.A.DF0.html"'));
  assert.ok(html.includes('data-aid="#1Kcjcttm"'));
  assert.ok(html.includes('data-board="C_Chat"'));
  assert.ok(html.includes('#1Kcjcttm (C_Chat)</a>'));
});



test('M type timestamp boundaries roundtrip without overflow or type confusion', () => {
  for (const timestamp of [0, 1, 1729600000, 0x7fffffff, 0xffffffff]) {
    for (const suffix of ['000', '001', 'ABC', 'FFF']) {
      const filename = `M.${timestamp}.A.${suffix}`;
      assert.equal(aidToFilename(filenameToAid(filename)), filename);
    }
  }
  for (const aid of ['#40000000', '#________', '#80000000']) assert.equal(aidToFilename(aid), null);
  for (const filename of ['M.4294967296.A.123', 'M.68719476736.A.123', 'M.9007199254740993.A.123', 'junkM.123.A.123', 'G.123.A.123']) {
    assert.equal(filenameToAid(filename), null);
  }
  assert.equal(filenameToAid('M.123.A'), filenameToAid('M.123.A.000'));
});

test('strict URL identity and complete pathname reject substrings and truncation', () => {
  for (const input of [
    'https://evil.example/ptt.cc/bbs/Stock/M.1729600000.A.123.html',
    'https://www.ptt.cc/bbs/Stock/M.1729600000.A.1234.html',
    'https://ptt.cc.evil.example/bbs/Stock/M.1729600000.A.123.html',
    'https://evil.example/?next=https://ptt.cc/bbs/Stock/M.1729600000.A.123.html',
    'https://user:pass@ptt.cc/bbs/Stock/M.1729600000.A.123.html',
    'ftp://ptt.cc/bbs/Stock/M.1729600000.A.123.html',
    'https://ptt.cc:444/bbs/Stock/M.1729600000.A.123.html',
    'https://ptt.cc/bbs/Stock/M.1729600000.A.123.html/extra',
  ]) assert.equal(parseAidInput(input).isValid, false, input);
  assert.equal(urlToAid('https://ptt.cc/bbs/Stock/M.123.A.html').url, 'https://www.ptt.cc/bbs/Stock/M.123.A.html');
  assert.equal(parseAidInput('#1d5ve04Z (' + 'x'.repeat(33) + ')').isValid, false);
  assert.equal(parseAidInput('#1d5ve04Z\x1b').isValid, false);
});

test('native board headers and unsafe navigation arguments fail conservatively', () => {
  const native = { rows: 24, lines: ['作者  Test (測試)                 看板  Gossiping'], getRowText: row => row || '' };
  assert.equal(detectCurrentBoard(native), 'Gossiping');
  native.lines = ['文章內文談到 看板: Wrong']; assert.equal(detectCurrentBoard(native), null);
  for (const bbsState of ['compose', 'unknown', 'waiting-enter', undefined]) {
    assert.throws(() => generateJumpSequence({ aid: '#1d5ve04Z', currentBoard: 'Stock', bbsState }));
  }
  assert.throws(() => generateJumpSequence({ aid: '#1d5ve04Z', bbsState: 'reading' }));
  assert.equal(generateJumpSequence({ aid: '#1d5ve04Z', targetBoard: 'Stock', bbsState: 'reading' }), 'qsStock\r#1d5ve04Z\r');
  assert.throws(() => generateJumpSequence({ aid: '#1d5ve04Z\rQ', currentBoard: 'Stock', bbsState: 'article-list' }));
  assert.throws(() => generateJumpSequence({ aid: '#1d5ve04Z', currentBoard: 'Stock', targetBoard: 'Bad\rQ', bbsState: 'article-list' }));
});

test('reader uses native board headers and leaves unknown-board AIDs as escaped text', async () => {
  const { ArticleParser, ArticleReaderModal } = await import('../src/article_reader.js');
  const reader = Object.create(ArticleReaderModal.prototype);
  reader.currentArticle = ArticleParser.parseLines(['作者  User (讀者)  看板  Stock', '標題  標題', '時間  日期', '', '#1d5ve04Z']);
  assert.equal(reader.currentArticle.aidBoard, 'Stock');
  assert.match(reader.formatLineHtml('#1d5ve04Z'), /https:\/\/www\.ptt\.cc\/bbs\/Stock\//);
  reader.currentArticle = ArticleParser.parseLines(['', '#1d5ve04Z']);
  assert.equal(reader.currentArticle.aidBoard, null);
  const plain = reader.formatLineHtml('<script> #1d5ve04Z');
  assert.ok(!plain.includes('<a ')); assert.ok(!plain.includes('<script>')); assert.ok(plain.includes('&lt;script&gt;'));
  const overlap = reader.formatLineHtml('https://example.com/#1d5ve04Z');
  assert.equal((overlap.match(/<a /g) || []).length, 1);
});

test('aid-input recovery cannot apply the current prompt to a different target board', () => {
  assert.throws(() => generateJumpSequence({ aid: '#1gtDZ4N9', targetBoard: 'Stock', currentBoard: 'Gossiping', bbsState: 'aid-input' }), /其他看板/);
  assert.throws(() => generateJumpSequence({ aid: '#1gtDZ4N9', targetBoard: 'Stock', bbsState: 'aid-input' }), /無法確認/);
});
