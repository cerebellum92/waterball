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

import { ConnectionController } from './connection_controller.js';
import { ImeController } from './ime_controller.js';
import { BookmarksUI } from './bookmarks_ui.js';
import { SettingsUI } from './settings_ui.js';
import { ContextMenuController } from './context_menu.js';

const { invoke } = window.__TAURI__.core;

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
const exportBtn = document.getElementById('export-btn');
const paletteBtn = document.getElementById('palette-btn');
const articleReaderBtn = document.getElementById('article-reader-btn');
const pushHelperBtn = document.getElementById('push-helper-btn');
const addBookmarkBtn = document.getElementById('add-bookmark-btn');
const settingsBtn = document.getElementById('settings-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const terminalContainer = document.getElementById('terminal-container');
const imeInput = document.getElementById('ime-input');

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
const pushHelper = new PushHelper((data) => connectionCtrl.sendData(data), () => tabManager.getActiveTab());

function areAnyModalsOpen() {
  if (settingsUI && settingsUI.isOpen()) return true;
  if (articleReader && articleReader.isOpen) return true;
  if (searchWidget && searchWidget.isOpen) return true;
  if (pushHelper && pushHelper.isOpen) return true;
  if (paletteWidget && paletteWidget.isOpen) return true;
  if (exportModal && exportModal.isOpen) return true;
  if (boardSwitcherWidget && boardSwitcherWidget.isOpen) return true;
  return false;
}

// 3. IME Controller
const imeCtrl = new ImeController({
  imeInput,
  terminalContainer,
  tabManager,
  onSendData: (data) => connectionCtrl.sendData(data),
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
    settingWheelScroll: document.getElementById('setting-wheel-scroll'),
    settingAutoCopy: document.getElementById('setting-auto-copy'),
    settingTheme: document.getElementById('setting-theme'),
    settingCursorStyle: document.getElementById('setting-cursor-style'),
    settingBlinkRate: document.getElementById('setting-blink-rate'),
    settingImagePreview: document.getElementById('setting-image-preview'),
    settingToolbarScale: document.getElementById('setting-toolbar-scale'),
    btnCheckUpdate: document.getElementById('btn-check-update'),
    updateStatusMsg: document.getElementById('update-status-msg'),
    settingBlacklistEnabled: document.getElementById('setting-blacklist-enabled'),
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
  },
  onBookmarksRender: () => bookmarksUI.renderBookmarkList(),
  onFocusTerminal: () => imeCtrl.focusTerminal(),
  onShowToast: showGlobalToast,
});

// 7. Context Menu Controller
const contextMenuCtrl = new ContextMenuController({
  contextMenuEl: document.getElementById('terminal-context-menu'),
  blacklistManager,
  onQuickPush: () => pushHelper.open(),
  onBlacklistChange: () => {
    settingsUI.renderBlacklistUI();
    tabManager.getActiveTab()?.view?.redraw();
  },
  onShowToast: showGlobalToast,
});

// Tab Manager Event Hooks
tabManager.onActiveTabChange = (activeTab) => {
  if (!activeTab) return;
  imagePreview.hideImmediate();
  searchWidget.close();
  if (addressInput) addressInput.value = activeTab.address;
  if (encodingSelect) encodingSelect.value = activeTab.encoding;
  connectionCtrl.updateToolbarConnectionState(activeTab.status);
};

tabManager.onTabCloseRequest = (closingTab) => {
  imagePreview.hideImmediate();
  if (closingTab.isConnected) {
    invoke('disconnect', { tabId: closingTab.id }).catch(() => {});
  }
};

tabManager.onUrlClick = (url) => {
  imagePreview.hideImmediate();
  invoke('open_browser_url', { url }).catch((err) => {
    console.error('Failed to open URL via Tauri:', err);
    window.open(url, '_blank');
  });
};

tabManager.onUrlHover = (url, cx, cy) => {
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
  connectionCtrl.sendData(direction === 'down' ? '\x1b[6~' : '\x1b[5~');
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
tabManager.init();
bookmarksUI.renderBookmarksSelect();
settingsUI.applyToolbarScale(settingsManager.settings.toolbarScale || 'medium');

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
    connectionCtrl.sendData(clean);
  }
});

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

  // Modal Dialog ESC handling
  if (boardSwitcherWidget && boardSwitcherWidget.isOpen) {
    if (e.key === 'Escape') {
      boardSwitcherWidget.close();
      return;
    }
  }

  if (exportModal && exportModal.isOpen) {
    if (e.key === 'Escape') {
      exportModal.close();
      return;
    }
  }

  if (paletteWidget && paletteWidget.isOpen) {
    if (e.key === 'Escape') {
      paletteWidget.close();
      return;
    }
  }

  if (searchWidget && searchWidget.isOpen) {
    if (e.key === 'Escape') {
      searchWidget.close();
    }
    return;
  }

  if (articleReader && articleReader.isOpen) {
    if (e.key === 'Escape') {
      articleReader.close();
    }
    return;
  }

  if (settingsUI && settingsUI.isOpen()) {
    if (e.key === 'Escape') {
      settingsUI.close();
    }
    return;
  }

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
  imeCtrl.focusTerminal();

  // If user is actively in IME composition or candidate selection popup
  if (imeCtrl.isComposing || e.isComposing || e.key === 'Process' || e.keyCode === 229) {
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
    connectionCtrl.sendData(seq);
  } else if (handled) {
    e.preventDefault();
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
