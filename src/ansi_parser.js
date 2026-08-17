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
          if ((ch >= '`' && ch <= 'z') || (ch >= '@' && ch <= 'Z')) {
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
          let C1_End = true;
          const C1_Char = [' ', '#', '%', '(', ')', '*', '+', '-', '.', '/'];
          if (this.esc) {
            for (let j = 0; j < C1_Char.length; ++j) {
              if (this.esc === C1_Char[j]) C1_End = false;
            }
            if (C1_End) --i;
            else this.esc += ch;
            this.esc = '';
            this.state = AnsiParser.STATE_TEXT;
            break;
          }
          switch (ch) {
            case '7':
              term.cur_x_sav = term.cur_x;
              term.cur_y_sav = term.cur_y;
              break;
            case '8':
              if (term.cur_x_sav >= 0 && term.cur_y_sav >= 0) {
                term.cur_x = term.cur_x_sav;
                term.cur_y = term.cur_y_sav;
              }
              break;
            case 'D':
              term.scroll(false, 1);
              break;
            case 'E':
              term.lineFeed();
              term.carriageReturn();
              break;
            case 'M':
              term.scroll(true, 1);
              break;
            default:
              this.esc += ch;
              C1_End = false;
          }
          if (!C1_End) break;
          this.esc = '';
          this.state = AnsiParser.STATE_TEXT;
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
