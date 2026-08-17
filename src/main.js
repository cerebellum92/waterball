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
const addBookmarkBtn = document.getElementById('add-bookmark-btn');
const settingsBtn = document.getElementById('settings-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const terminalContainer = document.getElementById('terminal-container');
const imeInput = document.getElementById('ime-input');

// Palette, Search & Board Switcher Widgets Setup
const searchWidget = new SearchWidget(() => tabManager.getActiveTab());
const paletteWidget = new PaletteWidget((data) => sendData(data), () => tabManager.getActiveTab());
const boardSwitcherWidget = new BoardSwitcherWidget((data) => sendData(data));
const settingsModal = document.getElementById('settings-modal');
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
const settingCmdCtrl = document.getElementById('setting-cmd-ctrl');
const settingSmartDbcs = document.getElementById('setting-smart-dbcs');
const settingWheelScroll = document.getElementById('setting-wheel-scroll');
const settingAutoCopy = document.getElementById('setting-auto-copy');
const settingTheme = document.getElementById('setting-theme');
const settingBlinkRate = document.getElementById('setting-blink-rate');
const settingImagePreview = document.getElementById('setting-image-preview');
const settingToolbarScale = document.getElementById('setting-toolbar-scale');

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
      navigator.clipboard.writeText(text).catch(() => {});
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

let isComposing = false;

function sendData(data) {
  const activeTab = tabManager.getActiveTab();
  if (!activeTab || !activeTab.isConnected || !data) return;
  invoke('send_input', { tabId: activeTab.id, data }).catch((err) => {
    console.error('Send error:', err);
  });
}

function focusTerminal() {
  if (settingsModal && !settingsModal.classList.contains('hidden')) return;
  if (articleReader && articleReader.isOpen) return;
  if (searchWidget && searchWidget.isOpen) return;
  if (
    document.activeElement &&
    (document.activeElement.tagName === 'INPUT' ||
      document.activeElement.tagName === 'SELECT' ||
      document.activeElement.tagName === 'BUTTON' ||
      (document.activeElement.tagName === 'TEXTAREA' && document.activeElement !== imeInput))
  ) {
    return;
  }
  if (imeInput && document.activeElement !== imeInput) {
    imeInput.focus();
  }
}

// Click on terminal container focuses IME input
terminalContainer.addEventListener('click', () => {
  focusTerminal();
});

window.addEventListener('click', (e) => {
  if (settingsModal && !settingsModal.classList.contains('hidden')) return;
  if (articleReader && articleReader.isOpen) return;
  if (searchWidget && searchWidget.isOpen) return;
  if (paletteWidget && paletteWidget.isOpen) return;
  if (exportModal && exportModal.isOpen) return;
  if (boardSwitcherWidget && boardSwitcherWidget.isOpen) return;
  if (
    e.target.closest('#settings-modal') ||
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

// IME Composition Events (注音 / 倉頡 / 拼音 中文輸入法)
if (imeInput) {
  imeInput.addEventListener('compositionstart', () => {
    isComposing = true;
    imeInput.classList.add('composing');
  });

  imeInput.addEventListener('compositionupdate', () => {
    isComposing = true;
    imeInput.classList.add('composing');
  });

  imeInput.addEventListener('compositionend', (e) => {
    isComposing = false;
    imeInput.classList.remove('composing');
    const text = e.data || imeInput.value;
    imeInput.value = '';
    if (text) {
      sendData(text.replace(/\r\n/g, '\r').replace(/\n/g, '\r'));
    }
  });

  imeInput.addEventListener('input', () => {
    if (isComposing) return;
    const text = imeInput.value;
    imeInput.value = '';
    if (text) {
      sendData(text.replace(/\r\n/g, '\r').replace(/\n/g, '\r'));
    }
  });

  imeInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData)?.getData('text');
    if (text) {
      let clean = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
      clean = clean.replace(/\x1b\[/g, '\x15[');
      clean = clean.replace(/\*\[([0-9;]*m)/g, '\x15[$1');
      sendData(clean);
    }
  });
}

// Global paste handler for terminal
window.addEventListener('paste', (e) => {
  if (document.activeElement === addressInput || document.activeElement === bmInputName || document.activeElement === bmInputAddr) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData)?.getData('text');
  if (text) {
    let clean = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    clean = clean.replace(/\x1b\[/g, '\x15[');
    clean = clean.replace(/\*\[([0-9;]*m)/g, '\x15[$1');
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

async function doConnect() {
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

  try {
    await invoke('connect', { tabId: activeTab.id, address: targetAddress, port, charset });
    // Check auto-login credentials
    const matchedBm = settingsManager.bookmarks.find(
      (b) => b.address === targetAddress || b.address === raw || targetAddress.includes(b.address)
    );
    if (matchedBm && matchedBm.username && matchedBm.password) {
      autoLoginManager.startSession(
        activeTab.id,
        { username: matchedBm.username, password: matchedBm.password },
        sendData
      );
    }
  } catch (err) {
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
    settingsManager.startKeepAlive(sendData, () => {
      const tab = tabManager.getActiveTab();
      return tab ? tab.isConnected : false;
    });
    focusTerminal();
  } else if (state === 'connecting') {
    statusDot.classList.add('connecting');
    statusText.textContent = '連線中...';
    connectBtn.disabled = true;
    disconnectBtn.style.display = 'none';
    addressInput.disabled = true;
  } else {
    settingsManager.stopKeepAlive();
    statusText.textContent = '未連線';
    connectBtn.style.display = 'inline-block';
    connectBtn.disabled = false;
    disconnectBtn.style.display = 'none';
    addressInput.disabled = false;
  }
}

connectBtn.addEventListener('click', doConnect);
disconnectBtn.addEventListener('click', doDisconnect);

addressInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
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
      const activeTab = tabManager.getActiveTab();
      if (activeTab?.isConnected) {
        doDisconnect().then(doConnect);
      } else {
        doConnect();
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

// Settings Modal
function openSettingsModal() {
  loadSettingsToUI();
  renderBookmarkList();
  settingsModal.classList.remove('hidden');
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
  if (settingCmdCtrl) settingCmdCtrl.checked = s.mapCommandToCtrl;
  if (settingSmartDbcs) settingSmartDbcs.checked = s.smartDbcsBackspace;
  if (settingWheelScroll) settingWheelScroll.checked = s.wheelScrollPage;
  if (settingAutoCopy) settingAutoCopy.checked = s.autoCopySelection;
  if (settingTheme) settingTheme.value = s.theme || 'pcman';
  if (settingBlinkRate) settingBlinkRate.value = String(s.cursorBlinkRate ?? 500);
  if (settingImagePreview) settingImagePreview.checked = s.imagePreviewEnabled !== false;
  if (settingToolbarScale) settingToolbarScale.value = s.toolbarScale || 'medium';
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
  imagePreview.enabled = isImgPrev;

  if (isNotify) {
    notificationManager.requestPermission();
  }

  applyToolbarScale(toolbarScale);

  settingsManager.saveSettings({
    antiIdleEnabled: settingAntiIdle.checked,
    antiIdleInterval: parseInt(settingAntiIdleInterval.value, 10),
    notifyEnabled: isNotify,
    notifySound: isSound,
    mapCommandToCtrl: settingCmdCtrl.checked,
    smartDbcsBackspace: settingSmartDbcs.checked,
    wheelScrollPage: settingWheelScroll.checked,
    autoCopySelection: settingAutoCopy.checked,
    theme: settingTheme.value,
    cursorBlinkRate: parseInt(settingBlinkRate.value, 10),
    imagePreviewEnabled: isImgPrev,
    toolbarScale,
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
        doDisconnect().then(doConnect);
      } else {
        doConnect();
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
    delBtn.onclick = (e) => {
      e.stopPropagation();
      settingsManager.deleteBookmark(bm.id);
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

function renderInlineBookmarkEdit(item, bm) {
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
        <input type="password" id="edit-pass-${bm.id}" value="${bm.password || ''}" placeholder="自動登入密碼 (選填)" />
      </div>
      <div class="bm-edit-actions">
        <button id="edit-cancel-${bm.id}" class="btn-secondary">✕ 取消</button>
        <button id="edit-save-${bm.id}" class="btn-primary">💾 儲存修改</button>
      </div>
    </div>
  `;

  document.getElementById(`edit-save-${bm.id}`)?.addEventListener('click', (e) => {
    e.stopPropagation();
    const newName = document.getElementById(`edit-name-${bm.id}`)?.value?.trim() || bm.name;
    const newAddr = document.getElementById(`edit-addr-${bm.id}`)?.value?.trim() || bm.address;
    const newEnc = document.getElementById(`edit-enc-${bm.id}`)?.value || 'big5';
    const newUser = document.getElementById(`edit-user-${bm.id}`)?.value?.trim() || '';
    const newPass = document.getElementById(`edit-pass-${bm.id}`)?.value?.trim() || '';

    settingsManager.updateBookmark(bm.id, {
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
  bmBtnAdd.addEventListener('click', () => {
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

    settingsManager.addBookmark({
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

if (settingsModal) {
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettingsModal();
    }
  });
}

// Initial Bookmarks & UI scale population
renderBookmarksSelect();
applyToolbarScale(settingsManager.settings.toolbarScale || 'medium');

// Comprehensive Keyboard Mapping for BBS & Multi-Tab Shortcuts
window.addEventListener('keydown', (e) => {
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

  // Quick Board Switcher (Cmd+K)
  if (e.metaKey && e.code === 'KeyK' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    boardSwitcherWidget.open();
    return;
  }

  // HD Screenshot & Export Modal (Cmd+Shift+S)
  if (e.metaKey && e.shiftKey && e.code === 'KeyS' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      exportModal.open(activeTab);
    }
    return;
  }

  // Toggle ANSI Palette & Symbols (Cmd+P)
  if (e.metaKey && e.code === 'KeyP' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    paletteWidget.toggle();
    return;
  }

  // Find in Terminal (Cmd+F / Ctrl+F)
  if (e.metaKey && e.code === 'KeyF' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    searchWidget.open();
    return;
  }

  // Find Next/Prev (Cmd+G / Cmd+Shift+G)
  if (e.metaKey && e.code === 'KeyG' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    if (e.shiftKey) {
      searchWidget.prevMatch();
    } else {
      searchWidget.nextMatch();
    }
    return;
  }

  // Open Article Reader Mode (Cmd+D / Cmd+R)
  if (e.metaKey && (e.code === 'KeyD' || e.code === 'KeyR') && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      articleReader.open(activeTab);
    }
    return;
  }

  // Multi-Tab Global Shortcuts:
  // Cmd+T: New Tab
  if (e.metaKey && e.code === 'KeyT' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    const newTab = tabManager.createTab({
      title: `連線 ${tabManager.tabs.length + 1}`,
      address: 'nckugibbs.duckdns.org',
      encoding: 'big5',
    });
    tabManager.switchTab(newTab.id);
    return;
  }

  // Cmd+W: Close Current Tab
  if (e.metaKey && e.code === 'KeyW' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
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

  // Cmd+1 ~ Cmd+9: Direct switch to tab N
  if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.code.startsWith('Digit')) {
    const digit = parseInt(e.code.charAt(5), 10);
    if (digit >= 1 && digit <= 9) {
      e.preventDefault();
      tabManager.switchToTabIndex(digit - 1);
      return;
    }
  }

  const activeTab = tabManager.getActiveTab();
  if (!activeTab || !activeTab.isConnected) return;
  if (document.activeElement === addressInput) return;

  // Make sure terminal textarea has focus
  focusTerminal();

  // If user is actively in IME composition or candidate selection popup
  if (isComposing || e.isComposing || e.key === 'Process' || e.keyCode === 229) {
    return;
  }

  let seq = '';
  const isCtrl = settingsManager.settings.mapCommandToCtrl ? (e.ctrlKey || e.metaKey) : e.ctrlKey;
  const view = activeTab.view;
  const buf = activeTab.buf;

  // 1. Copy Shortcut: Cmd+C (Plain text) / Cmd+Shift+C (With ANSI Colors)
  if (isCtrl && e.code === 'KeyC' && view && view.selection) {
    e.preventDefault();
    const isAnsi = !!e.shiftKey;
    const text = isAnsi ? view.getSelectionAnsi() : view.getSelectionText();
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        showGlobalToast(isAnsi ? '🎨 已複製含色彩 ANSI 代碼至剪貼簿！' : '📋 已複製純文字至剪貼簿！');
      }).catch((err) => {
        console.error('Clipboard copy error:', err);
      });
    }
    return;
  }

  // 2. Control / Command key combinations (Ctrl+A ~ Ctrl+Z, Ctrl+X, Ctrl+Y, Ctrl+U, etc.)
  if (isCtrl && !e.altKey) {
    if (e.code.startsWith('Key')) {
      const letter = e.code.charAt(3).toUpperCase();
      const code = letter.charCodeAt(0) - 64; // 'A' (65) -> 1, 'X' (88) -> 24
      if (code >= 1 && code <= 26) {
        // Handle Ctrl+V (let browser paste event handle paste if Cmd+V, else send \x16)
        if (letter === 'V' && e.metaKey) {
          return; // Let paste handler execute
        }
        seq = String.fromCharCode(code);
      }
    } else if (e.code === 'BracketLeft') {
      seq = '\x1b'; // Ctrl+[ (ESC)
    } else if (e.code === 'BracketRight') {
      seq = '\x1d'; // Ctrl+]
    } else if (e.code === 'Backslash') {
      seq = '\x1c'; // Ctrl+\
    } else if (e.code === 'Slash' || e.code === 'Minus') {
      seq = '\x1f'; // Ctrl+/ or Ctrl+_
    } else if (e.code === 'Space' || e.code === 'Digit2') {
      seq = '\x00'; // Ctrl+Space or Ctrl+@
    } else if (e.key === 'ArrowLeft') {
      seq = e.metaKey ? '\x1b[1~' : '\x1b[1;5D'; // Cmd+Left -> Home, Ctrl+Left -> Word Left
    } else if (e.key === 'ArrowRight') {
      seq = e.metaKey ? '\x1b[4~' : '\x1b[1;5C'; // Cmd+Right -> End, Ctrl+Right -> Word Right
    } else if (e.key === 'ArrowUp') {
      seq = e.metaKey ? '\x1b[1~' : '\x1b[1;5A'; // Cmd+Up -> Home
    } else if (e.key === 'ArrowDown') {
      seq = e.metaKey ? '\x1b[4~' : '\x1b[1;5B'; // Cmd+Down -> End
    } else if (e.key === 'Letter' || (e.key.length === 1 && e.key.toLowerCase() >= 'a' && e.key.toLowerCase() <= 'z')) {
      const code = e.key.toLowerCase().charCodeAt(0) - 96;
      seq = String.fromCharCode(code);
    }
  } else if (e.altKey && !isCtrl) {
    // 3. Alt / Option Key Combinations (ESC prefix)
    if (e.key.length === 1) {
      seq = '\x1b' + e.key;
    }
  } else if (!isCtrl && !e.altKey) {
    // 4. Shift Key Modifiers for Navigation
    if (e.shiftKey) {
      switch (e.key) {
        case 'Tab': seq = '\x1b[Z'; break; // Shift+Tab
        case 'ArrowUp': seq = '\x1b[5~'; break; // Shift+Up -> PageUp
        case 'ArrowDown': seq = '\x1b[6~'; break; // Shift+Down -> PageDown
        case 'ArrowLeft': seq = '\x1b[1~'; break; // Shift+Left -> Home
        case 'ArrowRight': seq = '\x1b[4~'; break; // Shift+Right -> End
      }
    }

    // 5. Navigation, BBS Function, and Editing keys
    if (!seq) {
      switch (e.key) {
        case 'ArrowUp': seq = '\x1b[A'; break;
        case 'ArrowDown': seq = '\x1b[B'; break;
        case 'ArrowRight': seq = '\x1b[C'; break;
        case 'ArrowLeft': seq = '\x1b[D'; break;
        case 'Enter': seq = '\r'; break;
        case 'Backspace':
          // Smart DBCS Backspace: if left cell is DBCS trail byte, send 2 Backspaces (\x08\x08)
          seq = (settingsManager.settings.smartDbcsBackspace && buf && buf.isPrevCharDBCS()) ? '\x08\x08' : '\x08';
          break;
        case 'Escape': seq = '\x1b'; break;
        case 'Tab': seq = '\t'; break;
        case 'PageUp': seq = '\x1b[5~'; break;
        case 'PageDown': seq = '\x1b[6~'; break;
        case 'Home': seq = '\x1b[1~'; break;
        case 'End': seq = '\x1b[4~'; break;
        case 'Insert': seq = '\x1b[2~'; break;
        case 'Delete':
          // Smart DBCS Delete: if current cell is DBCS lead byte, send 2 Deletes
          seq = (settingsManager.settings.smartDbcsBackspace && buf && buf.isCurCharDBCSLead()) ? '\x1b[3~\x1b[3~' : '\x1b[3~';
          break;
        case 'F1': seq = '\x1bOP'; break;
        case 'F2': seq = '\x1bOQ'; break;
        case 'F3': seq = '\x1bOR'; break;
        case 'F4': seq = '\x1bOS'; break;
        case 'F5': seq = '\x1b[15~'; break;
        case 'F6': seq = '\x1b[17~'; break;
        case 'F7': seq = '\x1b[18~'; break;
        case 'F8': seq = '\x1b[19~'; break;
        case 'F9': seq = '\x1b[20~'; break;
        case 'F10': seq = '\x1b[21~'; break;
        case 'F11': seq = '\x1b[23~'; break;
        case 'F12': seq = '\x1b[24~'; break;
        default:
          // Direct printable ASCII key
          if (e.key.length === 1 && e.key !== 'Process' && e.keyCode !== 229) {
            seq = e.key;
          }
          break;
      }
    }
  }

  if (seq) {
    e.preventDefault();
    imeInput.value = '';
    sendData(seq);
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

// Listen for backend data per tab
listen('terminal-data', (event) => {
  try {
    const { tab_id, data } = event.payload;
    if (tab_id && data) {
      tabManager.feedData(tab_id, data);
      autoLoginManager.feedData(tab_id, data);

      const tab = tabManager.getTabById(tab_id);
      if (tab && tab.buf) {
        const lines = [];
        for (let r = 0; r < tab.buf.rows; r++) {
          let lineStr = '';
          for (let c = 0; c < tab.buf.cols; c++) {
            const cell = tab.buf.lines[r][c];
            if (!cell || cell.isTrailByte) continue;
            lineStr += cell.ch || ' ';
          }
          lines.push(lineStr);
        }
        notificationManager.feedScreenLines(tab_id, lines, tab.title);
      }
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
