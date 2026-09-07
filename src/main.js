import { TabManager } from './tab_manager.js';
import { settingsManager } from './settings.js';
import { imagePreview } from './image_preview.js';
import { articleReader } from './article_reader.js';
import { SearchWidget } from './search.js';
import { autoLoginManager } from './auto_login.js';
import { PaletteWidget } from './palette.js';
import { notificationManager } from './notifications.js';
import { exportModal } from './exporter.js';
import { BoardSwitcherWidget } from './board_switcher.js';
import { UpdateChecker } from './updater.js';
import { PushHelper } from './push_helper.js';
import { blacklistManager } from './blacklist.js';
import { writeClipboardText } from './platform.js';
import { isMac, isInteractiveInputElement, translateBbsKey } from './keymap.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const updateChecker = new UpdateChecker();

// DOM elements
const tabBar = document.getElementById('tab-bar');
const addressInput = document.getElementById('address-input');
const encodingSelect = document.getElementById('encoding-select');
const bookmarksSelect = document.getElementById('bookmarks-select');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const boardBtn = document.getElementById('board-btn');
const exportBtn = document.getElementById('export-btn');
const paletteBtn = document.getElementById('palette-btn');
const articleReaderBtn = document.getElementById('article-reader-btn');
const pushHelperBtn = document.getElementById('push-helper-btn');
const addBookmarkBtn = document.getElementById('add-bookmark-btn');
const settingsBtn = document.getElementById('settings-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const terminalContainer = document.getElementById('terminal-container');
document.body.addEventListener("scroll", () => { if (document.body.scrollLeft > 0) document.body.scrollLeft = 0; if (document.body.scrollTop > 0) document.body.scrollTop = 0; });
window.addEventListener("scroll", () => { if (window.scrollX > 0) window.scrollTo(0, window.scrollY); if (window.scrollY > 0) window.scrollTo(window.scrollX, 0); });

terminalContainer.addEventListener("scroll", () => { if (terminalContainer.scrollLeft > 0) terminalContainer.scrollLeft = 0; if (terminalContainer.scrollTop > 0) terminalContainer.scrollTop = 0; });

const imeInput = document.getElementById('ime-input');

// Palette, Search, Board Switcher & Push Helper Setup
const searchWidget = new SearchWidget(() => tabManager.getActiveTab());
const paletteWidget = new PaletteWidget((data) => sendData(data), () => tabManager.getActiveTab());
const boardSwitcherWidget = new BoardSwitcherWidget((data) => sendData(data));
const pushHelper = new PushHelper((data) => sendData(data), () => tabManager.getActiveTab());
const settingsModal = document.getElementById('settings-modal');
const pushModal = document.getElementById('push-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalSaveBtn = document.getElementById('modal-save-btn');
const bookmarkList = document.getElementById('bookmark-list');
const bmInputName = document.getElementById('bm-input-name');
const bmInputAddr = document.getElementById('bm-input-addr');
const bmInputEnc = document.getElementById('bm-input-enc');
const bmInputUser = document.getElementById('bm-input-user');
const bmInputPass = document.getElementById('bm-input-pass');
const bmBtnAdd = document.getElementById('bm-btn-add');
const btnResetDefaultBookmarks = document.getElementById('btn-reset-default-bookmarks');

// Setting form inputs
const settingAntiIdle = document.getElementById('setting-anti-idle');
const settingAntiIdleInterval = document.getElementById('setting-anti-idle-interval');
const settingNotifyEnabled = document.getElementById('setting-notify-enabled');
const settingNotifySound = document.getElementById('setting-notify-sound');
const settingSmartDbcs = document.getElementById('setting-smart-dbcs');
const settingWheelScroll = document.getElementById('setting-wheel-scroll');
const settingAutoCopy = document.getElementById('setting-auto-copy');
const settingTheme = document.getElementById('setting-theme');
const settingCursorStyle = document.getElementById('setting-cursor-style');
const settingBlinkRate = document.getElementById('setting-blink-rate');
const settingImagePreview = document.getElementById('setting-image-preview');
const settingToolbarScale = document.getElementById('setting-toolbar-scale');
const settingFontFamily = document.getElementById('setting-font-family');
const settingCustomFont = document.getElementById('setting-custom-font');
const customFontGroup = document.getElementById('custom-font-group');

// Blacklist DOM elements
const settingBlacklistEnabled = document.getElementById('setting-blacklist-enabled');
const settingBlacklistGreatTreasure = document.getElementById('setting-blacklist-great-treasure');
const greatTreasureBadge = document.getElementById('great-treasure-badge');
const inputBlacklistAdd = document.getElementById('input-blacklist-add');
const btnBlacklistAdd = document.getElementById('btn-blacklist-add');
const blacklistTagsContainer = document.getElementById('blacklist-tags-container');
const blacklistCount = document.getElementById('blacklist-count');
const btnBlacklistImport = document.getElementById('btn-blacklist-import');
const fileBlacklistImport = document.getElementById('file-blacklist-import');
const btnBlacklistExportTxt = document.getElementById('btn-blacklist-export-txt');
const btnBlacklistExportJson = document.getElementById('btn-blacklist-export-json');
const btnBlacklistClear = document.getElementById('btn-blacklist-clear');

// Global Context Menu DOM elements
const contextMenuEl = document.getElementById('terminal-context-menu');
const ctxCopy = document.getElementById('ctx-copy');
const ctxCopyAnsi = document.getElementById('ctx-copy-ansi');
const ctxSearchGoogle = document.getElementById('ctx-search-google');
const ctxBlacklistToggle = document.getElementById('ctx-blacklist-toggle');
const ctxQuickPush = document.getElementById('ctx-quick-push');

if (settingFontFamily && customFontGroup) {
  settingFontFamily.addEventListener('change', () => {
    if (settingFontFamily.value === 'custom') {
      customFontGroup.classList.remove('hidden');
    } else {
      customFontGroup.classList.add('hidden');
    }
  });
}

// Tab Manager Setup
const tabManager = new TabManager(tabBar, terminalContainer, imeInput);

notificationManager.onTabBadgeTrigger = (tabId) => tabManager.triggerTabBadge(tabId);
notificationManager.onFocusTab = (tabId) => tabManager.switchTab(tabId);

tabManager.onActiveTabChange = (activeTab) => {
  if (!activeTab) return;
  imagePreview.hideImmediate();
  searchWidget.close();
  addressInput.value = activeTab.address;
  if (encodingSelect) encodingSelect.value = activeTab.encoding;
  updateToolbarConnectionState(activeTab.status);
};

tabManager.onTabCloseRequest = (closingTab) => {
  imagePreview.hideImmediate();
  if (closingTab.isConnected) {
    invoke('disconnect', { tabId: closingTab.id }).catch(() => {});
  }
};

tabManager.onUrlClick = (url) => {
  console.log('Opening external URL:', url);
  imagePreview.hideImmediate();
  invoke('open_browser_url', { url }).catch((err) => {
    console.error('Failed to open URL via Tauri:', err);
    window.open(url, '_blank');
  });
};

tabManager.onUrlHover = (url, cx, cy, tab) => {
  if (settingsManager.settings.imagePreviewEnabled !== false) {
    imagePreview.show(url, cx, cy);
  }
};

tabManager.onUrlLeave = () => {
  imagePreview.hide();
};

tabManager.onWheel = (direction, tab) => {
  imagePreview.hideImmediate();
  settingsManager.recordActivity();
  if (!tab || !tab.isConnected) return;
  if (!settingsManager.settings.wheelScrollPage) return;
  sendData(direction === 'down' ? '\x1b[6~' : '\x1b[5~');
};

tabManager.onSelectionChange = (selection, tab) => {
  if (settingsManager.settings.autoCopySelection && selection && tab?.view) {
    const text = tab.view.getSelectionText();
    if (text) {
      writeClipboardText(text).catch(() => {});
    }
  }
};

// Initialize first tab
tabManager.init();

// Window resize handling
const resizeObserver = new ResizeObserver(() => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab?.view) activeTab.view.resize();
});
resizeObserver.observe(terminalContainer);
window.addEventListener('resize', () => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab?.view) activeTab.view.resize();
});

