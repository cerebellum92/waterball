import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AnsiParser } from '../src/ansi_parser.js';
import { TermBuf } from '../src/term_buf.js';

export function parseCapture(contents) {
  let capture = JSON.parse(contents);
  if (typeof capture === 'string') capture = JSON.parse(capture);
  if (!Array.isArray(capture.events)) throw new Error('Capture has no events array');
  return capture;
}

export function seedBuffer(screen, cursor) {
  const buffer = new TermBuf(80, 24);
  const rows = screen.split('\r\n');
  if (rows.length !== buffer.rows) throw new Error(`Expected ${buffer.rows} rows, got ${rows.length}`);
  for (let row = 0; row < buffer.rows; row++) {
    let col = 0;
    for (const char of rows[row]) {
      if (col >= buffer.cols) break;
      const wide = buffer.isFullWidth(char);
      const cell = buffer.lines[row][col];
      cell.ch = char;
      cell.isLeadByte = wide;
      if (wide && col + 1 < buffer.cols) {
        const trail = buffer.lines[row][col + 1];
        trail.ch = '';
        trail.isTrailByte = true;
      }
      col += wide ? 2 : 1;
    }
  }
  buffer.cur_x = cursor.x;
  buffer.cur_y = cursor.y;
  return buffer;
}

function cellText(buffer, watch) {
  if (!watch) return null;
  return buffer.lines[watch.row - 1][watch.col - 1].ch;
}

function capturedBackground(event, watch) {
  if (!watch || !event.coloredCells) return null;
  const span = event.coloredCells.backgrounds.find(({ row, start, end }) =>
    row === watch.row - 1 && start <= watch.col - 1 && watch.col - 1 < end);
  return span?.background ?? 0;
}

function rawPrefix(rawHex) {
  return Buffer.from(rawHex, 'hex').subarray(0, 24).toString('latin1');
}

function scanAnsiBytes(rawHex, initialState) {
  let state = initialState;
  for (const byte of Buffer.from(rawHex, 'hex')) {
    if (byte === 0x1b) {
      state = 'escape';
    } else if (state === 'escape') {
      state = byte === 0x5b ? 'csi' : 'text';
    } else if (state === 'csi' && byte >= 0x40 && byte <= 0x7e) {
      state = 'text';
    }
  }
  return state;
}

export function analyzeCapture(capture, { watch = null } = {}) {
  const previousOutputs = new Map();
  const previousReads = new Map();
  const rawStates = new Map();
  const reads = new Map();
  const replays = [];
  const boundaries = [];

  for (const event of capture.events) {
    if (event.type === 'rawRead') {
      const previous = previousReads.get(event.tabId);
      const stateAtStart = rawStates.get(event.tabId) ?? 'unknown';
      const prefix = rawPrefix(event.rawHex);
      const apparentCsiTail = prefix.match(/^[0-9;?]+[A-Za-z]/)?.[0];
      if (apparentCsiTail) {
        const splitCsi = stateAtStart === 'csi' && previous?.readSeq + 1 === event.readSeq;
        boundaries.push({
          readSeq: event.readSeq,
          prefix: apparentCsiTail,
          previousReadSeq: previous?.readSeq ?? null,
          rawStateAtStart: stateAtStart,
          splitCsi,
          previousTailHex: previous?.rawHex.slice(-24) ?? null,
        });
      }
      rawStates.set(event.tabId, scanAnsiBytes(event.rawHex, stateAtStart));
      previousReads.set(event.tabId, event);
      reads.set(`${event.tabId}:${event.readSeq}`, event);
      continue;
    }
    if (event.type !== 'output') continue;
    const previous = previousOutputs.get(event.tabId);
    previousOutputs.set(event.tabId, event);
    if (!previous?.bufferScreen || !event.bufferScreen || !event.cursorBefore || event.cursorBefore.parserState !== 0) continue;

    const buffer = seedBuffer(previous.bufferScreen, event.cursorBefore);
    const before = cellText(buffer, watch);
    const parser = new AnsiParser(buffer);
    const raw = reads.get(`${event.tabId}:${event.rawReadSeq}`);
    const rawBig5 = raw && Buffer.from(raw.rawHex, 'hex').toString('latin1') === event.data;
    parser.feed(event.data, !!rawBig5);
    const actual = buffer.getText(0, 0, buffer.cols - 1, buffer.rows - 1);
    const expectedRows = event.bufferScreen.split('\r\n');
    const actualRows = actual.split('\r\n');
    const differingRows = actualRows.flatMap((row, index) => row === expectedRows[index] ? [] : [index + 1]);
    const cursorPositionMatches = !event.cursorAfter || (
      buffer.cur_x === event.cursorAfter.x && buffer.cur_y === event.cursorAfter.y
    );
    const parserStateMatches = !event.cursorAfter || parser.state === event.cursorAfter.parserState;
    const after = cellText(buffer, watch);
    const backgroundBefore = capturedBackground(previous, watch);
    const backgroundAfter = capturedBackground(event, watch);
    const backgroundChanged = backgroundBefore !== null && backgroundAfter !== null && backgroundBefore !== backgroundAfter;
    replays.push({
      readSeq: event.rawReadSeq,
      outputSequence: event.sequence,
      matchesCapture: differingRows.length === 0,
      differingRows,
      cursorPositionMatches,
      parserStateMatches,
      watchChanged: watch ? before !== after || backgroundChanged : null,
      watchBefore: watch && before !== after ? before : null,
      watchAfter: watch && before !== after ? after : null,
      backgroundBefore: backgroundChanged ? backgroundBefore : null,
      backgroundAfter: backgroundChanged ? backgroundAfter : null,
      rawBig5,
    });
  }
  return { replays, boundaries };
}

