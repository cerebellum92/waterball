// Complete BBS Terminal Buffer & Grid State Machine

export const TERM_COLORS = [
  // Normal (0-7)
  '#000000', // 0: black
  '#bb0000', // 1: red
  '#00bb00', // 2: green
  '#bbbb00', // 3: yellow / brown
  '#0000bb', // 4: blue
  '#bb00bb', // 5: magenta
  '#00bbbb', // 6: cyan
  '#bbbbbb', // 7: white / light gray
  // Bright (8-15) - with bold / bright attribute (code 1)
  '#555555', // 8: bright black / dark gray
  '#ff5555', // 9: bright red
  '#55ff55', // 10: bright green
  '#ffff55', // 11: bright yellow
  '#5555ff', // 12: bright blue
  '#ff55ff', // 13: bright magenta
  '#55ffff', // 14: bright cyan
  '#ffffff'  // 15: bright white
];

export class TermChar {
  constructor(ch = ' ') {
    this.ch = ch;
    this.fg = 7;
    this.bg = 0;
    this.bright = false;
    this.blink = false;
    this.invert = false;
    this.underLine = false;
    this.isLeadByte = false;
    this.isTrailByte = false;
  }

  reset() {
    this.ch = ' ';
    this.fg = 7;
    this.bg = 0;
    this.bright = false;
    this.blink = false;
    this.invert = false;
    this.underLine = false;
    this.isLeadByte = false;
    this.isTrailByte = false;
  }

  copyFrom(other) {
    this.ch = other.ch;
    this.fg = other.fg;
    this.bg = other.bg;
    this.bright = other.bright;
    this.blink = other.blink;
    this.invert = other.invert;
    this.underLine = other.underLine;
    this.isLeadByte = other.isLeadByte;
    this.isTrailByte = other.isTrailByte;
  }

  copyAttr(other) {
    this.fg = other.fg;
    this.bg = other.bg;
    this.bright = other.bright;
    this.blink = other.blink;
    this.invert = other.invert;
    this.underLine = other.underLine;
  }

  getFg() {
    if (this.invert) {
      return this.bright ? this.bg + 8 : this.bg;
    }
    return this.bright ? this.fg + 8 : this.fg;
  }

  getBg() {
    if (this.invert) {
      return this.fg;
    }
    return this.bg;
  }
}

export class TermBuf {
  constructor(cols = 80, rows = 24) {
    this.cols = cols;
    this.rows = rows;
    this.cur_x = 0;
    this.cur_y = 0;
    this.cur_x_sav = -1;
    this.cur_y_sav = -1;

    this.scrollTop = 0;
    this.scrollBottom = rows - 1;

    this.curAttr = new TermChar(' ');
    this.newChar = new TermChar(' ');

    this.lines = [];
    for (let r = 0; r < rows; r++) {
      let row = [];
      for (let c = 0; c < cols; c++) {
        row.push(new TermChar(' '));
      }
      this.lines.push(row);
    }

    this.cursorVisible = true;
    this.onUpdate = null;
    this.timerUpdate = null;
  }

  queueUpdate() {
    if (this.timerUpdate) return;
    this.timerUpdate = setTimeout(() => {
      this.timerUpdate = null;
      if (this.onUpdate) this.onUpdate();
    }, 16);
  }