const sendQueue = [];
let isSending = false;

async function processSendQueue() {
  if (isSending || sendQueue.length === 0) return;
  isSending = true;

  while (sendQueue.length > 0) {
    const item = sendQueue.shift();
    if (!item) continue;

    // Coalesce contiguous queued items intended for the same tab into a single IPC packet
    let combinedData = item.data;
    const currentTabId = item.tabId;
    while (sendQueue.length > 0 && sendQueue[0].tabId === currentTabId) {
      combinedData += sendQueue.shift().data;
    }

    if (combinedData) {
      try {
        await invoke('send_input', { tabId: currentTabId, data: combinedData });
      } catch (err) {
        console.error('Send error:', err);
      }
    }
  }

  isSending = false;
}

function sendDataToTab(tabId, data) {
  if (!tabId || !data) return;
  const cleanData = data
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2000-\u200b\u202f\u205f\ufeff]/g, ' ');

  sendQueue.push({ tabId, data: cleanData });
  processSendQueue();
}

function sendData(data) {
  const activeTab = tabManager.getActiveTab();
  if (!activeTab || !activeTab.isConnected || !data) return;
  sendDataToTab(activeTab.id, data);
}

function focusTerminal(force = false) {
  if (settingsModal && !settingsModal.classList.contains('hidden')) return;
  if (articleReader && articleReader.isOpen) return;
  if (searchWidget && searchWidget.isOpen) return;
  if (pushHelper && pushHelper.isOpen) return;
  if (paletteWidget && paletteWidget.isOpen) return;
  if (exportModal && exportModal.isOpen) return;
  if (boardSwitcherWidget && boardSwitcherWidget.isOpen) return;

  if (!force) {
    if (
      document.activeElement &&
      (document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'SELECT' ||
        document.activeElement.tagName === 'BUTTON' ||
        (document.activeElement.tagName === 'TEXTAREA' && document.activeElement !== imeInput))
    ) {
      return;
    }
  } else {
    // If forcing focus back to BBS terminal, blur whatever toolbar element currently holds focus
    if (document.activeElement && document.activeElement !== imeInput && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  }

  if (imeInput) {
    imeInput.focus();
  }
}

// Click on terminal container focuses IME input
terminalContainer.addEventListener('click', () => {
  focusTerminal(true);
});

window.addEventListener('click', (e) => {
  if (settingsModal && !settingsModal.classList.contains('hidden')) return;
  if (articleReader && articleReader.isOpen) return;
  if (searchWidget && searchWidget.isOpen) return;
  if (paletteWidget && paletteWidget.isOpen) return;
  if (exportModal && exportModal.isOpen) return;
  if (boardSwitcherWidget && boardSwitcherWidget.isOpen) return;
  if (pushHelper && pushHelper.isOpen) return;
  if (
    e.target.closest('#settings-modal') ||
    e.target.closest('#push-modal') ||
    e.target.closest('#article-reader-modal') ||
    e.target.closest('#reader-lightbox') ||
    e.target.closest('#search-bar-widget') ||
    e.target.closest('#palette-widget') ||
    e.target.closest('#export-modal') ||
    e.target.closest('#board-switcher-widget') ||
    e.target.closest('#toolbar') ||
    e.target.closest('#tab-bar')
  ) {
    return;
  }
  focusTerminal();
});

function updateImeBubble(text = '') {
  const el = document.getElementById('ime-bubble');
  const txtEl = document.getElementById('ime-bubble-text');
  if (!el || !txtEl) return;

  const str = text || imeInput?.value || '';
  if (!str) {
    hideImeBubble();
    return;
  }

  const activeTab = tabManager.getActiveTab();
  const view = activeTab?.view;
  if (!view || !view.canvas) {
    hideImeBubble();
    return;
  }

  const canvasRect = view.canvas.getBoundingClientRect();
  const curX = canvasRect.left + (activeTab.buf.cur_x * view.cellW);
  const curY = canvasRect.top + (activeTab.buf.cur_y * view.cellH);
  const cellH = view.cellH;

  txtEl.textContent = str;
  el.classList.remove('hidden');
  el.style.display = 'flex';

  let left = curX;
  let top = curY + cellH + 4;

  const bubbleRect = el.getBoundingClientRect();
  if (top + (bubbleRect.height || 26) > window.innerHeight - 8) {
    top = Math.max(8, curY - (bubbleRect.height || 26) - 4);
  }
  if (left + (bubbleRect.width || 80) > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - (bubbleRect.width || 80) - 8);
  }

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function hideImeBubble() {
  const el = document.getElementById('ime-bubble');
  const txtEl = document.getElementById('ime-bubble-text');
  if (el) {
    el.classList.add('hidden');
    el.style.display = 'none';
  }
  if (txtEl) {
    txtEl.textContent = '';
  }
}

let isComposing = false;

// IME Composition Events (注音 / 倉頡 / 拼音 中文輸入法)
if (imeInput) {
  imeInput.addEventListener('compositionstart', (e) => {
    isComposing = true;
    imeInput.dataset.composing = 'true';
    imeInput.classList.add('composing');
    updateImeBubble(e.data || imeInput.value || '');
    const activeTab = tabManager.getActiveTab();
    if (activeTab && activeTab.view) {
      activeTab.view.updateImePosition();
    }
  });

  imeInput.addEventListener('compositionupdate', (e) => {
    isComposing = true;
    imeInput.dataset.composing = 'true';
    imeInput.classList.add('composing');
    updateImeBubble(e.data || imeInput.value || '');
  });

  imeInput.addEventListener('compositionend', () => {
    isComposing = false;
    imeInput.dataset.composing = 'false';
    imeInput.classList.remove('composing');
    hideImeBubble();

    // In standard W3C DOM, text input is dispatched via the `input` event immediately after compositionend.
    // We use queueMicrotask as a fallback to ensure text is dispatched even in environments where input event might not fire.
    queueMicrotask(() => {
      if (!isComposing && imeInput.value) {
        const text = imeInput.value;
        imeInput.value = '';
        sendData(text.replace(/\r\n/g, '\r').replace(/\n/g, '\r'));
      }
    });

    const activeTab = tabManager.getActiveTab();
    if (activeTab && activeTab.view) {
      activeTab.view.updateImePosition();
    }
  });

  imeInput.addEventListener('input', (e) => {
    // During active composition, update floating bubble and do not commit yet
    if (isComposing || (e && e.isComposing)) {
      updateImeBubble(e.data || imeInput.value || '');
      return;
    }

    const text = imeInput.value;
    imeInput.value = '';

    if (text) {
      sendData(text.replace(/\r\n/g, '\r').replace(/\n/g, '\r'));
    }
  });
}

// Global paste handler for terminal
window.addEventListener('paste', (e) => {
  const activeEl = document.activeElement;
  const activeTag = activeEl?.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeEl?.isContentEditable) {
    if (activeEl !== imeInput) {
      return; // Let browser paste natively into the focused input or textarea
    }
  }
  if (
    e.target.closest('#push-modal') ||
    e.target.closest('#settings-modal') ||
    e.target.closest('#search-bar-widget') ||
    e.target.closest('#export-modal') ||
    e.target.closest('#board-switcher-widget') ||
    e.target.closest('#article-reader-modal')
  ) {
    return;
  }
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData)?.getData('text');
  if (text) {
    let clean = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    const activeTab = tabManager.getActiveTab();
    const isPtt = (activeTab?.address || '').toLowerCase().includes('ptt');
    // Only convert standard ESC[ to \x15[ (Ctrl+U) on PTT, which uses \x15 as color leader.
    // On MapleBBS or other telnet sites, \x15 is erase-line, so keep \x1b[ intact.
    if (isPtt) {
      clean = clean.replace(/\x1b\[/g, '\x15[');
      clean = clean.replace(/\*\[([0-9;]*m)/g, '\x15[$1');
    }
    sendData(clean);
  }
});

function parseAddress(input) {
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

async function doConnect(targetBm = null) {
  const activeTab = tabManager.getActiveTab();
  if (!activeTab) return;

  const raw = addressInput.value.trim();
  if (!raw) return;

  activeTab.address = raw;
  activeTab.encoding = encodingSelect ? encodingSelect.value : 'big5';

  const { host, port, userPrefix } = parseAddress(raw);
  const targetAddress = userPrefix ? `${userPrefix}@${host}` : host;
  const charset = activeTab.encoding;

  activeTab.buf.clear(2);
  activeTab.parser.feed(`\x1b[1;33m正在連線到 ${targetAddress}:${port} (${charset.toUpperCase()}) ...\r\n\x1b[0m`);
  tabManager.updateTabStatus(activeTab.id, 'connecting');

  // 1. Resolve matching bookmark for auto-login
  let matchedBm = targetBm;
  if (!matchedBm || !matchedBm.username) {
    // Only search bookmarks that actually have an auto-login username configured
    const credBookmarks = settingsManager.bookmarks.filter((b) => Boolean(b.username));
    // Priority A: Exact raw address match among bookmarks with username
    matchedBm = credBookmarks.find((b) => b.address === raw);
    // Priority B: Exact targetAddress match among bookmarks with username
    if (!matchedBm) {
      matchedBm = credBookmarks.find((b) => b.address === targetAddress);
    }
    // Priority C: Same host & port
    if (!matchedBm && host) {
      matchedBm = credBookmarks.find((b) => {
        const bInfo = parseAddress(b.address);
        return bInfo.host === host && (!port || bInfo.port === port);
      });
    }
    // Priority D: Same host match
    if (!matchedBm && host) {
      matchedBm = credBookmarks.find((b) => {
        const bInfo = parseAddress(b.address);
        return bInfo.host === host;
      });
    }
    // Priority E: Loose match
    if (!matchedBm && host) {
      matchedBm = credBookmarks.find((b) => b.address.includes(host) || host.includes(b.address));
    }
  }

  // 2. Pre-initialize auto-login session BEFORE socket connection
  // CRITICAL: Await credentials so autoLoginManager is ready when initial packet arrives!
  if (matchedBm && matchedBm.username) {
    try {
      const creds = await settingsManager.getDecryptedCredentials(matchedBm);
      if (creds && creds.username) {
        autoLoginManager.startSession(
          activeTab.id,
          creds,
          (data) => sendDataToTab(activeTab.id, data)
        );
      }
    } catch (err) {
      console.warn("Failed to retrieve auto-login credentials:", err);

    }
  }

  try {
    await invoke('connect', { tabId: activeTab.id, address: targetAddress, port, charset });
    tabManager.updateTabStatus(activeTab.id, 'connected');
    focusTerminal(true);

    if (activeTab.buf) {
      const screen = activeTab.buf.getText(0, 0, activeTab.buf.cols - 1, activeTab.buf.rows - 1);
      autoLoginManager.checkScreenBuffer(activeTab.id, screen);
    }
  } catch (err) {
    autoLoginManager.stopSession(activeTab.id);
    activeTab.parser.feed(`\x1b[1;31m連線失敗: ${err}\r\n\x1b[0m`);
    tabManager.updateTabStatus(activeTab.id, 'disconnected');
  }
}

// Support switching encoding on the fly during active session
if (encodingSelect) {
  encodingSelect.addEventListener('change', () => {
    const activeTab = tabManager.getActiveTab();
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

async function doDisconnect() {
  const activeTab = tabManager.getActiveTab();
  if (!activeTab) return;

  try {
    await invoke('disconnect', { tabId: activeTab.id });
  } catch (err) {
    console.error('Disconnect error:', err);
  }
  tabManager.updateTabStatus(activeTab.id, 'disconnected');
}

function updateToolbarConnectionState(state) {
  statusDot.className = 'status-dot';
  if (state === 'connected') {
    statusDot.classList.add('connected');
    statusText.textContent = '已連線';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'inline-block';
    addressInput.disabled = true;
    focusTerminal();
  } else if (state === 'connecting') {
    statusDot.classList.add('connecting');
    statusText.textContent = '連線中...';
    connectBtn.disabled = true;
    disconnectBtn.style.display = 'none';
    addressInput.disabled = true;
  } else {
    statusText.textContent = '未連線';
    connectBtn.style.display = 'inline-block';
    connectBtn.disabled = false;
    disconnectBtn.style.display = 'none';
    addressInput.disabled = false;
  }
}

connectBtn.addEventListener('click', () => {
  connectBtn.blur();
  focusTerminal(true);
  doConnect();
});
disconnectBtn.addEventListener('click', doDisconnect);

addressInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addressInput.blur();
    focusTerminal(true);
    const activeTab = tabManager.getActiveTab();
    if (activeTab?.isConnected) {
      doDisconnect().then(doConnect);
    } else {
      doConnect();
    }
  }
});

// --- Bookmarks & Settings Management ---
function renderBookmarksSelect() {
  if (!bookmarksSelect) return;
  bookmarksSelect.innerHTML = '<option value="" disabled selected>⭐ 常用站台書籤...</option>';
  settingsManager.bookmarks.forEach((bm) => {
    const opt = document.createElement('option');
    opt.value = bm.id;
    opt.textContent = `${bm.name} (${bm.address})`;
    bookmarksSelect.appendChild(opt);
  });
}

if (bookmarksSelect) {
  bookmarksSelect.addEventListener('change', () => {
    const bm = settingsManager.bookmarks.find((b) => b.id === bookmarksSelect.value);
    if (bm) {
      addressInput.value = bm.address;
      if (encodingSelect) encodingSelect.value = bm.encoding || 'big5';
      bookmarksSelect.selectedIndex = 0;
      bookmarksSelect.blur();
      focusTerminal(true);
      const activeTab = tabManager.getActiveTab();
      if (activeTab?.isConnected) {
        doDisconnect().then(() => doConnect(bm));
      } else {
        doConnect(bm);
      }
    }
  });
}

if (addBookmarkBtn) {
  addBookmarkBtn.addEventListener('click', () => {
    const addr = addressInput.value.trim();
    if (!addr) return;
    const name = addr.split(':')[0].replace(/.*@/, '') || '我的 BBS 站台';
    settingsManager.addBookmark({
      name,
      address: addr,
      encoding: encodingSelect.value,
    });
    renderBookmarksSelect();
    renderBookmarkList();
    statusText.textContent = '已存入書籤';
    setTimeout(() => {
      const activeTab = tabManager.getActiveTab();
      if (activeTab?.isConnected) statusText.textContent = '已連線';
      else statusText.textContent = '未連線';
    }, 2000);
  });
}

// Global Floating Toast Helper
let globalToastTimeout = null;
function showGlobalToast(message, duration = 2200) {
  let toast = document.getElementById('waterball-global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'waterball-global-toast';
    toast.className = 'export-toast success';
    toast.style.position = 'fixed';
    toast.style.bottom = '28px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.zIndex = '99999';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.remove('hidden');
  if (globalToastTimeout) clearTimeout(globalToastTimeout);
  globalToastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

function openSettingsModal() {
  loadSettingsToUI();
  renderBookmarkList();
  renderBlacklistUI();
  settingsModal.classList.remove('hidden');

  // Clear the update badge dot when settings are opened
  const badgeDot = settingsBtn?.querySelector('.tb-btn-badge-dot');
  if (badgeDot) {
    badgeDot.remove();
  }
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
  focusTerminal();
}

function loadSettingsToUI() {
  const s = settingsManager.settings;
  if (settingAntiIdle) settingAntiIdle.checked = s.antiIdleEnabled;
  if (settingAntiIdleInterval) settingAntiIdleInterval.value = String(s.antiIdleInterval);
  if (settingNotifyEnabled) settingNotifyEnabled.checked = s.notifyEnabled !== false;
  if (settingNotifySound) settingNotifySound.checked = s.notifySound !== false;
  if (settingSmartDbcs) settingSmartDbcs.checked = s.smartDbcsBackspace;
  if (settingWheelScroll) settingWheelScroll.checked = s.wheelScrollPage;
  if (settingAutoCopy) settingAutoCopy.checked = s.autoCopySelection;
  if (settingTheme) settingTheme.value = s.theme || 'pcman';
  if (settingCursorStyle) settingCursorStyle.value = s.cursorStyle || 'smart';
  if (settingBlinkRate) settingBlinkRate.value = String(s.cursorBlinkRate ?? 500);
  if (settingImagePreview) settingImagePreview.checked = s.imagePreviewEnabled !== false;
  if (settingToolbarScale) settingToolbarScale.value = s.toolbarScale || 'medium';
  if (settingFontFamily) {
    settingFontFamily.value = s.fontFamily || 'auto';
    if (customFontGroup) {
      if (s.fontFamily === 'custom') {
        customFontGroup.classList.remove('hidden');
      } else {
        customFontGroup.classList.add('hidden');
      }
    }
  }
  if (settingCustomFont) settingCustomFont.value = s.customFont || '';

  // Blacklist settings
  if (settingBlacklistEnabled) settingBlacklistEnabled.checked = blacklistManager.settings.enabled !== false;
  if (settingBlacklistGreatTreasure) settingBlacklistGreatTreasure.checked = blacklistManager.settings.enableGreatTreasure !== false;
}

function renderBlacklistUI() {
  if (!blacklistTagsContainer) return;
  blacklistTagsContainer.innerHTML = '';

  const list = blacklistManager.getCustomListArray();
  if (blacklistCount) {
    blacklistCount.textContent = String(list.length);
  }
  if (greatTreasureBadge) {
    greatTreasureBadge.textContent = `已收錄 ${blacklistManager.getGreatTreasureCount()}+ 帳號`;
  }

  if (list.length === 0) {
    const emptyHint = document.createElement('div');
    emptyHint.className = 'blacklist-empty-hint';
    emptyHint.textContent = '目前尚未加入任何自訂黑名單帳號。可在上方輸入 ID 或在畫面中點擊右鍵加入。';
    blacklistTagsContainer.appendChild(emptyHint);
    return;
  }

  list.forEach((userId) => {
    const tag = document.createElement('div');
    tag.className = 'blacklist-tag';
    tag.innerHTML = `
      <span>${userId}</span>
      <span class="blacklist-tag-remove" title="移出黑名單" data-user="${userId}">&times;</span>
    `;
    blacklistTagsContainer.appendChild(tag);
  });

  blacklistTagsContainer.querySelectorAll('.blacklist-tag-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const u = btn.dataset.user;
      if (u) {
        blacklistManager.remove(u);
        renderBlacklistUI();
        tabManager.getActiveTab()?.view?.redraw();
      }
    });
  });
}

function applyToolbarScale(scale = 'medium') {
  document.body.classList.remove('toolbar-scale-standard', 'toolbar-scale-medium', 'toolbar-scale-large');
  document.body.classList.add(`toolbar-scale-${scale}`);
  setTimeout(() => {
    tabManager.tabs.forEach((t) => t.view?.resize());
  }, 60);
}

function saveSettingsFromModal() {
  const isImgPrev = settingImagePreview ? settingImagePreview.checked : true;
  const isNotify = settingNotifyEnabled ? settingNotifyEnabled.checked : true;
  const isSound = settingNotifySound ? settingNotifySound.checked : true;
  const toolbarScale = settingToolbarScale ? settingToolbarScale.value : 'medium';
  const fontFamily = settingFontFamily ? settingFontFamily.value : 'auto';
  const customFont = settingCustomFont ? settingCustomFont.value.trim() : '';
  const cursorStyle = settingCursorStyle ? settingCursorStyle.value : 'smart';
  imagePreview.enabled = isImgPrev;

  if (isNotify) {
    notificationManager.requestPermission();
  }

  applyToolbarScale(toolbarScale);

  // Apply font family and cursor style across all tabs
  tabManager.tabs.forEach((t) => {
    t.view?.setFontStyle(fontFamily, customFont);
    t.view?.setCursorStyle(cursorStyle);
  });

  const antiIdleEnabled = settingAntiIdle.checked;
  const antiIdleInterval = parseInt(settingAntiIdleInterval.value, 10);

  // Sync with native Rust background anti-idle system (24/7 background protected)
  invoke('set_anti_idle', { enabled: antiIdleEnabled, intervalSecs: antiIdleInterval }).catch(() => {});

  // Save Blacklist settings
  const blacklistEnabled = settingBlacklistEnabled ? settingBlacklistEnabled.checked : true;
  const greatTreasureEnabled = settingBlacklistGreatTreasure ? settingBlacklistGreatTreasure.checked : true;
  blacklistManager.saveSettings({
    enabled: blacklistEnabled,
    enableGreatTreasure: greatTreasureEnabled,
  });
  tabManager.getActiveTab()?.view?.redraw();

  settingsManager.saveSettings({
    antiIdleEnabled,
    antiIdleInterval,
    notifyEnabled: isNotify,
    notifySound: isSound,
    smartDbcsBackspace: settingSmartDbcs.checked,
    wheelScrollPage: settingWheelScroll.checked,
    autoCopySelection: settingAutoCopy.checked,
    theme: settingTheme.value,
    cursorStyle,
    cursorBlinkRate: parseInt(settingBlinkRate.value, 10),
    imagePreviewEnabled: isImgPrev,
    toolbarScale,
    fontFamily,
    customFont,
  });
  closeSettingsModal();
}

function renderBookmarkList() {
  if (!bookmarkList) return;
  bookmarkList.innerHTML = '';

  if (settingsManager.bookmarks.length === 0) {
    const emptyBox = document.createElement('div');
    emptyBox.style.padding = '16px';
    emptyBox.style.textAlign = 'center';
    emptyBox.style.color = 'var(--text-secondary)';
    emptyBox.innerHTML = `<div>目前沒有任何書籤，可點擊上方按鈕恢復預設。</div>`;
    bookmarkList.appendChild(emptyBox);
    return;
  }

  settingsManager.bookmarks.forEach((bm) => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';

    const info = document.createElement('div');
    info.className = 'bm-info';
    const autoLoginBadge = (bm.username && bm.password)
      ? `<span style="font-size: 11px; background: rgba(63, 185, 80, 0.18); color: var(--green); border: 1px solid rgba(63, 185, 80, 0.4); padding: 1px 6px; border-radius: 4px; margin-left: 6px;">🔐 自動登入 (${bm.username})</span>`
      : '';
    info.innerHTML = `
      <div class="bm-name">${bm.name} ${autoLoginBadge}</div>
      <div class="bm-address">${bm.address} [${bm.encoding || 'big5'}]</div>
    `;

    const btns = document.createElement('div');
    btns.className = 'bm-btns';

    const connBtn = document.createElement('button');
    connBtn.className = 'btn-primary';
    connBtn.textContent = '連線';
    connBtn.onclick = () => {
      addressInput.value = bm.address;
      encodingSelect.value = bm.encoding || 'big5';
      closeSettingsModal();
      const activeTab = tabManager.getActiveTab();
      if (activeTab?.isConnected) {
        doDisconnect().then(() => doConnect(bm));
      } else {
        doConnect(bm);
      }
    };

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-secondary';
    editBtn.textContent = '✏️ 編輯';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      renderInlineBookmarkEdit(item, bm);
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = '刪除';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      await settingsManager.deleteBookmark(bm.id);
      renderBookmarksSelect();
      renderBookmarkList();
    };

    btns.appendChild(connBtn);
    btns.appendChild(editBtn);
    btns.appendChild(delBtn);
    item.appendChild(info);
    item.appendChild(btns);
    bookmarkList.appendChild(item);
  });
}

