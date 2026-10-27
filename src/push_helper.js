// Smart Auto-Split Multi-Push Assistant (長推文智慧自動分段發送小幫手)

import { writeClipboardText } from './platform.js';

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
  constructor(sendDataFn, getActiveTabFn, options = {}) {
    // A fire-and-forget active-tab sender cannot safely drive terminal prompts.
    this.sendToTab = options.sendToTab;
    this.getSession = options.getSession;
    this.acquireInput = options.acquireInput;
    this.releaseInput = options.releaseInput;
    this.getUserId = options.getUserId;
    this.getTabById = options.getTabById || (id => { const tab = getActiveTabFn?.(); return tab?.id === id ? tab : null; });
    this.now = options.now || Date.now;
    this.promptTimeoutMs = options.promptTimeoutMs || 8000;
    this.maxRunMs = options.maxRunMs || 300000;
    this.maxCooldownSeconds = 120;
    this.maxRetries = 3;
    if (options.sleep) this.sleep = options.sleep;
    this.getActiveTab = getActiveTabFn;
    this.isOpen = false;
    this.isPushing = false;
    this._run = null;

    this.modalEl = document.getElementById('push-modal');
    this.closeBtn = document.getElementById('push-modal-close');
    this.cancelBtn = document.getElementById('push-btn-cancel');
    this.sendBtn = document.getElementById('push-btn-send');
    this.abortBtn = document.getElementById('push-btn-abort');
    this.reviewBtn = document.getElementById('push-btn-review');
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
    this.authorNotice = document.getElementById('push-author-notice');

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
    this.reviewBtn?.addEventListener('click', () => {
      if (this._run) return;
      this.recovery = null;
      this.setRunningUi(false);
      if (this.progressLabel) this.progressLabel.textContent = '已解除未確認狀態；請刪除畫面上已送出的段落，再手動開始。';
    });

    this.idInput?.addEventListener('input', () => {
      this.recovery = null;
      try {
        localStorage.setItem('bbsterm_push_id', this.idInput.value.trim());
      } catch (e) {}
      this.checkAuthorMode();
      this.updatePreview();
      this.setRunningUi(false);
    });

    this.typeSelect?.addEventListener('change', () => this.updatePreview());
    this.strategySelect?.addEventListener('change', () => this.updatePreview());
    this.delaySelect?.addEventListener('change', () => this.updatePreview());
    this.textInput?.addEventListener('input', () => {
      this.recovery = null;
      this.updatePreview();
      this.setRunningUi(false);
    });
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
    if (this._run) return;
    const tab = this.getActiveTab?.();
    if (!tab || !tab.isConnected) {
      alert('請先連線至 BBS 站台並進入文章畫面，再開啟推文小幫手。');
      return;
    }
    this.recovery = null;
    this.isOpen = true;
    this.modalEl?.classList.remove('hidden');
    this.isPushing = false;

    if (this.tplSaveBar) this.tplSaveBar.style.display = 'none';
    if (this.tplControls) this.tplControls.style.display = 'flex';
    if (this.tplStatus) this.tplStatus.style.display = 'none';
    this.loadTemplates();
    this.progressBox?.classList.add('hidden');
    if (this.progressLabel) this.progressLabel.textContent = '';
    if (this.progressCountdown) this.progressCountdown.textContent = '';
    if (this.progressBarFill) this.progressBarFill.style.width = '0%';
    this.sendBtn?.classList.remove('hidden');
    this.cancelBtn?.classList.remove('hidden');
    this.abortBtn?.classList.add('hidden');

    const detectedId = this.detectUserId(tab);
    if (this.idInput) {
      if (detectedId && !this.idInput.value) {
        this.idInput.value = detectedId;
      } else if (!this.idInput.value) {
        try {
          const savedId = localStorage.getItem('bbsterm_push_id');
          if (savedId) this.idInput.value = savedId;
        } catch (e) {}
      }
    }

    this.setRunningUi(false);

    if (this.textInput) {
      this.textInput.disabled = false;
      this.textInput.focus();
      this.updatePreview();
    }
  }

  detectUserId(tab = this.getActiveTab?.()) {
    const fromOptions = this.getUserId?.(tab);
    if (fromOptions && typeof fromOptions === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{1,11}$/.test(fromOptions.trim())) {
      return fromOptions.trim();
    }
    try {
      const saved = localStorage.getItem('bbsterm_push_id');
      if (saved && /^[a-zA-Z][a-zA-Z0-9_]{1,11}$/.test(saved.trim())) return saved.trim();
    } catch {}
    if (tab?.buf) {
      const lines = this.getBottomPromptText(tab).split('\n');
      for (const line of lines) {
        const m = line.trim().match(/^(?:[推噓→]|\[[推噓→]\])\s*([a-zA-Z][a-zA-Z0-9_]{1,11})\s*[:：]/);
        if (m) return m[1];
      }
    }
    return '';
  }

  recordDetectedId(id) {
    if (!id || typeof id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{1,11}$/.test(id.trim())) return;
    const cleanId = id.trim();
    try {
      localStorage.setItem('bbsterm_push_id', cleanId);
    } catch {}
    if (this.idInput && !this.idInput.value) {
      this.idInput.value = cleanId;
      this.checkAuthorMode();
      this.updatePreview();
    }
  }

  close() {
    if (this.isPushing) return;
    this.recovery = null;
    this.isOpen = false;
    this.modalEl?.classList.add('hidden');
    clearTimeout(this._statusTimer);
    for (const timer of this._uiTimers || []) clearTimeout(timer);
    this._uiTimers?.clear();
  }

  later(callback, ms) {
    this._uiTimers ||= new Set();
    const timer = setTimeout(() => { this._uiTimers.delete(timer); callback(); }, ms);
    this._uiTimers.add(timer);
    return timer;
  }

  getCharWidth(char) {
    // Big5/UAO bytes, not Unicode display width: conservatively reserve two
    // bytes for every non-ASCII code point (including symbols and emoji).
    return char.codePointAt(0) <= 0x7f ? 1 : 2;
  }

  getStringByteWidth(str) {
    let width = 0;
    for (const ch of str) {
      width += this.getCharWidth(ch);
    }
    return width;
  }

  getMaxSafeBytes() {
    const id = (this.idInput?.value || this.detectUserId() || '').trim();
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
    if (!Number.isInteger(maxBytes) || maxBytes < 2 || maxBytes > 46) throw new Error('分段長度必須介於 2 至 46 bytes');

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
    let typeKey = this.typeSelect?.value || '3';
    const author = this.detectArticleAuthor(), id = String(this.idInput?.value || '').trim();
    if (!author || !/^[a-z][a-z0-9_]{1,11}$/i.test(id) || author.toLowerCase() === id.toLowerCase()) typeKey = '3';
    const strategy = this.strategySelect?.value || 'fill';

    const maxBytes = this.getMaxSafeBytes();
    const maxChars = Math.floor(maxBytes / 2);
    const segments = text.length <= 10000 ? this.splitText(text, maxBytes, strategy) : [];
    this.currentSegments = segments;

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
      this.previewList.innerHTML = `<div class="push-preview-empty">${text.length > 10000 ? '文字超過 10,000 字元，請縮短後再預覽。' : '請在上方輸入文字，系統將自動為您分段預覽...'}</div>`;
      return;
    }

    const typeBadges = {
      '1': { label: '推 👍', cls: 'push-type-up' },
      '2': { label: '噓 👎', cls: 'push-type-down' },
      '3': { label: '→ 箭頭', cls: 'push-type-neutral' },
      'author': { label: '作者 ✍️', cls: 'push-type-neutral' },
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
      textEl.contentEditable = this.isPushing ? 'false' : 'true';
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
        if (this._run) return;
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
      btnSendSingle.disabled = this.isPushing || Boolean(this.recovery?.uncertain);
      btnSendSingle.title = '單獨發送此分段';
      btnSendSingle.textContent = '▶️ 發送';
      btnSendSingle.onclick = async (e) => {
        e.stopPropagation();
        if (this._run || this.recovery?.uncertain) return;
        await this.runSegments([this.currentSegments[idx]], this.typeSelect?.value || '3', { singleIndex: idx });
      };

      const btnCopy = document.createElement('button');
      btnCopy.className = 'push-item-btn';
      btnCopy.title = '複製此段文字';
      btnCopy.textContent = '📋 複製';
      btnCopy.onclick = (e) => {
        e.stopPropagation();
        writeClipboardText(this.currentSegments[idx]).catch(() => {});
        btnCopy.textContent = '✓ 已複製';
        this.later(() => { btnCopy.textContent = '📋 複製'; }, 1000);
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

  detectTargetStation(tab = this.getActiveTab?.()) {
    try {
      const address = String(tab?.address || '');
      const host = new URL(/^[a-z]+:\/\//i.test(address) ? address : `ssh://${address}`).hostname.toLowerCase();
      return /^(?:[^.]+\.)*(?:ptt|ptt2)\.cc$/.test(host) ? 'ptt' : 'unsupported';
    } catch { return 'unsupported'; }
  }

  detectArticleAuthor(tab = this.getActiveTab?.()) {
    if (!tab?.buf) return null;
    for (let row = 0; row < Math.min(5, tab.buf.rows); row++) {
      const match = tab.buf.getRowText(tab.buf.lines[row] || []).match(/^\s*作者(?:\s*[:：]\s*|\s+)(?:\[([a-zA-Z][a-zA-Z0-9_]{1,11})\]|([a-zA-Z][a-zA-Z0-9_]{1,11}))(?=\s|[（(]|$)/);
      if (match) return match[1] || match[2];
    }
    return null;
  }

  articleIdentity(tab) {
    if (!tab?.buf) return '';
    const fields = [];
    for (let row = 0; row < Math.min(5, tab.buf.rows); row++) {
      const text = tab.buf.getRowText(tab.buf.lines[row] || []).trimEnd();
      if (/^\s*(?:作者|標題|時間)(?:\s*[:：]\s*|\s+)/.test(text)) fields.push(text);
    }
    return fields.length >= 2 ? fields.join('\n') : '';
  }

  checkAuthorMode() {
    return false;
  }

  getBottomPromptText(tab = this.getActiveTab?.()) {
    if (!tab?.buf) return '';
    const rows = tab.buf.rows;
    return [rows - 2, rows - 1].filter(row => row >= 0).map(row => tab.buf.getRowText(tab.buf.lines[row] || [])).join('\n');
  }

  promptSnapshot(tab = this.getActiveTab?.()) {
    const bottomText = this.getBottomPromptText(tab);
    const state = this.detectPushState(tab);
    return { state, text: bottomText, draft: '' };
  }

  detectPushState(tab = this.getActiveTab?.()) {
    const bottomText = this.getBottomPromptText(tab);
    if (/(?:[◆●※]\s*)?(?:請勿快速連續推文|距離上次發文或推文|距離上次推文|需間隔|請稍候|請勿在).*?(\d{1,6})\s*秒/.test(bottomText)) {
      return 'cooldown';
    }
    if (/(?:確定\s*\[[yY]\/[nN]\]|確定要儲存檔案嗎)/.test(bottomText)) {
      return 'confirm-save';
    }
    if (/(?:[推噓→]|\[[推噓→]\])\s*[a-zA-Z0-9_]+\s*[:：]|(?:請輸入您的意見|加註意見)\s*[:：]/.test(bottomText)) {
      return 'input-content';
    }
    if (/您覺得這篇文章|[(（]1\/2\/3[)）]\?/.test(bottomText)) {
      return 'choose-type';
    }
    if (/瀏覽\s+第\s+\d+/.test(bottomText)) {
      return 'idle';
    }
    return 'unknown';
  }

  detectCooldownSeconds(tab = this.getActiveTab?.()) {
    const bottomText = this.getBottomPromptText(tab);
    for (const line of bottomText.split('\n')) {
      const m = line.trim().match(/^(?:[◆●※]\s*)?(?:請勿快速連續推文[，,、]?\s*請等待|距離上次發文或推文間隔需|距離上次推文(?:還)?需等待|需間隔|請稍候|請勿在)\s*(\d{1,6})\s*秒/);
      if (m) {
        const s = parseInt(m[1], 10);
        return s > 0 && s <= 120 ? s : null;
      }
    }
    return null;
  }

  async sendKeystroke(data, tab = this.getActiveTab?.()) {
    if (!tab) return;
    if (this.sendToTab) {
      const session = this.getSession ? await this.getSession(tab.id) : null;
      await this.sendToTab(tab.id, data, session, this._inputLease || null);
    } else if (this.sendData) {
      this.sendData(data);
    }
  }

  async sendSegmentSequence(seg, typeKey = '1', isFirstSegment = true, signal = null) {
    const tab = this.getActiveTab?.();
    if (!tab || !tab.isConnected) throw new Error('連線已中斷，無法推文');
    const isPtt = this.detectTargetStation(tab) === 'ptt';
    const keyDelay = isPtt ? 250 : 500;
    const pushKey = isPtt ? 'X' : '%';

    // 1. Check if terminal is ALREADY at push prompt before sending any initial key
    let bottomText = this.getBottomPromptText(tab);
    let atInput = /(?:[推噓→]|\[[推噓→]\])\s*[a-zA-Z0-9_]+\s*[:：]|(?:請輸入您的意見|加註意見)\s*[:：]/.test(bottomText);
    let atChoice = /您覺得這篇文章|[(（]1\/2\/3[)）]\?/.test(bottomText);

    if (!atInput && !atChoice) {
      // Not yet in push interface: trigger push mode with 'X' (or '%' on Maple)
      await this.sendKeystroke(pushKey, tab);
      await this.sleep(keyDelay, signal);
      if (this.abortController || signal?.aborted) return { status: 'aborted' };

      bottomText = this.getBottomPromptText(tab);
      atInput = /(?:[推噓→]|\[[推噓→]\])\s*[a-zA-Z0-9_]+\s*[:：]|(?:請輸入您的意見|加註意見)\s*[:：]/.test(bottomText);
      atChoice = /您覺得這篇文章|[(（]1\/2\/3[)）]\?/.test(bottomText);
    }

    // 2. If at 1/2/3 choice prompt, send choice (PTT single key, Maple with \r)
    if (atChoice && !atInput) {
      // On subsequent segments (isFirstSegment === false), choose '3' (→)
      const choice = !isFirstSegment ? '3' : (['1', '2', '3'].includes(typeKey) ? typeKey : '1');
      const optionStr = isPtt ? choice : `${choice}\r`;
      await this.sendKeystroke(optionStr, tab);
      await this.sleep(keyDelay, signal);
      if (this.abortController || signal?.aborted) return { status: 'aborted' };
    }

    // 3. Send segment text + Enter
    await this.sendKeystroke(`${seg}\r`, tab);
    await this.sleep(keyDelay, signal);
    if (this.abortController || signal?.aborted) return { status: 'aborted' };

    // 4. Confirm saving (on PTT, send y\r)
    if (isPtt) {
      await this.sendKeystroke('y\r', tab);
      await this.sleep(keyDelay, signal);
      if (this.abortController || signal?.aborted) return { status: 'aborted' };
    }

    // 5. Check if PTT threw a cooldown warning
    bottomText = this.getBottomPromptText(tab);
    const cdMatch = bottomText.match(/(?:[◆●※]\s*)?(?:請勿快速連續推文|距離上次發文或推文|距離上次推文|需間隔|請稍候|請勿在).*?(\d{1,6})\s*秒/);
    if (cdMatch) {
      const waitSec = parseInt(cdMatch[1], 10);
      if (waitSec > 0 && waitSec <= 120) {
        return { status: 'cooldown', seconds: waitSec };
      }
    }

    return { status: 'confirmed' };
  }

  normalizeSegment(segment) {
    return String(segment).replace(/\u00a0/g, ' ').replace(/[\u2000-\u200b\u202f\u205f\ufeff]/g, ' ');
  }

  async runSegments(input, typeKey = '1') {
    if (Array.isArray(input)) {
      this.currentSegments = [...input];
    }
    if (this.typeSelect) this.typeSelect.value = typeKey;
    return this.startPushing();
  }

  async startPushing() {
    const tab = this.getActiveTab?.();
    if (!tab || !tab.isConnected) {
      alert('連線已中斷，無法推文。');
      return { status: 'failed', error: '連線已中斷' };
    }

    const segments = [...(this.currentSegments || [])];
    if (segments.length === 0) {
      alert('請先輸入推文內容！');
      return { status: 'failed', error: '推文內容為空' };
    }

    const typeKey = this.typeSelect?.value || '1';
    const delayVal = this.delaySelect?.value || '2000';
    const baseDelayMs = parseInt(delayVal, 10) || 2000;

    this.isPushing = true;
    this.abortController = false;
    this._run = { controller: new AbortController(), tab };

    if (this.acquireInput) {
      this._inputLease = this.acquireInput(tab.id);
      if (!this._inputLease) {
        alert('終端機正由其他輸入流程使用，請稍後再試。');
        this.isPushing = false;
        return { status: 'failed', error: '終端輸入忙碌中' };
      }
    }

    this.setRunningUi(true);
    if (this.progressBarFill) this.progressBarFill.style.width = '0%';
    if (this.progressCountdown) this.progressCountdown.textContent = '';

    let confirmedCount = 0;
    let result = { status: 'confirmed', confirmed: 0 };

    try {
      for (let i = 0; i < segments.length; i++) {
        if (this.abortController || this._run?.controller?.signal?.aborted) {
          result = { status: 'aborted', confirmed: confirmedCount };
          break;
        }

        const seg = segments[i];
        if (this.progressLabel) {
          this.progressLabel.textContent = `正在發送第 ${i + 1} / ${segments.length} 段...`;
        }

        const outcome = await this.sendSegmentSequence(seg, typeKey, i === 0, this._run.controller.signal);

        if (this.abortController || this._run?.controller?.signal?.aborted) {
          result = { status: 'aborted', confirmed: confirmedCount };
          break;
        }

        if (outcome.status === 'cooldown') {
          const waitSec = outcome.seconds || 5;
          let remaining = (waitSec + 0.5) * 1000;
          while (remaining > 0 && !this.abortController && !this._run?.controller?.signal?.aborted) {
            if (this.progressCountdown) {
              this.progressCountdown.textContent = `防冷卻倒數 ${(remaining / 1000).toFixed(1)}s`;
            }
            await this.sleep(100, this._run.controller.signal);
            remaining -= 100;
          }
          if (this.abortController || this._run?.controller?.signal?.aborted) {
            result = { status: 'aborted', confirmed: confirmedCount };
            break;
          }
          // Retry this same segment
          i--;
          continue;
        }

        // Successfully sent this segment
        confirmedCount++;
        result.confirmed = confirmedCount;

        const percent = Math.round((confirmedCount / segments.length) * 100);
        if (this.progressBarFill) {
          this.progressBarFill.style.width = `${percent}%`;
        }

        // Update pending segments and text box
        this.currentSegments = segments.slice(confirmedCount);
        if (this.textInput) {
          this.textInput.value = this.currentSegments.join('\n');
        }
        this.updatePreview();

        // If there are more segments to send, wait the interval delay
        if (i < segments.length - 1 && !this.abortController && !this._run?.controller?.signal?.aborted) {
          let remaining = baseDelayMs;
          while (remaining > 0 && !this.abortController && !this._run?.controller?.signal?.aborted) {
            if (this.progressCountdown) {
              this.progressCountdown.textContent = `間隔倒數 ${(remaining / 1000).toFixed(1)}s`;
            }
            await this.sleep(100, this._run.controller.signal);
            remaining -= 100;
          }
        }
      }

      if (!this.abortController && !this._run?.controller?.signal?.aborted && confirmedCount === segments.length) {
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
        this.close();
      } else if (this.abortController || this._run?.controller?.signal?.aborted) {
        if (this.progressLabel) {
          this.progressLabel.textContent = `已中止推文發送。已確認 ${confirmedCount} 段，未送出段落已為您保留。`;
        }
        if (this.progressCountdown) {
          this.progressCountdown.textContent = '已中止';
        }
      }
    } catch (err) {
      result = { status: 'failed', confirmed: confirmedCount, error: err.message };
      if (this.progressLabel) {
        this.progressLabel.textContent = `${err.message || '發送過程發生錯誤'}。已確認 ${confirmedCount} 段，未送出段落已為您保留。`;
      }
      if (this.progressCountdown) {
        this.progressCountdown.textContent = '已停止';
      }
    } finally {
      if (this._inputLease && this.releaseInput && tab) {
        this.releaseInput(tab.id, this._inputLease);
        this._inputLease = null;
      }
      this._run = null;
      this.isPushing = false;
      this.setRunningUi(false);
      this.updatePreview();
    }

    return result;
  }

  setRunningUi(running) {
    this.isPushing = running;
    for (const element of [this.textInput, this.idInput, this.typeSelect, this.strategySelect, this.delaySelect, this.tplSelect, this.tplSaveBtn, this.tplDeleteBtn]) {
      if (element) element.disabled = running;
    }
    for (const element of this.previewList?.querySelectorAll('.push-item-text') || []) {
      element.contentEditable = running ? 'false' : 'true';
    }
    for (const element of this.previewList?.querySelectorAll('button') || []) {
      element.disabled = running;
    }
    this.sendBtn?.classList.toggle('hidden', running);
    this.cancelBtn?.classList.toggle('hidden', running);
    this.abortBtn?.classList.toggle('hidden', !running);
    this.reviewBtn?.classList.add('hidden');
    if (this.progressBox) {
      if (running) {
        this.progressBox.classList.remove('hidden');
      } else {
        if (!this.progressLabel?.textContent) {
          this.progressBox.classList.add('hidden');
        }
      }
    }
    if (this.sendBtn) this.sendBtn.disabled = running;
    if (!running) this.checkAuthorMode();
  }

  abort() {
    this.abortController = true;
    if (this._run?.controller) {
      this._run.controller.abort();
    }
    this.isPushing = false;
    this.setRunningUi(false);
    if (this.progressLabel) {
      this.progressLabel.textContent = '已中止推文發送。未送出段落已為您保留。';
    }
    if (this.progressCountdown) {
      this.progressCountdown.textContent = '已中止';
    }
  }

  sleep(ms, signal = null) {
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
      const onAbort = () => { cleanup(); resolve(); };
      const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
