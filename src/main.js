import { TabManager } from './tab_manager.js';
import { settingsManager, getDefaultAddress } from './settings.js';
import { imagePreview } from './image_preview.js';
import { articleReader } from './article_reader.js';
import { SearchWidget } from './search.js';
import { autoLoginManager } from './auto_login.js';
import { PaletteWidget } from './palette.js';
import { notificationManager } from './notifications.js';
import { exportModal } from './exporter.js';
import { BoardSwitcherWidget } from './board_switcher.js';
import { AidJumpModal } from './aid_jump_modal.js';
import { UpdateChecker } from './updater.js';
import { PushHelper } from './push_helper.js';
import { blacklistManager } from './blacklist.js';
import { writeClipboardText, readClipboardText, readClipboardImage, extractClipboardImage, isTouchDevice, isIOS, safeInvoke, isTauri, openExternalUrl } from './platform.js';
import { uploadImageToHost, deleteUploadedImage, imageUploadHistory } from './image_uploader.js';
import { isMac, isInteractiveInputElement, translateBbsKey } from './keymap.js';

if (isTouchDevice() || isIOS()) {
  document.body.classList.add('is-mobile', 'is-touch');
}

import { ConnectionController } from './connection_controller.js';
import { TerminalPasteTransaction } from './paste_transaction.js';
import { ImeController } from './ime_controller.js';
import { BookmarksUI } from './bookmarks_ui.js';
import { SettingsUI } from './settings_ui.js';
import { ContextMenuController } from './context_menu.js';
import { terminalDiagnostics } from './terminal_diagnostics.js';
import { userTagsManager } from './user_tags.js';
import { userTagsUI } from './user_tags_ui.js';
import { waterballManager } from './waterball_manager.js';
import { waterballUI } from './waterball_ui.js';
import { articleMonitorManager, normalizePttArticleUrl } from './article_monitor.js';
import { articleMonitorUI } from './article_monitor_ui.js';
import { ShortcutsModal } from './shortcuts_modal.js';
import { resolveEnv, matchShortcut, getShortcutTooltip } from './shortcuts_config.js';

