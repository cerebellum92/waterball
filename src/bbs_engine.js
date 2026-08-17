// Clean, Self-Contained 80x24 Canvas BBS Engine

export class CleanBBSEngine {
  constructor(container) {
    this.container = container;
    this.cols = 80;
    this.rows = 24;

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    container.replaceChildren(this.canvas);

    // Standard 16 ANSI colors
    this.colors = [
      '#000000', '#c00000', '#00c000', '#c0c000', '#0000c0', '#c000c0', '#00c0c0', '#c0c0c0',
      '#808080', '#ff6060', '#60ff60', '#ffff60', '#6060ff', '#ff60ff', '#60ffff', '#ffffff'
    ];

    // Grid: 24 rows x 80 cols
    this.grid = [];
    this.resetGrid();

    this.curX = 0;
    this.curY = 0;
    this.fg = 7;
    this.bg = 0;
    this.escState = 0;
    this.escParam = '';

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resetGrid() {
    this.grid = [];
    for (let r = 0; r < 24; r++) {
      let row = [];
      for (let c = 0; c < 80; c++) {
        row.push({ ch: ' ', fg: 7, bg: 0, isLead: false });
      }
      this.grid.push(row);
    }
  }

  resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 500;

    this.cellW = Math.max(10, Math.floor(w / 80));
    this.cellH = Math.max(20, Math.floor(h / 24));

    this.canvas.width = Math.max(800, this.cellW * 80);
    this.canvas.height = Math.max(480, this.cellH * 24);

    this.redraw();
  }

  clear() {
    this.resetGrid();
    this.curX = 0;
    this.curY = 0;
    this.redraw();
  }

  writeln(msg) {
    this.feed(msg + '\r\n');
  }

