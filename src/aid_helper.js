// PTT Article ID (AID) Decoder, Parser & Navigation Helper for Waterball

export const PTT_B64_TABLE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

/**
 * Converts a PTT AID (e.g. '#1Kcjcttm' or '1Kcjcttm') into a BBS filename (e.g. 'M.1419434423.A.DF0').
 * @param {string} aid
 * @returns {string|null} filename or null if invalid
 */
export function aidToFilename(aid) {
  if (typeof aid !== 'string') return null;
  const clean = aid.trim().replace(/^#/, '');
  if (clean.length !== 8) return null;

  for (let i = 0; i < 8; i++) {
    if (PTT_B64_TABLE.indexOf(clean[i]) === -1) return null;
  }

  let id0 = 0;
  for (let i = 0; i < 6; i++) {
    id0 = id0 * 64 + PTT_B64_TABLE.indexOf(clean[i]);
  }

  let id1 = 0;
  for (let i = 6; i < 8; i++) {
    id1 = id1 * 64 + PTT_B64_TABLE.indexOf(clean[i]);
  }

  // AIDv1: 4 type bits + 32 timestamp bits + 12 suffix bits.
  // This client currently navigates normal (M) articles only.
  if (id0 > 0xffffffff) return null;
  const hexStr = id1.toString(16).toUpperCase().padStart(3, '0');
  return `M.${id0}.A.${hexStr}`;
}

/**
 * Converts a BBS filename (e.g. 'M.1419434423.A.DF0') into a PTT AID (e.g. '#1Kcjcttm').
 * @param {string} filename
 * @returns {string|null} AID with leading '#' or null if invalid
 */
export function filenameToAid(filename) {
  if (typeof filename !== 'string') return null;
  const match = filename.trim().match(/^M\.(\d{1,10})\.A(?:\.([0-9A-Fa-f]{3}))?(?:\.html)?$/);
  if (!match) return null;

  let id0 = parseInt(match[1], 10);
  let id1 = parseInt(match[2] || '000', 16);

  if (!Number.isSafeInteger(id0) || id0 < 0 || id0 > 0xffffffff || !Number.isInteger(id1) || id1 < 0 || id1 >= 4096) return null;

  let aid0 = '';
  for (let i = 0; i < 6; i++) {
    aid0 = PTT_B64_TABLE[id0 % 64] + aid0;
    id0 = Math.floor(id0 / 64);
  }

  let aid1 = '';
  for (let i = 0; i < 2; i++) {
    aid1 = PTT_B64_TABLE[id1 % 64] + aid1;
    id1 = Math.floor(id1 / 64);
  }

  return `#${aid0}${aid1}`;
}

/**
 * Converts board name and AID into a canonical PTT web URL.
 * @param {string} board
 * @param {string} aid
 * @returns {string|null}
 */
export function aidToUrl(board, aid) {
  if (!board || typeof board !== 'string') return null;
  const filename = aidToFilename(aid);
  if (!filename) return null;
  const cleanBoard = board.trim();
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(cleanBoard)) return null;
  return `https://www.ptt.cc/bbs/${cleanBoard}/${filename}.html`;
}

/**
 * Converts a PTT web URL into board name and AID.
 * @param {string} url
 * @returns {{ board: string, aid: string, filename: string, url: string }|null}
 */
export function urlToAid(url) {
  if (typeof url !== 'string') return null;
  if (url.length > 2048 || /[\x00-\x20\x7f]/.test(url.trim())) return null;
  try {
    const input = url.trim();
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || !['ptt.cc', 'www.ptt.cc'].includes(parsed.hostname.toLowerCase()) ||
        parsed.username || parsed.password || parsed.port) return null;
    const match = parsed.pathname.match(/^\/bbs\/([a-zA-Z0-9_-]{1,32})\/(M\.\d{1,10}\.A(?:\.[0-9A-Fa-f]{3})?)(?:\.html)?$/);
    if (!match) return null;
    const [, board, filename] = match;
    const aid = filenameToAid(filename);
    if (!aid) return null;
    return { board, aid, filename, url: `https://www.ptt.cc/bbs/${board}/${filename}.html` };
  } catch { return null; }
}

/**
 * Flexible parser for user inputs: handles raw AID, AID with board, or full PTT URL.
 * @param {string} input
 * @param {string|null} [defaultBoard=null]
 * @returns {{ isValid: boolean, aid: string|null, cleanAid: string|null, board: string|null, filename: string|null, url: string|null }}
 */
export function parseAidInput(input, defaultBoard = null) {
  if (typeof input !== 'string') {
    return { isValid: false, aid: null, cleanAid: null, board: null, filename: null, url: null };
  }

  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048 || /[\x00-\x1f\x7f]/.test(trimmed)) {
    return { isValid: false, aid: null, cleanAid: null, board: null, filename: null, url: null };
  }

  // Check if input is a PTT Web URL
  const fromUrl = urlToAid(trimmed);
  if (fromUrl) {
    return {
      isValid: true,
      aid: fromUrl.aid,
      cleanAid: fromUrl.aid.slice(1),
      board: fromUrl.board,
      filename: fromUrl.filename,
      url: fromUrl.url,
    };
  }

  // Check for '文章代碼(AID): #1xxxxxxx (Board)' or '#1xxxxxxx (Board)' or '#1xxxxxxx'
  const aidPattern = /^(?:(?:文章代碼(?:\(AID\))?|AID)\s*[:：]?\s*)?#?([0-9a-zA-Z_-]{8})(?:\s*[（(]([a-zA-Z0-9_-]{1,32})[）)])?$/i;
  const match = trimmed.match(aidPattern);
  if (match) {
    const candidateCode = match[1];
    const extractedBoard = match[2] || validBoard(defaultBoard);
    const filename = aidToFilename(candidateCode);
    if (filename) {
      const aid = `#${candidateCode}`;
      const url = extractedBoard ? aidToUrl(extractedBoard, aid) : null;
      return {
        isValid: true,
        aid,
        cleanAid: candidateCode,
        board: extractedBoard,
        filename,
        url,
      };
    }
  }

  return { isValid: false, aid: null, cleanAid: null, board: null, filename: null, url: null };
}