async function renderInlineBookmarkEdit(item, bm) {
  let existingPass = '';
  if (bm.password) {
    const creds = await settingsManager.getDecryptedCredentials(bm);
    existingPass = creds?.password || '';
  }

  item.innerHTML = `
    <div class="bm-edit-box">
      <div style="font-size: 12px; font-weight: 600; color: var(--accent);">✏️ 編輯站台資訊與自動登入帳密</div>
      <div class="bm-edit-row">
        <input type="text" id="edit-name-${bm.id}" value="${bm.name}" placeholder="站台名稱" style="flex: 2;" />
        <input type="text" id="edit-addr-${bm.id}" value="${bm.address}" placeholder="位址 (如: bbs@ptt.cc:22)" style="flex: 3;" />
        <select id="edit-enc-${bm.id}" style="width: 85px; flex: none;">
          <option value="big5" ${bm.encoding === 'big5' ? 'selected' : ''}>Big5</option>
          <option value="utf-8" ${bm.encoding === 'utf-8' ? 'selected' : ''}>UTF-8</option>
          <option value="gbk" ${bm.encoding === 'gbk' ? 'selected' : ''}>GBK</option>
        </select>
      </div>
      <div class="bm-edit-row">
        <input type="text" id="edit-user-${bm.id}" value="${bm.username || ''}" placeholder="自動登入帳號 (選填)" />
        <input type="password" id="edit-pass-${bm.id}" value="${existingPass}" placeholder="自動登入密碼 (選填)" />
      </div>
      <div class="bm-edit-actions">
        <button id="edit-cancel-${bm.id}" class="btn-secondary">✕ 取消</button>
        <button id="edit-save-${bm.id}" class="btn-primary">💾 儲存修改</button>
      </div>
    </div>
  `;

  document.getElementById(`edit-save-${bm.id}`)?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newName = document.getElementById(`edit-name-${bm.id}`)?.value?.trim() || bm.name;
    const newAddr = document.getElementById(`edit-addr-${bm.id}`)?.value?.trim() || bm.address;
    const newEnc = document.getElementById(`edit-enc-${bm.id}`)?.value || 'big5';
    const newUser = document.getElementById(`edit-user-${bm.id}`)?.value?.trim() || '';
    const newPass = document.getElementById(`edit-pass-${bm.id}`)?.value?.trim() || '';

    await settingsManager.updateBookmark(bm.id, {
      name: newName,
      address: newAddr,
      encoding: newEnc,
      username: newUser,
      password: newPass,
    });

    renderBookmarksSelect();
    renderBookmarkList();
  });

  document.getElementById(`edit-cancel-${bm.id}`)?.addEventListener('click', (e) => {
    e.stopPropagation();
    renderBookmarkList();
  });
}