  puts(str) {
    for (let i = 0; i < str.length; i++) {
      const ch = str.charAt(i);
      if (ch === '\r') {
        this.curX = 0;
      } else if (ch === '\n') {
        this.curY++;
        if (this.curY >= 24) {
          this.grid.shift();
          let row = [];
          for (let c = 0; c < 80; c++) row.push({ ch: ' ', fg: 7, bg: 0, isLead: false });
          this.grid.push(row);
          this.curY = 23;
        }
      } else if (ch === '\b') {
        if (this.curX > 0) this.curX--;
      } else if (ch === '\t') {
        this.curX = Math.min(79, (Math.floor(this.curX / 8) + 1) * 8);
      } else {
        const code = ch.charCodeAt(0);

        // Strict BBS Cell Width:
        // ASCII (code < 128): 1 cell
        // Fullwidth CJK & CJK Symbols: 2 cells
        let isFull = false;
        if (code >= 0x80) {
          if (
            (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
            (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
            (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility
            (code >= 0x3000 && code <= 0x303f) || // CJK Symbols & Punctuation
            (code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms
            (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Symbol Variants
            (code >= 0x2500 && code <= 0x257f)    // Box Drawing Symbols in BBS
          ) {
            isFull = true;
          }
        }

        if (this.curX < 80 && this.curY < 24) {
          this.grid[this.curY][this.curX] = { ch: ch, fg: this.fg, bg: this.bg, isLead: isFull };
          if (isFull && this.curX + 1 < 80) {
            this.grid[this.curY][this.curX + 1] = { ch: '', fg: this.fg, bg: this.bg, isLead: false };
            this.curX += 2;
          } else {
            this.curX += 1;
          }
          if (this.curX >= 80) {
            this.curX = 0;
            this.curY++;
            if (this.curY >= 24) {
              this.grid.shift();
              let row = [];
              for (let c = 0; c < 80; c++) row.push({ ch: ' ', fg: 7, bg: 0, isLead: false });
              this.grid.push(row);
              this.curY = 23;
            }
          }
        }
      }
    }
    this.redraw();
  }

  feed(data) {
    if (!data) return;
    for (let i = 0; i < data.length; i++) {
      const ch = data.charAt(i);
      if (this.escState === 0) {
        if (ch === '\x1b') {
          this.escState = 1;
        } else {
          this.puts(ch);
        }
      } else if (this.escState === 1) {
        if (ch === '[') {
          this.escState = 2;
          this.escParam = '';
        } else {
          this.escState = 0;
        }
      } else if (this.escState === 2) {
        if ((ch >= '`' && ch <= 'z') || (ch >= '@' && ch <= 'Z')) {
          const params = this.escParam.split(';').map(p => parseInt(p, 10) || 0);
          if (ch === 'm') {
            if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
              this.fg = 7; this.bg = 0;
            } else {
              let bright = false;
              for (let p of params) {
                if (p === 0) { this.fg = 7; this.bg = 0; bright = false; }
                else if (p === 1) { bright = true; if (this.fg < 8) this.fg += 8; }
                else if (p >= 30 && p <= 37) { this.fg = (p - 30) + (bright ? 8 : 0); }
                else if (p >= 40 && p <= 47) { this.bg = p - 40; }
              }
            }
          } else if (ch === 'H' || ch === 'f') {
            this.curY = Math.max(0, Math.min(23, (params[0] || 1) - 1));
            this.curX = Math.max(0, Math.min(79, (params[1] || 1) - 1));
          } else if (ch === 'J') {
            this.resetGrid();
            this.curX = 0; this.curY = 0;
          } else if (ch === 'K') {
            for (let c = this.curX; c < 80; c++) {
              this.grid[this.curY][c] = { ch: ' ', fg: this.fg, bg: this.bg, isLead: false };
            }
          } else if (ch === 'A') { this.curY = Math.max(0, this.curY - (params[0] || 1)); }
          else if (ch === 'B') { this.curY = Math.min(23, this.curY + (params[0] || 1)); }
          else if (ch === 'C') { this.curX = Math.min(79, this.curX + (params[0] || 1)); }
          else if (ch === 'D') { this.curX = Math.max(0, this.curX - (params[0] || 1)); }

          this.escState = 0;
        } else {
          this.escParam += ch;
        }
      }
    }
    this.redraw();
  }

  redraw() {
    const ctx = this.ctx;
    const cw = this.cellW;
    const ch = this.cellH;

    // Fill main black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.font = `${ch - 1}px "WenQuanYi Micro Hei Mono", "Noto Sans Mono CJK TC", "MingLiU", monospace`;
    ctx.textBaseline = 'top';

    for (let r = 0; r < 24; r++) {
      for (let c = 0; c < 80; c++) {
        const cell = this.grid[r][c];
        const x = c * cw;
        const y = r * ch;

        // 1. Draw cell background seamlessly
        if (cell.bg !== 0) {
          ctx.fillStyle = this.colors[cell.bg] || '#000000';
          // Ensure seamless coverage across adjacent cells
          ctx.fillRect(x, y, cell.isLead ? cw * 2 + 1 : cw + 1, ch + 1);
        }

        // 2. Draw character
        if (cell.isLead) {
          if (cell.ch && cell.ch !== ' ') {
            ctx.fillStyle = this.colors[cell.fg] || '#ffffff';
            // Measure string width and scale horizontally to fit exactly 2-cell width
            const metrics = ctx.measureText(cell.ch);
            const targetW = cw * 2;
            if (metrics.width > 0 && Math.abs(metrics.width - targetW) > 1) {
              ctx.save();
              const scaleX = targetW / metrics.width;
              ctx.translate(x, y);
              ctx.scale(scaleX, 1);
              ctx.fillText(cell.ch, 0, 0);
              ctx.restore();
            } else {
              ctx.fillText(cell.ch, x, y);
            }
          }
        } else if (cell.ch && cell.ch !== ' ') {
          ctx.fillStyle = this.colors[cell.fg] || '#ffffff';
          ctx.fillText(cell.ch, x, y);
        }
      }
    }

    // Cursor
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(this.curX * cw, this.curY * ch, cw, ch);
  }
}