async function startApp() {

// Keep the native close handler in sync with the persisted preference.
safeInvoke('set_remember_window_state', {
  enabled: settingsManager.settings.rememberWindowState !== false,
}).catch(() => {});

// Prevent body & window rubber-band scrolling
document.body.addEventListener('scroll', () => {
  if (document.body.scrollLeft > 0) document.body.scrollLeft = 0;
  if (document.body.scrollTop > 0) document.body.scrollTop = 0;
});
window.addEventListener('scroll', () => {
  if (window.scrollX > 0) window.scrollTo(0, window.scrollY);
  if (window.scrollY > 0) window.scrollTo(window.scrollX, 0);
});

// DOM elements
const tabBar = document.getElementById('tab-bar');
const addressInput = document.getElementById('address-input');
const encodingSelect = document.getElementById('encoding-select');

const bookmarksSelect = document.getElementById('bookmarks-select');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const boardBtn = document.getElementById('board-btn');
const aidBtn = document.getElementById('aid-btn');
const exportBtn = document.getElementById('export-btn');
const paletteBtn = document.getElementById('palette-btn');
const articleReaderBtn = document.getElementById('article-reader-btn');
const mouseBrowsingBtn = document.getElementById('mouse-browsing-btn');
const pushHelperBtn = document.getElementById('push-helper-btn');
const addBookmarkBtn = document.getElementById('add-bookmark-btn');
const settingsBtn = document.getElementById('settings-btn');
const shortcutsBtn = document.getElementById('shortcuts-btn');
const collapseToolbarBtn = document.getElementById('collapse-toolbar-btn');
const floatingExpandBtn = document.getElementById('floating-expand-btn');
const toolbar = document.getElementById('toolbar');
const toolbarActions = document.getElementById('toolbar-actions');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const terminalContainer = document.getElementById('terminal-container');
const imeInput = document.getElementById('ime-input');

function updateMouseBrowsingButton(enabled) {
  if (!mouseBrowsingBtn) return;
  mouseBrowsingBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  mouseBrowsingBtn.title = enabled ? '關閉滑鼠操作 BBS（保留文字選取）' : '開啟滑鼠操作 BBS';
  mouseBrowsingBtn.classList.toggle('active', enabled);
}

function updateToolbarMode() {
  if (!toolbar || !toolbarActions) return;
  if (document.body.classList.contains('toolbar-collapsed')) return;

  // Measure the full text version first. This lets the toolbar switch back
  // to labels automatically when the window becomes wide enough again.
  document.body.classList.remove('toolbar-icons-only');
  void toolbar.offsetWidth;

  const toolbarRect = toolbar.getBoundingClientRect();
  const actionsRect = toolbarActions.getBoundingClientRect();
  const overflows = actionsRect.right > toolbarRect.right + 1 || toolbar.scrollWidth > toolbar.clientWidth + 1;
  document.body.classList.toggle('toolbar-icons-only', overflows);
}

window.addEventListener('toolbar-scale-changed', updateToolbarMode);

terminalContainer.addEventListener('scroll', () => {
  if (terminalContainer.scrollLeft > 0) terminalContainer.scrollLeft = 0;
  if (terminalContainer.scrollTop > 0) terminalContainer.scrollTop = 0;
});

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

// 1. Tab Manager Setup
const tabManager = new TabManager(tabBar, terminalContainer, imeInput);

// 2. Auxiliary Tool Widgets
const updateChecker = new UpdateChecker();
const searchWidget = new SearchWidget(() => tabManager.getActiveTab());
const paletteWidget = new PaletteWidget((data) => connectionCtrl.sendData(data), () => tabManager.getActiveTab());
const boardSwitcherWidget = new BoardSwitcherWidget((data) => connectionCtrl.sendData(data));
const aidJumpModal = new AidJumpModal({
  getActiveTab: () => tabManager.getActiveTab(),
  getTabById: id => tabManager.getTabById(id),
  getSession: id => connectionCtrl.getConnectionSession(id),
  acquireInput: id => terminalPaste.busy ? null : connectionCtrl.acquireInputLease(id),
  releaseInput: (id, token) => connectionCtrl.releaseInputLease(id, token),
  sendToTab: (id, text, session, token) => connectionCtrl.sendDataToTabAndWait(id, text, session, token),
  onShowToast: showGlobalToast,
});
const pushHelper = new PushHelper(null, () => tabManager.getActiveTab(), {
  getTabById: id => tabManager.getTabById(id),
  getSession: id => connectionCtrl.getConnectionSession(id),
  acquireInput: id => terminalPaste.busy ? null : connectionCtrl.acquireInputLease(id),
  releaseInput: (id, token) => connectionCtrl.releaseInputLease(id, token),
  sendToTab: (id, text, session, token) => connectionCtrl.sendDataToTabAndWait(id, text, session, token),
  getUserId: (tab = tabManager.getActiveTab()) => connectionCtrl.autoLoginManager?.sessions?.get(tab?.id)?.username || settingsManager?.bookmarks?.find(b => b.username)?.username || '',
});
const shortcutsModal = new ShortcutsModal();

function areAnyModalsOpen() {
  if (shortcutsModal && shortcutsModal.isOpen()) return true;
  if (document.getElementById('paste-recovery-dialog')?.open || document.getElementById('paste-confirm-dialog')?.open) return true;
  if (tabManager && tabManager.isTabSwitcherOpen && tabManager.isTabSwitcherOpen()) return true;
  if (settingsUI && settingsUI.isOpen()) return true;
  if (articleReader && articleReader.isOpen) return true;
  if (searchWidget && searchWidget.isOpen) return true;
  if (pushHelper && pushHelper.isOpen) return true;
  if (paletteWidget && paletteWidget.isOpen) return true;
  if (exportModal && exportModal.isOpen) return true;
  if (boardSwitcherWidget && boardSwitcherWidget.isOpen) return true;
  if (aidJumpModal && aidJumpModal.isOpen) return true;
  if (userTagsUI && userTagsUI.isOpen()) return true;
  if (waterballUI && waterballUI.isOpen()) return true;
  if (articleMonitorUI && articleMonitorUI.isOpen()) return true;
  return false;
}

// 3. IME Controller
const imeCtrl = new ImeController({
  imeInput,
  terminalContainer,
  tabManager,
  onSendData: (data) => { if (!terminalPaste.busy) connectionCtrl.sendData(data); },
  getModalOpenStates: areAnyModalsOpen,
});

// 4. Connection Controller
const connectionCtrl = new ConnectionController({
  tabManager,
  settingsManager,
  autoLoginManager,
  notificationManager,
  elements: { addressInput, encodingSelect, connectBtn, disconnectBtn, statusDot, statusText },
  onFocusTerminal: (force) => imeCtrl.focusTerminal(force),
  onShowToast: showGlobalToast,
});

articleReader.getConnectionSession = id => connectionCtrl.getConnectionSession(id);
articleReader.sendToTab = (id, text, session) => connectionCtrl.sendDataToTabAndWait(id, text, session);

// 5. Bookmarks UI Controller
const bookmarksUI = new BookmarksUI({
  settingsManager,
  addressInput,
  encodingSelect,
  bookmarksSelect,
  addBookmarkBtn,
  bookmarkList: document.getElementById('bookmark-list'),
  inputs: {
    bmInputName: document.getElementById('bm-input-name'),
    bmInputAddr: document.getElementById('bm-input-addr'),
    bmInputEnc: document.getElementById('bm-input-enc'),
    bmInputUser: document.getElementById('bm-input-user'),
    bmInputPass: document.getElementById('bm-input-pass'),
    bmBtnAdd: document.getElementById('bm-btn-add'),
    btnResetDefaultBookmarks: document.getElementById('btn-reset-default-bookmarks'),
  },
  onConnect: (bm) => {
    const activeTab = tabManager.getActiveTab();
    if (activeTab?.isConnected) {
      connectionCtrl.disconnect().then(() => connectionCtrl.connect(bm));
    } else {
      connectionCtrl.connect(bm);
    }
  },
  onCloseModal: () => settingsUI.close(),
  onFocusTerminal: (force) => imeCtrl.focusTerminal(force),
  onShowToast: showGlobalToast,
});

// 6. Settings & Blacklist UI Controller
const settingsUI = new SettingsUI({
  settingsManager,
  blacklistManager,
  tabManager,
  imagePreview,
  notificationManager,
  updateChecker,
  elements: {
    settingsModal: document.getElementById('settings-modal'),
    settingsBtn,
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalSaveBtn: document.getElementById('modal-save-btn'),
    settingFontFamily: document.getElementById('setting-font-family'),
    customFontGroup: document.getElementById('custom-font-group'),
    settingCustomFont: document.getElementById('setting-custom-font'),
    settingAntiIdle: document.getElementById('setting-anti-idle'),
    settingAntiIdleInterval: document.getElementById('setting-anti-idle-interval'),
    settingNotifyEnabled: document.getElementById('setting-notify-enabled'),
    settingNotifySound: document.getElementById('setting-notify-sound'),
    settingSmartDbcs: document.getElementById('setting-smart-dbcs'),
    settingMouseBrowsing: document.getElementById('setting-mouse-browsing'),
    settingWheelScroll: document.getElementById('setting-wheel-scroll'),
    settingAutoCopy: document.getElementById('setting-auto-copy'),
    settingImageUpload: document.getElementById('setting-image-upload'),
    settingImageHostProvider: document.getElementById('setting-image-host-provider'),
    settingImageImgurClientId: document.getElementById('setting-image-imgur-client-id'),
    settingImageCustomEndpoint: document.getElementById('setting-image-custom-endpoint'),
    settingImageImgurClientGroup: document.getElementById('setting-image-imgur-client-group'),
    settingImageCustomEndpointGroup: document.getElementById('setting-image-custom-endpoint-group'),
    settingTheme: document.getElementById('setting-theme'),
    settingCursorStyle: document.getElementById('setting-cursor-style'),
    settingBlinkRate: document.getElementById('setting-blink-rate'),
    settingImagePreview: document.getElementById('setting-image-preview'),
    settingRememberWindow: document.getElementById('setting-remember-window'),
    settingToolbarScale: document.getElementById('setting-toolbar-scale'),
    btnCheckUpdate: document.getElementById('btn-check-update'),
    updateStatusMsg: document.getElementById('update-status-msg'),
    settingBlacklistEnabled: document.getElementById('setting-blacklist-enabled'),
    settingBlacklistMode: document.getElementById('setting-blacklist-mode'),
    settingBlacklistBlockWaterball: document.getElementById('setting-blacklist-block-waterball'),
    settingBlacklistBlockPush: document.getElementById('setting-blacklist-block-push'),
    settingBlacklistEnableKeywords: document.getElementById('setting-blacklist-enable-keywords'),
    settingBlacklistGreatTreasure: document.getElementById('setting-blacklist-great-treasure'),
    greatTreasureBadge: document.getElementById('great-treasure-badge'),
    inputBlacklistAdd: document.getElementById('input-blacklist-add'),
    btnBlacklistAdd: document.getElementById('btn-blacklist-add'),
    blacklistTagsContainer: document.getElementById('blacklist-tags-container'),
    blacklistCount: document.getElementById('blacklist-count'),
    btnBlacklistImport: document.getElementById('btn-blacklist-import'),
    fileBlacklistImport: document.getElementById('file-blacklist-import'),
    btnBlacklistExportTxt: document.getElementById('btn-blacklist-export-txt'),
    btnBlacklistExportJson: document.getElementById('btn-blacklist-export-json'),
    btnBlacklistClear: document.getElementById('btn-blacklist-clear'),
    inputBlacklistKwAdd: document.getElementById('input-blacklist-kw-add'),
    btnBlacklistKwAdd: document.getElementById('btn-blacklist-kw-add'),
    blacklistKwTagsContainer: document.getElementById('blacklist-kw-tags-container'),
    blacklistKwCount: document.getElementById('blacklist-kw-count'),
    btnBlacklistKwImport: document.getElementById('btn-blacklist-kw-import'),
    fileBlacklistKwImport: document.getElementById('file-blacklist-kw-import'),
    btnBlacklistKwExportTxt: document.getElementById('btn-blacklist-kw-export-txt'),
    btnBlacklistKwClear: document.getElementById('btn-blacklist-kw-clear'),
  },
  onBookmarksRender: () => bookmarksUI.renderBookmarkList(),
  onUserTagsRender: () => userTagsUI.renderList(),
  onFocusTerminal: () => imeCtrl.focusTerminal(),
  onShowToast: showGlobalToast,
  onMouseBrowsingChange: updateMouseBrowsingButton,
});

updateMouseBrowsingButton(settingsManager.settings.mouseBrowsingEnabled !== false);
mouseBrowsingBtn?.addEventListener('click', () => {
  const enabled = settingsManager.settings.mouseBrowsingEnabled === false;
  settingsManager.saveSettings({ mouseBrowsingEnabled: enabled });
  tabManager.tabs.forEach((tab) => tab.view?.setMouseBrowsingEnabled(enabled));
  updateMouseBrowsingButton(enabled);
});

// 7. Context Menu Controller
const contextMenuCtrl = new ContextMenuController({
  contextMenuEl: document.getElementById('terminal-context-menu'),
  blacklistManager,
  userTagsManager,
  onQuickPush: () => pushHelper.open(),
  onBlacklistChange: () => {
    settingsUI.renderBlacklistUI();
    tabManager.getActiveTab()?.view?.redraw();
  },
  onEditTag: (userId) => {
    userTagsUI.openModal(userId);
  },
  onSendWaterball: () => {
    showGlobalToast('水球功能維護中，暫停使用');
  },
  onShowToast: showGlobalToast,
});

// Waterball UI Integration (Disabled for v0.1.8 maintenance)
waterballUI.onSendWaterball = async () => {
  showGlobalToast('水球發送功能目前暫停使用');
  return { success: false, reason: 'disabled', text: '水球發送功能目前暫停使用' };
};
waterballUI.onSendMail = async () => {
  showGlobalToast('水球功能維護中，暫停使用');
  return { success: false, reason: 'disabled', text: '水球功能維護中，暫停使用' };
};
waterballUI.onShowToast = showGlobalToast;
waterballUI.onFocusTerminal = (force = true) => imeCtrl.focusTerminal(force);

// Article Monitor UI Integration
articleMonitorUI.onOpenArticleReader = (url) => {
  const safeUrl = normalizePttArticleUrl(url);
  openExternalUrl(safeUrl).catch(console.error);
};
articleMonitorUI.onSwitchBoard = (board) => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab && activeTab.isConnected) {
    connectionCtrl.sendData(`s${board}\r`);
    showGlobalToast(`已送出切換至看板 [${board}]`);
  } else {
    showGlobalToast(`尚未連線至 BBS，無法切換至 [${board}]`);
  }
};
articleMonitorUI.onShowToast = showGlobalToast;
articleMonitorUI.onFocusTerminal = (force = true) => imeCtrl.focusTerminal(force);
userTagsUI.onFocusTerminal = (force = true) => imeCtrl.focusTerminal(force);

