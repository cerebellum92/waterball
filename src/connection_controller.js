// Connection & Send Queue Controller for Waterball BBS
import { terminalDiagnostics } from './terminal_diagnostics.js';

const isDevelopment = import.meta.env?.DEV ?? false;
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const isHorizontalNavigation = (data) => data === '\x1b[C' || data === '\x1b[D';
const isVerticalNavigation = (data) => data === '\x1bOA' || data === '\x1bOB' || data === '\x1b[A' || data === '\x1b[B';
const isPageNavigation = (data) => data === '\x1b[5~' || data === '\x1b[6~';
const isScreenNavigation = (data) => isHorizontalNavigation(data) || isVerticalNavigation(data) || isPageNavigation(data);

export function parseAddress(input) {
  input = input.trim();
  const scheme = input.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase() || '';
  if (scheme === 'wss') {
    const url = new URL(input);
    return {
      host: url.hostname,
      port: Number(url.port || 443),
      userPrefix: '',
      transport: 'wss',
      endpoint: `${url.origin}${url.pathname}${url.search}`,
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
    this.heldScreenNavigationKeys = new Set();
    this.notificationScrapeTimers = new Map();

    // PCMan-style Bell (\x07) hook: immediate waterball inspection & chime
    if (this.tabManager) {
      this.tabManager.onBell = (tab) => {
        if (tab) {
          this.checkWaterballImmediate(tab.id);
          this.notificationManager?.playChime?.();
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
          invoke('set_charset', { tabId: activeTab.id, charset: cs }).catch((err) => {
            console.error('Failed to change charset:', err);
          });
        }
      });
    }
  }

  initTauriListeners() {
    if (isDevelopment) {
      listen('terminal-raw-read', (event) => {
        terminalDiagnostics.recordRawRead(event.payload);
      });
    }

    // Listen for backend terminal data per tab
    listen('terminal-data', (event) => {
      try {
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
        const { tab_id, status } = event.payload;
        if (tab_id && status) {
          this.tabManager.updateTabStatus(tab_id, status);
          if (status === 'disconnected') {
            this.autoLoginManager.stopSession(tab_id);
            this.sendQueue = this.sendQueue.filter((item) => item.tabId !== tab_id);
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

  async processSendQueue() {
    if (this.isSending || this.sendQueue.length === 0) return;
    this.isSending = true;

    while (this.sendQueue.length > 0) {
      const item = this.sendQueue.shift();
      if (!item) continue;

      const currentTabId = item.tabId;

      if (item.data) {
        try {
          if (!this.tabManager.getTabById(currentTabId)?.isConnected) continue;

          if (isDevelopment) {
            terminalDiagnostics.recordInput({
              tabId: currentTabId,
              data: item.data,
              sourceKey: item.sourceKey,
              isRepeat: item.isRepeat,
            });
          }
          await invoke('send_input', { tabId: currentTabId, data: item.data });
        } catch (err) {
          console.error('Send error:', err);
        }
      }
    }

    this.isSending = false;
  }

  sendDataToTab(tabId, data, { sourceKey = null, isRepeat = false } = {}) {
    if (!tabId || !data) return;
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
    this.sendQueue.push({ tabId, data: cleanData, sourceKey, isRepeat });
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

  async connect(targetBm = null) {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) return;

    const { addressInput, encodingSelect } = this.elements;
    const raw = addressInput ? addressInput.value.trim() : '';
    if (!raw) return;

    activeTab.address = raw;
    activeTab.encoding = encodingSelect ? encodingSelect.value : 'big5';
    activeTab.parser.resetByteDecoder();

    const { host, port, userPrefix, transport, endpoint } = parseAddress(raw);
    const targetAddress = userPrefix ? `${userPrefix}@${host}` : endpoint;
    const charset = activeTab.encoding;

    activeTab.buf.clear(2);
    const destination = transport === 'wss' ? targetAddress : `${targetAddress}:${port}`;
    activeTab.parser.feed(`\x1b[1;33m正在透過 ${transport.toUpperCase()} 連線到 ${destination} (${charset.toUpperCase()}) ...\r\n\x1b[0m`);
    this.tabManager.updateTabStatus(activeTab.id, 'connecting');

    // 1. Resolve matching bookmark for auto-login
    let matchedBm = targetBm;
    if (!matchedBm || !matchedBm.username) {
      const credBookmarks = this.settingsManager.bookmarks.filter((b) => Boolean(b.username));
      matchedBm = credBookmarks.find((b) => b.address === raw);
      if (!matchedBm) {
        matchedBm = credBookmarks.find((b) => b.address === targetAddress);
      }
      if (!matchedBm && host) {
        matchedBm = credBookmarks.find((b) => {
          const bInfo = parseAddress(b.address);
          return bInfo.host === host && (!port || bInfo.port === port);
        });
      }
      if (!matchedBm && host) {
        matchedBm = credBookmarks.find((b) => {
          const bInfo = parseAddress(b.address);
          return bInfo.host === host;
        });
      }
      if (!matchedBm && transport === 'wss' && host === 'ws.ptt.cc') {
        matchedBm = credBookmarks.find((b) => parseAddress(b.address).host === 'ptt.cc');
      }
      if (!matchedBm && host) {
        matchedBm = credBookmarks.find((b) => b.address.includes(host) || host.includes(b.address));
      }
    }

    // 2. Pre-initialize auto-login session BEFORE socket connection
    if (matchedBm && matchedBm.username) {
      try {
        const creds = await this.settingsManager.getDecryptedCredentials(matchedBm);
        if (creds && creds.username) {
          this.autoLoginManager.startSession(
            activeTab.id,
            creds,
            (data) => this.sendDataToTab(activeTab.id, data)
          );
        }
      } catch (err) {
        console.warn('Failed to retrieve auto-login credentials:', err);
      }
    }

    try {
      await invoke('connect', { tabId: activeTab.id, address: targetAddress, port, charset, transport });
      this.tabManager.updateTabStatus(activeTab.id, 'connected');
      this.onFocusTerminal(true);

      if (activeTab.buf) {
        const screen = activeTab.buf.getText(0, 0, activeTab.buf.cols - 1, activeTab.buf.rows - 1);
        this.autoLoginManager.checkScreenBuffer(activeTab.id, screen);
      }
    } catch (err) {
      this.autoLoginManager.stopSession(activeTab.id);
      activeTab.parser.feed(`\x1b[1;31m連線失敗: ${err}\r\n\x1b[0m`);
      this.tabManager.updateTabStatus(activeTab.id, 'disconnected');
    }
  }

  async disconnect() {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) return;

    try {
      await invoke('disconnect', { tabId: activeTab.id });
    } catch (err) {
      console.error('Disconnect error:', err);
    }
    if (this.notificationScrapeTimers?.has(activeTab.id)) {
      clearTimeout(this.notificationScrapeTimers.get(activeTab.id));
      this.notificationScrapeTimers.delete(activeTab.id);
    }
    this.tabManager.updateTabStatus(activeTab.id, 'disconnected');
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
