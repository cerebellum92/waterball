import { TERM_COLORS } from './term_buf.js';
import { blacklistManager } from './blacklist.js';
import { terminalDiagnostics } from './terminal_diagnostics.js';

const isDevelopment = import.meta.env?.DEV ?? false;

// Arm weights (0=none, 1=light, 2=heavy, 3=double) encoded as [U, R, D, L] for U+2500..U+257F
const BOX_ARM_MAP = {
  0x2500: '0101', 0x2501: '0202', 0x2502: '1010', 0x2503: '2020',
  0x250C: '0110', 0x250D: '0210', 0x250E: '0120', 0x250F: '0220',
  0x2510: '0011', 0x2511: '0012', 0x2512: '0021', 0x2513: '0022',
  0x2514: '1100', 0x2515: '1200', 0x2516: '2100', 0x2517: '2200',
  0x2518: '1001', 0x2519: '1002', 0x251A: '2001', 0x251B: '2002',
  0x251C: '1110', 0x251D: '1210', 0x251E: '2110', 0x251F: '1120',
  0x2520: '2120', 0x2521: '2210', 0x2522: '1220', 0x2523: '2220',
  0x2524: '1011', 0x2525: '1012', 0x2526: '2011', 0x2527: '1021',
  0x2528: '2021', 0x2529: '2012', 0x252A: '1022', 0x252B: '2022',
  0x252C: '0111', 0x252D: '0112', 0x252E: '0211', 0x252F: '0212',
  0x2530: '0121', 0x2531: '0122', 0x2532: '0221', 0x2533: '0222',
  0x2534: '1101', 0x2535: '1102', 0x2536: '1201', 0x2537: '1202',
  0x2538: '2101', 0x2539: '2102', 0x253A: '2201', 0x253B: '2202',
  0x253C: '1111', 0x253D: '1112', 0x253E: '1211', 0x253F: '1212',
  0x2540: '2111', 0x2541: '1121', 0x2542: '2121', 0x2543: '2112',
  0x2544: '2211', 0x2545: '1122', 0x2546: '1221', 0x2547: '2212',
  0x2548: '1222', 0x2549: '2122', 0x254A: '2221', 0x254B: '2222',
  0x2550: '0303', 0x2551: '3030', 0x2552: '0310', 0x2553: '0130',
  0x2554: '0330', 0x2555: '0013', 0x2556: '0031', 0x2557: '0033',
  0x2558: '1300', 0x2559: '3100', 0x255A: '3300', 0x255B: '1003',
  0x255C: '3001', 0x255D: '3003', 0x255E: '1310', 0x255F: '3130',
  0x2560: '3330', 0x2561: '1013', 0x2562: '3031', 0x2563: '3033',
  0x2564: '0313', 0x2565: '0131', 0x2566: '0333', 0x2567: '1303',
  0x2568: '3101', 0x2569: '3303', 0x256A: '1313', 0x256B: '3131',
  0x256C: '3333', 0x2574: '0001', 0x2575: '1000', 0x2576: '0100',
  0x2577: '0010', 0x2578: '0002', 0x2579: '2000', 0x257A: '0200',
  0x257B: '0020', 0x257C: '0201', 0x257D: '1020', 0x257E: '0102',
  0x257F: '2010',
};

const DASHED_BOX_MAP = {
  0x2504: ['H', 1, 3], 0x2505: ['H', 2, 3], 0x2506: ['V', 1, 3], 0x2507: ['V', 2, 3],
  0x2508: ['H', 1, 4], 0x2509: ['H', 2, 4], 0x250A: ['V', 1, 4], 0x250B: ['V', 2, 4],
  0x254C: ['H', 1, 2], 0x254D: ['H', 2, 2], 0x254E: ['V', 1, 2], 0x254F: ['V', 2, 2],
};

// Quadrant bitmasks for U+2596..U+259F: bit0=UL, bit1=UR, bit2=LL, bit3=LR
const QUADRANT_MASKS = [4, 8, 1, 13, 9, 7, 11, 2, 6, 14];

export class TermView {
  constructor(container, termBuf, imeInput = null) {
    this.container = container;
    this.buf = termBuf;
    this.imeInput = imeInput;
    this.onContextMenu = null;

    // Create wrapper & canvas
    this.wrapper = document.createElement('div');
    this.wrapper.style.position = 'relative';
    this.wrapper.style.width = '100%';
    this.wrapper.style.height = '100%';
    this.wrapper.style.display = 'flex';
    this.wrapper.style.alignItems = 'center';
    this.wrapper.style.justifyContent = 'center';
    this.wrapper.style.backgroundColor = '#000000';
    
    // Prevent browser auto-scroll when focusing a wide input near the screen edge
    this.wrapper.addEventListener('scroll', () => {
      if (this.wrapper.scrollLeft > 0) this.wrapper.scrollLeft = 0;
      if (this.wrapper.scrollTop > 0) this.wrapper.scrollTop = 0;
    });
    this.wrapper.style.overflow = 'hidden';

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.wrapper.appendChild(this.canvas);

    if (this.imeInput) {
      this.wrapper.appendChild(this.imeInput);
      this.imeInput.addEventListener('focus', () => this.scheduleRedraw());
      this.imeInput.addEventListener('blur', () => this.scheduleRedraw());
    }

    this.container.replaceChildren(this.wrapper);

    // BBS Aspect Ratio: Single char cell ratio is 1:2 (width:height)
    this.cellW = 10;
    this.cellH = 20;

    this.fontFamily = 'auto';
    this.customFont = '';
    this.terminalFontScale = 0.92;
    this.sideButtonEnabled = true;
    this.cursorStyle = 'smart';
    this.selectionSnapshot = null;

    this.renderRequested = false;
    this.measureCache = new Map();
    this.rowMetadataCache = new Map();
    this.rowUrlCache = new Map();

    this.blinkState = true;
    this.blinkTimer = setInterval(() => {
      if (this.hasBlinkingCharacters()) {
        this.blinkState = !this.blinkState;
        this.scheduleRedraw();
      }
    }, 500);

    this.selection = null; // { startX, startY, endX, endY }
    this.isSelecting = false;
    this.isDragging = false;
    this.mouseDownPos = null;
    this.mouseDownPixel = null;
    this.hoverUrl = null;
    this.hoverWord = null;
    this.hoverAction = null;
    this.mouseBrowsingEnabled = true;

    // Differential rendering state cache
    this.lastCursorX = -1;
    this.lastCursorY = -1;
    this.lastSelection = null;
    this.lastBlinkState = true;

    this.blacklistListener = () => {
      this.rowMetadataCache.clear();
      this.revealedBlacklistRows?.clear();
      this.hoverUrl = null;
      this.hoverAid = null;
      this.hoverWord = null;
      this.hoverAction = null;
      this.onUrlLeave?.();
      this.onAidLeave?.();
      this.onWordLeave?.();
      if (this.buf?.markAllDirty) {
        this.buf.markAllDirty();
      }
      this.scheduleRedraw();
    };
    blacklistManager.onChange(this.blacklistListener);

    this.onUrlClick = null;
    this.onUrlHover = null;
    this.onUrlLeave = null;
    this.onWheel = null;
    this.onSelectionChange = null;
    this.onSelectionComplete = null;
    this.onSideButton = null;
    this.onArticleClick = null;
    this.onBoardClick = null;
    this.onShortcutClick = null;

    this.initMouseEvents();

    this.buf.onUpdate = () => {
      if (this.selection && !this.isSelecting && this.hasSelectionScreenChanged()) {
        this.selection = null;
        this.selectionSnapshot = null;
        this.buf.markAllDirty();
      }
      this.resetCursorBlink();
      this.scheduleRedraw();
    };
    this.resize();
  }

  hasBlinkingCharacters() {
    if (!this.buf || !this.buf.lines) return false;
    for (let r = 0; r < this.buf.rows; r++) {
      const line = this.buf.lines[r];
      if (!line) continue;
      for (let c = 0; c < this.buf.cols; c++) {
        if (line[c]?.blink) return true;
      }
    }
    return false;
  }

  resetCursorBlink() {
    this.blinkState = true;
    if (this.blinkTimer) clearInterval(this.blinkTimer);
    this.blinkTimer = setInterval(() => {
      if (this.hasBlinkingCharacters()) {
        this.blinkState = !this.blinkState;
        this.scheduleRedraw();
      }
    }, 500);
  }

  clearWordHover() {
    if (this.hoverWord) {
      this.hoverWord = null;
      this.onWordLeave?.();
    }
  }

  initMouseEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left click
        const pos = this.getGridPos(e);
        this.isSelecting = true;
        this.isDragging = false;
        this.mouseDownPos = pos;
        this.mouseDownPixel = { x: e.clientX, y: e.clientY };
        this.selection = null;
        this.selectionSnapshot = null;
        this.redraw();
      }
    });

    const sideTarget = this.wrapper || this.canvas;
    const handleSideButtonEvent = (e, triggerAction = false) => {
      if (!this.sideButtonEnabled) return;
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (triggerAction) {
        this.onSideButton?.(e.button === 3 ? 'back' : 'forward');
      }
    };
    sideTarget.addEventListener('mousedown', (e) => handleSideButtonEvent(e, false));
    sideTarget.addEventListener('auxclick', (e) => handleSideButtonEvent(e, false));
    sideTarget.addEventListener('mouseup', (e) => handleSideButtonEvent(e, true));

    window.addEventListener('mousemove', (e) => {
      if (this.isSelecting && this.mouseDownPos) {
        const dx = e.clientX - this.mouseDownPixel.x;
        const dy = e.clientY - this.mouseDownPixel.y;
        if (!this.isDragging && (dx * dx + dy * dy) < 16) return;
        this.isDragging = true;
        const pos = this.getGridPos(e);
        this.selection = {
          startX: this.mouseDownPos.col,
          startY: this.mouseDownPos.row,
          endX: pos.col,
          endY: pos.row,
        };
        this.selectionSnapshot = this.getScreenTextSnapshot();
        this.onSelectionChange?.(this.selection);
        this.redraw();
      } else {
        // Check URL hover when not selecting (skip if an overlay modal/panel covers the terminal)
        const rect = this.canvas.getBoundingClientRect();
        const pointerOnTerminal = !(typeof Node !== 'undefined' && e.target instanceof Node && !this.wrapper.contains(e.target));
        if (
          pointerOnTerminal &&
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          const pos = this.getGridPos(e);
          if (this.isRowMasked(pos.row)) {
            this.canvas.style.cursor = 'pointer';
            this.canvas.title = '點擊展開黑名單列；再次點擊才會開啟連結';
            this.hoverUrl = null;
            this.hoverAction = null;
            this.onUrlLeave?.();
            this.clearWordHover();
            return;
          }
          this.canvas.title = '';
          const url = this.getAccessibleUrlAt(pos.col, pos.row);
          if (url) {
            this.canvas.style.cursor = 'pointer';
            if (this.hoverAction) {
              this.hoverAction = null;
              this.redraw();
            }
            if (!this.hoverUrl || this.hoverUrl.url !== url.url || this.hoverUrl.raw !== url.raw || this.hoverUrl.row !== url.row) {
              this.hoverUrl = url;
              this.redraw();
            }
            if (this.hoverAid) {
              this.hoverAid = null;
              this.onAidLeave?.();
            }
            this.clearWordHover();
            this.onUrlHover?.(url.url, e.clientX, e.clientY);
          } else {
            const aid = this.getAccessibleAidAt(pos.col, pos.row);
            if (aid) {
              this.canvas.style.cursor = 'pointer';
              if (this.hoverAction) {
                this.hoverAction = null;
                this.redraw();
              }
              if (this.hoverUrl) {
                this.hoverUrl = null;
                this.redraw();
                this.onUrlLeave?.();
              }
              if (!this.hoverAid || this.hoverAid.aid !== aid.aid || this.hoverAid.row !== aid.row) {
                this.hoverAid = aid;
              }
              this.clearWordHover();
              this.onAidHover?.(aid, e.clientX, e.clientY);
            } else {
              if (this.hoverAid) {
                this.hoverAid = null;
                this.onAidLeave?.();
              }
              const action = this.getMouseActionAt(pos.col, pos.row);
              this.canvas.style.cursor = action ? 'pointer' : 'text';
              if (JSON.stringify(action) !== JSON.stringify(this.hoverAction)) {
                this.hoverAction = action;
                this.redraw();
              }
              if (this.hoverUrl) {
                this.hoverUrl = null;
                this.redraw();
                this.onUrlLeave?.();
              }
              const word = this.getWordAt(pos.col, pos.row);
              if (word) {
                this.hoverWord = word;
                this.onWordHover?.(word, e.clientX, e.clientY);
              } else {
                this.clearWordHover();
              }
            }
          }
        } else {
          this.clearWordHover();
          if (this.hoverAid) {
            this.hoverAid = null;
            this.onAidLeave?.();
          }
          if (this.hoverUrl) {
            this.canvas.style.cursor = 'default';
            this.hoverUrl = null;
            this.hoverAction = null;
            this.redraw();
            this.onUrlLeave?.();
          } else if (this.hoverAction) {
            this.canvas.style.cursor = 'default';
            this.hoverAction = null;
            this.redraw();
          }
        }
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.clearWordHover();
      if (this.hoverUrl) {
        this.hoverUrl = null;
        this.redraw();
        this.onUrlLeave?.();
      }
      if (this.hoverAid) {
        this.hoverAid = null;
        this.onAidLeave?.();
      }
      if (this.hoverAction) {
        this.hoverAction = null;
        this.redraw();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isSelecting) {
        this.isSelecting = false;
        if (this.isDragging && this.selection) {
          this.selectionSnapshot = this.getScreenTextSnapshot();
          this.onSelectionComplete?.(this.selection);
        } else if (!this.isDragging && this.mouseDownPos) {
          if (this.isRowMasked(this.mouseDownPos.row)) {
            this.revealBlacklistRow(this.mouseDownPos.row);
            this.mouseDownPixel = null;
            return;
          }
          const url = this.getAccessibleUrlAt(this.mouseDownPos.col, this.mouseDownPos.row);
          if (url) {
            this.onUrlClick?.(url.url);
          } else {
            const aid = this.getAccessibleAidAt(this.mouseDownPos.col, this.mouseDownPos.row);
            if (aid) {
              this.onAidClick?.(aid);
            } else {
              const shortcut = this.mouseBrowsingEnabled
                ? this.getShortcutAt(this.mouseDownPos.col, this.mouseDownPos.row)
                : null;
            if (shortcut) {
              this.onShortcutClick?.(shortcut);
            } else {
              const action = this.getMouseActionAt(this.mouseDownPos.col, this.mouseDownPos.row);
              if (action?.type === 'waiting') {
                this.onShortcutClick?.(action);
              } else if (this.mouseBrowsingEnabled && this.isPttArticleListScreen() && this.isArticleListRow(this.mouseDownPos.row)) {
                this.onArticleClick?.(this.mouseDownPos.row);
              } else if (this.mouseBrowsingEnabled && this.getBbsState() === 'board-list' && this.isBoardListRow(this.mouseDownPos.row)) {
                this.onBoardClick?.(this.mouseDownPos.row);
              }
            }
          }
        }
      }
      this.isDragging = false;
      this.mouseDownPixel = null;
    }
  });

    // Mouse wheel scrolling
    let lastWheelTime = 0;
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelTime < 60) return;
      lastWheelTime = now;

      if (e.deltaY !== 0) {
        if (this.mouseBrowsingEnabled) {
          this.onWheel?.(e.deltaY > 0 ? 'down' : 'up');
        }
      }
    }, { passive: false });

    // Right-click context menu (Copy, Search, Blacklist user)
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const pos = this.getGridPos(e);
      let selectedText = this.getSelectionText() || '';
      let word = '';
      if (!selectedText) {
        word = this.getWordAt(pos.col, pos.row);
      }
      this.onContextMenu?.({
        clientX: e.clientX,
        clientY: e.clientY,
        gridX: pos.col,
        gridY: pos.row,
        selectedText: selectedText.trim(),
        word: word.trim(),
      });
    });
  }

  getWordAt(col, row) {
    if (this.isRowMasked(row)) return '';
    const line = this.buf.lines[row];
    if (!line || col < 0 || col >= this.buf.cols) return '';
    let start = col;
    while (start > 0 && /[a-zA-Z0-9_-]/.test(line[start - 1]?.ch)) {
      start--;
    }
    let end = col;
    while (end < this.buf.cols - 1 && /[a-zA-Z0-9_-]/.test(line[end + 1]?.ch)) {
      end++;
    }
    let word = '';
    for (let c = start; c <= end; c++) {
      const cell = line[c];
      if (cell && !cell.isTrailByte && /[a-zA-Z0-9_-]/.test(cell.ch)) {
        word += cell.ch;
      }
    }
    return word;
  }

  getRowMetadata(r, screenState = this.getBbsState()) {
    this.rowMetadataCache ||= new Map();
    const text = this.getRowText(r);
    const pushContext = screenState === 'reading' ? this.getLogicalPush(r) : null;
    const key = JSON.stringify([blacklistManager.revision, screenState, text, pushContext]);
    const cached = this.rowMetadataCache.get(r);
    if (cached?.key === key) return cached;
    let author = null, isPush = false, content = '', reason = null;
    // Only recognized content rows may be filtered. Prompts and unknown screens stay intact.
    if (r > 0 && r < this.buf.rows - 1 && screenState === 'article-list') {
      const match = text.match(/^\s*(?:[>●○◎☆★]\s*)?(?:\d+|[★*])\s+(?:[+爆Mm~!Xx\d\s]+)?\s*\d{1,2}\/\d{1,2}\s+([a-zA-Z][a-zA-Z0-9_]{1,11})(?=\s|$)(.*)$/);
      if (match) { author = match[1]; content = match[2]; }
    } else if (r > 0 && r < this.buf.rows - 1 && screenState === 'reading') {
      if (pushContext) { author = pushContext.author; content = pushContext.content; isPush = true; }
      else {
        const title = text.match(/^標題(?:\s*[:：]\s*|\s+)(.*)$/);
        if (title) content = title[1];
      }
    }
    if (author && blacklistManager.isBlacklisted(author)) reason = `帳號 ${author}`;
    else if (content) {
      const keyword = blacklistManager.isKeywordBlacklisted(content);
      if (keyword) reason = `關鍵字「${keyword}」`;
    }
    const meta = { key, author, isBlacklisted: Boolean(reason), reason, isPush };
    this.rowMetadataCache.set(r, meta);
    return meta;
  }

  getLogicalPush(row) {
    // Only inherit an author across visibly full, indented continuation rows.
    const continuation = r => {
      if (r <= 1 || r >= this.buf.rows - 1) return false;
      const previous = this.buf.lines[r - 1];
      const tail = previous?.[this.buf.cols - 1];
      return Boolean(tail && (tail.isTrailByte || /\S/.test(tail.ch || '')) && /^ {2,}\S/.test(this.getRowText(r)));
    };
    let start = row;
    while (continuation(start)) start--;
    const match = this.getRowText(start).match(/^([推噓→])\s+([a-zA-Z][a-zA-Z0-9_]{1,11})\s*[:：](.*)$/);
    if (!match) return null;
    let content = match[3];
    for (let next = start + 1; continuation(next); next++) content += this.getRowText(next).trimStart();
    return { author: match[2], content };
  }

  isRowMasked(row, screenState = this.getBbsState()) {
    const meta = this.getRowMetadata(row, screenState);
    return meta.isBlacklisted && blacklistManager.getMode() !== 'dim' && this.revealedBlacklistRows?.get(row) !== meta.key;
  }

  revealBlacklistRow(row) {
    const meta = this.getRowMetadata(row);
    this.revealedBlacklistRows ||= new Map();
    this.revealedBlacklistRows.set(row, meta.key);
    this.redraw();
  }

  selectionContainsMaskedRows() {
    if (!this.selection) return false;
    const first = Math.max(0, Math.min(this.selection.startY, this.selection.endY));
    const last = Math.min(this.buf.rows - 1, Math.max(this.selection.startY, this.selection.endY));
    const state = this.getBbsState();
    for (let row = first; row <= last; row++) if (this.isRowMasked(row, state)) return true;
    return false;
  }

  getRowText(r) {
    const line = this.buf.lines[r];
    if (!line) return '';
    let text = '';
    for (let c = 0; c < this.buf.cols; c++) {
      const cell = line[c];
      if (!cell || cell.isTrailByte) continue;
      text += cell.ch || ' ';
    }
    return text;
  }

  isArticleListRow(r) {
    const text = this.getRowText(r);
    if (!text.trim()) return false;
    if (/【精華文章】|【功能鍵】|精華列表|精華管理|標記項目/.test(text)) return false;

    // PTT's usual format: article number, score/status, date, author...
    if (/^\s*(?:[>●○◎☆★]\s*)?(?:\d+|[★*])\s+([+爆Mm~!Xx\d\s]+)?\s*\d{1,2}\/\d{1,2}\s+[a-zA-Z0-9_]+/.test(text)) {
      return true;
    }

    // Welly-style fallback: recognize common article title starters instead
    // of requiring one particular BBS's date/author column layout.
    const content = text.slice(2);
    if (/^\s*(?:\d+|[●○◎☆★>])\s+/.test(text) && /^(?:[^\r\n]*(?:□|◆|◇|★|├|└)\s*[^\s])/.test(content)) {
      return true;
    }
    return /^\s*(?:Re:|R:\s)/.test(text);
  }

  getBbsState() {
    const rows = Array.from({ length: this.buf.rows }, (_, r) => this.getRowText(r));
    const top = rows.slice(0, 3).join('\n');
    const bottom = rows.slice(Math.max(0, this.buf.rows - 3)).join('\n');
    const lastRow = rows[rows.length - 1] || '';
    const whole = rows.join('\n');
    let articleRows = 0;
    for (let r = 0; r < this.buf.rows; r++) {
      if (this.isArticleListRow(r)) articleRows++;
    }

    if (
      /每行最多可容納|編輯文章|請輸入標題|請輸入密碼|請輸入.*密碼|請輸入推文|推文確認|確認.*[Yy/Nn]|Ctrl[-+]X|\(Ctrl\+X\)|\^X\s*(?:發表|寄出|存檔)|確定要儲存變更嗎|\[Y\/S\]儲存|以上資料是否正確|確定要放棄填寫嗎/.test(bottom) ||
      /\[\s*項目\s*\d+\s*\/\s*\d+\s*\]/.test(top)
    ) {
      return 'compose';
    }
    if (this.getWaitingPromptRow() >= 0) {
      return 'waiting-enter';
    }
    const isDigestList = /^\s*(?:【功能鍵】|【板\s*主】|精華列表|精華管理|標記項目)(?:\s|$)/.test(lastRow);
    const hasArticleListCaption = /文章選讀|文章列表|系列文章|文摘列表/.test(lastRow) || /文章選讀|文章列表|系列文章|文摘列表/.test(bottom);
    if (
      !isDigestList && (
        (
          articleRows >= 2 &&
          (/目前顯示\s*[:：]|【看板列表】|文章選讀|文章列表|系列文章|文摘列表|版主|板主|看板/.test(top + bottom) ||
            /目前顯示\s*[:：]|【看板列表】|文章選讀|文章列表|系列文章|文摘列表/.test(whole))
        ) ||
        (hasArticleListCaption && (/沒有文章/.test(whole) || /編號\s+日\s*期\s+作\s*者/.test(whole)))
      )
    ) {
      return 'article-list';
    }
    if (/看板列表|討論區列表|个人定制区|板板列表|我的最愛|分類看板/.test(top) || /^\s*(?:選擇看板|看板列表|我的最愛|分類看板)(?:\s|$)/.test(lastRow)) return 'board-list';
    if (/好朋友列表|使用者列表|休閒聊天/.test(top)) return 'friend-list';
    if (/處理信箋選單|電子郵件|邮件选单/.test(top) || /^\s*(?:鴻雁往返|信件列表)(?:\s|$)/.test(lastRow)) return 'mail-list';
    if (/閱讀文章|主題閱讀|同作者閱讀|下面還有喔|瀏覽\s+第/.test(bottom)) return 'reading';
    if (/主功能表|聊天說話|個人設定|偏好設定列表|工具程式|網路遊樂場|目前\s*[:：]?/.test(top) || /^\s*(?:主功能表|偏好設定列表)(?:\s|\||$)/.test(lastRow)) return 'main-menu';

    let boardRows = 0;
    for (let r = 0; r < this.buf.rows; r++) {
      if (this.isBoardListRow(r)) boardRows++;
    }
    if (boardRows >= 2) return 'board-list';

    return 'unknown';
  }

  getWaitingPromptRow() {
    const promptPattern = /按任意鍵繼續|按回車鍵|按\s*\[RETURN\]\s*繼續|(?:請\s*)?按空白鍵(?:或是Enter)?繼續|按任何鍵繼續/;
    for (let r = this.buf.rows - 1; r >= 0; r--) {
      if (promptPattern.test(this.getRowText(r))) return r;
    }
    return -1;
  }

  getShortcutAt(col, row) {
    const line = this.buf.lines[row];
    if (!line || col < 0 || col >= this.buf.cols) return null;

    const options = [];
    const cells = [];
    for (let c = 0; c < this.buf.cols; c++) {
      if (!line[c]?.isTrailByte) cells.push({ col: c, ch: line[c]?.ch || ' ' });
    }

    for (let i = 0; i < cells.length; i++) {
      const opener = cells[i].ch;
      if (opener !== '(' && opener !== '[') continue;
      const closer = opener === '(' ? ')' : ']';
      for (let j = i + 1; j < Math.min(cells.length, i + 8); j++) {
        if (cells[j].ch !== closer) continue;
        const content = cells.slice(i + 1, j).map((cell) => cell.ch).join('').trim();
        const arrowCommands = {
          '←': '\x1b[D',
          '→': '\x1b[C',
          '↑': '\x1b[A',
          '↓': '\x1b[B',
        };
        const namedCommands = {
          enter: '\r',
          return: '\r',
          pgup: '\x1b[5~',
          pgdn: '\x1b[6~',
          pageup: '\x1b[5~',
          pagedown: '\x1b[6~',
        };
        const contentCells = cells.slice(i + 1, j);
        const addOption = (cellStart, cellEnd, key, command, wide = false) => {
          if (command) options.push({ start: cellStart, end: cellEnd, key, command, wide });
        };

        if (arrowCommands[content]) {
          addOption(cells[i].col, cells[j].col, content, arrowCommands[content], true);
        } else if (namedCommands[content.toLowerCase()]) {
          addOption(cells[i].col, cells[j].col, content, namedCommands[content.toLowerCase()], true);
        } else if (
          content.length > 1 &&
          [...content].every((key) => arrowCommands[key])
        ) {
          contentCells.forEach((cell) => {
            if (arrowCommands[cell.ch]) addOption(cell.col, cell.col, cell.ch, arrowCommands[cell.ch]);
          });
        } else if (/[←→↑↓]/.test(content) && /^[A-Za-z0-9/←→↑↓]+$/.test(content)) {
          // Mixed groups such as "k↑j↓", "enter/→" and "q/←" contain
          // several independent keys, with slash used only as a separator.
          let tokenStart = 0;
          while (tokenStart < contentCells.length) {
            const cell = contentCells[tokenStart];
            if (!cell || cell.ch === '/') {
              tokenStart++;
              continue;
            }
            if (arrowCommands[cell.ch]) {
              addOption(cell.col, cell.col, cell.ch, arrowCommands[cell.ch]);
              tokenStart++;
              continue;
            }
            let tokenEnd = tokenStart;
            while (
              tokenEnd + 1 < contentCells.length &&
              /^[A-Za-z0-9]$/.test(contentCells[tokenEnd + 1].ch)
            ) {
              tokenEnd++;
            }
            const token = contentCells.slice(tokenStart, tokenEnd + 1).map((item) => item.ch).join('');
            const command = namedCommands[token.toLowerCase()];
            if (command) {
              addOption(contentCells[tokenStart].col, contentCells[tokenEnd].col, token, command);
            } else if (token.length === 1) {
              addOption(cell.col, cell.col, token, token);
            }
            tokenStart = tokenEnd + 1;
          }
        } else if (/^[A-Za-z0-9]$/.test(content)) {
          addOption(cells[i].col, cells[j].col, content, content, true);
        } else {
          const keyMatch = content.match(/^([A-Za-z0-9])%$/);
          if (keyMatch) {
            addOption(cells[i].col, cells[j].col, keyMatch[1], keyMatch[1], true);
          } else if (/^\^([A-Za-z])$/.test(content)) {
            const key = content[1].toUpperCase();
            addOption(cells[i].col, cells[j].col, content, String.fromCharCode(key.charCodeAt(0) - 64), true);
          } else if (/^Ctrl-[A-Za-z]$/i.test(content)) {
            const key = content.slice(-1).toUpperCase();
            addOption(cells[i].col, cells[j].col, content, String.fromCharCode(key.charCodeAt(0) - 64), true);
          } else if (
            /[/?=<>\[\]]/.test(content) &&
            /^[/?A-Za-z0-9=<>\[\]]+$/.test(content)
          ) {
            // Compact BBS hints such as "(/?a)" and "(=[]<>)" contain
            // several independent keys. Give each visible key its own hitbox.
            contentCells.forEach((cell) => {
              if (!/\S/.test(cell.ch)) return;
              // In forms such as "(v/V)", slash is a visual separator.
              // In "(/?a)", it is the actual slash command.
              if (cell.ch === '/' && /^[A-Za-z]\/[A-Za-z]$/.test(content)) return;
              addOption(cell.col, cell.col, cell.ch, cell.ch);
            });
          }
        }
        break;
      }
    }

    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      if (option.wide) {
        const nextStart = options[i + 1]?.start ?? this.buf.cols;
        option.end = nextStart - 1;
        if (!options[i + 1]) {
          option.end = this.buf.cols - 1;
          while (option.end > option.start && (!line[option.end]?.ch || line[option.end].ch === ' ')) {
            option.end--;
          }
        }
      }
      if (col >= option.start && col <= option.end) {
        return { key: option.key, command: option.command, startCol: option.start, endCol: option.end };
      }
    }
    return null;
  }

  getMouseActionAt(col, row) {
    if (!this.mouseBrowsingEnabled) return null;
    const shortcut = this.getShortcutAt(col, row);
    if (shortcut) {
      return { type: 'shortcut', row, startCol: shortcut.startCol, endCol: shortcut.endCol };
    }
    if (this.isPttArticleListScreen() && this.isArticleListRow(row)) {
      return { type: 'article', row, startCol: 0, endCol: this.buf.cols - 1 };
    }
    if (this.getBbsState() === 'board-list' && this.isBoardListRow(row)) {
      return { type: 'board', row, startCol: 0, endCol: this.buf.cols - 1 };
    }
    if (this.getBbsState() === 'waiting-enter' && row === this.getWaitingPromptRow()) {
      return { type: 'waiting', row, startCol: 0, endCol: this.buf.cols - 1, command: ' ' };
    }
    return null;
  }

  isBoardListRow(r) {
    if (r <= 0 || r >= this.buf.rows - 1) return false;
    return /^\s*(?:[●○◎☆★>]\s*)?\d+(?:\s|\)|ˇ)/.test(this.getRowText(r));
  }

  setMouseBrowsingEnabled(enabled) {
    this.mouseBrowsingEnabled = enabled !== false;
    if (!this.mouseBrowsingEnabled) {
      this.hoverAction = null;
      this.canvas.style.cursor = 'text';
      this.redraw();
    }
  }

  /**
   * Enable or disable terminal handling for browser mouse side buttons (Back/Forward).
   * @param {boolean} enabled
   */
  setSideButtonEnabled(enabled) {
    this.sideButtonEnabled = enabled !== false;
  }

  isPttArticleListScreen() {
    return this.getBbsState() === 'article-list';
  }

  getRowAuthor(r) {
    return this.getRowMetadata(r).author;
  }

  isRowBlacklisted(r) {
    return this.getRowMetadata(r).isBlacklisted;
  }

  getAccessibleUrlAt(col, row) {
    if (this.isRowMasked(row)) return null;
    const url = this.buf.findUrlAt(col, row);
    if (url?.repairRows?.some(r => this.isRowMasked(r))) return null;
    return url;
  }

  getAccessibleAidAt(col, row) {
    if (this.isRowMasked(row)) return null;
    return this.buf?.findAidAt?.(col, row) || null;
  }

  getCachedRowUrls(r) {
    // Content signatures remain valid after dirty flags have been cleared, and
    // include both neighboring rows on which repaired spans depend.
    this.rowUrlCacheKeys ||= new Map();
    const key = JSON.stringify([
      this.buf.cols,
      this.buf.lines[r]?.map((cell) => cell?.hyperlink || '').join('\0') || '',
      ...[r - 1, r, r + 1].map((row) =>
        row >= 0 && row < this.buf.rows ? this.buf.getRowText(this.buf.lines[row]) : null
      ),
    ]);
    if (this.rowUrlCacheKeys.get(r) === key && this.rowUrlCache.has(r)) return this.rowUrlCache.get(r);
    const urls = this.buf.getUrlsInRow(r);
    this.rowUrlCache.set(r, urls);
    this.rowUrlCacheKeys.set(r, key);
    return urls;
  }

  getGridPos(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const py = evt.clientY - rect.top;
    const col = Math.max(0, Math.min(this.buf.cols - 1, Math.floor(px / this.cellW)));
    const row = Math.max(0, Math.min(this.buf.rows - 1, Math.floor(py / this.cellH)));
    return { col, row };
  }

  /**
   * Snapshot visible terminal characters to detect real screen changes vs cursor blink.
   * @returns {string}
   */
  getScreenTextSnapshot() {
    if (!this.buf?.lines) return '';
    return this.buf.lines.map((row) => row.map((c) => c.ch || ' ').join('')).join('\n');
  }

  hasSelectionScreenChanged() {
    if (this.selectionSnapshot === null) return true;
    return this.getScreenTextSnapshot() !== this.selectionSnapshot;
  }

  clearSelection() {
    this.selection = null;
    this.selectionSnapshot = null;
    this.redraw();
  }

  getSelectionText() {
    if (!this.selection || this.selectionContainsMaskedRows()) return '';
    return this.buf.getText(
      this.selection.startX,
      this.selection.startY,
      this.selection.endX,
      this.selection.endY
    );
  }

  getSelectionAnsi() {
    if (!this.selection || this.selectionContainsMaskedRows()) return '';
    return this.buf.getAnsiText(
      this.selection.startX,
      this.selection.startY,
      this.selection.endX,
      this.selection.endY
    );
  }

  setImeInput(imeInput) {
    this.imeInput = imeInput;
    if (imeInput && imeInput.parentElement !== this.wrapper) {
      this.wrapper.appendChild(imeInput);
    }
    this.updateImePosition();
  }

  updateImePosition() {
    if (!this.canvas || !this.imeInput) return;

    const canvasRect = this.canvas.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();

    const width = `${Math.max(10, Math.round(this.cellW))}px`;
    const height = `${Math.max(10, Math.round(this.cellH))}px`;
    const fontSize = `${Math.floor(this.cellH * 0.85)}px`;
    const fontFamily = this.getRenderFontFamilyString();

    if (this.imeInput.style.width !== width) this.imeInput.style.width = width;
    if (this.imeInput.style.height !== height) this.imeInput.style.height = height;
    if (this.imeInput.style.fontSize !== fontSize) this.imeInput.style.fontSize = fontSize;
    if (this.imeInput.style.lineHeight !== height) this.imeInput.style.lineHeight = height;
    if (this.imeInput.style.fontFamily !== fontFamily) this.imeInput.style.fontFamily = fontFamily;

    const left = Math.max(0, (canvasRect.left - wrapperRect.left) + this.buf.cur_x * this.cellW);
    const top = Math.max(0, (canvasRect.top - wrapperRect.top) + this.buf.cur_y * this.cellH);
    const newLeft = `${left}px`;
    const newTop = `${top}px`;

    if (this.imeInput.style.left !== newLeft) this.imeInput.style.left = newLeft;
    if (this.imeInput.style.top !== newTop) this.imeInput.style.top = newTop;
  }

  getFontFamilyString() {
    if (this.fontFamily === 'custom' && this.customFont && this.customFont.trim()) {
      return `"${this.customFont.trim()}", "Noto Sans Mono CJK TC", "PingFang TC", "Microsoft JhengHei", "Microsoft YaHei", "SimSun", "MingLiU", sans-serif, monospace`;
    }
    switch (this.fontFamily) {
      // Windows
      case 'mingliu':
        return '"MingLiU", "PMingLiU", "Songti TC", "LiSong Pro", "SimSun", "AR PL UMing TW", "Microsoft YaHei", serif, monospace';
      case 'jhenghei':
        return '"Microsoft JhengHei", "Microsoft YaHei", "PingFang TC", "Noto Sans Mono CJK TC", "SimSun", sans-serif, monospace';
      case 'yahei':
        return '"Microsoft YaHei", "PingFang SC", "Microsoft JhengHei", "Noto Sans Mono CJK SC", "SimSun", sans-serif, monospace';
      case 'kai':
        return '"DFKai-SB", "BiauKai", "Kaiti TC", "KaiTi", "Microsoft YaHei", cursive, serif, monospace';
      case 'cascadia-code':
      case 'cascadia':
        return '"Cascadia Code", "Cascadia Mono", "Microsoft JhengHei", "Microsoft YaHei", "PingFang TC", "SimSun", monospace';
      case 'cascadia-mono':
        return '"Cascadia Mono", "Cascadia Code", "Microsoft JhengHei", "Microsoft YaHei", "PingFang TC", "SimSun", monospace';
      case 'consolas':
        return '"Consolas", "Microsoft JhengHei", "Microsoft YaHei", "PingFang TC", "SimSun", monospace';
      case 'lucida':
        return '"Lucida Console", "Lucida Sans Typewriter", "Microsoft JhengHei", "Microsoft YaHei", "MingLiU", monospace';

      // macOS
      case 'pingfang':
        return '"PingFang TC", "Hiragino Sans GB", "Microsoft JhengHei", "Microsoft YaHei", "Noto Sans Mono CJK TC", sans-serif, monospace';
      case 'songti':
        return '"Songti TC", "LiSong Pro", "MingLiU", "PMingLiU", "SimSun", serif, monospace';
      case 'sfmono':
        return '"SF Mono", "PingFang TC", "Microsoft JhengHei", "Microsoft YaHei", monospace';
      case 'menlo':
        return '"Menlo", "PingFang TC", "Microsoft JhengHei", "Microsoft YaHei", monospace';
      case 'monaco':
        return '"Monaco", "Menlo", "PingFang TC", "Microsoft YaHei", monospace';

      // Linux
      case 'noto-sans':
        return '"Noto Sans Mono CJK TC", "Noto Sans CJK TC", "PingFang TC", "Microsoft JhengHei", "Microsoft YaHei", sans-serif, monospace';
      case 'noto-serif':
        return '"Noto Serif CJK TC", "Songti TC", "MingLiU", "SimSun", serif, monospace';
      case 'wenquanyi':
        return '"WenQuanYi Micro Hei Mono", "WenQuanYi Zen Hei Mono", "Noto Sans Mono CJK TC", "Microsoft YaHei", monospace';
      case 'zenhei':
        return '"WenQuanYi Zen Hei Mono", "WenQuanYi Micro Hei Mono", "Noto Sans Mono CJK TC", "Microsoft YaHei", monospace';
      case 'ubuntumono':
        return '"Ubuntu Mono", "DejaVu Sans Mono", "Noto Sans Mono CJK TC", "Microsoft YaHei", monospace';
      case 'dejavu':
        return '"DejaVu Sans Mono", "Ubuntu Mono", "Noto Sans Mono CJK TC", "Microsoft YaHei", monospace';

      // BBS community favorite
      case 'sarasa':
        return '"Sarasa Mono TC", "Sarasa Gothic TC", "Taipei Sans TC Beta", "Noto Sans Mono CJK TC", "PingFang TC", "Microsoft JhengHei", "Microsoft YaHei", monospace';
      case 'cubic':
        return '"Cubic 11", "Cubic 11 Regular", "Noto Sans Mono CJK TC", "MingLiU", "Microsoft YaHei", monospace';
      case 'iansui':
        return '"Iansui", "Iansui094", "Noto Sans Mono CJK TC", "PingFang TC", "Microsoft YaHei", monospace';
      case 'jetbrains':
        return '"JetBrains Mono", "Noto Sans Mono CJK TC", "PingFang TC", "Microsoft JhengHei", "Microsoft YaHei", monospace';
      case 'firacode':
        return '"Fira Code", "Fira Mono", "Noto Sans Mono CJK TC", "Microsoft YaHei", monospace';
      case 'sourcecodepro':
        return '"Source Code Pro", "Noto Sans Mono CJK TC", "Microsoft YaHei", monospace';

      case 'auto':
      default:
        return '"Noto Sans Mono CJK TC", "PingFang TC", "Microsoft JhengHei", "Microsoft YaHei", "SimSun", "MingLiU", "WenQuanYi Micro Hei Mono", sans-serif, monospace';
    }
  }

  getRenderFontFamilyString() {
    return `${this.getFontFamilyString()}, "WaterballUAOFallback"`;
  }

  scheduleRedraw() {
    if (this.renderRequested) return;
    this.renderRequested = true;
    const scheduledAt = isDevelopment && terminalDiagnostics.enabled ? performance.now() : null;
    requestAnimationFrame(() => {
      this.renderRequested = false;
      const redrawStartedAt = scheduledAt !== null ? performance.now() : null;
      this.redraw();
      if (scheduledAt !== null) {
        const finishedAt = performance.now();
        terminalDiagnostics.recordRender({
          scheduledToFrameMs: redrawStartedAt - scheduledAt,
          redrawMs: finishedAt - redrawStartedAt,
        });
      }
    });
  }

  getCharWidth(ch, fontSize, ctx) {
    let w = this.measureCache.get(ch);
    if (w === undefined) {
      w = ctx.measureText(ch).width;
      this.measureCache.set(ch, w);
    }
    return w;
  }

  setFontStyle(fontFamily = 'auto', customFont = '', terminalFontScale = this.terminalFontScale) {
    this.fontFamily = fontFamily;
    this.customFont = customFont;
    if (typeof terminalFontScale === 'number' && Number.isFinite(terminalFontScale) && terminalFontScale >= 0.7 && terminalFontScale <= 1.05) {
      this.terminalFontScale = terminalFontScale;
    }
    this.measureCache.clear();
    this.buf.markAllDirty();
    this.scheduleRedraw();
  }

  resize() {
    this.measureCache.clear();
    // Keep a comfortable 4px safe margin on all 4 borders to completely eliminate edge clipping,
    // plus any padding defined on the container (e.g. mobile safe area insets).
    const parentEl = this.wrapper?.parentElement || this.container;
    const containerW = parentEl.clientWidth || 800;
    const containerH = parentEl.clientHeight || 500;
    let padX = 0;
    let padY = 0;
    try {
      const style = window.getComputedStyle(parentEl);
      padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    } catch (_) {}

    const availW = Math.max(100, containerW - padX - 8);
    const availH = Math.max(100, containerH - padY - 8);

    // Lock each terminal cell to an exact integer number of physical pixels (2:1 aspect ratio)
    // so fractional Windows DPI scaling (e.g. 125% / 150%) never lands row clips on subpixel seams.
    const dpr = window.devicePixelRatio || 1;
    const physCellW = Math.max(4, Math.floor(Math.min((availW * dpr) / 80, (availH * dpr) / 48)));
    const physCellH = physCellW * 2;
    const cellW = physCellW / dpr;
    const cellH = physCellH / dpr;

    this.cellW = cellW;
    this.cellH = cellH;

    const canvasW = physCellW * 80;
    const canvasH = physCellH * 24;

    this.canvas.width = canvasW;
    this.canvas.height = canvasH;
    this.canvas.style.width = `${canvasW / dpr}px`;
    this.canvas.style.height = `${canvasH / dpr}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.ctx.textBaseline = 'middle';

    this.buf.markAllDirty();
    this.redraw();
  }

  /**
   * Pixel-exact vector renderer for Box Drawing (U+2500..U+257F), Block Elements (U+2580..U+259F),
   * and solid ANSI triangles (◢◣◥◤). Eliminates cell-grid black seams across Windows fractional DPI
   * and non-monospace fallback fonts (e.g. Microsoft JhengHei in Edge).
   * Note: intentionally uses fillRect / beginPath+stroke/fill (never ctx.rect) to keep clip rects predictable.
   */
  drawBoxOrBlockGlyph(ctx, ch, x1, y1, cellWidth, cellHeight, baseCellW, dpr = 1) {
    if (!ch || ch.length !== 1) return false;
    const code = ch.charCodeAt(0);
    const seamX = Math.max(0.55, 1 / (dpr || 1));
    const seamY = Math.max(0.6, 1 / (dpr || 1));
    const x2 = x1 + cellWidth;
    const y2 = y1 + cellHeight;

    // 1. Solid geometric triangles used in BBS ANSI art
    if (code >= 0x25E2 && code <= 0x25E5) {
      ctx.beginPath();
      if (code === 0x25E2) { // ◢
        ctx.moveTo(x2 + seamX, y1);
        ctx.lineTo(x2 + seamX, y2 + seamY);
        ctx.lineTo(x1, y2 + seamY);
      } else if (code === 0x25E3) { // ◣
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 + seamX, y2 + seamY);
        ctx.lineTo(x1, y2 + seamY);
      } else if (code === 0x25E5) { // ◥
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 + seamX, y1);
        ctx.lineTo(x2 + seamX, y2 + seamY);
      } else { // ◤ (0x25E4)
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 + seamX, y1);
        ctx.lineTo(x1, y2 + seamY);
      }
      ctx.closePath();
      ctx.fill();
      return true;
    }

    // 2. Block Elements (U+2580..U+259F)
    if (code >= 0x2580 && code <= 0x259F) {
      if (code === 0x2588) { // █
        ctx.fillRect(x1, y1, cellWidth + seamX, cellHeight + seamY);
      } else if (code === 0x2580) { // ▀
        const halfH = Math.round(cellHeight / 2);
        ctx.fillRect(x1, y1, cellWidth + seamX, halfH + seamY * 0.5);
      } else if (code >= 0x2581 && code <= 0x2587) { // ▁..▇
        const bh = Math.max(1, Math.round(cellHeight * ((code - 0x2580) / 8)));
        ctx.fillRect(x1, y1 + cellHeight - bh, cellWidth + seamX, bh + seamY);
      } else if (code >= 0x2589 && code <= 0x258F) { // ▉..▏
        const bw = Math.max(1, Math.round(cellWidth * ((0x2590 - code) / 8)));
        ctx.fillRect(x1, y1, bw, cellHeight + seamY);
      } else if (code === 0x2590) { // ▐
        const halfW = Math.round(cellWidth / 2);
        ctx.fillRect(x1 + halfW, y1, cellWidth - halfW + seamX, cellHeight + seamY);
      } else if (code >= 0x2591 && code <= 0x2593) { // ░▒▓
        const alpha = (code - 0x2590) * 0.25;
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.fillRect(x1, y1, cellWidth + seamX, cellHeight + seamY);
        ctx.restore();
      } else if (code === 0x2594) { // ▔
        const th = Math.max(1, Math.round(cellHeight / 8));
        ctx.fillRect(x1, y1, cellWidth + seamX, th);
      } else if (code === 0x2595) { // ▕
        const rw = Math.max(1, Math.round(cellWidth / 8));
        ctx.fillRect(x1 + cellWidth - rw, y1, rw + seamX, cellHeight + seamY);
      } else { // ▖..▟ (0x2596..0x259F)
        const mask = QUADRANT_MASKS[code - 0x2596];
        const leftW = Math.round(cellWidth / 2);
        const rightW = cellWidth - leftW + seamX;
        const topH = Math.round(cellHeight / 2);
        const botH = cellHeight - topH + seamY;
        if (mask & 1) ctx.fillRect(x1, y1, leftW + 0.1, topH + 0.1);
        if (mask & 2) ctx.fillRect(x1 + leftW, y1, rightW, topH + 0.1);
        if (mask & 4) ctx.fillRect(x1, y1 + topH, leftW + 0.1, botH);
        if (mask & 8) ctx.fillRect(x1 + leftW, y1 + topH, rightW, botH);
      }
      return true;
    }

    // 3. Box Drawing (U+2500..U+257F)
    if (code < 0x2500 || code > 0x257F) return false;

    const lightW = Math.max(1, Math.round(Math.min(baseCellW, cellHeight) * 0.08));
    const heavyW = Math.max(2, lightW * 2);
    const hl = lightW / 2;
    const cx = x1 + cellWidth / 2;
    const cy = y1 + cellHeight / 2;

    if (code >= 0x256D && code <= 0x2570) { // Rounded corners ╭╮╯╰
      const r = Math.min(cellWidth, cellHeight) * 0.35;
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = lightW;
      ctx.beginPath();
      if (code === 0x256D) {
        ctx.moveTo(cx, y2 + seamY);
        if (typeof ctx.arcTo === 'function') ctx.arcTo(cx, cy, x2 + seamX, cy, r);
        ctx.lineTo(x2 + seamX, cy);
      } else if (code === 0x256E) {
        ctx.moveTo(x1 - seamX * 0.5, cy);
        if (typeof ctx.arcTo === 'function') ctx.arcTo(cx, cy, cx, y2 + seamY, r);
        ctx.lineTo(cx, y2 + seamY);
      } else if (code === 0x256F) {
        ctx.moveTo(cx, y1 - seamY * 0.5);
        if (typeof ctx.arcTo === 'function') ctx.arcTo(cx, cy, x1 - seamX * 0.5, cy, r);
        ctx.lineTo(x1 - seamX * 0.5, cy);
      } else {
        ctx.moveTo(cx, y1 - seamY * 0.5);
        if (typeof ctx.arcTo === 'function') ctx.arcTo(cx, cy, x2 + seamX, cy, r);
        ctx.lineTo(x2 + seamX, cy);
      }
      ctx.stroke();
      ctx.restore();
      return true;
    }

    if (code >= 0x2571 && code <= 0x2573) { // Diagonals ╱╲╳
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = lightW;
      ctx.beginPath();
      if (code === 0x2571 || code === 0x2573) {
        ctx.moveTo(x1, y2 + seamY * 0.5);
        ctx.lineTo(x2 + seamX * 0.5, y1);
      }
      if (code === 0x2572 || code === 0x2573) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 + seamX * 0.5, y2 + seamY * 0.5);
      }
      ctx.stroke();
      ctx.restore();
      return true;
    }

    const dashed = DASHED_BOX_MAP[code];
    if (dashed) {
      const [axis, weight, count] = dashed;
      const thick = weight === 2 ? heavyW : lightW;
      if (axis === 'H') {
        const step = cellWidth / count;
        const dashW = Math.max(1, step * 0.65);
        const offset = (step - dashW) / 2;
        for (let i = 0; i < count; i++) {
          ctx.fillRect(x1 + i * step + offset, cy - thick / 2, dashW, thick);
        }
      } else {
        const step = cellHeight / count;
        const dashH = Math.max(1, step * 0.65);
        const offset = (step - dashH) / 2;
        for (let i = 0; i < count; i++) {
          ctx.fillRect(cx - thick / 2, y1 + i * step + offset, thick, dashH);
        }
      }
      return true;
    }

    const arms = BOX_ARM_MAP[code];
    if (!arms) return false;

    const u = Number(arms[0]);
    const r = Number(arms[1]);
    const d = Number(arms[2]);
    const l = Number(arms[3]);
    const thickOf = (w) => (w === 2 ? heavyW : w === 1 ? lightW : 0);
    const drawV = (xc, thick, ys, ye) => ctx.fillRect(xc - thick / 2, ys, thick, Math.max(0, ye - ys));
    const drawH = (yc, thick, xs, xe) => ctx.fillRect(xs, yc - thick / 2, Math.max(0, xe - xs), thick);

    if (u < 3 && r < 3 && d < 3 && l < 3) {
      const maxH = Math.max(thickOf(l), thickOf(r));
      const maxV = Math.max(thickOf(u), thickOf(d));
      if (u) drawV(cx, thickOf(u), y1 - seamY * 0.5, cy + maxH / 2);
      if (d) drawV(cx, thickOf(d), cy - maxH / 2, y2 + seamY);
      if (l) drawH(cy, thickOf(l), x1 - seamX * 0.5, cx + maxV / 2);
      if (r) drawH(cy, thickOf(r), cx - maxV / 2, x2 + seamX);
      return true;
    }

    // Double-line combinations (═║╔╗╚╝╠╣╦╩╬╞╟╡╢╤╥╧╨╪╫...)
    const off = Math.max(2, Math.round(Math.min(baseCellW, cellHeight) * 0.14));
    const yTop = y1 - seamY * 0.5;
    const yBot = y2 + seamY;
    const xLeft = x1 - seamX * 0.5;
    const xRight = x2 + seamX;

    if (u === 3) {
      drawV(cx - off, lightW, yTop, l === 3 ? cy - off + hl : l > 0 ? cy + hl : d === 3 ? cy + hl : r === 3 ? cy + off + hl : cy + hl);
      drawV(cx + off, lightW, yTop, r === 3 ? cy - off + hl : r > 0 ? cy + hl : d === 3 ? cy + hl : l === 3 ? cy + off + hl : cy + hl);
    } else if (u > 0) {
      const yEnd = (l === 3 && r === 3 && !d) ? cy - off + hl : (!d && (l === 3 || r === 3)) ? cy + off + hl : cy + hl;
      drawV(cx, thickOf(u), yTop, yEnd);
    }

    if (d === 3) {
      drawV(cx - off, lightW, l === 3 ? cy + off - hl : l > 0 ? cy - hl : u === 3 ? cy - hl : r === 3 ? cy - off - hl : cy - hl, yBot);
      drawV(cx + off, lightW, r === 3 ? cy + off - hl : r > 0 ? cy - hl : u === 3 ? cy - hl : l === 3 ? cy - off - hl : cy - hl, yBot);
    } else if (d > 0) {
      const yStart = (l === 3 && r === 3 && !u) ? cy + off - hl : (!u && (l === 3 || r === 3)) ? cy - off - hl : cy - hl;
      drawV(cx, thickOf(d), yStart, yBot);
    }

    if (l === 3) {
      drawH(cy - off, lightW, xLeft, u === 3 ? cx - off + hl : u > 0 ? cx + hl : r === 3 ? cx + hl : d === 3 ? cx + off + hl : cx + hl);
      drawH(cy + off, lightW, xLeft, d === 3 ? cx - off + hl : d > 0 ? cx + hl : r === 3 ? cx + hl : u === 3 ? cx + off + hl : cx + hl);
    } else if (l > 0) {
      const xEnd = (u === 3 && d === 3 && !r) ? cx - off + hl : (!r && (u === 3 || d === 3)) ? cx + off + hl : cx + hl;
      drawH(cy, thickOf(l), xLeft, xEnd);
    }

    if (r === 3) {
      drawH(cy - off, lightW, u === 3 ? cx + off - hl : u > 0 ? cx - hl : l === 3 ? cx - hl : d === 3 ? cx - off - hl : cx - hl, xRight);
      drawH(cy + off, lightW, d === 3 ? cx + off - hl : d > 0 ? cx - hl : l === 3 ? cx - hl : u === 3 ? cx - off - hl : cx - hl, xRight);
    } else if (r > 0) {
      const xStart = (u === 3 && d === 3 && !l) ? cx + off - hl : (!l && (u === 3 || d === 3)) ? cx - off - hl : cx - hl;
      drawH(cy, thickOf(r), xStart, xRight);
    }

    return true;
  }

  redraw(forceFull = false) {
    const ctx = this.ctx;
    const buf = this.buf;
    const cellW = this.cellW;
    const cellH = this.cellH;
    const cols = buf.cols;
    const rows = buf.rows;

    if (this.hoverUrl?.repairRows) {
      const current = this.getAccessibleUrlAt(this.hoverUrl.startCol, this.hoverUrl.row);
      if (!current || current.url !== this.hoverUrl.url) {
        this.hoverUrl = null;
        this.onUrlLeave?.();
      }
    }

    if (forceFull) {
      buf.markAllDirty();
    }

    // Only mark previous and current cursor rows dirty if cursor position actually changed
    const cursorMoved = (this.lastCursorX !== buf.cur_x || this.lastCursorY !== buf.cur_y);
    if (cursorMoved) {
      if (this.lastCursorY >= 0 && this.lastCursorY < rows) {
        buf.markRowDirty(this.lastCursorY);
      }
      buf.markRowDirty(buf.cur_y);
    }

    // Mark selection rows dirty if selection was present or changed
    if (this.lastSelection) {
      buf.markRowsDirty(this.lastSelection.startY, this.lastSelection.endY);
    }
    if (this.selection) {
      buf.markRowsDirty(this.selection.startY, this.selection.endY);
    }

    // Mark hover URL row dirty if hover changed
    if (this.lastHoverUrl && this.lastHoverUrl.row >= 0 && this.lastHoverUrl.row < rows) {
      buf.markRowDirty(this.lastHoverUrl.row);
    }
    if (this.hoverUrl && this.hoverUrl.row >= 0 && this.hoverUrl.row < rows) {
      buf.markRowDirty(this.hoverUrl.row);
    }

    // When blink state changes, mark rows with blinking characters dirty
    if (this.blinkState !== this.lastBlinkState) {
      for (let r = 0; r < rows; r++) {
        const line = buf.lines[r];
        for (let c = 0; c < cols; c++) {
          if (line[c].blink) {
            buf.markRowDirty(r);
            break;
          }
        }
      }
    }

    const fontScale = (typeof this.terminalFontScale === 'number' && Number.isFinite(this.terminalFontScale))
      ? this.terminalFontScale
      : 0.92;
    const fontSize = Math.floor(cellH * fontScale);
    ctx.font = `${fontSize}px ${this.getRenderFontFamilyString()}`;
    ctx.textBaseline = 'middle';

    ctx.globalAlpha = 1;
    const filterScreenState = this.getBbsState();
    // 0. Clear entire canvas background to completely eliminate ghost cursors and screen residuals
    const dpr = window.devicePixelRatio || 1;
    const scaleX = (this.canvas.width && cellW > 0) ? (this.canvas.width / (cellW * cols)) : dpr;
    const scaleY = (this.canvas.height && cellH > 0) ? (this.canvas.height / (cellH * rows)) : dpr;
    const snapX = (v) => Math.round(v * scaleX) / scaleX;
    const snapY = (v) => Math.round(v * scaleY) / scaleY;
    const logicalW = this.canvas.width / dpr;
    const logicalH = this.canvas.height / dpr;

    ctx.clearRect(0, 0, logicalW, logicalH);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, logicalW, logicalH);

    for (let r = 0; r < rows; r++) {
      ctx.save();
      try {
        const clipY = snapY(r * cellH);
        const clipY2 = snapY((r + 1) * cellH);
        const clipHeight = clipY2 - clipY;
        ctx.beginPath();
        ctx.rect(0, clipY, logicalW, clipHeight);
        ctx.clip();
        const meta = this.getRowMetadata(r, filterScreenState);
        const isBlacklisted = meta.isBlacklisted && this.revealedBlacklistRows?.get(r) !== meta.key;
        const mode = blacklistManager.getMode();

        if (isBlacklisted) {
          if (mode === 'hide') {
            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, clipY, logicalW, clipHeight);
            ctx.fillStyle = '#3a3a3a';
            ctx.font = `italic ${Math.round(cellH * 0.58)}px sans-serif`;
            ctx.fillText(`[🚫 黑名單已隱藏: ${meta.reason}]`, 12, clipY + cellH * 0.52);
            ctx.font = `${fontSize}px ${this.getRenderFontFamilyString()}`;
            continue;
          } else if (mode === 'mask') {
            ctx.fillStyle = '#111111';
            ctx.fillRect(0, clipY, logicalW, clipHeight);
            ctx.fillStyle = '#6b7280';
            ctx.font = `italic ${Math.round(cellH * 0.58)}px sans-serif`;
            ctx.fillText(`[🛡️ 遮蔽黑名單行: ${meta.reason}]`, 12, clipY + cellH * 0.52);
            ctx.font = `${fontSize}px ${this.getRenderFontFamilyString()}`;
            continue;
          } else {
            ctx.globalAlpha = 0.20;
          }
        }

        const line = buf.lines[r];
        const y1 = clipY;
        const y2 = clipY2;
        const cellHeight = clipHeight;
        const centerY = y1 + cellHeight * 0.52;

        // 1. Draw continuous background spans (snapped to physical pixels)
        let bgStartCol = 0;
        let curBg = line[0].getBg();

        for (let c = 1; c <= cols; c++) {
          const bg = (c < cols) ? line[c].getBg() : -1;
          if (bg !== curBg) {
            if (curBg !== 0) {
              const x1 = snapX(bgStartCol * cellW);
              const x2 = snapX(c * cellW);
              ctx.fillStyle = typeof curBg === 'string' ? curBg : (TERM_COLORS[curBg] || '#000000');
              ctx.fillRect(x1, y1, x2 - x1, cellHeight + 0.6 / scaleY);
            }
            bgStartCol = c;
            curBg = bg;
          }
        }

        // 2. Draw foreground characters & ANSI blocks
        for (let c = 0; c < cols; c++) {
          const cell = line[c];
          // Only skip trail byte if it is actually preceded by a valid lead byte
          if (cell.isTrailByte && c > 0 && line[c - 1].isLeadByte) continue;

          // Verify that lead byte is genuinely followed by a trail byte before spanning 2 cells
          const isLead = cell.isLeadByte && (c + 1 < cols) && !!line[c + 1].isTrailByte;

          const x1 = snapX(c * cellW);
          const x2 = snapX((c + (isLead ? 2 : 1)) * cellW);
          const cellWidth = x2 - x1;

          const fgVal = cell.getFg();
          const fgCol = typeof fgVal === 'string' ? fgVal : (TERM_COLORS[fgVal] || '#ffffff');

          // Draw character
          if (cell.ch && cell.ch !== ' ') {
            const trailCell = isLead ? line[c + 1] : null;
            const splitGlyph = trailCell &&
              (trailCell.getFg() !== fgVal || trailCell.blink !== cell.blink);
            for (let half = 0; half < (splitGlyph ? 2 : 1); half++) {
              const halfCell = half === 0 ? cell : trailCell;
              if (halfCell.blink && !this.blinkState) continue;
              if (splitGlyph) {
                ctx.save();
                ctx.beginPath();
                const clipStart = snapX((c + half) * cellW);
                const clipEnd = snapX((c + half + 1) * cellW);
                ctx.rect(clipStart, y1, clipEnd - clipStart, cellHeight);
                ctx.clip();
              }
              const halfFg = halfCell.getFg();
              ctx.fillStyle = half === 0 ? fgCol
                : typeof halfFg === 'string' ? halfFg : (TERM_COLORS[halfFg] || '#ffffff');

              // Direct pixel-perfect vector drawing for BBS Box Drawing, Block Elements & triangles (zero seams)
              if (this.drawBoxOrBlockGlyph(ctx, cell.ch, x1, y1, cellWidth, cellHeight, cellW, dpr)) {
                // Vector glyph rendered directly
              } else if (isLead) {
                // Full-width character (CJK / special symbols): preserve natural aspect ratio without horizontal stretching
                const charW = this.getCharWidth(cell.ch, fontSize, ctx);
                if (charW > cellWidth + 0.5) {
                  // If it overflows 2 cells, scale down horizontally to fit
                  const scaleX = cellWidth / charW;
                  ctx.save();
                  ctx.translate(x1, centerY);
                  ctx.scale(scaleX, 1);
                  ctx.fillText(cell.ch, 0, 0);
                  ctx.restore();
                } else {
                  // Natural aspect ratio: center inside the 2-cell width without stretching
                  const offsetX = Math.max(0, (cellWidth - charW) * 0.5);
                  ctx.fillText(cell.ch, x1 + offsetX, centerY);
                }
              } else {
                // Single-width character (ASCII): center inside cellWidth
                const charW = this.getCharWidth(cell.ch, fontSize, ctx);
                if (charW > cellWidth + 0.5) {
                  const scaleX = cellWidth / charW;
                  ctx.save();
                  ctx.translate(x1, centerY);
                  ctx.scale(scaleX, 1);
                  ctx.fillText(cell.ch, 0, 0);
                  ctx.restore();
                } else {
                  ctx.fillText(cell.ch, x1 + (cellWidth - charW) * 0.5, centerY);
                }
              }
              if (splitGlyph) ctx.restore();
            }
          }

          // Draw underline
          if (cell.underLine) {
            ctx.strokeStyle = fgCol;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, y2 - 1.5);
            ctx.lineTo(x2, y2 - 1.5);
            ctx.stroke();
          }
        }

        // 3. Highlight and Underline clickable URLs in this row
        const urls = this.getCachedRowUrls(r);
        for (const u of urls) {
          // Repaired links are hit-testing assistance only; preserve native
          // terminal colors/underlines even before or during hover.
          if (u.repaired || u.isContinuation || u.repairRows?.some(row => this.isRowMasked(row, filterScreenState))) continue;
          const x1 = Math.round(u.startCol * cellW);
          const x2 = Math.round((u.endCol + 1) * cellW);
          const width = x2 - x1;
          const isHovered = this.hoverUrl && this.hoverUrl.row === r && this.hoverUrl.startCol === u.startCol;

          if (isHovered) {
            ctx.fillStyle = 'rgba(88, 166, 255, 0.25)';
            ctx.fillRect(x1, y1, width, cellHeight);

            ctx.strokeStyle = '#58a6ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x1, y2 - 1.5);
            ctx.lineTo(x2, y2 - 1.5);
            ctx.stroke();
          } else {
            ctx.fillStyle = 'rgba(88, 166, 255, 0.08)';
            ctx.fillRect(x1, y1, width, cellHeight);

            ctx.strokeStyle = 'rgba(88, 166, 255, 0.75)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(x1, y2 - 1.5);
            ctx.lineTo(x2, y2 - 1.5);
            ctx.stroke();
          }
        }

      } finally {
        ctx.restore();
      }
    }

    // Show the active mouse hotspot like a lightweight terminal cursor.
    if (this.hoverAction && !this.isRowMasked(this.hoverAction.row, filterScreenState)) {
      const a = this.hoverAction;
      const x1 = Math.round(a.startCol * cellW) + 1;
      const x2 = Math.round((a.endCol + 1) * cellW) - 1;
      const y1 = Math.round(a.row * cellH) + 1;
      const y2 = Math.round((a.row + 1) * cellH) - 1;
      ctx.fillStyle = a.type === 'article' ? 'rgba(88, 166, 255, 0.18)' : 'rgba(255, 209, 102, 0.22)';
      ctx.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
      ctx.strokeStyle = a.type === 'article' ? '#58a6ff' : '#ffd166';
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
    }

    // Draw in-screen Search Highlights
    if (this.searchMatches && this.searchMatches.length > 0) {
      for (let i = 0; i < this.searchMatches.length; i++) {
        const m = this.searchMatches[i];
        if (this.isRowMasked(m.row, filterScreenState)) continue;
        const mx1 = Math.round(m.startCol * cellW);
        const mx2 = Math.round((m.endCol + 1) * cellW);
        const mw = mx2 - mx1;
        const my1 = Math.round(m.row * cellH);
        const my2 = Math.round((m.row + 1) * cellH);
        const mh = my2 - my1;
        const isActive = (i === this.activeSearchIndex);

        if (isActive) {
          // Active match: bright orange highlight with border
          ctx.fillStyle = 'rgba(255, 140, 0, 0.75)';
          ctx.fillRect(mx1, my1, mw, mh);

          ctx.strokeStyle = '#a0a0a0';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(mx1 + 0.5, my1 + 0.5, mw - 1, mh - 1);
        } else {
          // Other matches: yellow highlight
          ctx.fillStyle = 'rgba(255, 235, 59, 0.42)';
          ctx.fillRect(mx1, my1, mw, mh);
        }
      }
    }

    // Draw text selection overlay
    if (this.selection) {
      let { startX: sX, startY: sY, endX: eX, endY: eY } = this.selection;
      if (sY > eY || (sY === eY && sX > eX)) {
        [sX, sY, eX, eY] = [eX, eY, sX, sY];
      }

      ctx.fillStyle = 'rgba(88, 166, 255, 0.38)';
      for (let r = sY; r <= eY; r++) {
        const colStart = (r === sY) ? Math.max(0, sX) : 0;
        const colEnd = (r === eY) ? Math.min(cols - 1, eX) : cols - 1;
        const sx1 = snapX(colStart * cellW);
        const sx2 = snapX((colEnd + 1) * cellW);
        const sy1 = snapY(r * cellH);
        const sy2 = snapY((r + 1) * cellH);
        ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
      }
    }

    // 1. Check if the screen is in Article / Mail Editor mode (via precise row 23 editor signatures)
    let isEditorScreen = false;
    const footerStart = Math.max(0, buf.rows - 3);
    let footerText = '';
    for (let r = footerStart; r < buf.rows; r++) {
      const line = buf.lines[r];
      if (!line) continue;
      for (let c = 0; c < buf.cols; c++) {
        footerText += line[c]?.ch || '';
      }
    }
    if (footerText) {
      if (
        footerText.includes('每行最多可容納') ||
        footerText.includes('(Ctrl+X)') ||
        footerText.includes('^X 發表') ||
        footerText.includes('^X 寄出') ||
        footerText.includes('^X 存檔') ||
        footerText.includes('^X發表') ||
        footerText.includes('^X寄出') ||
        footerText.includes('^X存檔') ||
        footerText.includes('檔案處理') ||
        footerText.includes('(Ctrl+W)') ||
        footerText.includes('請輸入推文') ||
        footerText.includes('【推文】') ||
        /推文\s*[:：]|噓文\s*[:：]/.test(footerText) ||
        /→\s*[A-Za-z0-9_-]{1,16}\s*[:：]/.test(footerText) ||
        footerText.includes('請輸入標題') ||
        footerText.includes('請輸入：') ||
        footerText.includes('請輸入密碼') ||
        footerText.includes('Ctrl-X') ||
        footerText.includes('確定要儲存變更嗎') ||
        footerText.includes('[Y/S]儲存') ||
        footerText.includes('以上資料是否正確') ||
        footerText.includes('確定要放棄填寫嗎')
      ) {
        isEditorScreen = true;
      }
    }

    // 2. Draw cursor.
    let shouldDrawCursor = false;
    if (buf.cursorVisible && this.cursorStyle !== 'none') {
      if (this.cursorStyle !== 'smart' || isEditorScreen) {
        // In editor mode or non-smart modes, ALWAYS display the cursor!
        shouldDrawCursor = true;
      } else {
        // In menu / list screens: check if the current row contains a BBS menu/list selector icon or (F) hotkey pattern
        let hasMenuPointerOnRow = false;
        const line = buf.lines[buf.cur_y];
        if (line) {
          let lineStr = '';
          for (let c = 0; c < buf.cols; c++) {
            const ch = line[c]?.ch || ' ';
            lineStr += ch;
            if (ch === '●' || ch === '○' || ch === '★' || ch === '☆' || ch === '◆' || ch === '◇' || ch === '▶' || ch === '▷' || ch === '>' || ch === '→') {
              hasMenuPointerOnRow = true;
            }
          }
          // Keep cursor visible inside vform In-place form fields (`> 欄位名稱: [內容]`)
          if (/^\s*>\s*[^:：]+[:：]\s*\[.*\]/.test(lineStr)) {
            hasMenuPointerOnRow = false;
          } else if (!hasMenuPointerOnRow && (/\([A-Za-z0-9]\)/.test(lineStr) || /\[[A-Za-z0-9]\]/.test(lineStr)) && (
            lineStr.includes('【') || lineStr.includes('】') || lineStr.includes('Menu') || lineStr.includes('主功能表') || lineStr.includes('分組討論區') || lineStr.includes('看板') || lineStr.includes('郵件') || lineStr.includes('設定') || lineStr.includes('偏好設定') || lineStr.includes('我的最愛')
          )) {
            hasMenuPointerOnRow = true;
          }
        }
        if (!hasMenuPointerOnRow) {
          shouldDrawCursor = true;
        }
      }
    }

    if (shouldDrawCursor) {
      const curX = Math.round(buf.cur_x * cellW);
      const curY = Math.round(buf.cur_y * cellH);
      const width = Math.round(cellW);
      const height = Math.round(cellH);
      const style = (this.cursorStyle === 'smart') ? 'underline' : (this.cursorStyle || 'underline');

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';

      if (style === 'underline') {
        // Crisp bottom underline (never obscures text)
        const lineH = Math.max(2, Math.round(height * 0.15));
        ctx.fillRect(curX, curY + height - lineH, width, lineH);
      } else if (style === 'hollow') {
        // Hollow outline box
        ctx.lineWidth = 1.5;
        ctx.strokeRect(curX + 0.5, curY + 0.5, width - 1, height - 1);
      } else if (style === 'bar') {
        // Vertical I-Beam / Bar
        const barW = Math.max(2, Math.round(width * 0.2));
        ctx.fillRect(curX, curY, barW, height);
      } else if (style === 'block') {
        // Traditional semi-transparent block
        ctx.globalAlpha = 0.6;
        ctx.fillRect(curX, curY, width, height);
        ctx.globalAlpha = 1.0;
      }
    }

    this.updateImePosition();

    // Update tracking cache for differential rendering
    this.lastCursorX = buf.cur_x;
    this.lastCursorY = buf.cur_y;
    this.lastSelection = this.selection ? { ...this.selection } : null;
    this.lastHoverUrl = this.hoverUrl ? { ...this.hoverUrl } : null;
    this.lastBlinkState = this.blinkState;

    buf.clearDirty();
  }

  setCursorStyle(style = 'underline') {
    this.cursorStyle = style;
    this.buf.markAllDirty();
    this.redraw();
  }

  setSearchResults(matches, activeIndex = -1) {
    this.searchMatches = matches || [];
    this.activeSearchIndex = activeIndex;
    this.buf.markAllDirty();
    this.redraw();
  }

  clearSearch() {
    this.searchMatches = [];
    this.activeSearchIndex = -1;
    this.buf.markAllDirty();
    this.redraw();
  }

  destroy() {
    if (this.blinkTimer) clearInterval(this.blinkTimer);
    if (this.blacklistListener) blacklistManager.removeListener(this.blacklistListener);
  }
}
