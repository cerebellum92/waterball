// Connection & Send Queue Controller for Waterball BBS
import { terminalDiagnostics } from './terminal_diagnostics.js';
import { isTauri, getListen, safeInvoke } from './platform.js';

let nativeAttemptCounter = 0;
const isDevelopment = import.meta.env?.DEV ?? false;
const isHorizontalNavigation = (data) => data === '\x1b[C' || data === '\x1b[D';
const isVerticalNavigation = (data) => data === '\x1bOA' || data === '\x1bOB' || data === '\x1b[A' || data === '\x1b[B';
const isPageNavigation = (data) => data === '\x1b[5~' || data === '\x1b[6~';
const isScreenNavigation = (data) => isHorizontalNavigation(data) || isVerticalNavigation(data) || isPageNavigation(data);

export function parseAddress(input) {
  input = input.trim();
  if (input.startsWith('ws.ptt.cc') || input.startsWith('ws.ptt2.cc')) {
    input = `wss://${input}`;
  }
  const scheme = input.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase() || '';
  if (scheme === 'wss' || scheme === 'ws') {
    const url = new URL(input);
    if (url.username || url.password || url.hash) throw new Error('WebSocket 網址不能包含帳密或 fragment');
    let pathname = url.pathname;
    if ((url.hostname === 'ws.ptt.cc' || url.hostname === 'ws.ptt2.cc') && (pathname === '' || pathname === '/')) {
      pathname = '/bbs';
    }
    return {
      host: url.hostname,
      port: Number(url.port || (scheme === 'wss' ? 443 : 80)),
      userPrefix: '',
      transport: scheme,
      endpoint: `${url.origin}${pathname}${url.search}`,
    };
  }
  input = input.replace(/^(telnet|ssh|bbs):\/\//, '');

  let userPrefix = '';
  const atIdx = input.indexOf('@');
  if (atIdx !== -1) {
    userPrefix = input.substring(0, atIdx);
    input = input.substring(atIdx + 1);
  }

  let host = input;
  let port = scheme === 'ssh' ? 22 : 23;

  const colonIdx = input.lastIndexOf(':');
  if (colonIdx !== -1) {
    const portStr = input.substring(colonIdx + 1);
    const portNum = parseInt(portStr, 10);
    if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
      host = input.substring(0, colonIdx);
      port = portNum;
    }
  }

  return {
    host,
    port,
    userPrefix,
    transport: scheme === 'ssh' || port === 22 || port === 8888 ? 'ssh' : 'telnet',
    endpoint: host,
  };
}

export class ConnectionController {
  constructor({
    tabManager,
    settingsManager,
    autoLoginManager,
    notificationManager,
    elements,
    onFocusTerminal,
    onShowToast,
  }) {
    this.tabManager = tabManager;
    this.settingsManager = settingsManager;
    this.autoLoginManager = autoLoginManager;
    this.notificationManager = notificationManager;
    this.elements = elements;
    this.onFocusTerminal = onFocusTerminal || (() => {});
    this.onShowToast = onShowToast || (() => {});

    this.sendQueue = [];
    this.isSending = false;
    this.connectionAttempts = new Map();
    this.otpAttempts = new Map();
    this.nativeAttempts = new Map();
    this.heldScreenNavigationKeys = new Set();
    this.notificationScrapeTimers = new Map();

    // PCMan-style Bell (\x07) hook: immediate waterball inspection & chime
    if (this.tabManager) {
      this.tabManager.onBell = (tab) => {
        if (tab) {
          // Classification runs after feedData has parsed the complete delivered chunk.
          // An unclassified Bell must never bypass notification filtering.
          this.scheduleNotificationScrape(tab.id);
        }
      };
    }

    if (isDevelopment) terminalDiagnostics.install();
    this.initEventListeners();
    this.initTauriListeners();
  }

  initEventListeners() {
    const { connectBtn, disconnectBtn, addressInput, encodingSelect } = this.elements;

    if (connectBtn) {
      connectBtn.addEventListener('click', () => {
        connectBtn.blur();
        this.onFocusTerminal(true);
        this.connect();
      });
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => {
        this.disconnect();
      });
    }