// Start background article monitoring scheduler (every 3 minutes)
articleMonitorManager.startScheduler(3);

// Article Reader User Tag & Toast Integration
articleReader.onEditUserTag = (userId) => {
  userTagsUI.openModal(userId);
};
articleReader.onShowToast = showGlobalToast;
userTagsManager.addListener(() => {
  articleReader.refresh();
  tabManager.getActiveTab()?.view?.redraw();
});

// Tab Manager Event Hooks
tabManager.onActiveTabChange = (activeTab) => {
  if (!activeTab) return;
  imagePreview.hideImmediate();
  userTagsUI.hideTooltip();
  searchWidget.close();
  if (addressInput) addressInput.value = activeTab.address;
  if (encodingSelect) encodingSelect.value = activeTab.encoding;
  connectionCtrl.updateToolbarConnectionState(activeTab.status);
};

tabManager.onTabCloseRequest = (closingTab) => {
  imagePreview.hideImmediate();
  userTagsUI.hideTooltip();
  connectionCtrl.disconnectTab(closingTab.id).catch(console.error);
};

tabManager.onUrlClick = (url) => {
  imagePreview.hideImmediate();
  userTagsUI.hideTooltip();
  openExternalUrl(url).catch(console.error);
};

tabManager.onUrlHover = (url, cx, cy) => {
  userTagsUI.hideTooltip();
  if (settingsManager.settings.imagePreviewEnabled !== false) {
    imagePreview.show(url, cx, cy);
  }
};

