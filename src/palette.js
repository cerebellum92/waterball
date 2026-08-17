// Floating ANSI Color Palette & Symbol Picker (Cmd+P) for bbsterm

export class PaletteWidget {
  constructor(sendDataCallback) {
    this.sendData = sendDataCallback;
    this.isOpen = false;
    this.widgetEl = null;
    this.activeTab = 'color'; // 'color' | 'symbol' | 'kaomoji'
    this.createDom();
  }

  createDom() {
    const widget = document.createElement('div');
    widget.id = 'palette-widget';
    widget.className = 'palette-widget hidden';

    widget.innerHTML = `
      <div class="palette-header">
        <div class="palette-tabs">
          <button class="palette-tab-btn active" data-tab="color">🎨 ANSI 色彩</button>
          <button class="palette-tab-btn" data-tab="symbol">✨ 符號框線</button>
          <button class="palette-tab-btn" data-tab="kaomoji">(・ω・) 顏文字</button>
        </div>
        <button id="palette-close-btn" class="palette-close-btn" title="關閉調色盤 (ESC)">✕</button>
      </div>

      <div class="palette-body">
        <!-- Tab 1: ANSI Colors -->
        <div id="palette-pane-color" class="palette-pane active">
          <div class="palette-section-title">前景文字顏色 (亮色 / 暗色)</div>
          <div class="palette-color-grid">
            <!-- Bright 8 -->
            <button class="color-chip" style="background: #ffffff; color: #000;" data-code="1;37" title="亮白 (*[1;37m)">亮白</button>
            <button class="color-chip" style="background: #f85149; color: #fff;" data-code="1;31" title="亮紅 (*[1;31m)">亮紅</button>
            <button class="color-chip" style="background: #e3b341; color: #000;" data-code="1;33" title="亮黃 (*[1;33m)">亮黃</button>
            <button class="color-chip" style="background: #3fb950; color: #fff;" data-code="1;32" title="亮綠 (*[1;32m)">亮綠</button>
            <button class="color-chip" style="background: #58a6ff; color: #fff;" data-code="1;34" title="亮藍 (*[1;34m)">亮藍</button>
            <button class="color-chip" style="background: #bc8cff; color: #fff;" data-code="1;35" title="亮紫 (*[1;35m)">亮紫</button>
            <button class="color-chip" style="background: #39c5bb; color: #000;" data-code="1;36" title="亮青 (*[1;36m)">亮青</button>
            <button class="color-chip" style="background: #7d8590; color: #fff;" data-code="1;30" title="暗灰 (*[1;30m)">暗灰</button>

            <!-- Normal 8 -->
            <button class="color-chip" style="background: #b1bac4; color: #000;" data-code="37" title="淺灰 (*[37m)">淺灰</button>
            <button class="color-chip" style="background: #b62324; color: #fff;" data-code="31" title="暗紅 (*[31m)">暗紅</button>
            <button class="color-chip" style="background: #9e6a03; color: #fff;" data-code="33" title="棕褐 (*[33m)">棕褐</button>
            <button class="color-chip" style="background: #238636; color: #fff;" data-code="32" title="暗綠 (*[32m)">暗綠</button>
            <button class="color-chip" style="background: #1f6feb; color: #fff;" data-code="34" title="暗藍 (*[34m)">暗藍</button>
            <button class="color-chip" style="background: #8957e5; color: #fff;" data-code="35" title="暗紫 (*[35m)">暗紫</button>
            <button class="color-chip" style="background: #1b7c83; color: #fff;" data-code="36" title="暗青 (*[36m)">暗青</button>
            <button class="color-chip" style="background: #21262d; color: #8b949e; border: 1px solid #30363d;" data-code="30" title="黑色 (*[30m)">黑色</button>
          </div>

          <div class="palette-section-title" style="margin-top: 10px;">背景底色 (8色)</div>
          <div class="palette-color-grid">
            <button class="color-chip" style="background: #16181d; color: #8b949e; border: 1px solid #30363d;" data-code="40" title="黑底 (*[40m)">黑底</button>
            <button class="color-chip" style="background: #b62324; color: #fff;" data-code="41" title="紅底 (*[41m)">紅底</button>
            <button class="color-chip" style="background: #238636; color: #fff;" data-code="42" title="綠底 (*[42m)">綠底</button>
            <button class="color-chip" style="background: #9e6a03; color: #fff;" data-code="43" title="黃底 (*[43m)">黃底</button>
            <button class="color-chip" style="background: #1f6feb; color: #fff;" data-code="44" title="藍底 (*[44m)">藍底</button>
            <button class="color-chip" style="background: #8957e5; color: #fff;" data-code="45" title="紫底 (*[45m)">紫底</button>
            <button class="color-chip" style="background: #1b7c83; color: #fff;" data-code="46" title="青底 (*[46m)">青底</button>
            <button class="color-chip" style="background: #b1bac4; color: #000;" data-code="47" title="白底 (*[47m)">白底</button>
          </div>

          <div class="palette-section-title" style="margin-top: 10px;">屬性控制與快速工具</div>
          <div class="palette-action-grid">
            <button class="palette-act-btn reset" data-code="m" title="恢復預設顏色 (*[m)">🔄 恢復預設色</button>
            <button class="palette-act-btn" data-code="1" title="高亮/粗體 (*[1m)">𝗕 粗體/高亮</button>
            <button class="palette-act-btn" data-code="5" title="閃爍文字 (*[5m)">✨ 閃爍</button>
            <button class="palette-act-btn" data-code="4" title="底線 (*[4m)"><u>U</u> 底線</button>
            <button class="palette-act-btn" data-code="7" title="反白 (*[7m)">⬛ 反白</button>
            <button class="palette-act-btn" id="palette-btn-ctrl-c" title="插入純 Ctrl+C 控制字元">插入 Ctrl+C</button>
          </div>
        </div>

        <!-- Tab 2: Symbols -->
        <div id="palette-pane-symbol" class="palette-pane">
          <div class="palette-section-title">幾何圖形</div>
          <div class="symbol-grid">
            ${['★', '☆', '◆', '◇', '▲', '△', '▼', '▽', '●', '○', '■', '□', '◢', '◣', '◥', '◤', '۞', '卍', '✪', '✦', '✧', '❂', '✿', '❀'].map((s) => `<button class="symbol-btn" data-char="${s}">${s}</button>`).join('')}
          </div>

          <div class="palette-section-title" style="margin-top: 10px;">製表框線字元</div>
          <div class="symbol-grid">
            ${['┌', '┬', '┐', '├', '┼', '┤', '└', '┴', '┘', '─', '│', '═', '║', '╔', '╦', '╗', '╠', '╬', '╣', '╚', '╩', '╝', '╭', '╮', '╰', '╯'].map((s) => `<button class="symbol-btn" data-char="${s}">${s}</button>`).join('')}
          </div>

          <div class="palette-section-title" style="margin-top: 10px;">箭頭與數理符號</div>
          <div class="symbol-grid">
            ${['↑', '↓', '←', '→', '↖', '↗', '↙', '↘', '↔', '↕', '±', '×', '÷', '≠', '≒', '∞', '‰', '§', '※', '♀', '♂', '℃', '℉'].map((s) => `<button class="symbol-btn" data-char="${s}">${s}</button>`).join('')}
          </div>
        </div>

        <!-- Tab 3: Kaomoji -->
        <div id="palette-pane-kaomoji" class="palette-pane">
          <div class="palette-section-title">鄉民常用顏文字</div>
          <div class="kaomoji-grid">
            ${[
              'ヽ(・∀・)ﾉ',
              '(・ω・)',
              '(ﾟДﾟ)',
              '(つд⊂)',
              '(>_<)',
              '(^_^)v',
              '(￣▽￣)',
              '(*ﾟ∀ﾟ*)',
              '(°∀°)b',
              '(・∀・)',
              '(>///<)',
              '(OwO)',
              'QAQ',
              'Orz',
              'm(_ _)m',
              '\\(^o^)/',
              '(T_T)',
              'Σ(°Д°)',
            ].map((k) => `<button class="kaomoji-btn" data-char="${k}">${k}</button>`).join('')}
          </div>

          <div class="palette-section-title" style="margin-top: 10px;">常用日文五十音</div>
          <div class="symbol-grid">
            ${['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け', 'こ', 'さ', 'し', 'す', 'せ', 'そ', 'た', 'ち', 'つ', 'て', 'と', 'な', 'に', 'ぬ', 'ね', 'の'].map((s) => `<button class="symbol-btn" data-char="${s}">${s}</button>`).join('')}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(widget);
    this.widgetEl = widget;

    // Tab switching
    widget.querySelectorAll('.palette-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        widget.querySelectorAll('.palette-tab-btn').forEach((b) => b.classList.remove('active'));
        widget.querySelectorAll('.palette-pane').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const targetPane = widget.querySelector(`#palette-pane-${btn.dataset.tab}`);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    // Close button
    widget.querySelector('#palette-close-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });

    // Color chips click (Insert Ctrl+C [code m)
    widget.querySelectorAll('.color-chip, .palette-act-btn[data-code]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const code = btn.dataset.code;
        if (code) {
          // Send Ctrl+C (0x03) + [ + code + m
          const ansiSeq = `\x03[${code}m`;
          this.sendData?.(ansiSeq);
        }
      });
    });

    // Insert Raw Ctrl+C button
    widget.querySelector('#palette-btn-ctrl-c')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.sendData?.('\x03');
    });

    // Symbol & Kaomoji buttons click
    widget.querySelectorAll('.symbol-btn, .kaomoji-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ch = btn.dataset.char;
        if (ch) {
          this.sendData?.(ch);
        }
      });
    });
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.isOpen = true;
    this.widgetEl.classList.remove('hidden');
  }

  close() {
    this.isOpen = false;
    this.widgetEl.classList.add('hidden');
  }
}
