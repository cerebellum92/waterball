// HD Screenshot & ANSI / HTML Export Controller for bbsterm

export class BbsExporter {
  static getPaletteColor(code, isBright = false, isBg = false) {
    const fgNormal = ['#16181d', '#b62324', '#238636', '#9e6a03', '#1f6feb', '#8957e5', '#1b7c83', '#b1bac4'];
    const fgBright = ['#7d8590', '#f85149', '#3fb950', '#e3b341', '#58a6ff', '#bc8cff', '#39c5bb', '#ffffff'];
    const bgNormal = ['#101216', '#b62324', '#238636', '#9e6a03', '#1f6feb', '#8957e5', '#1b7c83', '#b1bac4'];

    const idx = code % 8;
    if (isBg) return bgNormal[idx] || '#101216';
    return isBright ? (fgBright[idx] || '#ffffff') : (fgNormal[idx] || '#b1bac4');
  }

  static toPlainText(buf) {
    const lines = [];
    for (let r = 0; r < buf.rows; r++) {
      let lineStr = '';
      for (let c = 0; c < buf.cols; c++) {
        const cell = buf.lines[r][c];
        if (!cell || cell.isTrailByte) continue;
        lineStr += cell.ch || ' ';
      }
      lines.push(lineStr.trimEnd());
    }
    return lines.join('\n');
  }

  static toAnsiText(buf) {
    let result = '';
    for (let r = 0; r < buf.rows; r++) {
      let lastFg = -1;
      let lastBg = -1;
      let lastBold = false;
      let lastBlink = false;

      for (let c = 0; c < buf.cols; c++) {
        const cell = buf.lines[r][c];
        if (!cell || cell.isTrailByte) continue;

        const attr = cell.attr || {};
        const fg = attr.fg ?? 7;
        const bg = attr.bg ?? 0;
        const bold = !!attr.bold;
        const blink = !!attr.blink;

        // If attribute changed, emit SGR escape sequence
        if (fg !== lastFg || bg !== lastBg || bold !== lastBold || blink !== lastBlink) {
          const codes = [];
          if (!bold && lastBold) codes.push('0'); // reset if bold turned off
          if (bold) codes.push('1');
          if (blink) codes.push('5');
          if (fg >= 0 && fg <= 7) codes.push(String(30 + fg));
          if (bg > 0 && bg <= 7) codes.push(String(40 + bg));
          if (codes.length === 0) codes.push('m');

          result += `\x1b[${codes.join(';')}m`;

          lastFg = fg;
          lastBg = bg;
          lastBold = bold;
          lastBlink = blink;
        }

        result += cell.ch || ' ';
      }

      result += '\x1b[m\n';
    }
    return result;
  }

  static toHtmlText(buf) {
    let html = `<pre style="background:#101216;color:#ffffff;font-family:'Courier New',Consolas,monospace;font-size:14px;line-height:1.2;padding:16px;border-radius:8px;overflow-x:auto;white-space:pre;"><code>`;

    for (let r = 0; r < buf.rows; r++) {
      for (let c = 0; c < buf.cols; c++) {
        const cell = buf.lines[r][c];
        if (!cell || cell.isTrailByte) continue;

        const attr = cell.attr || {};
        const fg = attr.fg ?? 7;
        const bg = attr.bg ?? 0;
        const bold = !!attr.bold;
        const blink = !!attr.blink;

        const colorHex = this.getPaletteColor(fg, bold, false);
        const bgHex = bg > 0 ? this.getPaletteColor(bg, false, true) : null;

        let style = `color:${colorHex};`;
        if (bgHex) style += `background-color:${bgHex};`;
        if (bold) style += `font-weight:bold;`;
        if (blink) style += `text-decoration:underline;`;

        const escaped = (cell.ch || ' ')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

        html += `<span style="${style}">${escaped}</span>`;
      }
      html += '\n';
    }

    html += `</code></pre>`;
    return html;
  }
}

export class ExportModal {
  constructor() {
    this.modalEl = null;
    this.isOpen = false;
    this.currentTab = null;
    this.createDom();
  }