tabManager.onUrlLeave = () => {
  imagePreview.hide();
};

tabManager.onAidClick = (aid) => {
  imagePreview.hideImmediate();
  userTagsUI.hideTooltip();
  aidJumpModal.open(aid.raw);
};

tabManager.onWordHover = (word, cx, cy) => {
  if (word && userTagsManager.hasTag(word)) {
    userTagsUI.showTooltip(word, cx, cy);
  } else {
    userTagsUI.hideTooltip();
  }
};

tabManager.onWordLeave = () => {
  userTagsUI.hideTooltip();
};

tabManager.onWheel = (direction, tab) => {
  imagePreview.hideImmediate();
  settingsManager.recordActivity();
  if (!tab || !tab.isConnected) return;
  if (!settingsManager.settings.wheelScrollPage) return;
  connectionCtrl.sendData(direction === 'down' ? '\x1b[6~' : '\x1b[5~');
};

tabManager.onArticleClick = (row, tab) => {
  imagePreview.hideImmediate();
  settingsManager.recordActivity();
  if (!tab || !tab.isConnected || !tab.view.isPttArticleListScreen()) return;

  // Keep PCManX's conservative list behaviour: move from the terminal cursor
  // to the clicked row, then submit the selected article.
  const distance = row - tab.buf.cur_y;
  const arrow = distance >= 0 ? '\x1bOB' : '\x1bOA';
  const move = arrow.repeat(Math.abs(distance));
  connectionCtrl.sendDataToTab(tab.id, `${move}\r`);
};

tabManager.onBoardClick = (row, tab) => {
  imagePreview.hideImmediate();
  settingsManager.recordActivity();
  if (!tab || !tab.isConnected || tab.view.getBbsState() !== 'board-list') return;

  const distance = row - tab.buf.cur_y;
  const arrow = distance >= 0 ? '\x1bOB' : '\x1bOA';
  const move = arrow.repeat(Math.abs(distance));
  connectionCtrl.sendDataToTab(tab.id, `${move}\r`);
};

tabManager.onShortcutClick = (shortcut, tab) => {
  imagePreview.hideImmediate();
  settingsManager.recordActivity();
  if (!tab || !tab.isConnected || !shortcut) return;
  const command = shortcut.command || shortcut.key;
  if (!command) return;
  const data = tab.view.getBbsState() === 'main-menu' && shortcut.key ? `${command}\r` : command;
  connectionCtrl.sendDataToTab(tab.id, data);
};

tabManager.onSelectionChange = (selection, tab) => {
  if (settingsManager.settings.autoCopySelection && selection && tab?.view) {
    const text = tab.view.getSelectionText();
    if (text) {
      writeClipboardText(text).catch(() => {});
    }
  }
};

tabManager.onContextMenu = (info, tab) => {
  contextMenuCtrl.show(info, tab);
};

notificationManager.onTabBadgeTrigger = (tabId) => tabManager.triggerTabBadge(tabId);
notificationManager.onFocusTab = (tabId) => tabManager.switchTab(tabId);

// Initialize first tab & UI
try {
  if (localStorage.getItem('waterball_toolbar_collapsed') === 'true') {
    document.body.classList.add('toolbar-collapsed');
  }
} catch (e) {}

tabManager.init();
bookmarksUI.renderBookmarksSelect();
settingsUI.applyToolbarScale(settingsManager.settings.toolbarScale || 'medium');
updateToolbarMode();

function applyPlatformShortcutTooltips() {
  const env = resolveEnv({ isMac });
  if (shortcutsBtn) shortcutsBtn.title = getShortcutTooltip('shortcuts_help', env);
  if (boardBtn) boardBtn.title = getShortcutTooltip('board_switcher', env);
  if (articleReaderBtn) articleReaderBtn.title = getShortcutTooltip('article_reader', env);
  if (pushHelperBtn) pushHelperBtn.title = getShortcutTooltip('push_helper', env);
  if (paletteBtn) paletteBtn.title = getShortcutTooltip('palette', env);
  if (exportBtn) exportBtn.title = getShortcutTooltip('export_screen', env);
  if (aidBtn) aidBtn.title = getShortcutTooltip('aid_jump', env);
  if (collapseToolbarBtn) collapseToolbarBtn.title = getShortcutTooltip('toggle_toolbar', env);
  if (floatingExpandBtn) floatingExpandBtn.title = getShortcutTooltip('toggle_toolbar', env);
  const ctxCopy = document.getElementById('ctx-copy');
  if (ctxCopy) ctxCopy.textContent = `📋 ${getShortcutTooltip('copy_text', env)}`;
  const ctxPush = document.getElementById('ctx-quick-push');
  if (ctxPush) ctxPush.textContent = `💬 快速開啟長推文小幫手 (${env.isMac ? 'Cmd+Shift+X' : 'Alt+X'})`;
}
applyPlatformShortcutTooltips();

// Window resize handling & Window state persistence
let windowStateSaveTimer = null;
function persistWindowState(immediate = false) {
  if (!isTauri() || settingsManager.settings.rememberWindowState === false) return;
  clearTimeout(windowStateSaveTimer);
  const save = () => {
    try {
      const width = window.outerWidth;
      const height = window.outerHeight;
      const x = window.screenX;
      const y = window.screenY;
      const isMaximized = (
        window.innerWidth >= window.screen.availWidth &&
        window.innerHeight >= window.screen.availHeight
      );

      if (width >= 400 && height >= 300) {
        localStorage.setItem('bbsterm_window_state', JSON.stringify({
          width,
          height,
          x: (typeof x === 'number' && !isNaN(x)) ? x : null,
          y: (typeof y === 'number' && !isNaN(y)) ? y : null,
          isMaximized,
        }));

        safeInvoke('save_window_state', {
          width,
          height,
          x: (typeof x === 'number' && !isNaN(x)) ? x : null,
          y: (typeof y === 'number' && !isNaN(y)) ? y : null,
          isMaximized,
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to persist window state:', e);
    }
  };
  if (immediate) {
    save();
  } else {
    windowStateSaveTimer = setTimeout(save, 300);
  }
}

const resizeObserver = new ResizeObserver(() => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab?.view) activeTab.view.resize();
});
resizeObserver.observe(terminalContainer);

window.addEventListener('resize', () => {
  updateToolbarMode();
  const activeTab = tabManager.getActiveTab();
  if (activeTab?.view) activeTab.view.resize();
  persistWindowState();
});

window.addEventListener('beforeunload', () => {
  persistWindowState(true);
});

// Auto-Login status callbacks
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
  showGlobalToast(`⚠️ ${errorMsg}`, 6000);
};

