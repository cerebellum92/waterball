// AID navigation owns one tab/session and advances only on explicit prompts.
import { parseAidInput, detectCurrentBoard, generateJumpPlan } from './aid_helper.js';
import { readClipboardText, writeClipboardText, openExternalUrl } from './platform.js';

export class AidJumpModal {
  constructor(options) {
    Object.assign(this, options);
    this.onShowToast ||= (() => {});
    this.readClipboard = options.readClipboard || readClipboardText;
    this.writeClipboard = options.writeClipboard || writeClipboardText;
    this.openUrl = options.openUrl || openExternalUrl;
    this.now = options.now || Date.now;
    this.sleep = options.sleep || ((ms, signal) => new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(new Error('已停止定位')); };
      const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    }));
    this.promptTimeoutMs = options.promptTimeoutMs || 8000;
    this.maxRunMs = options.maxRunMs || 45000;
    this.sessionTimeoutMs = options.sessionTimeoutMs || 5000;
    // Only recognized pauses owned by this run may be acknowledged. A stable
    // screen and bounded distinct pages prevent an old PASS prompt spamming keys.
    this.continueStableMs = options.continueStableMs ?? 200;
    this.maxBoardContinues = options.maxBoardContinues ?? 3;
    this.isOpen = false;
    this.openGeneration = 0;
    this.editGeneration = 0;
    for (const [field, id] of Object.entries({ modalEl: 'aid-modal', closeBtn: 'aid-modal-close', inputEl: 'aid-input',
      infoBox: 'aid-info-box', infoCode: 'aid-info-code', infoBoard: 'aid-info-board', infoUrl: 'aid-info-url',
      infoUrlRow: 'aid-info-url-row', btnJump: 'aid-btn-jump', btnReader: 'aid-btn-reader', btnCopy: 'aid-btn-copy' })) {
      this[field] = document.getElementById(id);
    }
    this.initEvents();
  }

  initEvents() {
    this.closeBtn?.addEventListener('click', () => this.close());
    this.inputEl?.addEventListener('input', () => { this.editGeneration++; this.updateInfo(); });
    this.inputEl?.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229 || e.key === 'Process') return;
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (e.repeat || this.run) return;
        if (e.shiftKey) void this.openInReader(); else void this.executeJump();
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    });
    this.btnJump?.addEventListener('click', () => void this.executeJump());
    this.btnReader?.addEventListener('click', () => void this.openInReader());
    this.btnCopy?.addEventListener('click', () => void this.copyUrl());
  }

  contextMatches(context) {
    const tab = this.getActiveTab?.();
    return tab === context?.tab && tab?.isConnected && tab.buf === context.buffer && tab.address === context.address &&
      tab.encoding === context.encoding && (!this.getTabById || this.getTabById(tab.id) === tab);
  }

  getCurrentBoard() {
    return this.contextMatches(this.context) ? detectCurrentBoard(this.context.buffer) : null;
  }

  updateInfo() {
    const parsed = parseAidInput((this.inputEl?.value || '').trim(), this.getCurrentBoard());
    this.infoBox?.classList.toggle('hidden', !parsed.isValid);
    if (this.infoCode) this.infoCode.textContent = parsed.aid || '';
    if (this.infoBoard) this.infoBoard.textContent = parsed.board || '未指定（網頁版需要看板）';
    if (this.infoUrl) this.infoUrl.textContent = parsed.url || '';
    this.infoUrlRow?.classList.toggle('hidden', !parsed.url);
    const busy = Boolean(this.run);
    if (this.inputEl) this.inputEl.disabled = busy;
    if (this.btnJump) {
      this.btnJump.disabled = busy || !parsed.isValid || !this.context?.session || !this.contextMatches(this.context);
      this.btnJump.textContent = busy ? (this.run.controller.signal.aborted ? '停止中，等待寫入完成…' : '定位中…') : '🚀 終端定位';
    }
    if (this.btnReader) this.btnReader.disabled = busy || !parsed.url;
    if (this.btnCopy) this.btnCopy.disabled = busy || !parsed.isValid;
    return parsed;
  }

  async open(prefill = '') {
    if (this.run) {
      if (this.contextMatches(this.run.context)) {
        this.context = this.run.context; this.isOpen = true;
        this.modalEl?.classList.remove('hidden'); this.updateInfo();
      }
      this.onShowToast('目前定位寫入尚未結束；輸入鎖會在寫入完成後釋放，請勿重複送出');
      return;
    }
    const tab = this.getActiveTab?.();
    if (!tab?.isConnected) { this.onShowToast('請先連線至 PTT 再使用文章代碼定位'); return; }
    this.openController?.abort();
    const controller = new AbortController();
    this.openController = controller;
    const generation = ++this.openGeneration;
    this.context = { tab, buffer: tab.buf, address: tab.address, encoding: tab.encoding, session: null };
    const context = this.context;
    this.isOpen = true;
    this.modalEl?.classList.remove('hidden');
    if (prefill && this.inputEl) this.inputEl.value = prefill;
    const original = this.inputEl?.value || '', edits = this.editGeneration;
    this.updateInfo(); this.inputEl?.focus(); this.inputEl?.select();
    // Identity and clipboard work may finish after close/reopen or user editing.
    const identity = (async () => {
      const timer = setTimeout(() => controller.abort('session-timeout'), this.sessionTimeoutMs);
      try {
        const session = await this.cancellableRead(this.getSession?.(tab.id), controller.signal);
        if (this.isOpen && this.openGeneration === generation && this.context === context && this.contextMatches(context)) {
          context.session = session || null;
          this.updateInfo();
        }
      } catch {
        if (this.isOpen && this.openGeneration === generation && this.context === context) {
          this.onShowToast('無法確認連線身分，請重新開啟定位視窗；輸入內容已保留');
        }
      } finally { clearTimeout(timer); }
    })();
    if (!prefill && !original) void (async () => {
      try {
        const clip = await this.readClipboard({ interactive: false });
        if (this.isOpen && this.openGeneration === generation && this.context === context && this.contextMatches(context) &&
            edits === this.editGeneration && this.inputEl?.value === original && !original && parseAidInput(clip).isValid) {
          this.inputEl.value = clip.trim();
          this.updateInfo();
        }
      } catch { /* Clipboard is optional; keep manual input and focus unchanged. */ }
    })();
    // Clipboard completion is optional and must not hold open() or session readiness.
    await identity;
  }

  close() {
    this.openGeneration++;
    this.openController?.abort();
    if (this.run) {
      this.run.controller.abort();
      this.updateInfo();
      this.onShowToast('停止後續定位步驟；已開始的寫入必須結束才能釋放輸入鎖');
    }
    this.isOpen = false;
    this.context = null;
    this.modalEl?.classList.add('hidden');
  }

  snapshot(tab) {
    const rows = tab.buf.lines.map(line => tab.buf.getRowText(line).trimEnd());
    const first = Math.max(0, rows.length - 3), footer = rows.slice(first);
    const last = footer.map(line => Boolean(line.trim())).lastIndexOf(true);
    const text = (footer[last] || '').trim();
    // PttChrome recognizes PASS text within the last row, including a welcome
    // prefix or decorative borders. Keep the suffix limited to decoration so
    // another instruction after the pause is not silently acknowledged.
    // Unicode punctuation/symbols include the real Gossiping ▄ border, box
    // drawing and ellipses; a hand-maintained character list misses these.
    const continuation = /(?:請)?按\s*(?:任意|任何|空白)\s*鍵\s*(?:(?:或是|或)\s*Enter\s*)?繼續[\s\p{P}\p{S}]*$/iu.test(text);
    const errorPattern = /^(?:[【\[◆※★]\s*)?(?:(?:很抱歉|抱歉|對不起)[，,:：\s]*)?(?:找不到|沒有這個|無此|權限不足|您沒有進入此看板的權限|無法建立或進入看板目錄|無法進入|不能進入|禁止進入|文章不存在|文章已刪除|未達看板.*限制|您(?:的)?(?:登入次數|上站次數|文章數|發文數|劣文數|退文數).*?(?:不足|不符|限制|超過)|您(?:尚未|未通過|不符合).*(?:認證|驗證|資格|門檻|進入))/;
    // A refusal can be printed above the footer with a generic PASS below it.
    // Inspect the whole screen only for a pause; ordinary article text is not a prompt.
    const error = (continuation ? rows : footer).find(line => errorPattern.test(line.trim()));
    if (error) return { state: 'error', text: error.trim() };
    // PTT do_select / board_cmd_search_global draw at (0, 0), so the active
    // board prompt is normally row 1, not the footer. Follow the cursor across
    // the whole screen; never search arbitrary old rows or accept an input draft.
    const cursorRow = Number.isInteger(tab.buf.cur_y) ? tab.buf.cur_y : first + last;
    let promptRow = cursorRow;
    if (!rows[cursorRow]?.trim() && tab.buf.cur_x === 0 && cursorRow > 0) promptRow--;
    const active = promptRow >= 0 && promptRow < rows.length ? rows[promptRow].trim() : '';
    const inputOrChoice = line => /^(?:[【\[◆※★]\s*)?(?:請(?:再(?:次)?)?輸入|請選擇|加註意見|您的意見|(?:帳號|密碼)\s*[:：])/.test(line.trim()) ||
      /[\[（(]\s*[Yy]\s*\/\s*[Nn]\s*[\]）)]\s*[:：]?\s*$/.test(line) || /^(?:是否|確定要|確認要).*[?？:：]\s*$/.test(line.trim());
    const editorPrompt = line => /Ctrl[-+]X|編輯文章|\^X\s*(?:發表|寄出|存檔)/i.test(line);
    // Top-row search overlays leave the previous menu/list footer intact. An
    // inactive old input hint must not override the current empty input prompt.
    const foreignInput = footer.some(editorPrompt);
    if (!foreignInput) {
      if (/^(?:【[^】]+】\s*)?(?:請輸入|搜尋)文章代碼(?:\s*[（(]AID[）)])?\s*[:：]\s*#?\s*$/.test(active)) return { state: 'aid-input', text: active, promptRow };
      if (/^(?:【[^】]+】\s*)?請輸入(?:看板名稱|看板名|看板|要進入的看板(?:名稱)?)(?:\s*[（(]按空白鍵(?:自動)?搜尋[）)])?\s*[:：]\s*$/.test(active)) return { state: 'board-input', text: active, promptRow };
    }
    // Policy prose such as「本板僅限…」「閱讀後請確認…」is not an
    // interactive confirmation. Require input grammar or an explicit Y/N choice.
    const unsafePause = rows.some(inputOrChoice) || footer.some(editorPrompt);
    if (continuation && !unsafePause) return {
      state: 'waiting-enter', text, continueKey: /空白/.test(text) ? ' ' : '\r', signature: rows.join('\n'),
    };
    if (inputOrChoice(active) || editorPrompt(active) || footer.some(line => inputOrChoice(line) || editorPrompt(line))) return { state: 'unknown', text };
    const base = tab.view?.getBbsState?.() || 'unknown';
    if (base === 'reading' && /^瀏覽\s+第\s+\d+(?:\/\d+)?\s+頁/.test(text)) return { state: base, text };
    if (base === 'article-list' && Boolean(detectCurrentBoard(tab.buf))) return { state: base, text };
    if (['board-list', 'main-menu'].includes(base)) return { state: base, text };
    return { state: 'unknown', text };
  }

  assertRun(run) {
    if (this.run !== run || run.controller.signal.aborted || this.now() >= run.deadline) throw new Error('定位已停止或逾時');
    if (!this.isOpen || this.context !== run.context || !this.contextMatches(run.context)) throw new Error('分頁或連線已變更，已停止定位');
  }

  cancellableRead(promise, signal) {
    if (signal.aborted) return Promise.reject(new Error('定位已停止'));
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(new Error(signal.reason === 'session-timeout' ? '確認連線身分逾時' : '定位已停止')); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }

  async validate(run) {
    this.assertRun(run);
    const timer = setTimeout(() => run.controller.abort('session-timeout'), this.sessionTimeoutMs);
    try {
      const session = await this.cancellableRead(this.getSession(run.context.tab.id), run.controller.signal);
      this.assertRun(run);
      if (!session || session !== run.context.session) throw new Error('連線身分已變更，已停止定位');
    } finally { clearTimeout(timer); }
  }

  async waitFor(run, step) {
    const deadline = Math.min(run.deadline, this.now() + this.promptTimeoutMs);
    const preparing = step.from === 'waiting-enter' && step.to === 'navigation-ready';
    const mayContinue = preparing || (step.from === 'board-input' && step.to === 'article-list');
    const acknowledged = new Set();
    let candidate = null;
    while (this.now() < deadline) {
      await this.validate(run);
      if (this.now() >= deadline) break;
      const prompt = this.snapshot(run.context.tab);
      if (prompt.state === 'error') throw new Error(`PTT 拒絕定位：${prompt.text}`);
      if (prompt.state === 'waiting-enter') {
        if (!mayContinue) throw new Error('目前停在非進板步驟的繼續提示；請關閉定位視窗並在終端手動處理');
        if (!acknowledged.has(prompt.signature)) {
          if (candidate?.signature !== prompt.signature) candidate = { signature: prompt.signature, since: this.now() };
          if (this.now() - candidate.since >= this.continueStableMs) {
            if (acknowledged.size >= this.maxBoardContinues) throw new Error('進板繼續提示超過自動處理上限；請關閉定位視窗並在終端手動處理');
            // validate() may await IPC. Re-read after it so cancellation, a late
            // refusal, or a newly active prompt cannot consume the automatic key.
            await this.validate(run);
            if (this.now() >= deadline) break;
            const current = this.snapshot(run.context.tab);
            if (current.state !== 'waiting-enter' || current.signature !== prompt.signature) { candidate = null; continue; }
            acknowledged.add(prompt.signature);
            this.onShowToast(`${preparing ? '正在處理定位前的繼續畫面' : `正在進入 ${step.board}`}（${acknowledged.size}/${this.maxBoardContinues}）`);
            this.assertRun(run);
            const result = await this.sendToTab(run.context.tab.id, current.continueKey, run.context.session, run.lease);
            if (result === false) throw new Error('傳輸拒絕進板繼續指令');
            this.assertRun(run);
            candidate = null;
          }
        } else candidate = null;
      } else candidate = null;
      if (preparing && ['main-menu', 'board-list', 'article-list', 'reading', 'board-input', 'aid-input'].includes(prompt.state)) return;
      if (prompt.state === step.to && (step.to !== 'article-list' || !step.board || detectCurrentBoard(run.context.buffer)?.toLowerCase() === step.board.toLowerCase())) return;
      await this.sleep(50, run.controller.signal);
    }
    throw new Error('等待明確定位提示逾時，已停止後續按鍵；請檢查終端畫面');
  }

  async executeJump() {
    if (this.run) return { status: 'busy' };
    const context = this.context;
    let run, submitted = false;
    try {
      if (!this.isOpen || !this.contextMatches(context) || !context.session) throw new Error('連線身分未確認或分頁已變更，請重新開啟定位視窗');
      const host = new URL(/^[a-z]+:\/\//i.test(context.address) ? context.address : `ssh://${context.address}`).hostname.toLowerCase();
      if (!/^(?:[^.]+\.)*ptt\.cc$/.test(host)) throw new Error('自動定位目前只支援 PTT（ptt.cc）');
      if (!this.sendToTab || !this.acquireInput || !this.releaseInput || !this.getSession) throw new Error('安全發送介面未初始化');
      const parsed = this.updateInfo();
      if (!parsed.isValid) throw new Error('請輸入有效的一般文章代碼（M 類型）或 PTT 網址');
      const initial = this.snapshot(context.tab).state;
      let steps = initial === 'waiting-enter' ? null : generateJumpPlan({ aid: parsed.aid, targetBoard: parsed.board, currentBoard: detectCurrentBoard(context.buffer), bbsState: initial });
      if (!steps && !parsed.board) throw new Error('請指定目標看板後再從繼續畫面開始定位');
      const lease = this.acquireInput(context.tab.id);
      if (!lease) throw new Error('終端機正由其他發送流程使用，請稍後再試');
      run = { context, lease, controller: new AbortController(), deadline: this.now() + this.maxRunMs };
      this.run = run;
      run.timer = setTimeout(() => { run.controller.abort(); if (this.run === run) this.updateInfo(); }, this.maxRunMs);
      this.updateInfo();
      if (!steps) {
        // The user explicitly started navigation on a recognized PASS screen.
        // Clear it under the same lease, then plan from the actual returned state.
        await this.waitFor(run, { from: 'waiting-enter', to: 'navigation-ready', board: parsed.board });
        steps = generateJumpPlan({ aid: parsed.aid, targetBoard: parsed.board, currentBoard: detectCurrentBoard(context.buffer), bbsState: this.snapshot(context.tab).state });
      }
      for (const step of steps) {
        await this.validate(run);
        if (this.snapshot(context.tab).state !== step.from) throw new Error('終端畫面已變更，停止定位');
        if (step.board && ['article-list', 'reading', 'aid-input'].includes(step.from) && detectCurrentBoard(context.buffer)?.toLowerCase() !== step.board.toLowerCase()) throw new Error('目前看板已變更，停止定位');
        // A write cannot be cancelled safely after it reaches the native transport.
        const result = await this.sendToTab(context.tab.id, step.data, context.session, lease);
        if (result === false) throw new Error('傳輸拒絕定位指令');
        this.assertRun(run);
        await this.waitFor(run, step);
      }
      this.onShowToast(`定位指令已完成：${parsed.aid} (${parsed.board})；請核對列表游標所在文章`);
      submitted = true;
      return { status: 'submitted', aid: parsed.aid, board: parsed.board };
    } catch (error) {
      this.onShowToast(`定位停止：${error.message}。輸入內容已保留。`);
      return { status: 'failed', error: error.message };
    } finally {
      if (run) {
        clearTimeout(run.timer);
        this.releaseInput(run.context.tab.id, run.lease);
        this.run = null;
      }
      this.updateInfo();
      if (submitted) this.close(); // Show the list for the user to verify; retain input value.
    }
  }

  async openInReader() {
    if (this.run) return;
    const parsed = this.updateInfo();
    if (!parsed.url) { this.onShowToast('請指定看板後再開啟網頁版'); return; }
    try { await this.openUrl(parsed.url); } catch { this.onShowToast('開啟網頁版失敗，輸入內容已保留'); }
  }

  async copyUrl() {
    if (this.run) return;
    const parsed = this.updateInfo();
    if (!parsed.isValid) return;
    try { await this.writeClipboard(parsed.url || parsed.aid); this.onShowToast('已複製文章網址／代碼'); }
    catch { this.onShowToast('複製失敗，輸入內容已保留'); }
  }
}
