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

    this.blinkState = true;
    this.blinkTimer = setInterval(() => {
      this.blinkState = !this.blinkState;
      this.redraw();
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

    this.buf.onUpdate = () => this.redraw();
    this.resize();
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
    this.imeInput.style.fontFamily = '"Noto Sans Mono CJK TC", "PingFang TC", "Microsoft JhengHei", monospace';
  }

  resize() {
    // Use clientWidth & clientHeight to get exact inner space excluding container padding
    const availW = this.container.clientWidth || 800;
    const availH = this.container.clientHeight || 500;

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
    const targetW = cellW * 80;
    const targetH = cellH * 24;

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
    ctx.font = `${fontSize}px "Noto Sans Mono CJK TC", "PingFang TC", "Microsoft JhengHei", "WenQuanYi Micro Hei Mono", "MingLiU", monospace`;
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

      for (let c = 0; c < cols; c++) {
        const cell = line[c];
        if (cell.isTrailByte) continue; // Handled by lead byte

        const x1 = Math.round(c * cellW);
        const x2 = Math.round((c + (cell.isLeadByte ? 2 : 1)) * cellW);
        const cellWidth = x2 - x1;

        const fgCol = TERM_COLORS[cell.getFg()];
        const bgCol = TERM_COLORS[cell.getBg()];

        // Draw background if not default black (guaranteed seamless coverage with zero black seams)
        if (cell.getBg() !== 0) {
          ctx.fillStyle = bgCol;
          ctx.fillRect(x1, y1, cellWidth, cellHeight);
        }

        // Draw character
        if (cell.ch && cell.ch !== ' ') {
          if (!cell.blink || this.blinkState) {
            ctx.fillStyle = fgCol;

            // Direct pixel-perfect solid block drawing for BBS ANSI art (zero seams)
            if (cell.ch === '█') {
              ctx.fillRect(x1, y1, cellWidth, cellHeight);
            } else if (cell.ch === '▀') {
              const halfH = Math.round(cellHeight / 2);
              ctx.fillRect(x1, y1, cellWidth, halfH);
            } else if (cell.ch === '▄') {
              const halfH = Math.round(cellHeight / 2);
              ctx.fillRect(x1, y1 + halfH, cellWidth, cellHeight - halfH);
            } else if (cell.ch === '▌') {
              const halfW = Math.round(cellWidth / 2);
              ctx.fillRect(x1, y1, halfW, cellHeight);
            } else if (cell.ch === '▐') {
              const halfW = Math.round(cellWidth / 2);
              ctx.fillRect(x1 + halfW, y1, cellWidth - halfW, cellHeight);
            } else if (cell.ch === '◢') {
              ctx.beginPath();
              ctx.moveTo(x2, y1);
              ctx.lineTo(x2, y2);
              ctx.lineTo(x1, y2);
              ctx.closePath();
              ctx.fill();
            } else if (cell.ch === '◣') {
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.lineTo(x1, y2);
              ctx.closePath();
              ctx.fill();
            } else if (cell.ch === '◥') {
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y1);
              ctx.lineTo(x2, y2);
              ctx.closePath();
              ctx.fill();
            } else if (cell.ch === '◤') {
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y1);
              ctx.lineTo(x1, y2);
              ctx.closePath();
              ctx.fill();
            } else if (cell.isLeadByte) {
              // Full-width character (CJK / special symbols): ensure exact fit into 2-cell width
              const metrics = ctx.measureText(cell.ch);
              if (metrics.width > 0) {
                const scaleX = cellWidth / metrics.width;
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
              const metrics = ctx.measureText(cell.ch);
              if (metrics.width > cellWidth) {
                const scaleX = cellWidth / metrics.width;
                ctx.save();
                ctx.translate(x1, centerY);
                ctx.scale(scaleX, 1);
                ctx.fillText(cell.ch, 0, 0);
                ctx.restore();
              } else {
                ctx.fillText(cell.ch, x1 + (cellWidth - metrics.width) / 2, centerY);
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

    // Draw cursor
    if (buf.cursorVisible && this.blinkState) {
      const curX = buf.cur_x * cellW;
      const curY = buf.cur_y * cellH;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.6;
      ctx.fillRect(curX, curY, cellW, cellH);
      ctx.globalAlpha = 1.0;
    }

    this.updateImePosition();
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
