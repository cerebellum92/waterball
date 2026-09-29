// Complete ANSI parser matching PttChrome & MapleBBS ANSI SGR specifications
import { decodeUao } from './uao_b2u.js';

export class AnsiParser {
  constructor(termbuf) {
    this.termbuf = termbuf;
    this.state = AnsiParser.STATE_TEXT;
    this.esc = '';
    this.pendingBig5Lead = null;
    this.pendingBig5Attr = null;
    this.pendingUtf8 = [];
  }

  resetByteDecoder() {
    this.pendingBig5Lead = null;
    this.pendingBig5Attr = null;
    this.pendingUtf8 = [];
    this.state = AnsiParser.STATE_TEXT;
    this.esc = '';
  }

  flushPendingBig5Lead() {
    if (this.pendingBig5Lead === null) return '';
    this.pendingBig5Lead = null;
    this.pendingBig5Attr = null;
    return '';
  }

  static STATE_TEXT = 0;
  static STATE_ESC = 1;
  static STATE_CSI = 2;
  static STATE_C1 = 3;

  feed(data, rawBig5 = false) {
    const term = this.termbuf;
    if (!term) return;
    term.beginOutputBatch();
    try {
      if (!rawBig5) this.flushPendingBig5Lead();
      return this.feedInternal(data, rawBig5);
    } finally {
      term.endOutputBatch();
    }
  }