// Toolbar Action Buttons
boardBtn?.addEventListener('click', () => boardSwitcherWidget.open());
aidBtn?.addEventListener('click', () => aidJumpModal.open());
exportBtn?.addEventListener('click', () => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab) exportModal.open(activeTab);
});
paletteBtn?.addEventListener('click', () => paletteWidget.toggle());
articleReaderBtn?.addEventListener('click', () => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab) articleReader.open(activeTab);
});
pushHelperBtn?.addEventListener('click', () => pushHelper.open());
shortcutsBtn?.addEventListener('click', () => shortcutsModal.open());
document.getElementById('settings-open-shortcuts-btn')?.addEventListener('click', () => {
  settingsUI.close();
  shortcutsModal.open();
});

function setToolbarCollapsed(collapsed, options = {}) {
  const { focusTerminal = true, showNotice = false } = options;
  const wasCollapsed = document.body.classList.contains('toolbar-collapsed');
  document.body.classList.toggle('toolbar-collapsed', collapsed);

  try {
    localStorage.setItem('waterball_toolbar_collapsed', collapsed ? 'true' : 'false');
  } catch (err) {
    console.warn('Failed to persist toolbar state:', err);
  }

  if (!collapsed) {
    updateToolbarMode();
  }

  const activeTab = tabManager.getActiveTab();
  if (activeTab?.view) {
    activeTab.view.resize();
  }

  if (focusTerminal) {
    imeCtrl.focusTerminal(true);
  }

  if (showNotice && collapsed && !wasCollapsed) {
    showGlobalToast(`功能列已收合；可點選右上角「▼ 功能列」或按 ${isMac ? 'Option+B' : 'Alt+B'} 展開`, 2500);
  }
}

function toggleToolbar(showNotice = false) {
  const isCollapsed = document.body.classList.contains('toolbar-collapsed');
  setToolbarCollapsed(!isCollapsed, { showNotice });
}

collapseToolbarBtn?.addEventListener('click', () => {
  setToolbarCollapsed(true, { showNotice: true });
});

floatingExpandBtn?.addEventListener('click', () => {
  setToolbarCollapsed(false);
});

function isAnyModalOpen() {
  return Boolean(
    shortcutsModal?.isOpen() ||
    document.getElementById('monitor-cloud-confirm')?.open ||
    document.getElementById('paste-recovery-dialog')?.open ||
    document.getElementById('paste-confirm-dialog')?.open ||
    document.querySelector('#push-modal:not(.hidden)') ||
    document.querySelector('#settings-modal:not(.hidden)') ||
    document.querySelector('#search-bar-widget:not(.hidden)') ||
    document.querySelector('#export-modal:not(.hidden)') ||
    document.querySelector('#board-switcher-widget:not(.hidden)') ||
    document.querySelector('#article-reader-modal:not(.hidden)')
  );
}

const terminalPaste = new TerminalPasteTransaction({
  getActiveTab: () => tabManager.getActiveTab(),
  getTabById: id => tabManager.getTabById(id),
  getSession: id => connectionCtrl.getConnectionSession(id),
  acquireInput: id => connectionCtrl.acquireInputLease(id),
  releaseInput: (id, token) => connectionCtrl.releaseInputLease(id, token),
  send: (id, text, session, token, signal) => connectionCtrl.sendDataToTabAndWait(id, text, session, token, signal),
  confirm: promptPasteConfirm,
  onFailure: draft => {
    const recovery = document.getElementById('paste-recovery-dialog');
    if (draft.remaining && recovery) {
      const remainingText = draft.remaining;
      document.getElementById('paste-recovery-text').value = remainingText;
      document.getElementById('paste-recovery-message').textContent = `${draft.error}。${draft.uncertain ? '第一個區塊可能已部分送出，請先檢查 BBS 畫面。' : ''}內容僅保留於此視窗，不會自動重送。`;

      const deleteBtn = document.getElementById('paste-recovery-delete-image');
      if (deleteBtn) {
        const entry = imageUploadHistory.findByUrl(remainingText);
        if (entry?.deletehash && !entry.deleted) {
          deleteBtn.classList.remove('hidden');
          deleteBtn.disabled = false;
          deleteBtn.textContent = '🗑️ 從圖床撤回刪除此圖';
        } else {
          deleteBtn.classList.add('hidden');
        }
      }

      recovery.showModal();
    }
    showGlobalToast(`⚠️ ${draft.error}，貼上已停止`, 6000);
  },
});

document.getElementById('paste-recovery-delete-image')?.addEventListener('click', async () => {
  const deleteBtn = document.getElementById('paste-recovery-delete-image');
  const textEl = document.getElementById('paste-recovery-text');
  const url = textEl?.value?.trim();
  if (!url || !deleteBtn) return;

  deleteBtn.disabled = true;
  deleteBtn.textContent = '⏳ 正在從圖床刪除...';
  try {
    await deleteUploadedImage({ url });
    showGlobalToast('✅ 圖片已成功從圖床撤回並銷毀！', 5000);
    deleteBtn.textContent = '✅ 已從圖床刪除';
    textEl.value = `[此圖片已於 ${new Date().toLocaleTimeString()} 成功從圖床撤回並銷毀]\n${url}`;
  } catch (err) {
    showGlobalToast(`❌ 撤回失敗：${err.message}`, 5000);
    deleteBtn.disabled = false;
    deleteBtn.textContent = '🗑️ 從圖床撤回刪除此圖';
  }
});