// Inline Bookmark Add in Settings Modal
if (bmBtnAdd) {
  bmBtnAdd.addEventListener('click', async () => {
    const name = bmInputName?.value?.trim();
    const addr = bmInputAddr?.value?.trim();
    const enc = bmInputEnc?.value || 'big5';
    const user = bmInputUser?.value?.trim() || '';
    const pass = bmInputPass?.value?.trim() || '';

    if (!name || !addr) {
      if (bmInputName && !name) bmInputName.focus();
      else if (bmInputAddr) bmInputAddr.focus();
      return;
    }

    await settingsManager.addBookmark({
      name,
      address: addr,
      encoding: enc,
      username: user,
      password: pass,
    });

    if (bmInputName) bmInputName.value = '';
    if (bmInputAddr) bmInputAddr.value = '';
    if (bmInputUser) bmInputUser.value = '';
    if (bmInputPass) bmInputPass.value = '';
    renderBookmarksSelect();
    renderBookmarkList();
  });
}

// Reset Default Bookmarks button
if (btnResetDefaultBookmarks) {
  btnResetDefaultBookmarks.addEventListener('click', () => {
    settingsManager.resetDefaultBookmarks();
    renderBookmarksSelect();
    renderBookmarkList();
  });
}

// Modal tab switching
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});