    if (addressInput) {
      addressInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          addressInput.blur();
          this.onFocusTerminal(true);
          const activeTab = this.tabManager.getActiveTab();
          if (activeTab?.isConnected) {
            this.disconnect().then(() => this.connect());
          } else {
            this.connect();
          }
        }
      });
    }

    if (encodingSelect) {
      encodingSelect.addEventListener('change', () => {
        const activeTab = this.tabManager.getActiveTab();
        if (!activeTab) return;
        const cs = encodingSelect.value;
        activeTab.encoding = cs;
        activeTab.parser.resetByteDecoder();
        if (activeTab.isConnected) {
          safeInvoke('set_charset', { tabId: activeTab.id, charset: cs }).catch(console.error);
        }
      });
    }
  }

  acceptNativeEvent(payload) {
    // Untagged events are retained for legacy test fixtures. All native production
    // events now carry an attempt_id, which must match the active request.
    return !payload.attempt_id || this.nativeAttempts.get(payload.tab_id) === payload.attempt_id;
  }

  initTauriListeners() {
    if (!isTauri()) return;
    const listen = getListen();
    if (typeof listen !== 'function') return;
    if (isDevelopment) {
      listen('terminal-raw-read', (event) => {
        if (!this.acceptNativeEvent(event.payload)) return;
        terminalDiagnostics.recordRawRead(event.payload);
      });
    }

    // Listen for backend terminal data per tab
    listen('terminal-data', (event) => {
      try {
        if (!this.acceptNativeEvent(event.payload)) return;
        const { tab_id, data, raw_big5 } = event.payload;
        if (tab_id && data) {
          const receivedAtMs = isDevelopment ? Date.now() : null;
          const tabBefore = isDevelopment ? this.tabManager.getTabById(tab_id) : null;
          const orphanEndBefore = tabBefore?.buf?.syncOutputOrphanEndGeneration || 0;
          const cursorBefore = tabBefore?.buf ? {
            x: tabBefore.buf.cur_x,
            y: tabBefore.buf.cur_y,
            parserState: tabBefore.parser.state,
          } : null;
          const parserStartedAt = isDevelopment ? performance.now() : null;
          const decodedData = this.tabManager.feedData(tab_id, data, raw_big5);

          // PCMan-style synchronous inspection: immediate check of bottom line upon every data chunk
          this.checkWaterballImmediate(tab_id);

          if (isDevelopment) {
            const parserMs = performance.now() - parserStartedAt;
            const tabAfter = this.tabManager.getTabById(tab_id);
            const cursorAfter = tabAfter?.buf ? {
              x: tabAfter.buf.cur_x,
              y: tabAfter.buf.cur_y,
              parserState: tabAfter.parser.state,
            } : null;
            const bufferScreen = tabAfter?.buf
              ? tabAfter.buf.getText(0, 0, tabAfter.buf.cols - 1, tabAfter.buf.rows - 1)
              : null;
            const emittedAtMs = event.payload.emitted_at_unix_ms;
            const readAtMs = event.payload.read_at_unix_ms;
            terminalDiagnostics.recordData({
              tabId: tab_id,
              data: decodedData,
              rawReadSeq: event.payload.raw_read_seq,
              cursorBefore,
              cursorAfter,
              bufferScreen,
              buffer: tabAfter?.buf,
              rawBytes: event.payload.raw_bytes,
              decodedChars: decodedData.length,
              rustToFrontendMs: Number.isFinite(emittedAtMs) ? receivedAtMs - emittedAtMs : null,
              readToEmitMs: Number.isFinite(readAtMs) && Number.isFinite(emittedAtMs)
                ? emittedAtMs - readAtMs : null,
              readToFrontendMs: Number.isFinite(readAtMs) ? receivedAtMs - readAtMs : null,
              parserMs,
            });
            if ((tabAfter?.buf?.syncOutputOrphanEndGeneration || 0) > orphanEndBefore) {
              terminalDiagnostics.freezeCapture('synchronized-output-ended-without-start', {
                tabId: tab_id,
                rawReadSeq: event.payload.raw_read_seq,
              });
            }
          }
          if (this.autoLoginManager.hasActiveSession(tab_id)) {
            if (decodedData) this.autoLoginManager.feedData(tab_id, decodedData);
            const tab = this.tabManager.getTabById(tab_id);
            if (tab?.buf) {
              const screen = tab.buf.getText(0, 0, tab.buf.cols - 1, tab.buf.rows - 1);
              this.autoLoginManager.checkScreenBuffer(tab_id, screen);
            }
          }
          this.scheduleNotificationScrape(tab_id);
        }
      } catch (err) {
        console.error('Parser feed error:', err);
      }
    });

    // Listen for backend connection status per tab
    listen('connection-status', (event) => {
      try {
        if (!this.acceptNativeEvent(event.payload)) return;
        const { tab_id, status } = event.payload;
        if (tab_id && status) {
          this.tabManager.updateTabStatus(tab_id, status);
          if (status === 'disconnected') {
            this.autoLoginManager.stopSession(tab_id);
            this.cancelQueuedSends(tab_id, new Error('連線已中斷'));
            if (this.notificationScrapeTimers?.has(tab_id)) {
              clearTimeout(this.notificationScrapeTimers.get(tab_id));
              this.notificationScrapeTimers.delete(tab_id);
            }
          }
        }
      } catch (err) {
        console.error('Status event error:', err);
      }
    });
  }

  getBottomLineText(tabId) {
    const tab = this.tabManager.getTabById(tabId);
    if (!tab || !tab.buf) return '';
    const r = tab.buf.rows - 1;
    if (r < 0 || !tab.buf.lines || !tab.buf.lines[r]) return '';

    let lineStr = '';
    for (let c = 0; c < tab.buf.cols; c++) {
      const cell = tab.buf.lines[r][c];
      if (!cell || cell.isTrailByte) continue;
      lineStr += cell.ch || ' ';
    }
    return lineStr.trim();
  }

  checkWaterballImmediate(tabId) {
    const tab = this.tabManager.getTabById(tabId);
    if (!tab || !tab.buf) return;

    const trimmed = this.getBottomLineText(tabId);
    if (trimmed.startsWith('★') || trimmed.includes('您有新信件')) {
      this.notificationManager.feedScreenLines(tabId, [trimmed], tab.title);
    }
  }

  async sendWaterball(targetName, message) {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab || !activeTab.isConnected) {
      return { success: false, reason: 'not_connected', text: '尚未連線至 BBS' };
    }

    const tabId = activeTab.id;
    const cleanTarget = String(targetName || '').trim();
    const cleanMsg = String(message || '').trim();
    if (!cleanTarget || !cleanMsg) {
      return { success: false, reason: 'invalid_params', text: '請輸入有效的對象與訊息' };
    }

    // Safety check: is the terminal currently inside a post editor?
    const bottomLine = this.getBottomLineText(tabId);
    if (/\[Ctrl-X\]|儲存離開|說明\(Ctrl-Z\)/i.test(bottomLine)) {
      return {
        success: false,
        reason: 'in_editor',
        text: '目前終端機正處於文章編輯器中，請先儲存離開後再發送水球',
      };
    }

    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    // Route 1: Try Ctrl+R cycling first (0ms screen shift, ideal for active conversations)
    const seenTargets = new Set();
    let foundTargetInQueue = false;

    this.sendDataToTab(tabId, '\x12');
    await sleep(90);

    for (let cycle = 0; cycle < 8; cycle++) {
      const line = this.getBottomLineText(tabId);
      const match = line.match(/^★對\s*([a-zA-Z][a-zA-Z0-9_]{1,11})\s*(?:丟水球\s*[:：]?|[:：]\s*)/i);
      if (match) {
        const curTarget = match[1].toLowerCase();
        if (curTarget === cleanTarget.toLowerCase()) {
          foundTargetInQueue = true;
          break;
        }
        if (seenTargets.has(curTarget)) {
          break; // Cycled through all available callers
        }
        seenTargets.add(curTarget);
        this.sendDataToTab(tabId, '\x12');
        await sleep(90);
      } else {
        break;
      }
    }

    if (foundTargetInQueue) {
      this.sendDataToTab(tabId, `${cleanMsg}\r`);
      await sleep(150);

      const afterLine = this.getBottomLineText(tabId);
      if (/不在線上|離線|不收水球|關閉中|無法送出/i.test(afterLine)) {
        return {
          success: false,
          reason: 'offline',
          text: `對方目前不在線上或拒收水球`,
        };
      }
      return { success: true };
    }

    // Cancel Ctrl+R prompt if still showing
    const curLine = this.getBottomLineText(tabId);
    if (curLine.startsWith('★對')) {
      this.sendDataToTab(tabId, '\x03'); // Ctrl+C
      await sleep(80);
    }

    // Route 2: Try Ctrl+U Online User List macro (targets any specific online user)
    this.sendDataToTab(tabId, '\x15'); // Ctrl+U
    await sleep(120);

    this.sendDataToTab(tabId, `s${cleanTarget}\r`);
    await sleep(150);

    const searchLine = this.getBottomLineText(tabId);
    if (/無此|不在線上|未上站|查無/i.test(searchLine)) {
      this.sendDataToTab(tabId, 'q');
      await sleep(80);
      return {
        success: false,
        reason: 'offline',
        text: `${cleanTarget} 目前不在線上`,
      };
    }

    // Found user: send waterball via 'w'
    this.sendDataToTab(tabId, `w${cleanMsg}\r`);
    await sleep(150);

    const resultLine = this.getBottomLineText(tabId);
    if (/不收水球|關閉中|無法送出/i.test(resultLine)) {
      this.sendDataToTab(tabId, 'q');
      await sleep(80);
      return {
        success: false,
        reason: 'offline',
        text: `對方設定不收水球`,
      };
    }

    // Return back to previous screen
    this.sendDataToTab(tabId, 'q');
    await sleep(80);
    return { success: true };
  }

  async sendMail(targetName, title, content) {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab || !activeTab.isConnected) {
      return { success: false, reason: 'not_connected', text: '尚未連線至 BBS' };
    }

    const tabId = activeTab.id;
    const cleanTarget = String(targetName || '').trim();
    const cleanTitle = String(title || '水球留言').trim();
    const cleanContent = String(content || '').trim();
    if (!cleanTarget || !cleanContent) {
      return { success: false, reason: 'invalid_params', text: '請輸入有效的收件人與信件內容' };
    }

    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    // Open User list Ctrl+U
    this.sendDataToTab(tabId, '\x15');
    await sleep(120);

    // Search user
    this.sendDataToTab(tabId, `s${cleanTarget}\r`);
    await sleep(150);

    const searchLine = this.getBottomLineText(tabId);
    if (/無此代號|無此使用者|查無/i.test(searchLine)) {
      this.sendDataToTab(tabId, 'q');
      await sleep(80);
      return {
        success: false,
        reason: 'user_not_found',
        text: `查無使用者代號 [${cleanTarget}]`,
      };
    }

    // In user list, pressing 'm' sends a mail to this user directly
    this.sendDataToTab(tabId, 'm');
    await sleep(150);

    // Enter title
    this.sendDataToTab(tabId, `${cleanTitle}\r`);
    await sleep(150);

    // In PTT editor: enter content, then Ctrl+X -> s -> Enter -> Enter
    this.sendDataToTab(tabId, `${cleanContent}\r\x18s\r\r`);
    await sleep(250);

    // Return from user list back to original screen
    this.sendDataToTab(tabId, 'q');
    await sleep(80);

    return { success: true };
  }

  scheduleNotificationScrape(tabId) {
    if (!this.notificationScrapeTimers) {
      this.notificationScrapeTimers = new Map();
    }
    const existing = this.notificationScrapeTimers.get(tabId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.notificationScrapeTimers.delete(tabId);
      const tab = this.tabManager.getTabById(tabId);
      if (tab && tab.buf) {
        const lines = [];
        // PTT and MapleBBS status messages & waterball alerts ONLY appear on the bottom-most row
        const startRow = Math.max(0, tab.buf.rows - 1);
        for (let r = startRow; r < tab.buf.rows; r++) {
          let lineStr = '';
          for (let c = 0; c < tab.buf.cols; c++) {
            const cell = tab.buf.lines[r][c];
            if (!cell || cell.isTrailByte) continue;
            lineStr += cell.ch || ' ';
          }
          lines.push(lineStr);
        }
        this.notificationManager.feedScreenLines(tabId, lines, tab.title);
      }
    }, 300);

    this.notificationScrapeTimers.set(tabId, timer);
  }

  processSendQueue() {
    this.sendingTabs ||= new Set();
    for (const tabId of new Set(this.sendQueue.map(item => item.tabId))) {
      if (this.sendingTabs.has(tabId)) continue;
      this.sendingTabs.add(tabId);
      this.isSending = true;
      void this.drainTabSendQueue(tabId);
    }
  }

  async drainTabSendQueue(tabId) {
    try {
      while (true) {
        const index = this.sendQueue.findIndex(item => item.tabId === tabId);
        if (index < 0) break;
        const [item] = this.sendQueue.splice(index, 1);

        if (item.signal?.aborted) {
          item.reject?.(new Error('貼上已取消'));
          continue;
        }
        if (item.expectedAttempt && this.connectionAttempts.get(tabId) !== item.expectedAttempt) {
          item.reject?.(new Error('連線已變更'));
          continue;
        }
        const currentTabId = item.tabId;

        if (item.data) {
          try {
            if (!this.tabManager.getTabById(currentTabId)?.isConnected) throw new Error('連線已中斷');

            if (isDevelopment) {
              terminalDiagnostics.recordInput({
                tabId: currentTabId,
                data: item.sensitive ? '[redacted]' : item.data,
                sourceKey: item.sourceKey,
                isRepeat: item.isRepeat,
              });
            }
            await safeInvoke('send_input', { tabId: currentTabId, data: item.data, ...(item.expectedSession ? { expectedSession: item.expectedSession } : {}) });
            item.resolve?.();
          } catch (err) {
            const error = new Error(String(err?.message || err));
            item.reject?.(error);
            this.cancelQueuedSends(currentTabId, error, error.message.includes('STALE_CONNECTION') ? item.expectedSession : null);
            if (!error.message.includes('STALE_CONNECTION')) {
              this.tabManager.updateTabStatus?.(currentTabId, 'disconnected');
              this.onShowToast('傳送失敗，已停止此連線的待送資料；請重新連線');
            }
            console.error('Send error:', err);
          }
        }
      }
    } finally {
      this.sendingTabs.delete(tabId);
      this.isSending = this.sendingTabs.size > 0;
    }
  }

  async getConnectionSession(tabId) {
    if (!this.tabManager.getTabById(tabId)?.isConnected) throw new Error('連線已中斷');
    const session = await safeInvoke('connection_session', { tabId });
    if (typeof session !== 'string' || !session) throw new Error('無法確認連線身分');
    return session;
  }

  cancelQueuedSends(tabId, error, session = null) {
    this.sendQueue = this.sendQueue.filter(item => {
      if (item.tabId !== tabId || (session && item.expectedSession !== session)) return true;
      item.reject?.(error);
      return false;
    });
  }

  acquireInputLease(tabId) {
    this.inputLeases ||= new Map();
    if (!this.tabManager.getTabById(tabId)?.isConnected || this.inputLeases.has(tabId) ||
        this.sendingTabs?.has(tabId) || this.sendQueue.some(item => item.tabId === tabId)) return null;
    const token = Symbol('terminal-input-owner');
    this.inputLeases.set(tabId, token);
    return token;
  }

  releaseInputLease(tabId, token) {
    if (token && this.inputLeases?.get(tabId) === token) this.inputLeases.delete(tabId);
  }

  acceptsInputLease(tabId, token = null) {
    return (this.inputLeases?.get(tabId) || null) === token;
  }

  sendDataToTabAndWait(tabId, data, expectedSession, inputLease = null, signal = null, sensitive = false) {
    if (!this.acceptsInputLease(tabId, inputLease)) return Promise.reject(new Error('終端機正由其他發送流程使用'));
    if (!expectedSession) return Promise.reject(new Error('缺少連線身分'));
    if (!tabId || typeof data !== 'string' || !data) return Promise.reject(new Error('待送資料不可為空'));
    return new Promise((resolve, reject) => {
      const cleanData = data.replace(/\u00a0/g, ' ').replace(/[\u2000-\u200b\u202f\u205f\ufeff]/g, ' ');
      this.sendQueue.push({ tabId, data: cleanData, expectedSession, signal, sensitive, resolve, reject });
      this.processSendQueue();
    });
  }

  sendDataToTab(tabId, data, { sourceKey = null, isRepeat = false, sensitive = false, signal = null, expectedAttempt = null } = {}) {
    if (!sensitive && this.autoLoginManager?.sessions?.get(tabId)?.state === 'SENDING_2FA') {
      this.autoLoginManager.stopSession(tabId);
    }
    if (!tabId || !data || signal?.aborted || (expectedAttempt && this.connectionAttempts.get(tabId) !== expectedAttempt) || !this.acceptsInputLease(tabId)) return false;
    const cleanData = data
      .replace(/\u00a0/g, ' ')
      .replace(/[\u2000-\u200b\u202f\u205f\ufeff]/g, ' ');

    if (isScreenNavigation(cleanData)) {
      if (sourceKey) {
        isRepeat = isRepeat || this.heldScreenNavigationKeys.has(sourceKey);
        this.heldScreenNavigationKeys.add(sourceKey);
      }
      if (isRepeat) {
        this.sendQueue = this.sendQueue.filter((item) =>
          item.tabId !== tabId || !(isScreenNavigation(item.data) && item.isRepeat));
      } else {
        this.sendQueue = this.sendQueue.filter((item) =>
          item.tabId !== tabId || !item.isRepeat);
      }
    }
    this.sendQueue.push({ tabId, data: cleanData, sourceKey, isRepeat, sensitive, signal, expectedAttempt });
    this.processSendQueue();
  }

  cancelQueuedRepeatedNavigation(sourceKey) {
    this.heldScreenNavigationKeys.delete(sourceKey);
    this.sendQueue = this.sendQueue.filter((item) => {
      const isNavigation = isScreenNavigation(item.data);
      return !(isNavigation && item.sourceKey === sourceKey && item.isRepeat);
    });
  }

  clearHeldScreenNavigationKeys() {
    this.heldScreenNavigationKeys.clear();
    this.sendQueue = this.sendQueue.filter((item) => {
      const isNavigation = isScreenNavigation(item.data);
      return !(isNavigation && item.isRepeat);
    });
  }

  sendData(data, options) {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab || !activeTab.isConnected || !data) return;
    this.sendDataToTab(activeTab.id, data, options);
  }

  async connect(targetBm = null, options = {}) {
    if (targetBm && !targetBm.address && targetBm.credentials) {
      options = targetBm;
      targetBm = null;
    }
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) return;

    const { addressInput, encodingSelect } = this.elements;
    const raw = addressInput ? addressInput.value.trim() : '';
    const charset = encodingSelect ? encodingSelect.value : 'big5';
    let parsed;
    try {
      if (!raw) throw new Error('請輸入 BBS 站台網址');
      parsed = parseAddress(raw);
      if (!parsed.host) throw new Error('站台網址缺少主機名稱');
      if (!isTauri()) throw new Error('此桌面版需要 Tauri 原生連線');
      if (isTauri() && parsed.transport === 'ws') throw new Error('桌面端 WebSocket 請使用 wss:// 安全連線');
    } catch (error) {
      this.onShowToast(`連線失敗：${error.message || error}`);
      // Validation must not retire an existing socket or change its address/session.
      return;
    }
    const { host, port, userPrefix, transport, endpoint } = parsed;
    const targetAddress = userPrefix ? `${userPrefix}@${host}` : endpoint;
    const isWs = transport === 'wss' || transport === 'ws';
    const attempt = Symbol('connection');
    this.connectionAttempts.set(activeTab.id, attempt);
    const isCurrent = () => this.connectionAttempts.get(activeTab.id) === attempt && Boolean(this.tabManager.getTabById(activeTab.id));
    const nativeAttempt = this.nativeAttempts.get(activeTab.id);
    this.nativeAttempts.delete(activeTab.id);
    if (nativeAttempt) await safeInvoke('disconnect', { tabId: activeTab.id, attemptId: nativeAttempt }).catch(console.error);
    if (!isCurrent()) return;
    this.cancelQueuedSends(activeTab.id, new Error('連線已替換'));
    this.autoLoginManager.stopSession(activeTab.id);
    if (this.notificationScrapeTimers.has(activeTab.id)) {
      clearTimeout(this.notificationScrapeTimers.get(activeTab.id));
      this.notificationScrapeTimers.delete(activeTab.id);
    }
    activeTab.address = raw;
    activeTab.encoding = charset;
    if (targetBm?.name) {
      activeTab.bookmarkName = targetBm.name;
      activeTab.title = targetBm.name;
    }
    activeTab.parser?.resetByteDecoder?.();

    activeTab.buf?.clear?.(2);
    const destination = isWs ? targetAddress : `${targetAddress}:${port}`;
    activeTab.parser?.feed?.(`\x1b[1;33m正在透過 ${transport.toUpperCase()} 連線到 ${destination} (${charset.toUpperCase()}) ...\r\n\x1b[0m`);
    this.tabManager.updateTabStatus(activeTab.id, 'connecting');

    // 1. Resolve matching bookmark for auto-login
    const bookmarkAddress = bm => { try { return parseAddress(bm.address); } catch { return {}; } };
    let matchedBm = targetBm;
    if (!matchedBm || !matchedBm.username) {
      const credBookmarks = (this.settingsManager?.bookmarks || []).filter((b) => Boolean(b.username));
      matchedBm = credBookmarks.find((b) => b.address === raw);
      if (!matchedBm) {
        matchedBm = credBookmarks.find((b) => b.address === targetAddress);
      }
      if (!matchedBm && host) {
        matchedBm = credBookmarks.find((b) => {
          const bInfo = bookmarkAddress(b);
          return bInfo.host === host && (!port || bInfo.port === port);
        });
      }
      if (!matchedBm && host) {
        matchedBm = credBookmarks.find((b) => {
          const bInfo = bookmarkAddress(b);
          return bInfo.host === host;
        });
      }
      if (!matchedBm && isWs && host === 'ws.ptt.cc') {
        matchedBm = credBookmarks.find((b) => bookmarkAddress(b).host === 'ptt.cc');
      }
      if (!matchedBm && host) {
        matchedBm = credBookmarks.find((b) => typeof b.address === 'string' && b.address.length > 0 && (b.address.includes(host) || host.includes(b.address)));
      }
    }

    // 2. Pre-initialize auto-login session BEFORE socket connection
    const customCreds = options?.credentials;
    if (customCreds && customCreds.username) {
      this.autoLoginManager.startSession(
        activeTab.id,
        customCreds,
        (data, signal) => this.sendDataToTab(activeTab.id, data, { sensitive: true, signal, expectedAttempt: attempt }),
        '', { sendOtp: (code, signal) => this.sendQuickLoginOtp(activeTab.id, attempt, code, signal) }
      );
    } else if (matchedBm && matchedBm.username) {
      try {
        const creds = await this.settingsManager.getDecryptedCredentials(matchedBm);
        if (!isCurrent()) return;
        if (creds && creds.username) {
          this.autoLoginManager.startSession(
            activeTab.id,
            creds,
            (data, signal) => this.sendDataToTab(activeTab.id, data, { sensitive: true, signal, expectedAttempt: attempt })
          );
        }
      } catch (err) {
        console.warn('Failed to retrieve auto-login credentials:', err);
      }
    }

    if (!isCurrent()) return;
    const attemptId = `native-${Date.now()}-${++nativeAttemptCounter}`;
    this.nativeAttempts.set(activeTab.id, attemptId);
    try {
      await safeInvoke('connect', { tabId: activeTab.id, address: targetAddress, port, charset, transport, attemptId });
      if (!isCurrent()) return;
      this.tabManager.updateTabStatus(activeTab.id, 'connected');
      this.onFocusTerminal(true);

      if (activeTab.buf) {
        const screen = activeTab.buf.getText(0, 0, activeTab.buf.cols - 1, activeTab.buf.rows - 1);
        this.autoLoginManager?.checkScreenBuffer?.(activeTab.id, screen);
      }
    } catch (err) {
      if (!isCurrent()) return;
      // Keep the failed native attempt addressable for close/replacement cleanup.
      this.autoLoginManager?.stopSession?.(activeTab.id);
      activeTab.parser?.feed?.(`\x1b[1;31m連線失敗: ${err}\r\n\x1b[0m`);
      this.tabManager.updateTabStatus(activeTab.id, 'disconnected');
    }
  }

  async disconnectTab(tabId) {
    // Invalidate pending credential lookup and handshake continuations first.
    this.connectionAttempts.delete(tabId);
    const nativeAttempt = this.nativeAttempts.get(tabId);
    this.nativeAttempts.delete(tabId);
    this.autoLoginManager.stopSession(tabId);
    this.cancelQueuedSends(tabId, new Error('連線已中斷'));
    if (this.notificationScrapeTimers?.has(tabId)) {
      clearTimeout(this.notificationScrapeTimers.get(tabId));
      this.notificationScrapeTimers.delete(tabId);
    }
    this.tabManager.updateTabStatus(tabId, 'disconnected');
    if (isTauri() && nativeAttempt) {
      try { await safeInvoke('disconnect', { tabId, attemptId: nativeAttempt }); }
      catch (err) { console.error('Disconnect error:', err); }
    }
  }

  async disconnect() {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) return;
    await this.disconnectTab(activeTab.id);
  }

  getQuickLoginContext() {
    const tab = this.tabManager.getActiveTab();
    if (!tab) throw new Error('沒有可用的分頁');
    const address = tab.isConnected ? tab.address : this.elements.addressInput?.value?.trim();
    if (!address || parseAddress(address).transport !== 'wss') throw new Error('快速登入需要 WSS 安全連線，請先確認站台網址');
    return { tabId: tab.id, address, connected: tab.isConnected, attempt: this.connectionAttempts.get(tab.id) };
  }

  isQuickLoginContextCurrent(context) {
    try {
      const now = this.getQuickLoginContext();
      return now.tabId === context.tabId && now.address === context.address && now.connected === context.connected && now.attempt === context.attempt;
    } catch { return false; }
  }

  async sendQuickLoginOtp(tabId, attempt, code, signal) {
    if (!attempt || this.connectionAttempts.get(tabId) !== attempt || this.otpAttempts.get(tabId) === attempt) throw new Error('此連線已嘗試過動態驗證碼');
    this.otpAttempts.set(tabId, attempt);
    const lease = this.acquireInputLease(tabId);
    if (!lease) throw new Error('終端機正在使用中');
    try {
      const session = await this.getConnectionSession(tabId);
      if (signal.aborted || this.connectionAttempts.get(tabId) !== attempt) throw new Error('登入已取消');
      await this.sendDataToTabAndWait(tabId, `${code}\r`, session, lease, signal, true);
    } finally {
      this.releaseInputLease(tabId, lease);
    }
  }

  startCustomAutoLogin(credentials, context) {
    if (!context || !this.isQuickLoginContextCurrent(context)) return false;
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab || !activeTab.isConnected) return false;
    let screen = '';
    if (activeTab.buf) {
      screen = activeTab.buf.getText(0, 0, activeTab.buf.cols - 1, activeTab.buf.rows - 1);
    }
    this.autoLoginManager.startSession(
      activeTab.id,
      credentials,
      (data, signal) => this.sendDataToTab(activeTab.id, data, { sensitive: true, signal, expectedAttempt: context.attempt }),
      screen,
      { sendOtp: (code, signal) => this.sendQuickLoginOtp(activeTab.id, context.attempt, code, signal) }
    );
    return true;
  }

  updateToolbarConnectionState(state) {
    const { statusDot, statusText, connectBtn, disconnectBtn, addressInput } = this.elements;
    if (!statusDot || !statusText) return;

    statusDot.className = 'status-dot';
    if (state === 'connected') {
      statusDot.classList.add('connected');
      statusText.textContent = '已連線';
      if (connectBtn) connectBtn.style.display = 'none';
      if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
      if (addressInput) addressInput.disabled = true;
      this.onFocusTerminal();
    } else if (state === 'connecting') {
      statusDot.classList.add('connecting');
      statusText.textContent = '連線中...';
      if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.style.display = 'inline-block';
      }
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (addressInput) addressInput.disabled = true;
    } else {
      statusText.textContent = '未連線';
      if (connectBtn) {
        connectBtn.style.display = 'inline-block';
        connectBtn.disabled = false;
      }
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (addressInput) addressInput.disabled = false;
    }
  }
}