document.getElementById('paste-recovery-copy')?.addEventListener('click', async () => {
  try {
    await writeClipboardText(document.getElementById('paste-recovery-text').value);
    showGlobalToast('已複製待處理文字；請確認 BBS 畫面後再決定是否貼上');
  } catch { showGlobalToast('複製失敗，請手動選取文字複製'); }
});
document.getElementById('paste-recovery-close')?.addEventListener('click', () => document.getElementById('paste-recovery-dialog').close());

function promptPasteConfirm(lineCount, charCount, previewSnippet) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('paste-confirm-dialog');
    const msgEl = document.getElementById('paste-confirm-text');
    const previewEl = document.getElementById('paste-confirm-preview');
    const cancelBtn = document.getElementById('paste-confirm-cancel');
    const acceptBtn = document.getElementById('paste-confirm-accept');

    if (!dialog || !acceptBtn || !cancelBtn) {
      resolve(false);
      return;
    }

    if (msgEl) {
      msgEl.textContent = `即將貼上 ${lineCount} 行文字（共 ${charCount} 個字元）至 BBS 終端機：`;
    }
    if (previewEl) {
      previewEl.textContent = previewSnippet + (lineCount > 4 ? `\n... （其餘還有 ${lineCount - 4} 行）` : '');
    }

    const onAccept = () => {
      cleanup();
      dialog.close();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      dialog.close();
      resolve(false);
    };

    const cleanup = () => {
      acceptBtn.removeEventListener('click', onAccept);
      cancelBtn.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
    };

    acceptBtn.addEventListener('click', onAccept, { once: true });
    cancelBtn.addEventListener('click', onCancel, { once: true });
    dialog.addEventListener('cancel', onCancel, { once: true });

    dialog.showModal();
  });
}

async function uploadClipboardImage(imageBlob, { signal } = {}) {
  const s = settingsManager.settings;
  showGlobalToast('☁️ 正在上傳圖片至圖床...', 8000);
  const url = await uploadImageToHost(imageBlob, {
    provider: s.imageUploadProvider || 'imgur',
    imgurClientId: s.imageUploadImgurClientId,
    customEndpoint: s.imageUploadCustomEndpoint,
    autoFallback: false,
    signal,
  });
  if (!signal?.aborted) { try { await writeClipboardText(url); } catch {} }
  if (imageUploadHistory.persistenceError) {
    showGlobalToast('圖片撤回紀錄目前僅保存在此視窗記憶體；請先撤回或備份，關閉視窗後可能無法撤回', 10000);
  }
  return url;
}

// The transaction captures the original tab/session and owns the lock before
// clipboard reads or uploads begin. Its normal ACK/recovery path owns sending.
async function pasteTerminalClipboard(input) {
  const result = await terminalPaste.paste(input);
  if (result.status === 'busy') showGlobalToast('上一筆貼上尚未完成');
  else if (result.status === 'disconnected') showGlobalToast('尚未連線，未貼上');
  else if (result.status === 'sent') showGlobalToast('✅ 貼上完成', 3000);
  return result;
}

const imageInsertions = new WeakSet();
async function handleImageUploadAndInsert(imageBlob, targetEl) {
  if (imageInsertions.has(targetEl)) {
    showGlobalToast('上一張圖片尚未上傳完成');
    return;
  }
  imageInsertions.add(targetEl);
  const original = targetEl.value;
  const start = targetEl.selectionStart;
  const end = targetEl.selectionEnd;
  try {
    const url = await uploadClipboardImage(imageBlob);
    // Do not overwrite an edited draft or insert into another editor.
    if (!targetEl.isConnected || targetEl.readOnly || targetEl.disabled ||
        !pushHelper.isOpen || targetEl.value !== original) {
      showGlobalToast(`圖片已上傳；草稿已變更，請手動貼上：${url}`, 8000);
      return;
    }
    targetEl.value = original.slice(0, start) + url + original.slice(end);
    targetEl.selectionStart = targetEl.selectionEnd = start + url.length;
    targetEl.dispatchEvent(new Event('input', { bubbles: true }));
    showGlobalToast('✅ 圖片網址已填入推文草稿', 3000);
  } catch (error) {
    console.error('Image upload failed:', error);
    showGlobalToast(`❌ 圖片上傳失敗：${error.message}`, 5000);
  } finally {
    imageInsertions.delete(targetEl);
  }
}

async function doPaste() {
  const activeEl = document.activeElement;
  if (isInteractiveInputElement(activeEl, imeInput) || isAnyModalOpen()) return;
  await pasteTerminalClipboard(async ({ signal }) => {
    // Native text paste keeps the existing single read fast path. Some native
    // backends reject readText for image-only clipboards, so probe images then.
    let textError;
    try {
      if (signal.aborted) return '';
      const text = await readClipboardText();
      if (text || settingsManager.settings.imageUploadEnabled === false) return text;
    } catch (error) {
      if (settingsManager.settings.imageUploadEnabled === false) throw error;
      textError = error;
    }
    if (signal.aborted) return '';
    const imageBlob = await readClipboardImage();
    if (signal.aborted) return '';
    if (imageBlob) return await uploadClipboardImage(imageBlob, { signal });
    if (textError) throw textError;
    return '';
  });
}

// Snapshot event data and cancel native insertion synchronously. Browser paste
// shortcuts use this event directly, without a second clipboard permission read.
window.addEventListener('paste', (e) => {
  const activeEl = document.activeElement;
  const clipboardData = e.clipboardData || window.clipboardData;
  if (isInteractiveInputElement(activeEl, imeInput)) {
    if (activeEl !== pushHelper.textInput || !pushHelper.isOpen ||
        activeEl.readOnly || activeEl.disabled || settingsManager.settings.imageUploadEnabled === false) return;
    if (clipboardData?.getData('text/plain') || clipboardData?.getData('text')) return;
    const imageBlob = extractClipboardImage(clipboardData);
    if (!imageBlob) return;
    e.preventDefault();
    void handleImageUploadAndInsert(imageBlob, activeEl);
    return;
  }
  if (isAnyModalOpen()) return;
  const text = clipboardData?.getData('text') || '';
  const imageBlob = !text && settingsManager.settings.imageUploadEnabled !== false
    ? extractClipboardImage(clipboardData) : null;
  e.preventDefault();
  imeInput.value = '';
  void pasteTerminalClipboard(imageBlob ? ({ signal }) => uploadClipboardImage(imageBlob, { signal }) : text);
});