if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeSettingsModal);
if (modalSaveBtn) modalSaveBtn.addEventListener('click', saveSettingsFromModal);

// Update Checker Handler
const btnCheckUpdate = document.getElementById('btn-check-update');
const updateStatusMsg = document.getElementById('update-status-msg');

if (btnCheckUpdate) {
  btnCheckUpdate.addEventListener('click', async () => {
    btnCheckUpdate.disabled = true;
    btnCheckUpdate.textContent = '🔄 檢查中...';
    if (updateStatusMsg) {
      updateStatusMsg.className = 'update-status-msg';
      updateStatusMsg.textContent = '正在連線至 GitHub 查詢最新版本...';
      updateStatusMsg.classList.remove('hidden');
    }

    try {
      const res = await updateChecker.checkUpdate();
      if (res.hasUpdate) {
        updateStatusMsg.className = 'update-status-msg has-new';
        updateStatusMsg.innerHTML = `🎉 發現新版本 <strong>${res.latestVersion}</strong>！<br><a href="${res.releaseUrl}" target="_blank" style="color:inherit;text-decoration:underline;margin-top:4px;display:inline-block;">👉 前往 GitHub 下載安裝包 (${res.publishedAt})</a>`;
      } else {
        updateStatusMsg.className = 'update-status-msg';
        updateStatusMsg.innerHTML = `✅ 目前使用的 <strong>${res.currentVersion}</strong> 已是最新版本！`;
      }
    } catch (err) {
      updateStatusMsg.className = 'update-status-msg error';
      updateStatusMsg.textContent = `❌ 檢查失敗: ${err.message || '無法連線至 GitHub'}`;
    } finally {
      btnCheckUpdate.disabled = false;
      btnCheckUpdate.textContent = '🔍 檢查新版本';
    }
  });
}

