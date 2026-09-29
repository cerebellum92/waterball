import assert from 'node:assert/strict';
import test from 'node:test';
import { AnsiParser } from '../src/ansi_parser.js';
import { TermBuf } from '../src/term_buf.js';
import { decodeUao } from '../src/uao_b2u.js';

function raw(...bytes) {
  return String.fromCharCode(...bytes);
}

test('Big5 lead survives a color change across reads', () => {
  const buffer = new TermBuf();
  const parser = new AnsiParser(buffer);

  parser.feed('\x1b[1;31m', true);
  parser.feed(raw(0xa2), true);
  const decoded = parser.feed('\x1b[1;47m' + raw(0x66) + 'X', true);

  assert.equal(buffer.lines[0][0].ch, decodeUao(0xa2, 0x66));
  assert.equal(buffer.lines[0][0].isLeadByte, true);
  assert.equal(buffer.lines[0][1].isTrailByte, true);
  assert.equal(buffer.lines[0][0].getBg(), 0);
  assert.equal(buffer.lines[0][1].getBg(), 7);
  assert.equal(buffer.lines[0][2].ch, 'X');
  assert.equal(buffer.cur_x, 3);
  assert.equal(decoded, '\x1b[1;47m▅X');
});

test('both halves of one glyph retain independent foreground colors', () => {
  const buffer = new TermBuf();
  const parser = new AnsiParser(buffer);

  parser.feed('\x1b[31m' + raw(0xa2) + '\x1b[32m' + raw(0x66), true);

  assert.equal(buffer.lines[0][0].ch, '▅');
  assert.equal(buffer.lines[0][0].getFg(), 1);
  assert.equal(buffer.lines[0][1].getFg(), 2);
  assert.equal(buffer.cur_x, 2);
});

test('cursor movement cancels a pending Big5 lead', () => {
  const buffer = new TermBuf();
  const parser = new AnsiParser(buffer);

  parser.feed(raw(0xa4), true);
  parser.feed('\x1b[2;4H' + raw(0xa4, 0xe5), true);

  assert.equal(buffer.lines[0][0].ch, ' ');
  assert.equal(buffer.lines[1][3].ch, '文');
  assert.equal(buffer.cur_x, 5);
});

test('Big5 bytes spanning reads retain their terminal width', () => {
  const buffer = new TermBuf();
  const parser = new AnsiParser(buffer);

  parser.feed(raw(0xa4), true);
  parser.feed(raw(0xe5), true);

  assert.equal(buffer.lines[0][0].ch, '文');
  assert.equal(buffer.lines[0][1].isTrailByte, true);
  assert.equal(buffer.cur_x, 2);
});

test('UTF-8 emoji passthrough remains available in Big5 mode', () => {
  const buffer = new TermBuf();
  const parser = new AnsiParser(buffer);

  parser.feed(raw(0xf0, 0x9f), true);
  parser.feed(raw(0x98, 0x80), true);

  assert.equal(buffer.lines[0][0].ch, '😀');
  assert.equal(buffer.cur_x, 2);
});

test('fragmented ANSI remains ordered with Big5 text', () => {
  const buffer = new TermBuf();
  const parser = new AnsiParser(buffer);

  parser.feed('\x1b[2;', true);
  parser.feed('4H' + raw(0xa4, 0xe5), true);

  assert.equal(buffer.lines[1][3].ch, '文');
  assert.equal(buffer.cur_x, 5);
});

test('bullet characters on different lines are preserved without phantom erasure', () => {
  const buffer = new TermBuf();
  const parser = new AnsiParser(buffer);

  parser.feed(raw(0xa1, 0xb4) + ' Item 1', true);
  parser.feed('\x1b[2;1H' + raw(0xa1, 0xb4) + ' Item 2', true);

  assert.equal(buffer.lines[0][0].ch, '●');
  assert.equal(buffer.lines[0][1].isTrailByte, true);
  assert.equal(buffer.lines[1][0].ch, '●');
  assert.equal(buffer.lines[1][1].isTrailByte, true);
});

test('an unpaired synchronized-output end does not discard preceding text', () => {
  const buffer = new TermBuf();
  const parser = new AnsiParser(buffer);

  parser.feed('\x1b[2;1Hnew page\x1b[?2026l', true);

  assert.equal(buffer.lines[1].slice(0, 8).map(cell => cell.ch).join(''), 'new page');
  assert.equal(buffer.syncOutputOrphanEndGeneration, 1);
});

test('synchronized-output controls can span raw reads', () => {
  const buffer = new TermBuf();
  const parser = new AnsiParser(buffer);

  parser.feed('\x1b[?20', true);
  parser.feed('26hpage', true);
  assert.equal(buffer.synchronizedOutputActive, true);
  parser.feed('\x1b[?2026l', true);

  assert.equal(buffer.lines[0].slice(0, 4).map(cell => cell.ch).join(''), 'page');
  assert.equal(buffer.synchronizedOutputActive, false);
  assert.equal(buffer.syncOutputEndGeneration, 1);
});

test('pending Big5 lead byte does not corrupt previous cursor position on cursor move', () => {
  const buffer = new TermBuf();
  buffer.puts('  23094     4/28 bajiqa   □ [情報] 卡巴 21.17.7.539');
  buffer.gotoPos(0, 0);

  const parser = new AnsiParser(buffer);
  parser.feed(raw(0xa4), true); // Unpaired lead byte
  parser.feed('\x1b[17;1H', true); // Move cursor to line 17

  // Cell (0, 0) should remain ' ' and not be mutated; cell (2, 0) should remain '2'
  assert.equal(buffer.lines[0][0].ch, ' ');
  assert.equal(buffer.lines[0][2].ch, '2');
  assert.equal(buffer.cur_y, 16);
  assert.equal(buffer.cur_x, 0);
});

test('insertChar and del shift cells in place without corrupting array structure', () => {
  const buffer = new TermBuf(10, 2);
  buffer.puts('0123456789');

  buffer.gotoPos(3, 0);
  buffer.del(2);
  assert.equal(buffer.lines[0].map(c => c.ch).join(''), '01256789  ');

  buffer.insertChar(2);
  assert.equal(buffer.lines[0].map(c => c.ch).join(''), '012  56789');
});