  feedInternal(data, rawBig5 = false) {
    const term = this.termbuf;
    if (!term) return;
    let s = '';
    let decodedText = '';
    const n = data.length;

    for (let i = 0; i < n; ++i) {
      const ch = data[i];
      const byte = rawBig5 ? ch.charCodeAt(0) : 0;

      if (rawBig5 && this.state === AnsiParser.STATE_TEXT) {
        if (this.pendingUtf8.length) {
          if (byte >= 0x80 && byte <= 0xbf) {
            this.pendingUtf8.push(byte);
            const first = this.pendingUtf8[0];
            const expected = first <= 0xdf ? 2 : first <= 0xef ? 3 : 4;
            if (this.pendingUtf8.length === expected) {
              const unicode = new TextDecoder().decode(new Uint8Array(this.pendingUtf8));
              term.puts(unicode);
              decodedText += unicode;
              this.pendingUtf8 = [];
            }
            continue;
          }
          this.pendingUtf8 = [];
        }

        if (this.pendingBig5Lead !== null && byte !== 0x1b) {
          const lead = this.pendingBig5Lead;
          if (lead === 0x9b && byte >= 0x20 && byte <= 0x3f) {
            this.pendingBig5Lead = null;
            this.pendingBig5Attr = null;
            this.state = AnsiParser.STATE_CSI;
            this.esc = '';
            decodedText += '\x9b';
          } else {
            const unicode = decodeUao(lead, byte);
            if (unicode) {
              term.putDBCS(unicode, this.pendingBig5Attr, term.curAttr);
              decodedText += unicode;
              this.pendingBig5Lead = null;
              this.pendingBig5Attr = null;
              continue;
            }
            if (lead >= 0xc2 && lead <= 0xf4 && byte >= 0x80 && byte <= 0xbf) {
              this.pendingUtf8 = [lead, byte];
              this.pendingBig5Lead = null;
              this.pendingBig5Attr = null;
              if (lead <= 0xdf) {
                const utf8Char = new TextDecoder().decode(new Uint8Array(this.pendingUtf8));
                term.puts(utf8Char);
                decodedText += utf8Char;
                this.pendingUtf8 = [];
              }
              continue;
            }
            decodedText += this.flushPendingBig5Lead();
          }
        }

        if (this.state === AnsiParser.STATE_TEXT && byte >= 0x81) {
          if (s) {
            term.puts(s);
            s = '';
          }
          this.pendingBig5Lead = byte;
          this.pendingBig5Attr = { ...term.curAttr };
          continue;
        }
      }

      if (rawBig5 && this.state === AnsiParser.STATE_CSI && byte >= 0x80) {
        decodedText += this.flushPendingBig5Lead();
        this.state = AnsiParser.STATE_TEXT;
        this.esc = '';
        this.pendingBig5Lead = byte;
        this.pendingBig5Attr = { ...term.curAttr };
        continue;
      }
      if (rawBig5) decodedText += ch;

      // ESC (0x1B) cancels any in-progress escape sequence and starts a new one immediately
      if (ch === '\x1b') {
        if (s) {
          term.puts(s);
          s = '';
        }
        this.state = AnsiParser.STATE_ESC;
        this.esc = '';
        continue;
      }

      if (ch === '\x9b') {
        if (s) {
          term.puts(s);
          s = '';
        }
        this.state = AnsiParser.STATE_CSI;
        this.esc = '';
        continue;
      }

      switch (this.state) {
        case AnsiParser.STATE_TEXT:
          s += ch;
          break;

        case AnsiParser.STATE_ESC:
          if (ch === '[') {
            this.state = AnsiParser.STATE_CSI;
            this.esc = '';
          } else {
            if (rawBig5) decodedText += this.flushPendingBig5Lead();
            // Process C1 / single-byte ESC commands immediately
            this.state = AnsiParser.STATE_TEXT;
            this.esc = '';
            switch (ch) {
              case '7':
                // DECSC: save cursor pos & attr
                term.cur_x_sav = term.cur_x;
                term.cur_y_sav = term.cur_y;
                term.cur_attr_sav = { ...term.curAttr };
                break;
              case '8':
                // DECRC: restore cursor pos & attr
                if (term.cur_x_sav >= 0 && term.cur_y_sav >= 0) {
                  term.gotoPos(term.cur_x_sav, term.cur_y_sav);
                }
                if (term.cur_attr_sav) {
                  term.curAttr.copyFrom(term.cur_attr_sav);
                }
                break;
              case 'D':
                // IND: index (down one line, scroll if at bottom)
                term.lineFeed();
                break;
              case 'E':
                // NEL: next line (down + carriage return)
                term.lineFeed();
                term.carriageReturn();
                break;
              case 'M':
                // RI: reverse index (up one line, reverse scroll if at top)
                if (term.cur_y > term.scrollTop) {
                  term.cur_y--;
                  term.markRowDirty(term.cur_y);
                  term.queueUpdate();
                } else {
                  term.scroll(true, 1);
                }
                break;
              case '(':
              case ')':
              case '*':
              case '+':
              case '-':
              case '.':
              case '/':
              case ' ':
              case '#':
              case '%':
                // 2-byte charset designation: expect 1 more byte in STATE_C1
                this.state = AnsiParser.STATE_C1;
                this.esc = ch;
                break;
              default:
                break;
            }
          }
          break;

        case AnsiParser.STATE_C1:
          // Second byte of 2-byte charset sequence (e.g. ESC ( B)
          this.state = AnsiParser.STATE_TEXT;
          this.esc = '';
          break;

        case AnsiParser.STATE_CSI:
          // C0 control characters inside CSI have high priority: execute immediately
          if (ch < ' ') {
            if (rawBig5) decodedText += this.flushPendingBig5Lead();
            switch (ch) {
              case '\r':
                term.carriageReturn();
                break;
              case '\n':
              case '\f':
              case '\v':
                term.lineFeed();
                break;
              case '\b':
                term.back();
                break;
              case '\t':
                term.tab();
                break;
              case '\x18': // CAN (Cancel)
              case '\x1a': // SUB (Substitute)
                this.state = AnsiParser.STATE_TEXT;
                this.esc = '';
                break;
              default:
                break;
            }
            continue;
          }

          if (ch >= '@' && ch <= '~') {
            if (rawBig5 && ch !== 'm') decodedText += this.flushPendingBig5Lead();
            const rawParams = this.esc ? this.esc.split(';') : [];
            let firstChar = '';
            if (rawParams[0]) {
              if (rawParams[0].charAt(0) < '0' || rawParams[0].charAt(0) > '9') {
                firstChar = rawParams[0].charAt(0);
                rawParams[0] = rawParams[0].slice(1);
              }
            }

            if (firstChar && ch !== 'h' && ch !== 'l') {
              this.state = AnsiParser.STATE_TEXT;
              this.esc = '';
              break;
            }

            const params = [];
            if (rawParams.length === 0) {
              params.push(0);
            } else {
              for (let j = 0; j < rawParams.length; ++j) {
                if (rawParams[j]) {
                  params[j] = parseInt(rawParams[j], 10);
                } else {
                  params[j] = 0;
                }
              }
            }

            switch (ch) {
              case 'm':
                term.setAttr(params);
                break;
              case 'H':
              case 'f': {
                const r = params[0] > 0 ? params[0] - 1 : 0;
                const c = params.length > 1 && params[1] > 0 ? params[1] - 1 : 0;
                term.gotoPos(c, r);
                break;
              }
              case 'A':
                term.gotoPos(term.cur_x, term.cur_y - (params[0] ? params[0] : 1));
                break;
              case 'B':
              case 'e':
                term.gotoPos(term.cur_x, term.cur_y + (params[0] ? params[0] : 1));
                break;
              case 'C':
                term.gotoPos(term.cur_x + (params[0] ? params[0] : 1), term.cur_y);
                break;
              case 'D':
                term.gotoPos(term.cur_x - (params[0] ? params[0] : 1), term.cur_y);
                break;
              case 'E':
                term.gotoPos(0, term.cur_y + (params[0] ? params[0] : 1));
                break;
              case 'F':
                term.gotoPos(0, term.cur_y - (params[0] ? params[0] : 1));
                break;
              case 'G':
              case '`':
                term.gotoPos(params[0] > 0 ? params[0] - 1 : 0, term.cur_y);
                break;
              case 'd':
                term.gotoPos(term.cur_x, params[0] > 0 ? params[0] - 1 : 0);
                break;
              case 'I':
                term.tab(params[0] > 0 ? params[0] : 1);
                break;
              case 'Z':
                term.backTab(params[0] > 0 ? params[0] : 1);
                break;
              case 'J':
                term.clear(rawParams.length > 0 ? params[0] : 0);
                break;
              case 'K':
                term.eraseLine(rawParams.length > 0 ? params[0] : 0);
                break;
              case 's':
                term.cur_x_sav = term.cur_x;
                term.cur_y_sav = term.cur_y;
                term.cur_attr_sav = { ...term.curAttr };
                break;
              case 'u':
                if (term.cur_x_sav >= 0 && term.cur_y_sav >= 0) {
                  term.gotoPos(term.cur_x_sav, term.cur_y_sav);
                }
                if (term.cur_attr_sav) {
                  term.curAttr.copyFrom(term.cur_attr_sav);
                }
                break;
              case 'L':
                term.insertLine(params[0] > 0 ? params[0] : 1);
                break;
              case 'M':
                term.deleteLine(params[0] > 0 ? params[0] : 1);
                break;
              case 'P':
                term.del(params[0] > 0 ? params[0] : 1);
                break;
              case '@':
                term.insertChar(params[0] > 0 ? params[0] : 1);
                break;
              case 'r':
                if (rawParams.length < 2) {
                  term.setScrollRegion(0, term.rows - 1);
                } else {
                  term.setScrollRegion(
                    params[0] > 0 ? params[0] - 1 : 0,
                    params[1] > 0 ? params[1] - 1 : term.rows - 1
                  );
                }
                break;
              case 'h':
                if (firstChar === '?') {
                  if (params[0] === 25) term.showCursor(true);
                  if (params[0] === 2026) term.beginSynchronizedOutput();
                }
                break;
              case 'l':
                if (firstChar === '?') {
                  if (params[0] === 25) term.showCursor(false);
                  if (params[0] === 2026) term.endSynchronizedOutput();
                }
                break;
              case 'S':
                term.scroll(false, params[0] > 0 ? params[0] : 1);
                break;
              case 'T':
                term.scroll(true, params[0] > 0 ? params[0] : 1);
                break;
              case 'X':
                term.eraseChar(params[0] > 0 ? params[0] : 1);
                break;
              default:
                break;
            }
            this.state = AnsiParser.STATE_TEXT;
            this.esc = '';
          } else if (ch >= ' ' && ch <= '?') {
            this.esc += ch;
          } else {
            // Invalid byte in CSI (e.g. DEL or non-ASCII / Chinese char >= 0x80)
            // Immediately abort CSI to prevent swallowing text or desyncing
            this.state = AnsiParser.STATE_TEXT;
            this.esc = '';
            s += ch;
          }
          break;
      }
    }

    if (s) {
      term.puts(s);
      s = '';
    }
    return rawBig5 ? decodedText : data;
  }
}