if (boardBtn) {
  boardBtn.addEventListener('click', () => {
    boardSwitcherWidget.open();
  });
}

if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      exportModal.open(activeTab);
    }
  });
}

if (paletteBtn) {
  paletteBtn.addEventListener('click', () => {
    paletteWidget.toggle();
  });
}

if (articleReaderBtn) {
  articleReaderBtn.addEventListener('click', () => {
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      articleReader.open(activeTab);
    }
  });
}

if (pushHelperBtn) {
  pushHelperBtn.addEventListener('click', () => {
    pushHelper.open();
  });
}

// Blacklist Management Buttons
if (btnBlacklistAdd && inputBlacklistAdd) {
  const doAdd = () => {
    const val = inputBlacklistAdd.value.trim();
    if (val) {
      if (blacklistManager.add(val)) {
        showToast(`已將 ${val} 加入黑名單`);
        renderBlacklistUI();
        tabManager.getActiveTab()?.view?.redraw();
      } else {
        showToast(`${val} 已在黑名單中`);
      }
      inputBlacklistAdd.value = '';
    }
  };
  btnBlacklistAdd.addEventListener('click', doAdd);
  inputBlacklistAdd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doAdd();
    }
  });
}

if (btnBlacklistClear) {
  btnBlacklistClear.addEventListener('click', () => {
    if (confirm('確定要清空所有自訂黑名單帳號嗎？')) {
      blacklistManager.customList.clear();
      blacklistManager.saveCustomList();
      renderBlacklistUI();
      tabManager.getActiveTab()?.view?.redraw();
      showToast('已清空自訂黑名單');
    }
  });
}

if (btnBlacklistExportTxt) {
  btnBlacklistExportTxt.addEventListener('click', () => {
    const txt = blacklistManager.exportAsText();
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waterball_blacklist_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已匯出黑名單 (TXT)');
  });
}

if (btnBlacklistExportJson) {
  btnBlacklistExportJson.addEventListener('click', () => {
    const json = blacklistManager.exportAsJSON();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waterball_blacklist_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已匯出黑名單 (JSON)');
  });
}

if (btnBlacklistImport && fileBlacklistImport) {
  btnBlacklistImport.addEventListener('click', () => {
    fileBlacklistImport.click();
  });
  fileBlacklistImport.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result;
      if (typeof content === 'string') {
        let added = 0;
        try {
          if (file.name.endsWith('.json')) {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed.blacklist)) {
              for (const id of parsed.blacklist) {
                if (blacklistManager.add(id)) added++;
              }
            }
          } else {
            added = blacklistManager.importFromText(content);
          }
          showToast(`成功匯入 ${added} 個黑名單帳號`);
          renderBlacklistUI();
          tabManager.getActiveTab()?.view?.redraw();
        } catch (err) {
          showToast('匯入失敗，請確認檔案格式是否正確');
        }
      }
      fileBlacklistImport.value = '';
    };
    reader.readAsText(file);
  });
}

// Global Terminal Context Menu Controller
let activeContextMenuTarget = '';
let activeContextTab = null;

function hideContextMenu() {
  if (contextMenuEl && !contextMenuEl.classList.contains('hidden')) {
    contextMenuEl.classList.add('hidden');
    activeContextMenuTarget = '';
    activeContextTab = null;
  }
}

