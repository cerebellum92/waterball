// Complete ANSI parser matching PttChrome & MapleBBS ANSI SGR specifications

export class AnsiParser {
  constructor(termbuf) {
    this.termbuf = termbuf;
    this.state = AnsiParser.STATE_TEXT;
    this.esc = '';
  }

  static STATE_TEXT = 0;
  static STATE_ESC = 1;
  static STATE_CSI = 2;
  static STATE_C1 = 3;

  feed(data) {
    const term = this.termbuf;
    if (!term) return;
    let s = '';
    const n = data.length;
    for (let i = 0; i < n; ++i) {
      const ch = data[i];
      switch (this.state) {
        case AnsiParser.STATE_TEXT:
          switch (ch) {
            case '\x1b':
              if (s) {
                term.puts(s);
                s = '';
              }
              this.state = AnsiParser.STATE_ESC;
              break;
            default:
              s += ch;
          }
          break;

        case AnsiParser.STATE_CSI:
          if (ch >= '@' && ch <= '~') {
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
                break;
              case 'u':
                if (term.cur_x_sav >= 0 && term.cur_y_sav >= 0) {
                  term.cur_x = term.cur_x_sav;
                  term.cur_y = term.cur_y_sav;
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
                }
                break;
              case 'l':
                if (firstChar === '?') {
                  if (params[0] === 25) term.showCursor(false);
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
          } else {
            this.esc += ch;
          }
          break;

        case AnsiParser.STATE_C1:
          // Two sub-states: collecting ESC introducer (esc empty) vs reading intro parameter bytes
          // (esc non-empty, e.g. ESC ( B where "(" is the introducer and "B" designates G0 charset).
          if (this.esc === '') {
            // First byte after ESC. Known C1 controls fire immediately.
            switch (ch) {
              case '7':
                // DECSC: save cursor
                term.cur_x_sav = term.cur_x;
                term.cur_y_sav = term.cur_y;
                this.state = AnsiParser.STATE_TEXT;
                break;
              case '8':
                // DECRC: restore cursor
                if (term.cur_x_sav >= 0 && term.cur_y_sav >= 0) {
                  term.cur_x = term.cur_x_sav;
                  term.cur_y = term.cur_y_sav;
                }
                this.state = AnsiParser.STATE_TEXT;
                break;
              case 'D':
                // IND: index (down one line, scroll if at bottom)
                term.lineFeed();
                this.state = AnsiParser.STATE_TEXT;
                break;
              case 'E':
                // NEL: next line (down + carriage return)
                term.lineFeed();
                term.carriageReturn();
                this.state = AnsiParser.STATE_TEXT;
                break;
              case 'M':
                // RI: reverse index (up one line, reverse scroll if at top of scroll region)
                if (term.cur_y > term.scrollTop) {
                  term.cur_y--;
                } else {
                  term.scroll(true, 1);
                }
                this.state = AnsiParser.STATE_TEXT;
                break;
              case '[':
                // Should not happen (handled in STATE_ESC), but be defensive
                this.state = AnsiParser.STATE_CSI;
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
                // Charset designation introducers: read exactly one parameter byte next.
                this.esc = ch;
                // Stay in STATE_C1 to collect the next byte.
                break;
              default:
                // Unknown single-byte ESC sequence: silently consume.
                this.state = AnsiParser.STATE_TEXT;
                break;
            }
          } else {
            // Second byte of a charset designation sequence (e.g. ESC ( B).
            // The actual character set is implementation-specific; we just consume it.
            this.esc = '';
            this.state = AnsiParser.STATE_TEXT;
          }
          break;

        case AnsiParser.STATE_ESC:
          if (ch === '[') {
            this.state = AnsiParser.STATE_CSI;
          } else {
            this.state = AnsiParser.STATE_C1;
            --i;
          }
          break;
      }
    }
    if (s) {
      term.puts(s);
      s = '';
    }
  }
}
