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
      try {
        localStorage.setItem('bbsterm_push_id', this.idInput.value.trim());
      } catch (e) {}
      this.checkAuthorMode();
      this.updatePreview();
    });

    this.typeSelect?.addEventListener('change', () => this.updatePreview());
    this.strategySelect?.addEventListener('change', () => this.updatePreview());
    this.delaySelect?.addEventListener('change', () => this.updatePreview());
    this.textInput?.addEventListener('input', () => this.updatePreview());
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
    this.isOpen = true;
    this.modalEl?.classList.remove('hidden');
    this.isPushing = false;

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

    this.setRunningUi(false);

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
    clearTimeout(this._statusTimer);
    for (const timer of this._uiTimers || []) clearTimeout(timer);
    this._uiTimers?.clear();
  }

  later(callback, ms) {
    this._uiTimers ||= new Set();
    const timer = setTimeout(() => { this._uiTimers.delete(timer); callback(); }, ms);
    this._uiTimers.add(timer);
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
    const author = this.detectArticleAuthor();
    const id = String(this.idInput?.value || '').trim();
    const isAuthor = Boolean(author && /^[a-z][a-z0-9_]{1,11}$/i.test(id) && author.toLowerCase() === id.toLowerCase());
    const forced = isAuthor || !author || !/^[a-z][a-z0-9_]{1,11}$/i.test(id);
    if (forced && !this._forcedType) this._previousType = this.typeSelect?.value || '3';
    if (this.typeSelect) {
      this.typeSelect.disabled = forced || this.isPushing;
      if (forced) this.typeSelect.value = isAuthor ? 'author' : '3';
      else if (this._forcedType) this.typeSelect.value = this._previousType === 'author' ? '3' : this._previousType;
    }
    this._forcedType = forced;
    if (this.authorNotice) {
      this.authorNotice.textContent = isAuthor
        ? `✍️ 標頭作者與自填 ID 相符 (${author})，發送時強制箭頭模式`
        : '自填 ID 不等於登入驗證；作者或 ID 無法辨識時只發送箭頭。';
      this.authorNotice.classList.remove('hidden');
    }
    return isAuthor;
  }

  getBottomPromptText(tab = this.getActiveTab?.()) {
    if (!tab?.buf) return '';
    const rows = tab.buf.rows;
    return [rows - 2, rows - 1].filter(row => row >= 0).map(row => tab.buf.getRowText(tab.buf.lines[row] || [])).join('\n');
  }

  promptSnapshot(tab = this.getActiveTab?.()) {
    const lines = this.getBottomPromptText(tab).split('\n');
    const lineIndex = lines[1]?.trim() ? 1 : 0;
    const line = lines[lineIndex]?.trim() || '';
    // Inspect only the active footer, never phrases embedded in article prose.
    const cooldown = line.match(/^(?:[◆●※]\s*)?(?:請勿快速連續推文[，,、]?\s*請等待|距離上次發文或推文間隔需|距離上次推文(?:還)?需等待|需間隔|請稍候|請勿在)\s*(\d{1,6})\s*秒(?:.*)$/);
    if (cooldown) {
      const seconds = Number(cooldown[1]);
      return { state: 'cooldown', text: line, seconds: seconds >= 1 && seconds <= this.maxCooldownSeconds ? seconds : null };
    }
    const input = line.match(/^(?:請輸入您的意見|加註意見(?:\s*[（(]→[）)])?)\s*[:：](.*)$/);
    let state = 'unknown', draft = '';
    if (/^確定要儲存檔案嗎\s*[（(]Y\/N[）)]\s*[?？]\s*(?:\[[Nn]\])?\s*$/i.test(line)) state = 'confirm-save';
    else if (input) { state = 'input-content'; draft = input[1]; }
    else {
      const choice = /^\(1\/2\/3\)\?\s*(?:\[[123]\])?$/.test(line) ? lines.map(value => value.trim()).join(' ') : line;
      if (/^您覺得這篇文章\s*[:：].*(?:\(1\)|1\)).*(?:\(2\)|2\)).*(?:\(3\)|3\)).*[?？]\s*(?:\[[123]\])?\s*$/.test(choice)) state = 'choose-type';
      else if (/^瀏覽\s+第\s+\d+\/\d+\s+頁.*目前顯示\s*[:：]/.test(line)) state = 'idle';
    }
    const promptRow = Math.max(0, (tab?.buf?.rows || 2) - 2) + lineIndex;
    if (['choose-type', 'input-content', 'confirm-save'].includes(state) && Number.isInteger(tab?.buf?.cur_y) && tab.buf.cur_y !== promptRow) return { state: 'unknown', text: line, draft: '' };
    return { state, text: line, draft };
  }

  detectPushState() { return this.promptSnapshot().state; }
  detectCooldownSeconds() { const prompt = this.promptSnapshot(); return prompt.state === 'cooldown' ? prompt.seconds : null; }

  assertRun(run) {
    if (this._run !== run || run.controller.signal.aborted) throw new Error(run.controller.signal.reason === 'deadline' ? '已達發送時間上限' : '已停止發送');
    if (this.now() >= run.deadline) throw new Error('已達發送時間上限');
    const tab = this.getActiveTab?.();
    if (tab !== run.tab || this.getTabById(run.tab.id) !== run.tab || !tab.isConnected || tab.buf !== run.buffer ||
        tab.address !== run.address || tab.encoding !== run.encoding) throw new Error('分頁或連線已變更，已停止發送');
    const identity = this.articleIdentity(tab);
    if (run.article && identity && identity !== run.article) throw new Error('文章標頭已變更，已停止發送');
  }

  async validateSession(run) {
    this.assertRun(run);
    // Read-only identity lookups can be cancelled; writes must settle before the lease is released.
    const session = await this.withSignal(this.getSession(run.tab.id), run.controller.signal);
    this.assertRun(run);
    if (!session || session !== run.session) throw new Error('連線身分已變更，已停止發送');
  }

  withSignal(promise, signal) {
    if (signal.aborted) return Promise.reject(new Error('已停止發送'));
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(new Error(signal.reason === 'deadline' ? '已達發送時間上限' : '已停止發送')); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }

  async pause(ms, run) {
    this.assertRun(run);
    await this.sleep(ms, run.controller.signal);
    this.assertRun(run);
  }

  async waitFor(run, predicate) {
    const deadline = Math.min(run.deadline, this.now() + this.promptTimeoutMs);
    while (this.now() < deadline) {
      await this.validateSession(run);
      const prompt = this.promptSnapshot(run.tab);
      const result = predicate(prompt);
      if (result) return result;
      await this.pause(Math.min(50, deadline - this.now()), run);
    }
    throw new Error('等待明確提示逾時；不會猜測下一個按鍵');
  }

  async write(run, text, allowed, { payload = false, commit = false, expectedPrompt = null } = {}) {
    await this.validateSession(run);
    const prompt = this.promptSnapshot(run.tab);
    if (!allowed.includes(prompt.state) || (expectedPrompt !== null && prompt.text !== expectedPrompt)) throw new Error('終端提示已改變，已停止發送');
    if (payload && prompt.draft.trim()) throw new Error('終端已有推文草稿，請先手動處理');
    if (payload) run.uncertain = true;
    if (commit) run.commitSent = true;
    // Await actual transport completion; never release an input lease while a write is unresolved.
    await this.sendToTab(run.tab.id, text, run.session, run.lease);
    this.assertRun(run);
  }

  countEchoes(tab, segment, userId) {
    let count = 0;
    for (const row of tab.buf.lines) {
      const match = tab.buf.getRowText(row).trimEnd().match(/^[推噓→]\s+([a-zA-Z][a-zA-Z0-9_]{1,11})\s*[:：] ?(.*?)\s+(?:(?:\d{1,3}\.){3}\d{1,3}\s+)?\d{2}\/\d{2}\s+\d{2}:\d{2}$/);
      if (match && (!userId || match[1].toLowerCase() === userId.toLowerCase()) && match[2].trimEnd() === segment.trimEnd()) count++;
    }
    return count;
  }

  async sendSegmentSequence(segment, typeKey, run = null) {
    // Public/single-segment calls go through exactly the same owner and validation path.
    if (!run) return this.runSegments([segment], typeKey);
    run.uncertain = false; run.commitSent = false;
    let prompt = this.promptSnapshot(run.tab);
    if (prompt.state === 'cooldown' && prompt.text !== run.retryWarning) throw new Error('已有未歸屬本次操作的冷卻提示，請先手動確認畫面');
    if (prompt.state === 'confirm-save') throw new Error('終端已有未確認的推文，請先手動處理');
    if (prompt.state === 'idle' || (prompt.state === 'cooldown' && prompt.text === run.retryWarning)) {
      await this.write(run, '%', [prompt.state], { expectedPrompt: prompt.text });
      run.retryWarning = null;
      prompt = await this.waitFor(run, value => ['choose-type', 'input-content', 'cooldown'].includes(value.state) && value);
    }
    if (prompt.state === 'cooldown') {
      if (!prompt.seconds) throw new Error('冷卻秒數無效或超出安全上限');
      return { status: 'cooldown', seconds: prompt.seconds, text: prompt.text };
    }
    if (prompt.state === 'choose-type') {
      const author = this.detectArticleAuthor(run.tab) || run.author;
      const unknownIdentity = !author || !run.userId;
      const ownArticle = author && run.userId && author.toLowerCase() === run.userId.toLowerCase();
      const type = unknownIdentity || ownArticle || typeKey === 'author' ? '3' : typeKey;
      await this.write(run, type, ['choose-type']);
      prompt = await this.waitFor(run, value => ['input-content', 'cooldown'].includes(value.state) && value);
      if (prompt.state === 'cooldown') {
        if (!prompt.seconds) throw new Error('冷卻秒數無效或超出安全上限');
        return { status: 'cooldown', seconds: prompt.seconds, text: prompt.text };
      }
    }
    if (prompt.state !== 'input-content' || prompt.draft.trim()) throw new Error('不是空白的推文輸入提示，已停止發送');
    const echoBefore = this.countEchoes(run.tab, segment, run.userId);
    await this.write(run, `${segment}\r`, ['input-content'], { payload: true });
    prompt = await this.waitFor(run, value => ['confirm-save', 'cooldown'].includes(value.state) && value);
    if (prompt.state === 'cooldown') {
      if (!prompt.seconds) throw new Error('冷卻秒數無效或超出安全上限');
      run.uncertain = false; // Explicit rejection before any save confirmation.
      return { status: 'cooldown', seconds: prompt.seconds, text: prompt.text };
    }
    await this.write(run, 'y\r', ['confirm-save'], { commit: true });
    await this.waitFor(run, value => {
      if (value.state === 'cooldown') throw new Error('確認後出現冷卻訊息，送出結果未確認，不自動重試');
      return value.state === 'idle' && this.countEchoes(run.tab, segment, run.userId) > echoBefore && value;
    });
    run.uncertain = false;
    return { status: 'confirmed' };
  }

  async countdown(ms, run, label) {
    const until = Math.min(run.deadline, this.now() + ms);
    while (this.now() < until) {
      if (this.progressCountdown) this.progressCountdown.textContent = `${label} ${((until - this.now()) / 1000).toFixed(1)}s`;
      await this.pause(Math.min(100, until - this.now()), run);
      await this.validateSession(run);
    }
  }

  normalizeSegment(segment) {
    return String(segment).replace(/\u00a0/g, ' ').replace(/[\u2000-\u200b\u202f\u205f\ufeff]/g, ' ');
  }

  async startPushing() { return this.runSegments([...(this.currentSegments || [])], this.typeSelect?.value || '3'); }

  async runSegments(input, typeKey = '3', { singleIndex = null } = {}) {
    if (this._run) return { status: 'busy' };
    if (this.recovery?.uncertain) return { status: 'needs-review' };
    const tab = this.getActiveTab?.();
    const run = { tab, controller: new AbortController(), deadline: this.now() + this.maxRunMs, confirmed: 0, uncertain: false };
    run.draft = [...(this.currentSegments || [])]; run.singleIndex = singleIndex;
    this._run = run; this.isPushing = true;
    run.timer = setTimeout(() => run.controller.abort('deadline'), this.maxRunMs);
    this.setRunningUi(true);
    if (this.progressCountdown) this.progressCountdown.textContent = '';
    let result;
    try {
      if (!tab?.isConnected || !tab.buf || this.detectTargetStation(tab) !== 'ptt') throw new Error('自動推文目前只支援 PTT/PTT2 的已連線文章畫面');
      if (!['big5', 'big-5'].includes(String(tab.encoding || 'big5').toLowerCase())) throw new Error('請切換為 Big5 編碼再使用自動推文');
      if (!this.getSession || !this.sendToTab || !this.acquireInput || !this.releaseInput) throw new Error('安全發送介面尚未初始化');
      run.address = tab.address; run.encoding = tab.encoding; run.buffer = tab.buf; run.article = this.articleIdentity(tab); run.author = this.detectArticleAuthor(tab);
      const id = String(this.idInput?.value || '').trim();
      if (id && !/^[a-z][a-z0-9_]{1,11}$/i.test(id)) throw new Error('請填寫有效的 PTT ID，或留空採箭頭模式');
      run.userId = id;
      if (!['1', '2', '3', 'author'].includes(typeKey)) throw new Error('推文類型無效');
      if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('請輸入 1 至 100 段推文');
      if (singleIndex !== null && (!Number.isInteger(singleIndex) || singleIndex < 0 || singleIndex >= run.draft.length || input.length !== 1 || run.draft[singleIndex] !== input[0])) throw new Error('單段草稿已變更，請重新選取');
      run.segments = input.map(segment => {
        if (typeof segment !== 'string') throw new Error('推文內容無效');
        const clean = this.normalizeSegment(segment);
        if (!clean.trim() || /[\x00-\x1f\x7f]/.test(clean) || this.getStringByteWidth(clean) > this.getMaxSafeBytes()) throw new Error('分段含控制字元、換行或超過安全長度；請先修改');
        return clean;
      });
      run.lease = this.acquireInput(tab.id);
      if (!run.lease) throw new Error('終端機正由其他輸入流程使用，請稍後再試');
      run.session = await this.withSignal(this.getSession(tab.id), run.controller.signal);
      if (!run.session) throw new Error('無法確認連線身分');
      this.assertRun(run);
      const delay = this.delaySelect?.value || 'auto';
      const baseDelay = delay === 'auto' ? 1500 : Number(delay);
      if (![800, 1500, 2000, 5000, 10000].includes(baseDelay)) throw new Error('冷卻設定無效');
      let learned = 0;
      for (let index = 0; index < run.segments.length; index++) {
        let confirmed = false;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
          this.assertRun(run);
          if (this.progressLabel) this.progressLabel.textContent = `正在發送第 ${index + 1} / ${run.segments.length} 段；已確認 ${run.confirmed} 段`;
          const outcome = await this.sendSegmentSequence(run.segments[index], index ? '3' : typeKey, run);
          if (outcome.status === 'confirmed') { confirmed = true; break; }
          if (attempt === this.maxRetries) throw new Error('已達冷卻重試上限，請檢查畫面後再操作');
          run.retryWarning = outcome.text;
          learned = Math.max(learned, (outcome.seconds + 0.5) * 1000);
          await this.countdown((outcome.seconds + 0.5) * 1000, run, '冷卻後重試');
        }
        if (!confirmed) throw new Error('送出結果未確認');
        run.confirmed++;
        if (this.progressBarFill) this.progressBarFill.style.width = `${Math.round(run.confirmed / run.segments.length * 100)}%`;
        if (index + 1 < run.segments.length) await this.countdown(Math.max(baseDelay, learned), run, '分段間隔');
      }
      result = { status: 'confirmed', confirmed: run.confirmed };
      if (this.progressLabel) this.progressLabel.textContent = `已在畫面確認 ${run.confirmed} 段推文。`;
      if (this.progressCountdown) this.progressCountdown.textContent = '完成';
    } catch (error) {
      result = { status: run.controller.signal.aborted ? 'aborted' : 'failed', confirmed: run.confirmed, uncertain: run.uncertain, error: error.message };
      if (this.progressLabel) this.progressLabel.textContent = `${error.message}。已確認 ${run.confirmed} 段；待處理文字已保留。${run.uncertain ? '請核對畫面，勿直接重送。' : '終端可能仍停在推文子畫面，請先檢查。'}`;
      if (this.progressCountdown) this.progressCountdown.textContent = run.uncertain ? '待核對' : '已停止';
      if (run.uncertain) this.recovery = { uncertain: true, error: error.message };
    } finally {
      clearTimeout(run.timer);
      if (run.lease) this.releaseInput(run.tab.id, run.lease);
      this.lastRun = { ...result, originalSegments: run.segments ? [...run.segments] : Array.isArray(input) ? [...input] : [] };
      if (run.segments) {
        this.currentSegments = run.singleIndex !== null
          ? run.draft.filter((_, index) => run.confirmed !== 1 || index !== run.singleIndex)
          : run.segments.slice(run.confirmed);
        if (this.textInput) this.textInput.value = this.currentSegments.join('\n');
      }
      this._run = null; this.isPushing = false;
      this.setRunningUi(false);
      this.updatePreview();
    }
    return result;
  }

  setRunningUi(running) {
    for (const element of [this.textInput, this.idInput, this.typeSelect, this.strategySelect, this.delaySelect, this.tplSelect, this.tplSaveBtn, this.tplDeleteBtn]) if (element) element.disabled = running;
    for (const element of this.previewList?.querySelectorAll('.push-item-text') || []) element.contentEditable = running ? 'false' : 'true';
    for (const element of this.previewList?.querySelectorAll('button') || []) element.disabled = running || Boolean(this.recovery?.uncertain);
    this.sendBtn?.classList.toggle('hidden', running);
    this.cancelBtn?.classList.toggle('hidden', running);
    this.abortBtn?.classList.toggle('hidden', !running);
    this.progressBox?.classList.remove('hidden');
    if (this.sendBtn) this.sendBtn.disabled = running || Boolean(this.recovery?.uncertain);
    this.reviewBtn?.classList.toggle('hidden', !this.recovery?.uncertain);
    if (!running) this.checkAuthorMode();
  }

  abort() {
    if (!this._run) return;
    this._run.controller.abort();
    if (this.progressLabel) this.progressLabel.textContent = '停止中；不再送下一步，等待目前寫入結束後保留待處理文字。';
  }

  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(new Error('已停止發送')); };
      const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
