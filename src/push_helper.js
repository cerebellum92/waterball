// Smart Auto-Split Multi-Push Assistant (長推文智慧自動分段發送小幫手)

export class PushHelper {
  constructor(sendDataFn, getActiveTabFn) {
    this.sendData = sendDataFn;
    this.getActiveTab = getActiveTabFn;
    this.isOpen = false;
    this.isPushing = false;
    this.abortController = false;

    this.modalEl = document.getElementById('push-modal');
    this.closeBtn = document.getElementById('push-modal-close');
    this.cancelBtn = document.getElementById('push-btn-cancel');
    this.sendBtn = document.getElementById('push-btn-send');
    this.abortBtn = document.getElementById('push-btn-abort');
    this.idInput = document.getElementById('push-input-id');
    this.typeSelect = document.getElementById('push-type-select');
    this.strategySelect = document.getElementById('push-strategy-select');
    this.delaySelect = document.getElementById('push-delay-select');
    this.textInput = document.getElementById('push-input-text');
    this.previewList = document.getElementById('push-preview-list');
    this.previewStats = document.getElementById('push-preview-stats');
    this.progressBox = document.getElementById('push-progress-box');
    this.progressLabel = document.getElementById('push-progress-label');
    this.progressCountdown = document.getElementById('push-progress-countdown');
    this.progressBarFill = document.getElementById('push-progress-bar-fill');

    this.initEvents();
  }

  initEvents() {
    this.closeBtn?.addEventListener('click', () => this.close());
    this.cancelBtn?.addEventListener('click', () => this.close());
    this.abortBtn?.addEventListener('click', () => this.abort());

    this.modalEl?.addEventListener('click', (e) => {
      if (e.target === this.modalEl && !this.isPushing) {
        this.close();
      }
    });

    this.idInput?.addEventListener('input', () => {
      try {
        localStorage.setItem('bbsterm_push_id', this.idInput.value.trim());
      } catch (e) {}
      this.updatePreview();
    });

    this.typeSelect?.addEventListener('change', () => this.updatePreview());
    this.strategySelect?.addEventListener('change', () => this.updatePreview());
    this.delaySelect?.addEventListener('change', () => this.updatePreview());
    this.textInput?.addEventListener('input', () => this.updatePreview());
    this.textInput?.addEventListener('paste', () => setTimeout(() => this.updatePreview(), 50));
    this.sendBtn?.addEventListener('click', () => this.startPushing());
  }

  open() {
    const tab = this.getActiveTab?.();
    if (!tab || !tab.isConnected) {
      alert('請先連線至 BBS 站台並進入文章畫面，再開啟推文小幫手。');
      return;
    }
    this.isOpen = true;
    this.modalEl?.classList.remove('hidden');
    this.isPushing = false;
    this.abortController = false;
    this.progressBox?.classList.add('hidden');
    this.sendBtn?.classList.remove('hidden');
    this.cancelBtn?.classList.remove('hidden');
    this.abortBtn?.classList.add('hidden');

    if (this.idInput && !this.idInput.value) {
      try {
        const savedId = localStorage.getItem('bbsterm_push_id');
        if (savedId) this.idInput.value = savedId;
      } catch (e) {}
    }

    if (this.textInput) {
      this.textInput.disabled = false;
      this.textInput.focus();
      this.updatePreview();
    }
  }

  close() {
    if (this.isPushing) return;
    this.isOpen = false;
    this.modalEl?.classList.add('hidden');
  }

  abort() {
    this.abortController = true;
    if (this.progressLabel) {
      this.progressLabel.textContent = '⏹️ 已中途停止發送。';
    }
    this.isPushing = false;
    this.sendBtn?.classList.remove('hidden');
    this.cancelBtn?.classList.remove('hidden');
    this.abortBtn?.classList.add('hidden');
    if (this.textInput) this.textInput.disabled = false;
  }

