// Smart Auto-Split Multi-Push Assistant (長推文智慧自動分段發送小幫手)

const DEFAULT_TEMPLATES = {
  "┬─┬ノ( º _ ºノ) 淡定與翻桌": "( ′_>`) ┬─┬  淡定放好\n(╯°Д°)╯ ︵ ┴─┴ 再次翻桌！",
  "◢▆▅▄▃ 崩潰大星光 ▃▄▅▆◣": "◢▆▅▄▃ 崩╰(〒皿〒)╯潰 ▃▄▅▆◣",
  "(づ′・ω・）づ 摸摸抱抱": "(づ′・ω・）づ 摸摸抱抱，不哭不哭，眼淚是珍珠",
  "(σ′▽′)′▽′)σ 哈哈看看你": "(σ′▽′)′▽′)σ 哈哈你看看你！",
  "( ￣ c￣)y▂ξ 搬板凳幹古": "( ￣ c￣)y▂ξ 搬板凳拿香腸，坐看鄉民大亂鬥",
  "(╬ﾟдﾟ)▄︻┻┳═一 狙擊開槍": "(╬ﾟдﾟ)▄︻┻┳═一 給我退下！",
  "🐾 經典萌貓 喵~ (3行)": "   /\\_/\\   喵~\n  (=._.=)\n  (\")_(\")",
  "印 5樓專業蓋章 (3行)": " ┌───┐\n │  5樓 │  專業蓋章！\n └───┘"
};

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

    // Templates
    this.tplSelect = document.getElementById('push-template-select');
    this.tplSaveBtn = document.getElementById('push-template-save');
    this.tplDeleteBtn = document.getElementById('push-template-delete');
    this.tplControls = document.getElementById('push-template-controls');
    this.tplSaveBar = document.getElementById('push-template-save-bar');
    this.tplNameInput = document.getElementById('push-template-name-input');
    this.tplSaveConfirmBtn = document.getElementById('push-template-save-confirm');
    this.tplSaveCancelBtn = document.getElementById('push-template-save-cancel');
    this.tplStatus = document.getElementById('push-template-status');
    this.templates = {};

    this.initEvents();
  }

  showTplStatus(msg, isSuccess = true) {
    if (!this.tplStatus) return;
    this.tplStatus.textContent = msg;
    this.tplStatus.style.color = isSuccess ? 'var(--green)' : 'var(--red)';
    this.tplStatus.style.display = 'inline';
    clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      if (this.tplStatus) this.tplStatus.style.display = 'none';
    }, 2000);
  }

  loadTemplates() {
    let tpls = {};
    try {
      const saved = localStorage.getItem('bbsterm_push_templates_v2');
      if (saved) {
        tpls = JSON.parse(saved);
      } else {
        tpls = { ...DEFAULT_TEMPLATES };
        localStorage.setItem('bbsterm_push_templates_v2', JSON.stringify(tpls));
      }
    } catch (e) {
      tpls = { ...DEFAULT_TEMPLATES };
    }
    this.templates = tpls;

    // Refresh select options
    if (this.tplSelect) {
      const prevVal = this.tplSelect.value;
      this.tplSelect.innerHTML = '<option value="">-- 📋 選擇常用範本 --</option>';
      Object.keys(this.templates).forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        this.tplSelect.appendChild(opt);
      });
      if (prevVal && this.templates[prevVal]) {
        this.tplSelect.value = prevVal;
      }
    }
  }

  initEvents() {
    this.closeBtn?.addEventListener('click', () => this.close());
    this.cancelBtn?.addEventListener('click', () => this.close());
    this.abortBtn?.addEventListener('click', () => this.abort());

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

    // Templates Events
    this.tplSelect?.addEventListener('change', () => {
      const val = this.tplSelect.value;
      if (val && this.templates[val]) {
        this.textInput.value = this.templates[val];
        this.updatePreview();
      }
    });

    this.tplSaveBtn?.addEventListener('click', () => {
      const txt = (this.textInput?.value || '').trim();
      if (!txt) {
        this.showTplStatus('⚠️ 輸入框為空', false);
        return;
      }
      if (this.tplControls) this.tplControls.style.display = 'none';
      if (this.tplSaveBar) {
        this.tplSaveBar.style.display = 'flex';
        this.tplNameInput.value = this.tplSelect?.value || '';
        this.tplNameInput.focus();
        this.tplNameInput.select();
      }
    });

    const doSave = () => {
      const cleanName = (this.tplNameInput?.value || '').trim();
      if (!cleanName) {
        this.showTplStatus('⚠️ 名稱不能為空', false);
        return;
      }
      this.templates[cleanName] = this.textInput.value;
      try {
        localStorage.setItem('bbsterm_push_templates_v2', JSON.stringify(this.templates));
      } catch (e) {}
      this.loadTemplates();
      if (this.tplSelect) this.tplSelect.value = cleanName;

      if (this.tplSaveBar) this.tplSaveBar.style.display = 'none';
      if (this.tplControls) this.tplControls.style.display = 'flex';
      this.showTplStatus(`✅ 已儲存！`, true);
    };

    this.tplSaveConfirmBtn?.addEventListener('click', doSave);
    this.tplNameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (this.tplSaveBar) this.tplSaveBar.style.display = 'none';
        if (this.tplControls) this.tplControls.style.display = 'flex';
      }
    });

    this.tplSaveCancelBtn?.addEventListener('click', () => {
      if (this.tplSaveBar) this.tplSaveBar.style.display = 'none';
      if (this.tplControls) this.tplControls.style.display = 'flex';
    });

    this.tplDeleteBtn?.addEventListener('click', () => {
      const val = this.tplSelect?.value;
      if (!val) {
        this.showTplStatus('⚠️ 請先選取範本', false);
        return;
      }
      delete this.templates[val];
      try {
        localStorage.setItem('bbsterm_push_templates_v2', JSON.stringify(this.templates));
      } catch (e) {}
      this.loadTemplates();
      this.showTplStatus(`🗑️ 已刪除！`, true);
    });
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
    if (this.tplSaveBar) this.tplSaveBar.style.display = 'none';
    if (this.tplControls) this.tplControls.style.display = 'flex';
    if (this.tplStatus) this.tplStatus.style.display = 'none';
    this.loadTemplates();
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
    // PTT has a hard push text limit of 50-52 bytes. 
    // We set the maximum safe bytes to 46 to leave a buffer, preventing boundary byte truncation and 'y' key merging.
    if (id.length > 0) {
      return Math.max(20, Math.min(46, 56 - id.length));
    }
    return 46;
  }

  splitText(rawText, maxBytes = null, strategy = 'fill') {
    if (!rawText || !rawText.trim()) return [];
    if (!maxBytes) maxBytes = this.getMaxSafeBytes();

    const clean = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawLines = clean.split('\n');
    const segments = [];

    const punctRegex = /([，。！？；：、,.!?;:~～—…\s]+)/;

    for (const rawLine of rawLines) {
      const line = rawLine.trimEnd();
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
              const part1 = current.slice(0, splitPos).trimEnd();
              const part2 = current.slice(splitPos);
              if (part1) segments.push(part1);
              current = part2 + ch;
              currentBytes = this.getStringByteWidth(current);
            } else {
              segments.push(current.trimEnd());
              current = ch;
              currentBytes = chWidth;
            }
          } else {
            segments.push(current.trimEnd());
            current = ch;
            currentBytes = chWidth;
          }
          i++;
        }
      }

      if (current.trim()) {
        segments.push(current.trimEnd());
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
      '3': { label: '→ 箭頭', cls: 'push-type-neutral' },
      'author': { label: '作者 ✍️', cls: 'push-type-neutral' },
    };

    this.currentSegments = segments; // Store split segments for editing support

    segments.forEach((seg, idx) => {
      const badgeInfo = typeBadges[typeKey] || typeBadges['1'];

      const item = document.createElement('div');
      item.className = 'push-preview-item';

      const badge = document.createElement('div');
      badge.className = `push-item-badge ${badgeInfo.cls}`;
      badge.textContent = badgeInfo.label;

      const textEl = document.createElement('div');
      textEl.className = 'push-item-text';
      textEl.contentEditable = 'true';
      textEl.textContent = seg;
      textEl.style.outline = 'none';
      textEl.style.borderBottom = '1px dashed var(--border-color)';
      textEl.style.cursor = 'text';

      const lenEl = document.createElement('div');
      lenEl.className = 'push-item-len';
      
      const updateLen = (txt) => {
        const bytes = this.getStringByteWidth(txt);
        if (bytes > maxBytes) {
          lenEl.innerHTML = `<span style="color: var(--red); font-weight: bold; cursor: help;" title="已超過單行安全長度限制 ${maxBytes} 位元組，可能導致亂碼或折行">⚠️ ${bytes}B</span>`;
        } else {
          lenEl.textContent = `${txt.length}字 (${bytes}B)`;
        }
      };
      updateLen(seg);

      textEl.oninput = () => {
        // Strip non-breaking space (0xA0 / &nbsp;) generated by browser contenteditable
        const newText = (textEl.textContent || '').replace(/\u00A0/g, ' ');
        this.currentSegments[idx] = newText;
        updateLen(newText);

        // Two-way sync: update main textarea so saving template saves the edited version!
        if (this.textInput) {
          this.textInput.value = this.currentSegments.join('\n');
        }
      };

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
        await this.sendSegmentSequence(this.currentSegments[idx], typeKey);
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
        navigator.clipboard.writeText(this.currentSegments[idx]);
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

  detectTargetStation() {
    const tab = this.getActiveTab?.();
    const addr = (tab?.address || '').toLowerCase();
    if (addr.includes('ptt.cc') || addr.includes('ptt2.cc') || addr.includes('ptt')) {
      return 'ptt';
    }
    return 'maple';
  }

  async sendSegmentSequence(seg, typeKey) {
    const isPtt = this.detectTargetStation() === 'ptt';
    const keyDelay = isPtt ? 500 : 750; // Dynamic delay: PTT is faster (500ms), MapleBBS needs more time (750ms) to prevent byte corruption

    if (typeKey === 'author') {
      // Author mode: PTT directly transitions to text input bar, skipping the 1/2/3 choice prompt!
      this.sendData('%');
      await this.sleep(keyDelay);
      if (this.abortController) return;

      this.sendData(`${seg}\r`);
      await this.sleep(keyDelay);
      if (this.abortController) return;

      if (isPtt) {
        // PTT asks '確定要儲存檔案嗎(Y/N)? [N]'. We must send 'y\r' to confirm saving.
        // Wait 200ms to ensure the prompt is open before sending y\r.
        await this.sleep(200);
        this.sendData('y\r');
        await this.sleep(keyDelay);
      }
    } else {
      this.sendData('%');
      await this.sleep(keyDelay);
      if (this.abortController) return;

      // Step 2: Push Type selection
      // PTT uses single-character prompt (no Enter); MapleBBS requires Enter to confirm selection!
      const optionStr = isPtt ? typeKey : `${typeKey}\r`;
      this.sendData(optionStr);
      await this.sleep(keyDelay);
      if (this.abortController) return;

      // Step 3: Segment text followed by Enter
      this.sendData(`${seg}\r`);
      await this.sleep(keyDelay);
      if (this.abortController) return;

      if (isPtt) {
        // PTT asks '確定要儲存檔案嗎(Y/N)? [N]'. We must send 'y\r' to confirm saving.
        // Wait 200ms to ensure the prompt is open before sending y\r.
        await this.sleep(200);
        this.sendData('y\r');
        await this.sleep(keyDelay);
      }
    }
  }

  async startPushing() {
    const tab = this.getActiveTab?.();
    if (!tab || !tab.isConnected) {
      alert('連線已中斷，無法推文。');
      return;
    }

    const segments = this.currentSegments || [];
    if (segments.length === 0) {
      alert('請先輸入推文內容！');
      return;
    }

    const typeKey = this.typeSelect?.value || '1';
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
      const isPtt = this.detectTargetStation() === 'ptt';
      // On PTT, all subsequent pushes (i > 0) after the first one automatically become arrows and skip the 1/2/3 menu
      const effectiveTypeKey = (isPtt && i > 0) ? 'author' : typeKey;

      await this.sendSegmentSequence(seg, effectiveTypeKey);
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