/**
 * Extracts all AID spans within a single row or line of text.
 * @param {string} lineStr
 * @param {string|null} [currentBoard=null]
 * @returns {Array<{ aid: string, cleanAid: string, board: string|null, url: string|null, raw: string, startCol: number, endCol: number }>}
 */
export function extractAidsFromLine(lineStr, currentBoard = null) {
  if (typeof lineStr !== 'string' || !lineStr) return [];

  const results = [];
  // Match AID with optional prefix and optional (Board):
  // 1. "文章代碼(AID): #1d5ve04Z (Gossiping)"
  // 2. "#1d5ve04Z (Gossiping)"
  // 3. "#1d5ve04Z"
  const regex = /(?:(文章代碼(?:\(AID\))?|AID)\s*[:：]?\s*)?(?<![0-9a-zA-Z_#-])(#([0-9a-zA-Z_-]{8}))(?![0-9a-zA-Z_-])(?:\s*[（(]([a-zA-Z0-9_-]+)[）)])?/g;

  let match;
  while ((match = regex.exec(lineStr)) !== null) {
    const fullMatch = match[0];
    const candidateAid = match[3];
    const board = match[4] || validBoard(currentBoard);

    // Validate that candidateAid is a mathematically valid PTT AID
    const filename = aidToFilename(candidateAid);
    if (!filename) continue;

    const aid = `#${candidateAid}`;
    const startCol = match.index;
    const endCol = match.index + fullMatch.length - 1;
    const url = board ? aidToUrl(board, aid) : null;

    results.push({
      aid,
      cleanAid: candidateAid,
      board,
      raw: fullMatch,
      url,
      startCol,
      endCol,
    });
  }

  return results;
}

/**
 * Detects current BBS board name from buffer header rows (0-4).
 * @param {Object} buf
 * @returns {string|null}
 */
export function validBoard(board) {
  return typeof board === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(board.trim()) ? board.trim() : null;
}

export function boardFromHeaderLine(line) {
  // PTT sets currBM to「徵求中」when no public moderator is present. The
  // right-hand board field remains the same and must still be verified.
  if (typeof line !== 'string' || !/^\s*(?:作者(?:\s|[:：])|看板|【(?:[板版]主|徵求中】))/.test(line)) return null;
  const match = line.match(/看板《([a-zA-Z0-9_-]{1,32})》/) ||
    line.match(/(?:^|\s)看板(?:\s*[:：]\s*|\s+)([a-zA-Z0-9_-]{1,32})(?=\s|$)/);
  return match ? validBoard(match[1]) : null;
}

export function detectCurrentBoard(buf) {
  if (!buf?.lines) return null;
  for (let r = 0; r < Math.min(5, buf.rows || 24); r++) {
    const board = boardFromHeaderLine(buf.getRowText?.(buf.lines[r]) || '');
    if (board) return board;
  }
  return null;
}

// A plan is descriptive only. The modal executes each command after verifying
// its source prompt and waiting for the destination state; never send join('').
export function generateJumpPlan({ aid, targetBoard = null, currentBoard = null, bbsState } = {}) {
  const parsed = parseAidInput(aid);
  if (!parsed.isValid || !['reading', 'article-list', 'board-list', 'main-menu', 'board-input', 'aid-input'].includes(bbsState)) {
    throw new Error('目前畫面不適合文章定位');
  }
  const target = targetBoard == null ? null : validBoard(targetBoard);
  const current = currentBoard == null ? null : validBoard(currentBoard);
  if ((targetBoard != null && !target) || (currentBoard != null && !current)) throw new Error('看板名稱無效');
  if ((['article-list', 'aid-input'].includes(bbsState) || (bbsState === 'reading' && !target)) && !current) throw new Error('無法確認目前看板，請先回到可辨識的文章列表');
  if (!target && !current) throw new Error('請指定目標看板');
  const board = target || current;
  if (bbsState === 'aid-input' && board.toLowerCase() !== current.toLowerCase()) {
    throw new Error('目前文章代碼輸入屬於其他看板，請先手動退出提示再切板');
  }
  const steps = [];
  if (bbsState === 'reading') {
    // Later article pages omit the board header. With an explicit target it is
    // safe to leave reading, verify a real list, then select that target afresh.
    steps.push({ data: 'q', from: 'reading', to: 'article-list', board: current });
  }
  if (bbsState === 'board-input') {
    steps.push({ data: `${board}\r`, from: 'board-input', to: 'article-list', board });
  } else if (bbsState !== 'aid-input') {
    if (['main-menu', 'board-list'].includes(bbsState) || board.toLowerCase() !== current?.toLowerCase()) {
      steps.push({ data: 's', from: bbsState === 'reading' ? 'article-list' : bbsState, to: 'board-input', board: current });
      steps.push({ data: `${board}\r`, from: 'board-input', to: 'article-list', board });
    }
  }
  if (bbsState !== 'aid-input') {
    steps.push({ data: '#', from: 'article-list', to: 'aid-input', board });
  }
  steps.push({ data: `${parsed.cleanAid}\r`, from: 'aid-input', to: 'article-list', board });
  return steps;
}

// Compatibility for callers inspecting a sequence. Never used by the sender.
export function generateJumpSequence(options) {
  return generateJumpPlan(options).map(step => step.data).join('');
}
