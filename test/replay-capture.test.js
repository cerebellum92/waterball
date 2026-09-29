import assert from 'node:assert/strict';
import test from 'node:test';
import { AnsiParser } from '../src/ansi_parser.js';
import { TermBuf } from '../src/term_buf.js';
import { analyzeCapture, findRepeatedTails, parseCapture, replayRawSshCapture, seedBuffer } from '../scripts/replay-capture.mjs';

test('repeated tail detection separates normal splitting from an orphaned prefix', () => {
  const full = Buffer.concat([Buffer.alloc(1024, 0x41), Buffer.from('body\x1b[K')]);
  const rawRead = (readSeq, bytes) => ({ type: 'rawRead', tabId: 'one', readSeq, rawHex: bytes.toString('hex') });
  const matches = findRepeatedTails({ events: [
    rawRead(1, full),
    rawRead(2, full.subarray(0, 1024)),
    rawRead(3, full.subarray(1024)),
    rawRead(4, Buffer.from('\x1b[?2026l')),
    rawRead(5, full.subarray(1024)),
  ] });
  assert.deepEqual(matches.map(({ readSeq, hasAdjacentPrefix }) => ({ readSeq, hasAdjacentPrefix })), [
    { readSeq: 3, hasAdjacentPrefix: true },
    { readSeq: 5, hasAdjacentPrefix: false },
  ]);
});

test('capture parser accepts console-quoted JSON', () => {
  const capture = { events: [] };
  assert.deepEqual(parseCapture(JSON.stringify(JSON.stringify(capture))), capture);
});

test('replay identifies a write to any watched cell', () => {
  const initial = new TermBuf();
  initial.cur_y = 3;
  initial.puts('previous');
  const before = initial.getText(0, 0, 79, 23);
  const afterBuffer = seedBuffer(before, { x: 0, y: 3 });
  new AnsiParser(afterBuffer).feed('7;6H88', false);

  const capture = {
    events: [
      { type: 'output', tabId: 'one', sequence: 1, rawReadSeq: 1, bufferScreen: before },
      { type: 'rawRead', tabId: 'one', readSeq: 1, rawHex: '1B5B3F323032366C' },
      { type: 'rawRead', tabId: 'one', readSeq: 2, rawHex: '373B36483838' },
      {
        type: 'output', tabId: 'one', sequence: 4, rawReadSeq: 2,
        data: '7;6H88', cursorBefore: { x: 0, y: 3, parserState: 0 },
        bufferScreen: afterBuffer.getText(0, 0, 79, 23),
      },
    ],
  };
  const report = analyzeCapture(capture, { watch: { row: 4, col: 1 } });
  assert.equal(report.replays.length, 1);
  assert.equal(report.replays[0].matchesCapture, true);
  assert.equal(report.replays[0].cursorPositionMatches, true);
  assert.equal(report.replays[0].parserStateMatches, true);
  assert.equal(report.replays[0].watchBefore, 'p');
  assert.equal(report.replays[0].watchAfter, '7');
  assert.equal(report.boundaries[0].splitCsi, false);
  assert.equal(report.boundaries[0].rawStateAtStart, 'text');
});

test('a CSI continued from the preceding read is not an orphan', () => {
  const report = analyzeCapture({
    events: [
      { type: 'rawRead', tabId: 'one', readSeq: 8, rawHex: '1B5B31' },
      { type: 'rawRead', tabId: 'one', readSeq: 9, rawHex: '373B36483838' },
    ],
  });
  assert.deepEqual(report.boundaries.map(({ readSeq, splitCsi }) => ({ readSeq, splitCsi })), [
    { readSeq: 9, splitCsi: true },
  ]);
  assert.equal(report.boundaries[0].rawStateAtStart, 'csi');
});

test('captured background changes are visible even if the text is unchanged', () => {
  const screen = new TermBuf().getText(0, 0, 79, 23);
  const report = analyzeCapture({
    events: [
      {
        type: 'output', tabId: 'one', sequence: 1, rawReadSeq: 1,
        bufferScreen: screen, coloredCells: { backgrounds: [] },
      },
      {
        type: 'output', tabId: 'one', sequence: 2, rawReadSeq: 2,
        data: '\x1b[1;1H\x1b[41m ', cursorBefore: { x: 0, y: 0, parserState: 0 },
        bufferScreen: screen,
        coloredCells: { backgrounds: [{ row: 0, start: 0, end: 1, background: 1 }] },
      },
    ],
  }, { watch: { row: 1, col: 1 } });
  assert.equal(report.replays[0].watchChanged, true);
  assert.equal(report.replays[0].backgroundBefore, 0);
  assert.equal(report.replays[0].backgroundAfter, 1);
});

test('raw SSH replay preserves parser state across split CSI reads', () => {
  const initial = new TermBuf();
  const before = initial.getText(0, 0, 79, 23);
  const expectedBuffer = seedBuffer(before, { x: 0, y: 0 });
  const expectedParser = new AnsiParser(expectedBuffer);
  expectedParser.feed('\x1b[1', true);
  expectedParser.feed('7;6H88', true);
  const capture = {
    events: [
      {
        type: 'output', tabId: 'one', rawReadSeq: 6,
        bufferScreen: before, cursorAfter: { x: 0, y: 0, parserState: 0 },
      },
      { type: 'rawRead', tabId: 'one', readSeq: 7, rawHex: '1B5B31' },
      { type: 'rawRead', tabId: 'one', readSeq: 8, rawHex: '373B36483838' },
      {
        type: 'output', tabId: 'one', rawReadSeq: 8,
        bufferScreen: expectedBuffer.getText(0, 0, 79, 23),
        cursorAfter: { x: expectedBuffer.cur_x, y: expectedBuffer.cur_y, parserState: 0 },
      },
    ],
  };
  const result = replayRawSshCapture(capture, { watch: { row: 17, col: 6 } });
  assert.equal(result.length, 1);
  assert.equal(result[0].textMatchesCapture, true);
  assert.equal(result[0].cursorPositionMatches, true);
  assert.equal(result[0].parserStateMatches, true);
  assert.equal(result[0].watchAfter, '8');
});
