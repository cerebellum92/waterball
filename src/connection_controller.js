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
    this.notificationScrapeTimer = null;

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
          }
        }
      } catch (err) {
        console.error('Status event error:', err);
      }
    });
  }

  scheduleNotificationScrape(tabId) {
    clearTimeout(this.notificationScrapeTimer);
    this.notificationScrapeTimer = setTimeout(() => {
      const tab = this.tabManager.getTabById(tabId);
      if (tab && tab.buf) {
        const lines = [];
        const startRow = Math.max(0, tab.buf.rows - 2);
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
