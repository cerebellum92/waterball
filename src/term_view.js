import { TERM_COLORS } from './term_buf.js';
import { blacklistManager } from './blacklist.js';

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
    this.cursorStyle = 'smart';

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
    this.hoverAction = null;
    this.mouseBrowsingEnabled = true;

    // Differential rendering state cache
    this.lastCursorX = -1;
    this.lastCursorY = -1;
    this.lastSelection = null;
    this.lastBlinkState = true;

    this.onUrlClick = null;
    this.onUrlHover = null;
    this.onUrlLeave = null;
    this.onWheel = null;
    this.onSelectionChange = null;
    this.onArticleClick = null;
    this.onBoardClick = null;
    this.onShortcutClick = null;

    this.initMouseEvents();

    this.buf.onUpdate = () => {
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

  initMouseEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left click
        const pos = this.getGridPos(e);
        this.isSelecting = true;
        this.isDragging = false;
        this.mouseDownPos = pos;
        this.mouseDownPixel = { x: e.clientX, y: e.clientY };
        this.selection = null;
        this.redraw();
      }
    });

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
        this.onSelectionChange?.(this.selection);
        this.redraw();
      } else {
        // Check URL hover when not selecting
        const rect = this.canvas.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          const pos = this.getGridPos(e);
          const url = this.buf.findUrlAt(pos.col, pos.row);
          if (url) {
            this.canvas.style.cursor = 'pointer';
            if (this.hoverAction) {
              this.hoverAction = null;
              this.redraw();
            }
            if (!this.hoverUrl || this.hoverUrl.raw !== url.raw || this.hoverUrl.row !== url.row) {
              this.hoverUrl = url;
              this.redraw();
            }
            this.onUrlHover?.(url.url, e.clientX, e.clientY);
          } else {
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
          }
        } else if (this.hoverUrl) {
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
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isSelecting) {
        this.isSelecting = false;
        if (!this.isDragging && this.mouseDownPos) {
          const url = this.buf.findUrlAt(this.mouseDownPos.col, this.mouseDownPos.row);
          if (url) {
            this.onUrlClick?.(url.url);
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

  getRowMetadata(r) {
    if (!this.rowMetadataCache) {
      this.rowMetadataCache = new Map();
    }
    // If not dirty and cached, return cached metadata immediately
    if (!this.buf.dirtyRows[r] && this.rowMetadataCache.has(r)) {
      return this.rowMetadataCache.get(r);
    }

    const line = this.buf.lines[r];
    if (!line) return { author: null, isBlacklisted: false };

    let lineStr = '';
    for (let c = 0; c < this.buf.cols; c++) {
      const cell = line[c];
      if (!cell || cell.isTrailByte) continue;
      lineStr += cell.ch || ' ';
    }

    let author = null;
    // Match PTT article row pattern: e.g. " 1234 + 9/02 username □ [標題]" or " 1234 爆 9/02 username □"
    const match = lineStr.match(/^\s*\d+\s+([+爆M~!\d\s]+)?\s*\d{1,2}\/\d{1,2}\s+([a-zA-Z0-9_-]+)/);
    if (match && match[2]) {
      author = match[2];
    } else {
      // Also match PTT Push row pattern: "推 username: " or "噓 username: " or "→ username: "
      const pushMatch = lineStr.match(/^([推噓→])\s+([a-zA-Z0-9_-]+)\s*[:：]/);
      if (pushMatch && pushMatch[2]) {
        author = pushMatch[2];
      }
    }

    const isBlacklisted = author ? blacklistManager.isBlacklisted(author) : false;
    const meta = { author, isBlacklisted };
    this.rowMetadataCache.set(r, meta);
    return meta;
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
    if (/【精華文章】|【功能鍵】/.test(text)) return false;

    // PTT's usual format: article number, score/status, date, author...
    if (/^\s*\d+\s+([+爆M~!\d\s]+)?\s*\d{1,2}\/\d{1,2}\s+[a-zA-Z0-9_-]+/.test(text)) {
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
    const whole = rows.join('\n');
    let articleRows = 0;
    for (let r = 0; r < this.buf.rows; r++) {
      if (this.isArticleListRow(r)) articleRows++;
    }

    if (/每行最多可容納|編輯文章|請輸入標題|請輸入密碼|\(Ctrl\+X\)|\^X\s*(?:發表|寄出|存檔)/.test(bottom)) {
      return 'compose';
    }
    if (this.getWaitingPromptRow() >= 0) {
      return 'waiting-enter';
    }
    if (
      articleRows >= 2 &&
      (/目前顯示\s*[:：]|【看板列表】|文章列表|版主|板主|看板/.test(top + bottom) ||
        /目前顯示\s*[:：]|【看板列表】|文章列表/.test(whole))
    ) {
      return 'article-list';
    }
    if (/看板列表|討論區列表|个人定制区|板板列表/.test(top)) return 'board-list';
    if (/好朋友列表|使用者列表|休閒聊天/.test(top)) return 'friend-list';
    if (/處理信箋選單|電子郵件|邮件选单/.test(top)) return 'mail-list';
    if (/閱讀文章|主題閱讀|同作者閱讀|下面還有喔|瀏覽\s+第/.test(bottom)) return 'reading';
    if (/主功能表|聊天說話|個人設定|工具程式|網路遊樂場|目前\s*[:：]?/.test(top)) return 'main-menu';

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

  isPttArticleListScreen() {
    return this.getBbsState() === 'article-list';
  }

  getRowAuthor(r) {
    return this.getRowMetadata(r).author;
  }

  isRowBlacklisted(r) {
    return this.getRowMetadata(r).isBlacklisted;
  }

  getCachedRowUrls(r) {
    if (!this.buf.dirtyRows[r] && this.rowUrlCache.has(r)) {
      return this.rowUrlCache.get(r);
    }
    const urls = this.buf.getUrlsInRow(r);
    this.rowUrlCache.set(r, urls);
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

  clearSelection() {
    this.selection = null;
    this.redraw();
  }

  getSelectionText() {
    if (!this.selection) return '';
    return this.buf.getText(
      this.selection.startX,
      this.selection.startY,
      this.selection.endX,
      this.selection.endY
    );
  }

  getSelectionAnsi() {
    if (!this.selection) return '';
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
    requestAnimationFrame(() => {
      this.renderRequested = false;
      this.redraw();
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

  setFontStyle(fontFamily = 'auto', customFont = '') {
    this.fontFamily = fontFamily;
    this.customFont = customFont;
    this.measureCache.clear();
    this.buf.markAllDirty();
    this.scheduleRedraw();
  }

  resize() {
    this.measureCache.clear();
    // Keep a comfortable 4px safe margin on all 4 borders to completely eliminate edge clipping
    const containerW = this.container.clientWidth || 800;
    const containerH = this.container.clientHeight || 500;
    const availW = Math.max(100, containerW - 8);
    const availH = Math.max(100, containerH - 8);

    const cellW_fromW = availW / 80;
    const cellH_fromW = cellW_fromW * 2;
    const cellH_fromH = availH / 24;
    const cellW_fromH = cellH_fromH / 2;

    let cellW, cellH;
    if (cellH_fromW * 24 <= availH) {
      cellW = Math.max(4, cellW_fromW);
      cellH = Math.max(8, cellH_fromW);
    } else {
      cellW = Math.max(4, cellW_fromH);
      cellH = Math.max(8, cellH_fromH);
    }

    this.cellW = cellW;
    this.cellH = cellH;

    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(cellW * 80);
    const targetH = Math.round(cellH * 24);

    this.canvas.width = targetW * dpr;
    this.canvas.height = targetH * dpr;
    this.canvas.style.width = `${targetW}px`;
    this.canvas.style.height = `${targetH}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.ctx.textBaseline = 'middle';

    this.buf.markAllDirty();
    this.redraw();
  }

  redraw(forceFull = false) {
    const ctx = this.ctx;
    const buf = this.buf;
    const cellW = this.cellW;
    const cellH = this.cellH;
    const cols = buf.cols;
    const rows = buf.rows;

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

    const fontSize = Math.floor(cellH * 0.82);
    ctx.font = `${fontSize}px ${this.getRenderFontFamilyString()}`;
    ctx.textBaseline = 'middle';

    // 0. Clear entire canvas background to completely eliminate ghost cursors and screen residuals
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

    for (let r = 0; r < rows; r++) {
      const isBlacklisted = this.isRowBlacklisted(r);
      if (isBlacklisted) {
        ctx.globalAlpha = 0.22;
      }

      const line = buf.lines[r];
      const y1 = Math.round(r * cellH);
      const y2 = Math.round((r + 1) * cellH);
      const cellHeight = y2 - y1;
      const centerY = y1 + Math.round(cellHeight * 0.52);

      // 1. Draw continuous background spans (100% eliminates fractional DPI grid lines)
      let bgStartCol = 0;
      let curBg = line[0].getBg();

      for (let c = 1; c <= cols; c++) {
        const bg = (c < cols) ? line[c].getBg() : -1;
        if (bg !== curBg) {
          if (curBg !== 0) {
            const x1 = Math.round(bgStartCol * cellW);
            const x2 = Math.round(c * cellW);
            ctx.fillStyle = typeof curBg === 'string' ? curBg : (TERM_COLORS[curBg] || '#000000');
            ctx.fillRect(x1, y1, x2 - x1, cellHeight + 0.6);
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

        const x1 = Math.round(c * cellW);
        const x2 = Math.round((c + (isLead ? 2 : 1)) * cellW);
        const cellWidth = x2 - x1;

        const fgVal = cell.getFg();
        const fgCol = typeof fgVal === 'string' ? fgVal : (TERM_COLORS[fgVal] || '#ffffff');

        // Draw character
        if (cell.ch && cell.ch !== ' ') {
          if (!cell.blink || this.blinkState) {
            ctx.fillStyle = fgCol;

            // Direct pixel-perfect solid block drawing for BBS ANSI art (zero seams)
            if (cell.ch === '█') {
              ctx.fillRect(x1, y1, cellWidth + 0.5, cellHeight + 0.6);
            } else if (cell.ch === '▀') {
              const halfH = Math.round(cellHeight / 2);
              ctx.fillRect(x1, y1, cellWidth + 0.5, halfH + 0.3);
            } else if (cell.ch === '▄') {
              const halfH = Math.round(cellHeight / 2);
              ctx.fillRect(x1, y1 + halfH, cellWidth + 0.5, cellHeight - halfH + 0.6);
            } else if (cell.ch === '▌') {
              const halfW = Math.round(cellWidth / 2);
              ctx.fillRect(x1, y1, halfW, cellHeight + 0.6);
            } else if (cell.ch === '▐') {
              const halfW = Math.round(cellWidth / 2);
              ctx.fillRect(x1 + halfW, y1, cellWidth - halfW + 0.5, cellHeight + 0.6);
            } else if (cell.ch === '◢') {
              ctx.beginPath();
              ctx.moveTo(x2, y1);
              ctx.lineTo(x2, y2 + 0.6);
              ctx.lineTo(x1, y2 + 0.6);
              ctx.closePath();
              ctx.fill();
            } else if (cell.ch === '◣') {
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2 + 0.6);
              ctx.lineTo(x1, y2 + 0.6);
              ctx.closePath();
              ctx.fill();
            } else if (cell.ch === '◥') {
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y1);
              ctx.lineTo(x2, y2 + 0.6);
              ctx.closePath();
              ctx.fill();
            } else if (cell.ch === '◤') {
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y1);
              ctx.lineTo(x1, y2 + 0.6);
              ctx.closePath();
              ctx.fill();
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

      if (isBlacklisted) {
        ctx.globalAlpha = 1.0;
      }
    }

    // Show the active mouse hotspot like a lightweight terminal cursor.
    if (this.hoverAction) {
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
        const sx1 = Math.round(colStart * cellW);
        const sx2 = Math.round((colEnd + 1) * cellW);
        const sy1 = Math.round(r * cellH);
        const sy2 = Math.round((r + 1) * cellH);
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
        footerText.includes('請輸入密碼')
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
          // Also check for Main Menu bracketed hotkey pattern like (F)avorite, (C)分組討論區, (M)電子郵件, (U)個人設定, (X)休閒聊天, (T)即時動態
          if (!hasMenuPointerOnRow && (/\([A-Za-z0-9]\)/.test(lineStr) || /\[[A-Za-z0-9]\]/.test(lineStr)) && (
            lineStr.includes('【') || lineStr.includes('】') || lineStr.includes('Menu') || lineStr.includes('主功能表') || lineStr.includes('分組討論區') || lineStr.includes('看板') || lineStr.includes('郵件') || lineStr.includes('設定')
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
  }
}