tabManager.onContextMenu = (info, tab) => {
  if (!contextMenuEl) return;
  activeContextTab = tab;
  const targetText = info.selectedText || info.word || '';
  activeContextMenuTarget = targetText;

  if (ctxBlacklistToggle) {
    if (targetText) {
      const isBl = blacklistManager.isBlacklisted(targetText);
      ctxBlacklistToggle.textContent = isBl ? `🚫 從黑名單移除 (${targetText})` : `🚫 加入黑名單 (${targetText})`;
      ctxBlacklistToggle.style.display = 'flex';
    } else {
      ctxBlacklistToggle.style.display = 'none';
    }
  }

  // Positioning with edge collision prevention
  contextMenuEl.classList.remove('hidden');
  const menuW = 200;
  const menuH = 180;
  let posX = info.clientX;
  let posY = info.clientY;

  if (posX + menuW > window.innerWidth) {
    posX = window.innerWidth - menuW - 10;
  }
  if (posY + menuH > window.innerHeight) {
    posY = window.innerHeight - menuH - 10;
  }

  contextMenuEl.style.left = `${Math.max(10, posX)}px`;
  contextMenuEl.style.top = `${Math.max(10, posY)}px`;
};

// Context Menu Item Click Handlers
ctxCopy?.addEventListener('click', () => {
  if (activeContextMenuTarget) {
    writeClipboardText(activeContextMenuTarget).catch(() => {});
    showToast('已複製文字至剪貼簿');
  } else if (activeContextTab?.view) {
    const sel = activeContextTab.view.getSelectionText();
    if (sel) {
      writeClipboardText(sel).catch(() => {});
      showToast('已複製文字至剪貼簿');
    }
  }
  hideContextMenu();
});

ctxCopyAnsi?.addEventListener('click', () => {
  if (activeContextTab?.view) {
    const ansi = activeContextTab.view.getSelectionAnsi();
    if (ansi) {
      writeClipboardText(ansi).catch(() => {});
      showToast('已複製含色彩 ANSI 代碼');
    }
  }
  hideContextMenu();
});