// Capture before focused editors/dialogs can consume Escape. Already-issued
// uploads may finish so their deletion keys can be retained, but never insert.
window.addEventListener('keydown', (e) => {
  if (!terminalPaste.busy || e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
  terminalPaste.cancel();
  e.preventDefault();
  e.stopImmediatePropagation();
  const confirmDialog = document.getElementById('paste-confirm-dialog');
  if (confirmDialog?.open) confirmDialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  showGlobalToast('已停止貼上；若圖片已送出，會等待回應並保留可用的撤回資料', 8000);
}, { capture: true });

// Comprehensive Keyboard Mapping for BBS & Multi-Tab Shortcuts
window.addEventListener('keydown', (e) => {
  if (document.getElementById('monitor-cloud-confirm')?.open ||
      document.getElementById('paste-confirm-dialog')?.open ||
      document.getElementById('paste-recovery-dialog')?.open) {
    return;
  }

  // Ignore bare modifier keys to not interfere with OS level HUDs (e.g., Cmd+Space input method HUD)
  if (['Meta', 'Control', 'Alt', 'Shift', 'OS'].includes(e.key)) {
    return;
  }

  // Immediately let OS handle Cmd+Space / Ctrl+Space without any interference or focus shifts
  if ((e.metaKey || e.ctrlKey) && e.code === 'Space') {
    return;
  }

  // 1. IME Composition Check: MUST run before any client action or BBS translation!
  if (imeCtrl.isComposing || e.isComposing || e.key === 'Process' || e.keyCode === 229) {
    return;
  }

  if (import.meta.env.DEV && ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) &&
      e.altKey && e.shiftKey && e.code === 'KeyL') {
    e.preventDefault();
    if (e.repeat) return;
    if (terminalDiagnostics.captureEnabled) {
      terminalDiagnostics.captureSave()
        .then((filename) => showGlobalToast(filename ? `已下載畫面紀錄：${filename}` : '沒有可下載的畫面紀錄'))
        .catch((error) => showGlobalToast(`畫面紀錄失敗：${error}`));
    } else {
      terminalDiagnostics.captureStart({ autoFreeze: false })
        .then(() => showGlobalToast('開始錄製最近 30 秒畫面資料；可能包含私人內容', 4000))
        .catch((error) => showGlobalToast(`無法開始錄製：${error}`));
    }
    return;
  }

  imagePreview.hideImmediate();
  settingsManager.recordActivity();

  // 2. Interactive Input Element Handling (inputs/textareas other than terminal imeInput)
  if (isInteractiveInputElement(document.activeElement, imeInput)) {
    // Escape in an input closes containing modals/widgets
    if (e.key === 'Escape') {
      if (shortcutsModal?.isOpen()) { shortcutsModal.close(); e.preventDefault(); return; }
      if (searchWidget?.isOpen) { searchWidget.close(); e.preventDefault(); return; }
      if (boardSwitcherWidget?.isOpen) { boardSwitcherWidget.close(); e.preventDefault(); return; }
      if (aidJumpModal?.isOpen) { aidJumpModal.close(); e.preventDefault(); return; }
      if (exportModal?.isOpen) { exportModal.close(); e.preventDefault(); return; }
      if (paletteWidget?.isOpen) { paletteWidget.close(); e.preventDefault(); return; }
      if (articleReader?.isOpen) { articleReader.close(); e.preventDefault(); return; }
      if (settingsUI?.isOpen()) { settingsUI.close(); e.preventDefault(); return; }
      if (pushHelper?.isOpen) {
        if (pushHelper.isPushing) pushHelper.abort(); else pushHelper.close();
        e.preventDefault();
        return;
      }
      if (waterballUI?.isOpen()) { waterballUI.close(); e.preventDefault(); return; }
      if (userTagsUI?.isOpen()) { userTagsUI.closeModal(); e.preventDefault(); return; }
      if (articleMonitorUI?.isOpen()) { articleMonitorUI.close(); e.preventDefault(); return; }
      if (tabManager?.isTabSwitcherOpen?.()) { tabManager.closeTabSwitcher(); e.preventDefault(); return; }
    }
    // F3 / Shift+F3 in search input (if not caught by local input handler)
    if (searchWidget?.isOpen && (e.key === 'F3' || (isMac && e.metaKey && e.code === 'KeyG'))) {
      e.preventDefault();
      if (e.shiftKey) searchWidget.prevMatch();
      else searchWidget.nextMatch();
      return;
    }
    return; // Allow native typing in the focused input
  }

  // 3. Open Modal ESC / Key Handling (when focus is outside the input)
  if (shortcutsModal?.isOpen()) {
    if (e.key === 'Escape' || e.key === 'F1') {
      shortcutsModal.close();
      e.preventDefault();
      return;
    }
    return; // Modal captures keyboard
  }

  if (aidJumpModal?.isOpen) {
    if (e.key === 'Escape') { aidJumpModal.close(); e.preventDefault(); }
    return; // Never forward keys from AID buttons/backdrop into the terminal.
  }

  if (boardSwitcherWidget?.isOpen) {
    if (e.key === 'Escape') {
      boardSwitcherWidget.close();
      e.preventDefault();
    }
    return;
  }

  if (exportModal?.isOpen) {
    if (e.key === 'Escape') {
      exportModal.close();
      e.preventDefault();
    }
    return;
  }

  if (paletteWidget?.isOpen) {
    if (e.key === 'Escape') {
      paletteWidget.close();
      e.preventDefault();
    }
    return;
  }

  if (settingsUI?.isOpen()) {
    if (e.key === 'Escape') {
      settingsUI.close();
      e.preventDefault();
    }
    return;
  }

  if (pushHelper?.isOpen) {
    if (e.key === 'Escape') {
      if (pushHelper.isPushing) {
        pushHelper.abort();
      } else {
        pushHelper.close();
      }
      e.preventDefault();
    }
    return;
  }

  if (waterballUI?.isOpen()) {
    if (e.key === 'Escape') {
      waterballUI.close();
      e.preventDefault();
    }
    return;
  }

  if (userTagsUI?.isOpen()) {
    if (e.key === 'Escape') {
      userTagsUI.closeModal();
      e.preventDefault();
    }
    return;
  }

  if (articleMonitorUI?.isOpen()) {
    if (e.key === 'Escape') {
      articleMonitorUI.close();
      e.preventDefault();
    }
    return;
  }

  if (tabManager?.isTabSwitcherOpen?.()) {
    if (e.key === 'Escape') {
      tabManager.closeTabSwitcher();
      e.preventDefault();
    }
    return;
  }

  if (articleReader?.isOpen) {
    if (e.key === 'Escape') {
      articleReader.close();
      e.preventDefault();
    }
    return;
  }

  // Search Widget handling (searchWidget does NOT swallow other keys; Escape closes it)
  if (searchWidget?.isOpen) {
    if (e.key === 'Escape') {
      searchWidget.close();
      e.preventDefault();
      return;
    }
  }

  // 4. Client Global Shortcuts Dispatch
  const env = resolveEnv({ isMac });

  if (matchShortcut('shortcuts_help', e, env)) {
    e.preventDefault();
    shortcutsModal.toggle();
    return;
  }

  if (matchShortcut('article_monitor', e, env)) {
    e.preventDefault();
    if (articleMonitorUI.isOpen()) {
      articleMonitorUI.close();
    } else {
      articleMonitorUI.open();
    }
    return;
  }

  if (matchShortcut('toggle_toolbar', e, env)) {
    e.preventDefault();
    toggleToolbar(true);
    return;
  }

  if (matchShortcut('push_helper', e, env)) {
    e.preventDefault();
    pushHelper.open();
    return;
  }

  if (matchShortcut('board_switcher', e, env)) {
    e.preventDefault();
    boardSwitcherWidget.open();
    return;
  }

  if (matchShortcut('aid_jump', e, env)) {
    e.preventDefault();
    aidJumpModal.open();
    return;
  }

  if (matchShortcut('export_screen', e, env)) {
    e.preventDefault();
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      exportModal.open(activeTab);
    }
    return;
  }

  if (matchShortcut('palette', e, env)) {
    e.preventDefault();
    paletteWidget.toggle();
    return;
  }

  if (matchShortcut('search_find', e, env)) {
    e.preventDefault();
    searchWidget.open();
    return;
  }

  if (matchShortcut('search_next', e, env)) {
    e.preventDefault();
    if (!searchWidget.isOpen) {
      searchWidget.open();
    } else {
      searchWidget.nextMatch();
    }
    return;
  }

  if (matchShortcut('search_prev', e, env)) {
    e.preventDefault();
    if (!searchWidget.isOpen) {
      searchWidget.open();
    } else {
      searchWidget.prevMatch();
    }
    return;
  }

  if (matchShortcut('article_reader', e, env)) {
    e.preventDefault();
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      articleReader.open(activeTab);
    }
    return;
  }

  if (matchShortcut('new_tab', e, env)) {
    e.preventDefault();
    const newTab = tabManager.createTab({
      title: `連線 ${tabManager.tabs.length + 1}`,
      address: getDefaultAddress(),
      encoding: 'big5',
    });
    tabManager.switchTab(newTab.id);
    return;
  }

  if (matchShortcut('close_tab', e, env)) {
    e.preventDefault();
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      tabManager.closeTab(activeTab.id);
    }
    return;
  }

  if (matchShortcut('cycle_tab', e, env)) {
    e.preventDefault();
    if (e.shiftKey) {
      tabManager.switchToPrevTab();
    } else {
      tabManager.switchToNextTab();
    }
    return;
  }

  if (matchShortcut('switch_tab_digits', e, env)) {
    const digit = parseInt(e.code.charAt(5), 10);
    if (digit >= 1 && digit <= 9) {
      e.preventDefault();
      tabManager.switchToTabIndex(digit - 1);
      return;
    }
  }

  // 5. BBS Terminal Key Handling & Translation
  const activeTab = tabManager.getActiveTab();
  if (!activeTab || !activeTab.isConnected) return;

  // Make sure terminal textarea has focus
  imeCtrl.focusTerminal(true);

  const view = activeTab.view;
  const buf = activeTab.buf;

  // 1. Copy Shortcut: Cmd+C (macOS) or Ctrl+C (Windows/Linux) when text selection exists
  if ((isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey) && e.code === 'KeyC' && view && view.selection) {
    e.preventDefault();
    const isAnsi = !!e.shiftKey;
    const text = isAnsi ? view.getSelectionAnsi() : view.getSelectionText();
    if (text) {
      writeClipboardText(text)
        .then(() => {
          showGlobalToast(isAnsi ? '🎨 已複製含色彩 ANSI 代碼至剪貼簿！' : '📋 已複製純文字至剪貼簿！');
        })
        .catch((err) => {
          console.error('Clipboard copy error:', err);
        });
    }
    return;
  }

  if (terminalPaste.busy) {
    e.preventDefault();
    if (e.code === 'Escape') terminalPaste.cancel();
    return;
  }

  // 2. Translate BBS Key (Control characters, navigation, editing keys, DBCS)
  const { seq, handled, isPaste } = translateBbsKey(e, {
    smartDbcsBackspace: settingsManager.settings.smartDbcsBackspace,
    isPrevCharDBCS: buf ? buf.isPrevCharDBCS() : false,
    isCurCharDBCSLead: buf ? buf.isCurCharDBCSLead() : false,
  });

  if (isPaste) {
    // Web/extension needs the browser's native paste event and its snapshot.
    if (!isTauri()) return;
    e.preventDefault();
    imeInput.value = '';
    doPaste();
    return;
  }

  if (handled && seq) {
    e.preventDefault();
    imeInput.value = '';
    connectionCtrl.sendData(seq, { sourceKey: e.code, isRepeat: e.repeat });
  } else if (handled) {
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  connectionCtrl.cancelQueuedRepeatedNavigation(e.code);
});

window.addEventListener('blur', () => {
  connectionCtrl.clearHeldScreenNavigationKeys();
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
      const updateStatusMsg = document.getElementById('update-status-msg');
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

}

startApp().catch(error => {
  console.error('Waterball initialization failed:', error);
  const status = document.getElementById('status-text');
  if (status) status.textContent = `初始化失敗：${error.message || error}`;
});