  getCharWidth(char) {
    const code = char.codePointAt(0);
    if (code >= 0x1100 && (
      code <= 0x115f ||
      code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd) ||
      (code >= 0x30000 && code <= 0x3fffd)
    )) {
      return 2;
    }
    return 1;
  }

  getStringByteWidth(str) {
    let width = 0;
    for (const ch of str) {
      width += this.getCharWidth(ch);
    }
    return width;
  }

  getMaxSafeBytes() {
    const id = (this.idInput?.value || '').trim();
    if (id.length > 0) {
      return Math.max(20, Math.min(56, 60 - id.length));
    }
    return 52;
  }

  splitText(rawText, maxBytes = null, strategy = 'fill') {
    if (!rawText || !rawText.trim()) return [];
    if (!maxBytes) maxBytes = this.getMaxSafeBytes();

    const clean = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawLines = clean.split('\n');
    const segments = [];

    const punctRegex = /([，。！？；：、,.!?;:~～—…\s]+)/;

    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (!line) continue;

      let current = '';
      let currentBytes = 0;
      const chars = Array.from(line);
      let i = 0;

      while (i < chars.length) {
        const ch = chars[i];
        const chWidth = this.getCharWidth(ch);

        if (currentBytes + chWidth <= maxBytes) {
          current += ch;
          currentBytes += chWidth;
          i++;
        } else {
          if (strategy === 'punct') {
            const pMatches = Array.from(current.matchAll(new RegExp(punctRegex, 'g')));
            let splitPos = -1;
            for (const m of pMatches) {
              const idx = m.index + m[0].length;
              if (idx >= current.length * 0.45 && idx < current.length) {
                splitPos = idx;
              }
            }

            if (splitPos !== -1) {
              const part1 = current.slice(0, splitPos).trim();
              const part2 = current.slice(splitPos);
              if (part1) segments.push(part1);
              current = part2 + ch;
              currentBytes = this.getStringByteWidth(current);
            } else {
              segments.push(current.trim());
              current = ch;
              currentBytes = chWidth;
            }
          } else {
            segments.push(current.trim());
            current = ch;
            currentBytes = chWidth;
          }
          i++;
        }
      }

      if (current.trim()) {
        segments.push(current.trim());
      }
    }

    return segments;
  }

  updatePreview() {
    const text = this.textInput?.value || '';
    const typeKey = this.typeSelect?.value || '1';
    const strategy = this.strategySelect?.value || 'fill';

    const maxBytes = this.getMaxSafeBytes();
    const maxChars = Math.floor(maxBytes / 2);
    const segments = this.splitText(text, maxBytes, strategy);

    if (this.previewStats) {
      const totalChars = Array.from(text.replace(/\s+/g, '')).length;
      const idStr = (this.idInput?.value || '').trim();
      const idLabel = idStr ? `ID: ${idStr} ➔ ` : '';
      const stratLabel = strategy === 'fill' ? '極致塞滿' : '標點優先';
      this.previewStats.textContent = `共 ${segments.length} 段 (${totalChars} 字) • ${idLabel}${stratLabel} ${maxBytes}B/行 (~${maxChars}字)`;
    }

    if (!this.previewList) return;
    this.previewList.innerHTML = '';

    if (segments.length === 0) {
      this.previewList.innerHTML = `<div class="push-preview-empty">請在上方輸入文字，系統將自動為您分段預覽...</div>`;
      return;
    }

    const typeBadges = {
      '1': { label: '推 👍', cls: 'push-type-up' },
      '2': { label: '噓 👎', cls: 'push-type-down' },
    };

    segments.forEach((seg, idx) => {
      const badgeInfo = typeBadges[typeKey] || typeBadges['1'];

      const item = document.createElement('div');
      item.className = 'push-preview-item';

      const badge = document.createElement('div');
      badge.className = `push-item-badge ${badgeInfo.cls}`;
      badge.textContent = badgeInfo.label;

      const textEl = document.createElement('div');
      textEl.className = 'push-item-text';
      textEl.textContent = seg;

      const lenEl = document.createElement('div');
      lenEl.className = 'push-item-len';
      lenEl.textContent = `${seg.length}字`;

      const btnSendSingle = document.createElement('button');
      btnSendSingle.className = 'push-item-btn';
      btnSendSingle.title = '單獨發送此分段';
      btnSendSingle.textContent = '▶️ 發送';
      btnSendSingle.onclick = async (e) => {
        e.stopPropagation();
        const tab = this.getActiveTab?.();
        if (!tab || !tab.isConnected) {
          alert('連線已中斷，無法推文。');
          return;
        }
        btnSendSingle.disabled = true;
        btnSendSingle.textContent = '⏳ 送出...';
        await this.sendSegmentSequence(seg, typeKey);
        btnSendSingle.textContent = '✅ 已送出';
        setTimeout(() => {
          btnSendSingle.disabled = false;
          btnSendSingle.textContent = '▶️ 發送';
        }, 1500);
      };

      const btnCopy = document.createElement('button');
      btnCopy.className = 'push-item-btn';
      btnCopy.title = '複製此段文字';
      btnCopy.textContent = '📋 複製';
      btnCopy.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(seg);
        btnCopy.textContent = '✓ 已複製';
        setTimeout(() => { btnCopy.textContent = '📋 複製'; }, 1000);
      };

      item.appendChild(badge);
      item.appendChild(textEl);
      item.appendChild(lenEl);
      item.appendChild(btnSendSingle);
      item.appendChild(btnCopy);
      this.previewList.appendChild(item);
    });
  }

  escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async sendSegmentSequence(seg, typeKey) {
    this.sendData('%');
    await this.sleep(350);
    if (this.abortController) return;

    this.sendData(`${typeKey}\r`);
    await this.sleep(350);
    if (this.abortController) return;

    this.sendData(`${seg}\r`);
    await this.sleep(350);
  }

  async startPushing() {
    const tab = this.getActiveTab?.();
    if (!tab || !tab.isConnected) {
      alert('連線已中斷，無法推文。');
      return;
    }

    const text = this.textInput?.value || '';
    const strategy = this.strategySelect?.value || 'fill';
    const typeKey = this.typeSelect?.value || '1';
    const maxBytes = this.getMaxSafeBytes();
    const segments = this.splitText(text, maxBytes, strategy);
    if (segments.length === 0) {
      alert('請先輸入推文內容！');
      return;
    }

    const delayMs = parseInt(this.delaySelect?.value || '2000', 10);

    this.isPushing = true;
    this.abortController = false;

    this.textInput.disabled = true;
    this.sendBtn?.classList.add('hidden');
    this.cancelBtn?.classList.add('hidden');
    this.abortBtn?.classList.remove('hidden');
    this.progressBox?.classList.remove('hidden');

    for (let i = 0; i < segments.length; i++) {
      if (this.abortController) break;

      const seg = segments[i];

      const percent = Math.round(((i + 1) / segments.length) * 100);
      if (this.progressLabel) {
        this.progressLabel.textContent = `正在發送第 ${i + 1} / ${segments.length} 段...`;
      }
      if (this.progressBarFill) {
        this.progressBarFill.style.width = `${percent}%`;
      }

      await this.sendSegmentSequence(seg, typeKey);
      if (this.abortController) break;

      if (i < segments.length - 1 && !this.abortController) {
        let remaining = delayMs;
        const tick = 100;
        while (remaining > 0 && !this.abortController) {
          if (this.progressCountdown) {
            this.progressCountdown.textContent = `冷卻倒數 ${(remaining / 1000).toFixed(1)}s`;
          }
          await this.sleep(tick);
          remaining -= tick;
        }
      }
    }

    if (!this.abortController) {
      if (this.progressLabel) {
        this.progressLabel.textContent = '🎉 全部分段推文已順利發送完成！';
      }
      if (this.progressBarFill) {
        this.progressBarFill.style.width = '100%';
      }
      if (this.progressCountdown) {
        this.progressCountdown.textContent = '完成';
      }
      await this.sleep(1200);
      this.isPushing = false;
      this.close();
    } else {
      this.isPushing = false;
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