export function findRepeatedTails(capture, { prefixBytes = 1024, historySize = 40 } = {}) {
  const histories = new Map();
  const matches = [];
  for (const event of capture.events) {
    if (event.type !== 'rawRead') continue;
    const history = histories.get(event.tabId) ?? [];
    const current = Buffer.from(event.rawHex, 'hex');
    const earlier = [...history].reverse().find(({ bytes }) =>
      bytes.length > prefixBytes && current.equals(bytes.subarray(prefixBytes)));
    if (earlier) {
      const previous = history.at(-1);
      matches.push({
        readSeq: event.readSeq,
        earlierReadSeq: earlier.event.readSeq,
        previousReadSeq: previous?.event.readSeq ?? null,
        tailBytes: current.length,
        hasAdjacentPrefix: previous?.event.readSeq + 1 === event.readSeq
          && previous.bytes.equals(earlier.bytes.subarray(0, prefixBytes)),
      });
    }
    history.push({ event, bytes: current });
    if (history.length > historySize) history.shift();
    histories.set(event.tabId, history);
  }
  return matches;
}

export function replayRawSshCapture(capture, { watch = null } = {}) {
  const sessions = new Map();
  const results = [];
  for (const event of capture.events) {
    if (event.type === 'output') {
      let session = sessions.get(event.tabId);
      if (!session) {
        if (!event.bufferScreen || !event.cursorAfter || event.cursorAfter.parserState !== 0) continue;
        const buffer = seedBuffer(event.bufferScreen, event.cursorAfter);
        session = { buffer, parser: new AnsiParser(buffer), lastReadSeq: event.rawReadSeq, watchBefore: cellText(buffer, watch) };
        sessions.set(event.tabId, session);
        continue;
      }
      if (session.lastReadSeq !== event.rawReadSeq || !event.bufferScreen) continue;
      const actual = session.buffer.getText(0, 0, session.buffer.cols - 1, session.buffer.rows - 1);
      const expectedRows = event.bufferScreen.split('\r\n');
      const differingRows = actual.split('\r\n').flatMap((row, index) => row === expectedRows[index] ? [] : [index + 1]);
      const watchAfter = cellText(session.buffer, watch);
      results.push({
        readSeq: event.rawReadSeq,
        textMatchesCapture: differingRows.length === 0,
        differingRows,
        cursorPositionMatches: !event.cursorAfter || (
          session.buffer.cur_x === event.cursorAfter.x && session.buffer.cur_y === event.cursorAfter.y
        ),
        parserStateMatches: !event.cursorAfter || session.parser.state === event.cursorAfter.parserState,
        watchChanged: watch ? session.watchBefore !== watchAfter : null,
        watchBefore: watch && session.watchBefore !== watchAfter ? session.watchBefore : null,
        watchAfter: watch && session.watchBefore !== watchAfter ? watchAfter : null,
      });
      session.watchBefore = watchAfter;
    } else if (event.type === 'rawRead') {
      const session = sessions.get(event.tabId);
      if (!session) continue;
      if (session.lastReadSeq !== null && event.readSeq !== session.lastReadSeq + 1) {
        sessions.delete(event.tabId);
        continue;
      }
      session.lastReadSeq = event.readSeq;
      session.parser.feed(Buffer.from(event.rawHex, 'hex').toString('latin1'), true);
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const capturePath = process.argv[2];
  const watchArg = process.argv.find((arg) => arg.startsWith('--watch='));
  if (!capturePath) {
    console.error('Usage: node scripts/replay-capture.mjs CAPTURE.json [--watch=ROW,COL] [--raw-ssh]');
    process.exitCode = 1;
  } else {
    const watchMatch = watchArg?.match(/^--watch=(\d+),(\d+)$/);
    if (watchArg && !watchMatch) throw new Error('Watch must be --watch=ROW,COL (1-based)');
    const watch = watchMatch ? { row: Number(watchMatch[1]), col: Number(watchMatch[2]) } : null;
    if (watch && (watch.row < 1 || watch.row > 24 || watch.col < 1 || watch.col > 80)) {
      throw new Error('Watch coordinate must be within 24 rows and 80 columns');
    }
    const capture = parseCapture(fs.readFileSync(capturePath, 'utf8'));
    const report = analyzeCapture(capture, { watch });
    const repeatedTails = findRepeatedTails(capture);
    const rawSshReplays = process.argv.includes('--raw-ssh')
      ? replayRawSshCapture(capture, { watch })
      : null;
    console.log(JSON.stringify({
      replayed: report.replays.length,
      matched: report.replays.filter((entry) => entry.matchesCapture).length,
      mismatches: report.replays.filter((entry) => !entry.matchesCapture).slice(0, 20),
      watchChanges: report.replays.filter((entry) => entry.watchChanged).slice(0, 50),
      possibleCsiTails: report.boundaries,
      repeatedTails: repeatedTails.filter((entry) => !entry.hasAdjacentPrefix),
      repeatedTailCount: repeatedTails.length,
      rawSshReplayed: rawSshReplays?.length ?? null,
      rawSshMismatches: rawSshReplays?.filter((entry) => !entry.textMatchesCapture || !entry.cursorPositionMatches || !entry.parserStateMatches).slice(0, 20) ?? null,
      rawSshWatchChanges: rawSshReplays?.filter((entry) => entry.watchChanged).slice(0, 50) ?? null,
    }, null, 2));
  }
}