ctxSearchGoogle?.addEventListener('click', () => {
  if (activeContextMenuTarget) {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(activeContextMenuTarget)}`, '_blank');
  }
  hideContextMenu();
});

ctxBlacklistToggle?.addEventListener('click', () => {
  if (activeContextMenuTarget) {
    const isNowAdded = blacklistManager.toggle(activeContextMenuTarget);
    showToast(isNowAdded ? `已將 ${activeContextMenuTarget} 加入黑名單` : `已將 ${activeContextMenuTarget} 從黑名單移除`);
    renderBlacklistUI();
    tabManager.getActiveTab()?.view?.redraw();
  }
  hideContextMenu();
});

ctxQuickPush?.addEventListener('click', () => {
  hideContextMenu();
  pushHelper.open();
});

// Dismiss context menu on click outside, blur or escape
window.addEventListener('click', (e) => {
  if (contextMenuEl && !contextMenuEl.contains(e.target)) {
    hideContextMenu();
  }
});
window.addEventListener('resize', () => {
  hideContextMenu();
  hideImeBubble();
});
window.addEventListener('blur', () => {
  hideContextMenu();
  hideImeBubble();
});

if (settingsModal) {
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettingsModal();
    }
  });
}

// Initial Bookmarks, UI scale & Rust background anti-idle system
renderBookmarksSelect();
applyToolbarScale(settingsManager.settings.toolbarScale || 'medium');
invoke('set_anti_idle', {
  enabled: settingsManager.settings.antiIdleEnabled !== false,
  intervalSecs: settingsManager.settings.antiIdleInterval || 45,
}).catch(() => {});

// Comprehensive Keyboard Mapping for BBS & Multi-Tab Shortcuts
window.addEventListener('keydown', (e) => {
  // Ignore bare modifier keys to not interfere with OS level HUDs (e.g., Cmd+Space input method HUD)
  if (['Meta', 'Control', 'Alt', 'Shift', 'OS'].includes(e.key)) {
    return;
  }
  // Immediately let OS handle Cmd+Space / Ctrl+Space without any interference or focus shifts
  if ((e.metaKey || e.ctrlKey) && e.code === 'Space') {
    return;
  }

  imagePreview.hideImmediate();
  settingsManager.recordActivity();

  // If in Board Switcher Modal
  if (boardSwitcherWidget && boardSwitcherWidget.isOpen) {
    if (e.key === 'Escape') {
      boardSwitcherWidget.close();
      return;
    }
  }

  // If in Export Modal
  if (exportModal && exportModal.isOpen) {
    if (e.key === 'Escape') {
      exportModal.close();
      return;
    }
  }

  // If in Palette Widget
  if (paletteWidget && paletteWidget.isOpen) {
    if (e.key === 'Escape') {
      paletteWidget.close();
      return;
    }
  }

  // If in Search Widget
  if (searchWidget && searchWidget.isOpen) {
    if (e.key === 'Escape') {
      searchWidget.close();
    }
    return;
  }

  // If in Article Reader Modal
  if (articleReader && articleReader.isOpen) {
    if (e.key === 'Escape') {
      articleReader.close();
    }
    return;
  }

  // If in Settings Modal
  if (settingsModal && !settingsModal.classList.contains('hidden')) {
    if (e.key === 'Escape') {
      closeSettingsModal();
    }
    return;
  }

  // If in Push Helper Modal
  if (pushHelper && pushHelper.isOpen) {
    if (e.key === 'Escape') {
      if (pushHelper.isPushing) {
        pushHelper.abort();
      } else {
        pushHelper.close();
      }
    }
    return;
  }

  if (isInteractiveInputElement(document.activeElement, imeInput)) {
    return;
  }

  // Smart Multi-Push Assistant (Cmd+Shift+X / Ctrl+Shift+X / Alt+X)
  if (((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === 'KeyX' || e.key === 'X')) || (e.altKey && (e.code === 'KeyX' || e.key === 'x'))) {
    e.preventDefault();
    pushHelper.open();
    return;
  }

  // Quick Board Switcher (Cmd+K on macOS / Ctrl+Shift+K on Windows & Linux)
  if (((isMac && e.metaKey) || (!isMac && e.ctrlKey && e.shiftKey)) && e.code === 'KeyK' && !e.altKey) {
    e.preventDefault();
    boardSwitcherWidget.open();
    return;
  }

  // HD Screenshot & Export Modal (Cmd+Shift+S on macOS / Ctrl+Shift+S on Windows & Linux)
  if (((isMac && e.metaKey) || (!isMac && e.ctrlKey)) && e.shiftKey && e.code === 'KeyS' && !e.altKey) {
    e.preventDefault();
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      exportModal.open(activeTab);
    }
    return;
  }

  // Toggle ANSI Palette & Symbols (Cmd+P on macOS / Ctrl+Shift+P on Windows & Linux)
  if (((isMac && e.metaKey && !e.shiftKey) || (!isMac && e.ctrlKey && e.shiftKey)) && e.code === 'KeyP' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    paletteWidget.toggle();
    return;
  }

  // Find in Terminal (Cmd+F on macOS / Ctrl+Shift+F on Windows & Linux)
  if (((isMac && e.metaKey && !e.shiftKey) || (!isMac && e.ctrlKey && e.shiftKey)) && e.code === 'KeyF' && !e.altKey) {
    e.preventDefault();
    searchWidget.open();
    return;
  }

  // Find Next/Prev (Cmd+G / Cmd+Shift+G)
  if (((isMac && e.metaKey) || (!isMac && e.ctrlKey)) && e.code === 'KeyG' && !e.altKey) {
    e.preventDefault();
    if (e.shiftKey) {
      searchWidget.prevMatch();
    } else {
      searchWidget.nextMatch();
    }
    return;
  }

  // Open Article Reader Mode (Cmd+D / Cmd+R on macOS)
  if (isMac && e.metaKey && (e.code === 'KeyD' || e.code === 'KeyR') && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      articleReader.open(activeTab);
    }
    return;
  }

  // New Tab: Cmd+T (macOS) / Ctrl+Shift+T (Windows & Linux)
  if (((isMac && e.metaKey) || (!isMac && e.ctrlKey && e.shiftKey)) && e.code === 'KeyT' && !e.altKey) {
    e.preventDefault();
    const newTab = tabManager.createTab({
      title: `連線 ${tabManager.tabs.length + 1}`,
      address: 'bbs@ptt.cc:22',
      encoding: 'big5',
    });
    tabManager.switchTab(newTab.id);
    return;
  }

  // Close Current Tab: Cmd+W (macOS) / Ctrl+Shift+W (Windows & Linux)
  if (((isMac && e.metaKey) || (!isMac && e.ctrlKey && e.shiftKey)) && e.code === 'KeyW' && !e.altKey) {
    e.preventDefault();
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      tabManager.closeTab(activeTab.id);
    }
    return;
  }

  // Ctrl+Tab / Ctrl+Shift+Tab: Cycle through tabs
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      tabManager.switchToPrevTab();
    } else {
      tabManager.switchToNextTab();
    }
    return;
  }

  // Switch directly to tab 1 ~ 9 (Cmd+1~9 on macOS / Alt+1~9 on Windows & Linux)
  if (((isMac && e.metaKey) || (!isMac && e.altKey)) && !e.shiftKey && e.code.startsWith('Digit')) {
    const digit = parseInt(e.code.charAt(5), 10);
    if (digit >= 1 && digit <= 9) {
      e.preventDefault();
      tabManager.switchToTabIndex(digit - 1);
      return;
    }
  }

  const activeTab = tabManager.getActiveTab();
  if (!activeTab || !activeTab.isConnected) return;

  // Make sure terminal textarea has focus
  focusTerminal();

  // If user is actively in IME composition or candidate selection popup
  if (isComposing || e.isComposing || e.key === 'Process' || e.keyCode === 229) {
    return;
  }

  const view = activeTab.view;
  const buf = activeTab.buf;

  // 1. Copy Shortcut: Cmd+C (macOS) or Ctrl+C (Windows/Linux) when text selection exists
  if ((isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey) && e.code === 'KeyC' && view && view.selection) {
    e.preventDefault();
    const isAnsi = !!e.shiftKey;
    const text = isAnsi ? view.getSelectionAnsi() : view.getSelectionText();
    if (text) {
      writeClipboardText(text).then(() => {
        showGlobalToast(isAnsi ? '🎨 已複製含色彩 ANSI 代碼至剪貼簿！' : '📋 已複製純文字至剪貼簿！');
      }).catch((err) => {
        console.error('Clipboard copy error:', err);
      });
    }
    return;
  }

  // 2. Translate BBS Key (Control characters, navigation, editing keys, DBCS)
  const { seq, handled, isPaste } = translateBbsKey(e, {
    smartDbcsBackspace: settingsManager.settings.smartDbcsBackspace,
    isPrevCharDBCS: buf ? buf.isPrevCharDBCS() : false,
    isCurCharDBCSLead: buf ? buf.isCurCharDBCSLead() : false,
  });

  if (isPaste) {
    return; // Let browser paste event handle
  }

  if (handled && seq) {
    e.preventDefault();
    imeInput.value = '';
    sendData(seq);
  } else if (handled) {
    e.preventDefault();
  }
});

// Auto-Login status change
autoLoginManager.onStatusChange = (tabId, msg) => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab && activeTab.id === tabId) {
    statusText.textContent = msg;
    setTimeout(() => {
      if (activeTab.isConnected) statusText.textContent = '已連線';
      else statusText.textContent = '未連線';
    }, 2500);
  }
};

autoLoginManager.onLoginError = (tabId, errorMsg) => {
  showToast(`⚠️ ${errorMsg}`, 6000);
};

let notificationScrapeTimer = null;
function scheduleNotificationScrape(tabId) {
  clearTimeout(notificationScrapeTimer);
  notificationScrapeTimer = setTimeout(() => {
    const tab = tabManager.getTabById(tabId);
    if (tab && tab.buf) {
      // Waterball messages and mail alerts in BBS protocol exclusively appear at the bottom 1-2 status lines
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
      notificationManager.feedScreenLines(tabId, lines, tab.title);
    }
  }, 300);
}

// Listen for backend data per tab
listen('terminal-data', (event) => {
  try {
    const { tab_id, data } = event.payload;
    if (tab_id && data) {
      tabManager.feedData(tab_id, data);
      autoLoginManager.feedData(tab_id, data);
      scheduleNotificationScrape(tab_id);
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
      tabManager.updateTabStatus(tab_id, status);
      if (status === 'disconnected') {
        autoLoginManager.stopSession(tab_id);
      }
    }
  } catch (err) {
    console.error('Status event error:', err);
  }
});

// Background Update Check on Startup (silently check after 2 seconds)
setTimeout(async () => {
  try {
    const res = await updateChecker.checkUpdate();
    if (res.hasUpdate) {
      // 1. Show red badge on settings-btn in toolbar
      if (settingsBtn && !settingsBtn.querySelector('.tb-btn-badge-dot')) {
        const badge = document.createElement('span');
        badge.className = 'tb-btn-badge-dot';
        settingsBtn.appendChild(badge);
      }
      // 2. Pre-fill update status message in Settings screen
      if (updateStatusMsg) {
        updateStatusMsg.className = 'update-status-msg has-new';
        updateStatusMsg.innerHTML = `🎉 發現新版本 <strong>${res.latestVersion}</strong>！<br><a href="${res.releaseUrl}" target="_blank" style="color:inherit;text-decoration:underline;margin-top:4px;display:inline-block;">👉 前往 GitHub 下載安裝包 (${res.publishedAt})</a>`;
        updateStatusMsg.classList.remove('hidden');
      }
    }
  } catch (err) {
    console.warn('[Updater] Background check failed:', err);
  }
}, 2000);
