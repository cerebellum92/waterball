// Connection & Send Queue Controller for Waterball BBS

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

export function parseAddress(input) {
  input = input.trim();
  input = input.replace(/^(telnet|ssh|bbs):\/\//, '');

  let userPrefix = '';
  const atIdx = input.indexOf('@');
  if (atIdx !== -1) {
    userPrefix = input.substring(0, atIdx);
    input = input.substring(atIdx + 1);
  }

  let host = input;
  let port = 23;

  const colonIdx = input.lastIndexOf(':');
  if (colonIdx !== -1) {
    const portStr = input.substring(colonIdx + 1);
    const portNum = parseInt(portStr, 10);
    if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
      host = input.substring(0, colonIdx);
      port = portNum;
    }
  }

  return { host, port, userPrefix };
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
    this.notificationScrapeTimer = null;

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
        if (activeTab.isConnected) {
          invoke('set_charset', { tabId: activeTab.id, charset: cs }).catch((err) => {
            console.error('Failed to change charset:', err);
          });
        }
      });
    }
  }

  initTauriListeners() {
    // Listen for backend terminal data per tab
    listen('terminal-data', (event) => {
      try {
        const { tab_id, data } = event.payload;
        if (tab_id && data) {
          this.tabManager.feedData(tab_id, data);
          this.autoLoginManager.feedData(tab_id, data);
          const tab = this.tabManager.getTabById(tab_id);
          if (tab?.buf) {
            const screen = tab.buf.getText(0, 0, tab.buf.cols - 1, tab.buf.rows - 1);
            this.autoLoginManager.checkScreenBuffer(tab_id, screen);
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

      let combinedData = item.data;
      const currentTabId = item.tabId;
      while (this.sendQueue.length > 0 && this.sendQueue[0].tabId === currentTabId) {
        combinedData += this.sendQueue.shift().data;
      }

      if (combinedData) {
        try {
          await invoke('send_input', { tabId: currentTabId, data: combinedData });
        } catch (err) {
          console.error('Send error:', err);
        }
      }
    }

    this.isSending = false;
  }

  sendDataToTab(tabId, data) {
    if (!tabId || !data) return;
    const cleanData = data
      .replace(/\u00a0/g, ' ')
      .replace(/[\u2000-\u200b\u202f\u205f\ufeff]/g, ' ');

    this.sendQueue.push({ tabId, data: cleanData });
    this.processSendQueue();
  }

  sendData(data) {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab || !activeTab.isConnected || !data) return;
    this.sendDataToTab(activeTab.id, data);
  }

  async connect(targetBm = null) {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) return;

    const { addressInput, encodingSelect } = this.elements;
    const raw = addressInput ? addressInput.value.trim() : '';
    if (!raw) return;

    activeTab.address = raw;
    activeTab.encoding = encodingSelect ? encodingSelect.value : 'big5';

    const { host, port, userPrefix } = parseAddress(raw);
    const targetAddress = userPrefix ? `${userPrefix}@${host}` : host;
    const charset = activeTab.encoding;

    activeTab.buf.clear(2);
    activeTab.parser.feed(`\x1b[1;33m正在連線到 ${targetAddress}:${port} (${charset.toUpperCase()}) ...\r\n\x1b[0m`);
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
      await invoke('connect', { tabId: activeTab.id, address: targetAddress, port, charset });
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
