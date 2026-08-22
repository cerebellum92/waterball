// Canvas 80x24 Aspect-Ratio-Preserving Renderer (PttChrome/Welly style)

import { TERM_COLORS } from './term_buf.js';

export class TermView {
  constructor(container, termBuf, imeInput = null) {
    this.container = container;
    this.buf = termBuf;
    this.imeInput = imeInput;

    // Create wrapper & canvas
    this.wrapper = document.createElement('div');
    this.wrapper.style.position = 'relative';
    this.wrapper.style.width = '100%';
    this.wrapper.style.height = '100%';
    this.wrapper.style.display = 'flex';
    this.wrapper.style.alignItems = 'center';
    this.wrapper.style.justifyContent = 'center';
    this.wrapper.style.backgroundColor = '#000000';
    this.wrapper.style.overflow = 'hidden';

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.wrapper.appendChild(this.canvas);

    if (this.imeInput) {
      this.wrapper.appendChild(this.imeInput);
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

    this.blinkState = true;
    this.blinkTimer = setInterval(() => {
      this.blinkState = !this.blinkState;
      this.scheduleRedraw();
    }, 500);

    this.selection = null; // { startX, startY, endX, endY }
    this.isSelecting = false;
    this.mouseDownPos = null;
    this.hoverUrl = null;

    this.onUrlClick = null;
    this.onUrlHover = null;
    this.onUrlLeave = null;
    this.onWheel = null;
    this.onSelectionChange = null;

    this.initMouseEvents();

    this.buf.onUpdate = () => {
      this.resetCursorBlink();
      this.scheduleRedraw();
    };
    this.resize();
  }

  resetCursorBlink() {
    this.blinkState = true;
    if (this.blinkTimer) clearInterval(this.blinkTimer);
    this.blinkTimer = setInterval(() => {
      this.blinkState = !this.blinkState;
      this.scheduleRedraw();
    }, 500);
  }

  initMouseEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left click
        const pos = this.getGridPos(e);
        this.isSelecting = true;
        this.mouseDownPos = pos;
        this.selection = null;
        this.redraw();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isSelecting && this.mouseDownPos) {
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
            if (!this.hoverUrl || this.hoverUrl.raw !== url.raw || this.hoverUrl.row !== url.row) {
              this.hoverUrl = url;
              this.redraw();
            }
            this.onUrlHover?.(url.url, e.clientX, e.clientY);
          } else {
            this.canvas.style.cursor = 'text';
            if (this.hoverUrl) {
              this.hoverUrl = null;
              this.redraw();
              this.onUrlLeave?.();
            }
          }
        } else if (this.hoverUrl) {
          this.canvas.style.cursor = 'default';
          this.hoverUrl = null;
          this.redraw();
          this.onUrlLeave?.();
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isSelecting) {
        this.isSelecting = false;
        if (this.selection && this.mouseDownPos) {
          // If clicked and released without moving, check if clicked on URL
          if (
            this.selection.startX === this.selection.endX &&
            this.selection.startY === this.selection.endY
          ) {
            const url = this.buf.findUrlAt(this.selection.startX, this.selection.startY);
            this.selection = null;
            this.redraw();
            if (url) {
              this.onUrlClick?.(url.url);
            }
          }
        } else if (this.mouseDownPos) {
          const url = this.buf.findUrlAt(this.mouseDownPos.col, this.mouseDownPos.row);
          if (url) {
            this.onUrlClick?.(url.url);
          }
        }
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
        this.onWheel?.(e.deltaY > 0 ? 'down' : 'up');
      }
    }, { passive: false });
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
    if (!this.imeInput || !this.canvas) return;
    const canvasRect = this.canvas.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();
    const left = (canvasRect.left - wrapperRect.left) + this.buf.cur_x * this.cellW;
    const top = (canvasRect.top - wrapperRect.top) + this.buf.cur_y * this.cellH;
    const fontSize = Math.floor(this.cellH * 0.85);

    this.imeInput.style.left = `${Math.max(0, left)}px`;
    this.imeInput.style.top = `${Math.max(0, top)}px`;
    this.imeInput.style.width = `${Math.max(40, this.cellW * 4)}px`;
    this.imeInput.style.height = `${this.cellH}px`;
    this.imeInput.style.fontSize = `${fontSize}px`;
    this.imeInput.style.lineHeight = `${this.cellH}px`;
    this.imeInput.style.fontFamily = this.getFontFamilyString();
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

    this.redraw();
  }

  redraw() {
    const ctx = this.ctx;
    const buf = this.buf;
    const cellW = this.cellW;
    const cellH = this.cellH;
    const cols = buf.cols;
    const rows = buf.rows;

    const fontSize = Math.floor(cellH * 0.82);
    ctx.font = `${fontSize}px ${this.getFontFamilyString()}`;
    ctx.textBaseline = 'middle';

    // Clear background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cellW * cols, cellH * rows);

    for (let r = 0; r < rows; r++) {
      const line = buf.lines[r];
      const y1 = Math.round(r * cellH);
      const y2 = Math.round((r + 1) * cellH);
      const cellHeight = y2 - y1;
      const centerY = y1 + Math.round(cellHeight * 0.52);

      // 1. Draw continuous background spans (100% eliminates fractional DPI grid lines and vertical/horizontal seams on Windows)
      let bgStartCol = 0;
      let curBg = line[0].getBg();

      for (let c = 1; c <= cols; c++) {
        const bg = (c < cols) ? line[c].getBg() : -1;
        if (bg !== curBg) {
          if (curBg !== 0) {
            const x1 = Math.round(bgStartCol * cellW);
            const x2 = Math.round(c * cellW);
            ctx.fillStyle = TERM_COLORS[curBg];
            ctx.fillRect(x1, y1, x2 - x1, cellHeight + 0.6);
          }
          bgStartCol = c;
          curBg = bg;
        }
      }

      // 2. Draw foreground characters & ANSI blocks
      for (let c = 0; c < cols; c++) {
        const cell = line[c];
        if (cell.isTrailByte) continue; // Handled by lead byte

        const x1 = Math.round(c * cellW);
        const x2 = Math.round((c + (cell.isLeadByte ? 2 : 1)) * cellW);
        const cellWidth = x2 - x1;

        const fgCol = TERM_COLORS[cell.getFg()];

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
            } else if (cell.isLeadByte) {
              // Full-width character (CJK / special symbols): ensure exact fit into 2-cell width
              const charW = this.getCharWidth(cell.ch, fontSize, ctx);
              if (charW > 0 && Math.abs(charW - cellWidth) > 1.5) {
                const scaleX = cellWidth / charW;
                ctx.save();
                ctx.translate(x1, centerY);
                ctx.scale(scaleX, 1);
                ctx.fillText(cell.ch, 0, 0);
                ctx.restore();
              } else {
                ctx.fillText(cell.ch, x1, centerY);
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
    }

    // Highlight and Underline all clickable URLs on screen (PCManX / Welly style)
    for (let r = 0; r < rows; r++) {
      const urls = this.buf.getUrlsInRow(r);
      const y1 = Math.round(r * cellH);
      const y2 = Math.round((r + 1) * cellH);
      const cellHeight = y2 - y1;

      for (const u of urls) {
        const x1 = Math.round(u.startCol * cellW);
        const x2 = Math.round((u.endCol + 1) * cellW);
        const width = x2 - x1;
        const isHovered = this.hoverUrl && this.hoverUrl.row === r && this.hoverUrl.startCol === u.startCol;

        if (isHovered) {
          // Prominent hover highlight & solid blue underline
          ctx.fillStyle = 'rgba(88, 166, 255, 0.25)';
          ctx.fillRect(x1, y1, width, cellHeight);

          ctx.strokeStyle = '#58a6ff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, y2 - 1.5);
          ctx.lineTo(x2, y2 - 1.5);
          ctx.stroke();
        } else {
          // Subtle hyperlink background tint & crisp underline for all clickable links
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

          ctx.strokeStyle = '#ffffff';
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
    const bottomLine = buf.lines[buf.rows - 1];
    if (bottomLine) {
      let bStr = '';
      for (let c = 0; c < buf.cols; c++) {
        bStr += bottomLine[c]?.ch || '';
      }
      if (
        bStr.includes('每行最多可容納') ||
        bStr.includes('(Ctrl+X)') ||
        bStr.includes('^X 發表') ||
        bStr.includes('^X 寄出') ||
        bStr.includes('^X 存檔') ||
        bStr.includes('^X發表') ||
        bStr.includes('^X寄出') ||
        bStr.includes('^X存檔') ||
        bStr.includes('檔案處理') ||
        bStr.includes('(Ctrl+W)') ||
        bStr.includes('請輸入推文') ||
        bStr.includes('【推文】') ||
        bStr.includes('請輸入標題') ||
        bStr.includes('請輸入：') ||
        bStr.includes('請輸入密碼')
      ) {
        isEditorScreen = true;
      }
    }

    // 2. Draw cursor (Smart mode: auto-hide on menu indicator ● / (F)avorite in list screens; always show in editor)
    let shouldDrawCursor = false;
    if (this.blinkState && this.cursorStyle !== 'none') {
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
            if (ch === '●' || ch === '○' || ch === '★' || ch === '☆' || ch === '◆' || ch === '◇' || ch === '▶' || ch === '▷' || ch === '>') {
              hasMenuPointerOnRow = true;
            }
          }
          // Also check for Main Menu bracketed hotkey pattern like (F)avorite, (C)lass, (M)ail, (U)ser, (X)系統資訊
          if (!hasMenuPointerOnRow && /\([A-Za-z0-9]\)/.test(lineStr) && (lineStr.includes('【') || lineStr.includes('】') || lineStr.includes('Menu') || lineStr.includes('主功能表'))) {
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
  }

  setCursorStyle(style = 'underline') {
    this.cursorStyle = style;
    this.redraw();
  }

  setSearchResults(matches, activeIndex = -1) {
    this.searchMatches = matches || [];
    this.activeSearchIndex = activeIndex;
    this.redraw();
  }

  clearSearch() {
    this.searchMatches = [];
    this.activeSearchIndex = -1;
    this.redraw();
  }

  destroy() {
    if (this.blinkTimer) clearInterval(this.blinkTimer);
  }
}