  isFullWidth(ch) {
    const code = ch.charCodeAt(0);
    if (code > 0x7f) return true;
    return (
      (code >= 0x1100 &&
        (code <= 0x115f ||
          code === 0x2329 ||
          code === 0x232a ||
          (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
          (code >= 0xac00 && code <= 0xd7a3) ||
          (code >= 0xf900 && code <= 0xfaff) ||
          (code >= 0xfe10 && code <= 0xfe19) ||
          (code >= 0xfe30 && code <= 0xfe6f) ||
          (code >= 0xff00 && code <= 0xff60) ||
          (code >= 0xffe0 && code <= 0xffe6)))
    );
  }

  puts(str) {
    if (!str) return;
    const cols = this.cols;
    const rows = this.rows;
    const lines = this.lines;

    for (let i = 0; i < str.length; i++) {
      const ch = str.charAt(i);
      switch (ch) {
        case '\x07': // Bell
          continue;
        case '\b':
          this.back();
          continue;
        case '\r':
          this.carriageReturn();
          continue;
        case '\n':
        case '\f':
        case '\v':
          this.lineFeed();
          continue;
        case '\0':
          continue;
        case '\t':
          this.tab();
          continue;
      }

      if (this.cur_x >= cols) {
        this.cur_x = 0;
        this.lineFeed();
      }

      const full = this.isFullWidth(ch);

      // Prevent DBCS wrap overflow beyond col 80
      if (full && this.cur_x >= cols - 1) {
        this.cur_x = 0;
        this.lineFeed();
      }

      if (this.cur_y >= rows || this.cur_x >= cols) continue;

      const line = lines[this.cur_y];
      const cell = line[this.cur_x];
      cell.ch = ch;
      cell.copyAttr(this.curAttr);

      if (full) {
        cell.isLeadByte = true;
        cell.isTrailByte = false;
        this.cur_x++;
        if (this.cur_x < cols) {
          const nextCell = line[this.cur_x];
          nextCell.ch = '';
          nextCell.copyAttr(this.curAttr);
          nextCell.isLeadByte = false;
          nextCell.isTrailByte = true;
        }
      } else {
        cell.isLeadByte = false;
        cell.isTrailByte = false;
      }
      this.cur_x++;
    }
    this.queueUpdate();
  }

  back() {
    if (this.cur_x > 0) {
      this.cur_x--;
      this.queueUpdate();
    }
  }

  /**
   * Check if the character directly to the left of the cursor is a DBCS TrailByte (right half of a Chinese char).
   * Used for smart DBCS Backspace (deleting 2 bytes at once).
   */
  isPrevCharDBCS() {
    if (this.cur_x <= 0 || this.cur_y >= this.rows) return false;
    const cell = this.lines[this.cur_y][this.cur_x - 1];
    return cell ? cell.isTrailByte : false;
  }

  /**
   * Check if the character under the cursor is a DBCS LeadByte (left half of a Chinese char).
   * Used for smart DBCS Delete (deleting 2 bytes at once).
   */
  isCurCharDBCSLead() {
    if (this.cur_x >= this.cols || this.cur_y >= this.rows) return false;
    const cell = this.lines[this.cur_y][this.cur_x];
    return cell ? cell.isLeadByte : false;
  }

  tab(param = 1) {
    const mod = this.cur_x % 8;
    this.cur_x += 8 - mod;
    if (param > 1) this.cur_x += 8 * (param - 1);
    if (this.cur_x >= this.cols) this.cur_x = this.cols - 1;
    this.queueUpdate();
  }

  backTab(param = 1) {
    const mod = this.cur_x % 8;
    this.cur_x -= mod > 0 ? mod : 8;
    if (param > 1) this.cur_x -= 8 * (param - 1);
    if (this.cur_x < 0) this.cur_x = 0;
    this.queueUpdate();
  }

  lineFeed() {
    if (this.cur_y < this.scrollBottom) {
      this.cur_y++;
    } else {
      this.scroll(false, 1);
    }
    this.queueUpdate();
  }

  carriageReturn() {
    this.cur_x = 0;
    this.queueUpdate();
  }

  gotoPos(x, y) {
    this.cur_x = Math.max(0, Math.min(this.cols - 1, x));
    this.cur_y = Math.max(0, Math.min(this.rows - 1, y));
    this.queueUpdate();
  }

  showCursor(show) {
    this.cursorVisible = !!show;
    this.queueUpdate();
  }

  setScrollRegion(top, bottom) {
    this.scrollTop = Math.max(0, Math.min(this.rows - 1, top));
    this.scrollBottom = Math.max(this.scrollTop, Math.min(this.rows - 1, bottom));
    this.gotoPos(0, 0);
  }

  scroll(up, n = 1) {
    const scrollStart = this.scrollTop;
    const scrollEnd = this.scrollBottom;
    const lines = this.lines;
    const rows = this.rows;
    const cols = this.cols;

    if (n >= rows) {
      this.clear(2);
      return;
    }

    if (up) {
      // Move lines down
      for (let i = 0; i < rows - 1 - scrollEnd; i++) lines.unshift(lines.pop());
      while (--n >= 0) {
        const line = lines.pop();
        lines.splice(rows - 1 - scrollEnd + scrollStart, 0, line);
        for (let col = 0; col < cols; col++) line[col].copyFrom(this.newChar);
      }
      for (let i = 0; i < rows - 1 - scrollEnd; i++) lines.push(lines.shift());
    } else {
      // Move lines up
      for (let i = 0; i < scrollStart; i++) lines.push(lines.shift());
      while (--n >= 0) {
        const line = lines.shift();
        lines.splice(scrollEnd - scrollStart, 0, line);
        for (let col = 0; col < cols; col++) line[col].copyFrom(this.newChar);
      }
      for (let i = 0; i < scrollStart; i++) lines.unshift(lines.pop());
    }
    this.queueUpdate();
  }

  insertLine(param = 1) {
    const scrollStart = this.scrollTop;
    if (this.cur_y < this.scrollBottom) {
      this.scrollTop = this.cur_y;
      this.scroll(true, param);
    }
    this.scrollTop = scrollStart;
    this.queueUpdate();
  }

  deleteLine(param = 1) {
    const scrollStart = this.scrollTop;
    this.scrollTop = this.cur_y;
    this.scroll(false, param);
    this.scrollTop = scrollStart;
    this.queueUpdate();
  }

  insertChar(param = 1) {
    const line = this.lines[this.cur_y];
    const cols = this.cols;
    let cur_x = this.cur_x;
    if (cur_x >= cols) return;

    if (cur_x + param >= cols) {
      for (let col = cur_x; col < cols; col++) {
        line[col].copyFrom(this.newChar);
      }
    } else {
      while (--param >= 0) {
        const ch = line.pop();
        line.splice(cur_x, 0, ch);
        ch.copyFrom(this.newChar);
      }
    }
    this.queueUpdate();
  }

  del(param = 1) {
    const line = this.lines[this.cur_y];
    const cols = this.cols;
    let cur_x = this.cur_x;
    if (cur_x >= cols) return;

    if (cur_x + param >= cols) {
      for (let col = cur_x; col < cols; col++) {
        line[col].copyFrom(this.newChar);
      }
    } else {
      let n = cols - cur_x - param;
      while (--n >= 0) line.splice(cur_x, 0, line.pop());
      for (let col = cols - param; col < cols; col++) {
        line[col].copyFrom(this.newChar);
      }
    }
    this.queueUpdate();
  }

  eraseChar(param = 1) {
    const line = this.lines[this.cur_y];
    const cols = this.cols;
    let cur_x = this.cur_x;
    const n = cur_x + param > cols ? cols : cur_x + param;
    for (let col = cur_x; col < n; col++) {
      line[col].copyFrom(this.newChar);
    }
    this.queueUpdate();
  }

  eraseLine(param = 0) {
    const line = this.lines[this.cur_y];
    const cols = this.cols;
    switch (param) {
      case 0: // Erase right
        for (let col = this.cur_x; col < cols; col++) {
          line[col].copyFrom(this.newChar);
        }
        break;
      case 1: // Erase left
        for (let col = 0; col <= this.cur_x && col < cols; col++) {
          line[col].copyFrom(this.newChar);
        }
        break;
      case 2: // Erase all
        for (let col = 0; col < cols; col++) {
          line[col].copyFrom(this.newChar);
        }
        break;
    }
    this.queueUpdate();
  }

  clear(param = 0) {
    const rows = this.rows;
    const cols = this.cols;
    const lines = this.lines;

    switch (param) {
      case 0: { // From cursor to end of screen
        let line = lines[this.cur_y];
        for (let col = this.cur_x; col < cols; col++) {
          line[col].copyFrom(this.newChar);
        }
        for (let row = this.cur_y + 1; row < rows; row++) {
          line = lines[row];
          for (let col = 0; col < cols; col++) {
            line[col].copyFrom(this.newChar);
          }
        }
        break;
      }
      case 1: { // From start of screen to cursor
        for (let row = 0; row < this.cur_y; row++) {
          const line = lines[row];
          for (let col = 0; col < cols; col++) {
            line[col].copyFrom(this.newChar);
          }
        }
        const line = lines[this.cur_y];
        for (let col = 0; col <= this.cur_x && col < cols; col++) {
          line[col].copyFrom(this.newChar);
        }
        break;
      }
      case 2: { // Entire screen
        for (let row = 0; row < rows; row++) {
          const line = lines[row];
          for (let col = 0; col < cols; col++) {
            line[col].copyFrom(this.newChar);
          }
        }
        this.gotoPos(0, 0);
        break;
      }
    }
    this.queueUpdate();
  }

  setAttr(params) {
    for (let i = 0; i < params.length; i++) {
      const v = params[i];
      switch (v) {
        case 0: // reset
          this.curAttr.reset();
          break;
        case 1: // bright
          this.curAttr.bright = true;
          break;
        case 4: // underline
          this.curAttr.underLine = true;
          break;
        case 5: // blink
        case 6:
          this.curAttr.blink = true;
          break;
        case 7: // invert
          this.curAttr.invert = true;
          break;
        case 22: // normal brightness
          this.curAttr.bright = false;
          break;
        case 24: // not underlined
          this.curAttr.underLine = false;
          break;
        case 25: // not blinking
          this.curAttr.blink = false;
          break;
        case 27: // not inverted
          this.curAttr.invert = false;
          break;
        default:
          if (v >= 30 && v <= 37) {
            this.curAttr.fg = v - 30;
          } else if (v === 39) {
            this.curAttr.fg = 7;
          } else if (v >= 40 && v <= 47) {
            this.curAttr.bg = v - 40;
          } else if (v === 49) {
            this.curAttr.bg = 0;
          }
          break;
      }
    }
  }

  /**
   * Extract plain text from terminal selection range
   */
  getText(startX, startY, endX, endY) {
    let sX = startX, sY = startY, eX = endX, eY = endY;
    if (sY > eY || (sY === eY && sX > eX)) {
      [sX, sY, eX, eY] = [eX, eY, sX, sY];
    }

    const lines = [];
    for (let r = sY; r <= eY; r++) {
      if (r < 0 || r >= this.rows) continue;
      const colStart = (r === sY) ? Math.max(0, sX) : 0;
      const colEnd = (r === eY) ? Math.min(this.cols - 1, eX) : this.cols - 1;
      let rowText = '';

      for (let c = colStart; c <= colEnd; c++) {
        const cell = this.lines[r][c];
        if (!cell) continue;
        if (cell.isLeadByte) {
          rowText += cell.ch;
        } else if (cell.isTrailByte) {
          // Trail byte is already part of the lead byte's full-width char
          continue;
        } else {
          rowText += cell.ch || ' ';
        }
      }
      lines.push(rowText.replace(/\s+$/, ''));
    }
    return lines.join('\r\n');
  }

  /**
   * Extract ANSI color-formatted text from terminal selection range
   */
  getAnsiText(startX, startY, endX, endY) {
    let sX = startX, sY = startY, eX = endX, eY = endY;
    if (sY > eY || (sY === eY && sX > eX)) {
      [sX, sY, eX, eY] = [eX, eY, sX, sY];
    }

    const lines = [];
    let lastAttr = { fg: -1, bg: -1, bright: false, underLine: false, invert: false, blink: false };

    for (let r = sY; r <= eY; r++) {
      if (r < 0 || r >= this.rows) continue;
      const colStart = (r === sY) ? Math.max(0, sX) : 0;
      const colEnd = (r === eY) ? Math.min(this.cols - 1, eX) : this.cols - 1;
      let rowText = '';

      for (let c = colStart; c <= colEnd; c++) {
        const cell = this.lines[r][c];
        if (!cell) continue;

        // Check if attributes changed
        if (
          cell.fg !== lastAttr.fg ||
          cell.bg !== lastAttr.bg ||
          cell.bright !== lastAttr.bright ||
          cell.underLine !== lastAttr.underLine ||
          cell.invert !== lastAttr.invert ||
          cell.blink !== lastAttr.blink
        ) {
          const isDefault = cell.fg === 7 && cell.bg === 0 && !cell.bright && !cell.underLine && !cell.invert && !cell.blink;
          if (isDefault) {
            rowText += '\x15[m';
          } else {
            const codes = [];
            if (lastAttr.bright && !cell.bright) {
              codes.push(0);
            }
            if (cell.bright) codes.push(1);
            if (cell.underLine) codes.push(4);
            if (cell.blink) codes.push(5);
            if (cell.invert) codes.push(7);
            if (cell.fg !== 7 || lastAttr.fg !== cell.fg) {
              codes.push(30 + cell.fg);
            }
            if (cell.bg !== 0 || lastAttr.bg !== cell.bg) {
              codes.push(40 + cell.bg);
            }
            rowText += `\x15[${codes.join(';')}m`;
          }

          lastAttr = {
            fg: cell.fg,
            bg: cell.bg,
            bright: cell.bright,
            underLine: cell.underLine,
            invert: cell.invert,
            blink: cell.blink,
          };
        }

        if (cell.isLeadByte) {
          rowText += cell.ch;
        } else if (cell.isTrailByte) {
          continue;
        } else {
          rowText += cell.ch || ' ';
        }
      }
      rowText += '\x15[m';
      lines.push(rowText);
    }
    return lines.join('\r\n');
  }

  /**
   * Find all URLs on a specific row
   */
  getUrlsInRow(row) {
    if (row < 0 || row >= this.rows) return [];
    let lineStr = '';
    const colMap = [];

    for (let c = 0; c < this.cols; c++) {
      const cell = this.lines[row][c];
      if (!cell) continue;
      if (cell.isLeadByte) {
        lineStr += cell.ch;
        colMap.push({ start: c, end: c + 1 });
      } else if (cell.isTrailByte) {
        continue;
      } else {
        lineStr += cell.ch || ' ';
        colMap.push({ start: c, end: c });
      }
    }

    const urlRegex = /https?:\/\/[^\s\x00-\x1f<>"'()]+|telnet:\/\/[^\s\x00-\x1f<>"'()]+|ftp:\/\/[^\s\x00-\x1f<>"'()]+|(?:www\.|reurl\.cc\/|tinyurl\.com\/|bit\.ly\/|ptt\.cc\/)[^\s\x00-\x1f<>"'()]+/gi;
    let match;
    const urls = [];
    while ((match = urlRegex.exec(lineStr)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length - 1;
      const startCol = colMap[matchStart]?.start ?? 0;
      const endCol = colMap[matchEnd]?.end ?? (this.cols - 1);
      let cleanUrl = match[0].replace(/[.,;:!?]+$/, '');
      let targetUrl = cleanUrl;
      if (!/^(https?|telnet|ftp):\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
      }
      urls.push({
        raw: match[0],
        url: targetUrl,
        startCol,
        endCol,
        row,
      });
    }
    return urls;
  }

  /**
   * Find URL at a specific (col, row) coordinate on the screen
   */
  findUrlAt(col, row) {
    const urls = this.getUrlsInRow(row);
    for (const u of urls) {
      if (col >= u.startCol && col <= u.endCol) {
        return u;
      }
    }
    return null;
  }

  /**
   * Search for text across all rows in the buffer
   * Returns: Array of { row, startCol, endCol, text }
   */
  findMatches(query, caseSensitive = false) {
    if (!query || query.trim() === '') return [];
    const matches = [];
    const target = caseSensitive ? query : query.toLowerCase();

    for (let r = 0; r < this.rows; r++) {
      let lineStr = '';
      const colMap = [];

      for (let c = 0; c < this.cols; c++) {
        const cell = this.lines[r][c];
        if (!cell) continue;
        if (cell.isLeadByte) {
          lineStr += cell.ch;
          colMap.push({ start: c, end: c + 1 });
        } else if (cell.isTrailByte) {
          continue;
        } else {
          lineStr += cell.ch || ' ';
          colMap.push({ start: c, end: c });
        }
      }

      const searchStr = caseSensitive ? lineStr : lineStr.toLowerCase();
      let startIndex = 0;
      while (startIndex < searchStr.length) {
        const matchIdx = searchStr.indexOf(target, startIndex);
        if (matchIdx === -1) break;

        const matchEndIdx = matchIdx + target.length - 1;
        const startCol = colMap[matchIdx]?.start ?? 0;
        const endCol = colMap[matchEndIdx]?.end ?? (this.cols - 1);

        matches.push({
          row: r,
          startCol,
          endCol,
          text: lineStr.substring(matchIdx, matchIdx + target.length),
        });

        startIndex = matchIdx + Math.max(1, target.length);
      }
    }

    return matches;
  }
}