  createDom() {
    const modal = document.createElement('div');
    modal.id = 'export-modal';
    modal.className = 'export-modal hidden';

    modal.innerHTML = `
      <div class="export-dialog">
        <div class="export-header">
          <h2>📷 畫面截圖與彩色格式匯出中心</h2>
          <button id="export-close-btn" class="close-btn" title="關閉 (ESC)">&times;</button>
        </div>
        <div class="export-body">
          <div class="export-preview-card">
            <img id="export-preview-img" class="export-preview-img" src="" alt="BBS Snapshot Preview" />
            <div id="export-feedback-toast" class="export-toast hidden"></div>
          </div>
          <div class="export-actions-panel">
            <div class="export-action-group">
              <div class="export-group-title">🖼️ 高畫質圖片截圖 (2x Retina)</div>
              <div class="export-btn-row">
                <button id="btn-copy-png" class="btn-primary flex-1">📋 複製 PNG 圖片 (可直接貼在 LINE/Discord)</button>
                <button id="btn-download-png" class="btn-secondary">💾 下載 PNG 圖檔</button>
              </div>
            </div>

            <div class="export-action-group" style="margin-top: 14px;">
              <div class="export-group-title">🎨 代碼與文字格式匯出</div>
              <div class="export-btn-row">
                <button id="btn-copy-ansi" class="btn-secondary flex-1" title="複製標準 ANSI SGR 顏色代碼">🎨 複製 ANSI 彩色代碼</button>
                <button id="btn-copy-html" class="btn-secondary flex-1" title="複製帶有深色背景的 HTML 網頁程式碼">🌐 複製彩色 HTML 碼</button>
                <button id="btn-copy-text" class="btn-secondary flex-1" title="複製乾淨純文字">📄 複製純文字</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalEl = modal;

    // Events
    modal.querySelector('#export-close-btn')?.addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.close();
    });

    // Copy PNG button
    modal.querySelector('#btn-copy-png')?.addEventListener('click', () => this.copyPngImage());

    // Download PNG button
    modal.querySelector('#btn-download-png')?.addEventListener('click', () => this.downloadPngImage());

    // Copy ANSI button
    modal.querySelector('#btn-copy-ansi')?.addEventListener('click', () => this.copyAnsi());

    // Copy HTML button
    modal.querySelector('#btn-copy-html')?.addEventListener('click', () => this.copyHtml());

    // Copy Plain Text button
    modal.querySelector('#btn-copy-text')?.addEventListener('click', () => this.copyPlainText());
  }

  showToast(message, isError = false) {
    const toast = this.modalEl.querySelector('#export-feedback-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `export-toast ${isError ? 'error' : 'success'}`;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2000);
  }

  async copyPngImage() {
    if (!this.currentTab?.view?.canvas) return;
    try {
      const canvas = this.currentTab.view.canvas;
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
          this.showToast('✅ 高畫質 PNG 圖片已成功複製至剪貼簿！');
        } catch (err) {
          console.error('Clipboard copy image failed:', err);
          this.showToast('⚠️ 複製失敗，請嘗試下載圖檔', true);
        }
      }, 'image/png');
    } catch (e) {
      console.error(e);
    }
  }

  downloadPngImage() {
    if (!this.currentTab?.view?.canvas) return;
    const canvas = this.currentTab.view.canvas;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    const nowStr = new Date().toISOString().replace(/[-:T]/g, '_').slice(0, 15);
    a.download = `waterball_snapshot_${nowStr}.png`;
    a.href = dataUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    this.showToast('💾 PNG 截圖已成功下載！');
  }

  async copyAnsi() {
    if (!this.currentTab?.buf) return;
    const ansiText = BbsExporter.toAnsiText(this.currentTab.buf);
    await navigator.clipboard.writeText(ansiText);
    this.showToast('✅ ANSI 彩色代碼已複製到剪貼簿！');
  }

  async copyHtml() {
    if (!this.currentTab?.buf) return;
    const htmlText = BbsExporter.toHtmlText(this.currentTab.buf);
    await navigator.clipboard.writeText(htmlText);
    this.showToast('✅ 彩色 HTML 程式碼已複製到剪貼簿！');
  }

  async copyPlainText() {
    if (!this.currentTab?.buf) return;
    const text = BbsExporter.toPlainText(this.currentTab.buf);
    await navigator.clipboard.writeText(text);
    this.showToast('✅ 乾淨純文字已複製到剪貼簿！');
  }

  open(tab) {
    if (!tab || !tab.view?.canvas) return;
    this.currentTab = tab;

    // Generate preview
    const previewImg = this.modalEl.querySelector('#export-preview-img');
    if (previewImg) {
      previewImg.src = tab.view.canvas.toDataURL('image/png');
    }

    this.modalEl.classList.remove('hidden');
    this.isOpen = true;
  }

  close() {
    this.modalEl.classList.add('hidden');
    this.isOpen = false;
  }
}

export const exportModal = new ExportModal();
