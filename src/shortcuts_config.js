// Centralized Keyboard Shortcuts Configuration & Dispatcher for Waterball
// Single source of truth for event dispatch, tooltips, context menus, and Cheat Sheet.

export const SHORTCUT_CATEGORIES = {
  common: '⚡ 常用快捷功能',
  tabs: '📑 連線分頁管理',
  search: '🔍 搜尋與剪貼簿',
  bbs: '⌨️ BBS (PTT) 必備控制鍵',
};

/**
 * Normalizes environment info.
 * @param {Object} options
 * @param {boolean} [options.isMac]
 */
export function resolveEnv({ isMac = false } = {}) {
  const mac = Boolean(isMac);
  return {
    isMac: mac,
    platformKey: mac ? 'mac' : 'win',
  };
}

export const SHORTCUTS_REGISTRY = [
  // 1. Common Actions
  {
    id: 'board_switcher',
    category: 'common',
    name: '看板快速跳轉',
    description: '中英文板名即時直達',
    keyMac: 'Cmd+K',
    keyWin: 'Alt+K',
    tooltipMac: '看板快速跳轉 (Cmd+K)',
    tooltipWin: '看板快速跳轉 (Alt+K / Ctrl+Shift+K)',
    matches: (e, { isMac }) => {
      if (isMac) {
        return e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey && e.code === 'KeyK';
      }
      return (!e.ctrlKey && e.altKey && !e.metaKey && e.code === 'KeyK') ||
             (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyK');
    },
  },
  {
    id: 'aid_jump',
    category: 'common',
    name: '文章代碼跳轉',
    description: '輸入或貼上 AID 快速跳文',
    keyMac: 'Cmd+J',
    keyWin: 'Alt+J',
    tooltipMac: '文章代碼跳轉 (Cmd+J)',
    tooltipWin: '文章代碼跳轉 (Alt+J / Ctrl+Shift+J)',
    matches: (e, { isMac }) => {
      if (isMac) {
        return e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey && e.code === 'KeyJ';
      }
      return (!e.ctrlKey && e.altKey && !e.metaKey && e.code === 'KeyJ') ||
             (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyJ');
    },
  },
  {
    id: 'article_reader',
    category: 'common',
    name: '圖文好讀版',
    description: '長文好讀、大圖展開',
    keyMac: 'Cmd+D / F2',
    keyWin: 'F2 / Alt+O',
    tooltipMac: '圖文好讀版 (Cmd+D / F2)',
    tooltipWin: '圖文好讀版 (F2 / Alt+O)',
    matches: (e, { isMac }) => {
      // F2 (PCMan standard) is supported across all platforms
      if (e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        return true;
      }
      if (isMac) {
        return e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey && (e.code === 'KeyD' || e.code === 'KeyR');
      }
      // Windows/Linux: F2 (PCMan standard) or Alt+O (Open reader)
      // Note: Alt+R is strictly yielded to BBS Ctrl+R (PTT waterball reply)
      return e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyO';
    },
  },
  {
    id: 'toggle_toolbar',
    category: 'common',
    name: '收合／展開功能列',
    description: '極大化終端機可視範圍',
    keyMac: 'Option+B',
    keyWin: 'Alt+B',
    tooltipMac: '收合／展開功能列 (Option+B)',
    tooltipWin: '收合／展開功能列 (Alt+B)',
    matches: (e, { isMac }) => {
      // Note: Alt+T is strictly yielded to BBS Ctrl+T (term.ptt.cc parity)
      return e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyB';
    },
  },
  {
    id: 'article_monitor',
    category: 'common',
    name: '新文章追蹤中心',
    description: '看板推播追蹤與警示',
    keyMac: 'Option+M',
    keyWin: 'Alt+M',
    tooltipMac: '新文章追蹤與推播通知 (Option+M)',
    tooltipWin: '新文章追蹤與推播通知 (Alt+M)',
    matches: (e) => {
      return e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyM';
    },
  },
  {
    id: 'push_helper',
    category: 'common',
    name: '長推文小幫手',
    description: '長文自動分段定時發送',
    keyMac: 'Cmd+Shift+X',
    keyWin: 'Alt+X',
    tooltipMac: '長推文自動分段發送 (Cmd+Shift+X / Option+X)',
    tooltipWin: '長推文自動分段發送 (Alt+X / Ctrl+Shift+X)',
    matches: (e, { isMac }) => {
      return (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyX') ||
             ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === 'KeyX');
    },
  },
  {
    id: 'palette',
    category: 'common',
    name: 'ANSI 調色盤',
    description: '16色雙色發文、符號顏文字',
    keyMac: 'Cmd+P',
    keyWin: 'Alt+P',
    tooltipMac: 'ANSI 調色盤 (Cmd+P)',
    tooltipWin: 'ANSI 調色盤 (Alt+P / Ctrl+Shift+P)',
    matches: (e, { isMac }) => {
      if (isMac) {
        return e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && e.code === 'KeyP';
      }
      return (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') ||
             (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyP');
    },
  },
  {
    id: 'export_screen',
    category: 'common',
    name: '畫面截圖與匯出',
    description: '匯出高畫質 PNG 或 ANSI',
    keyMac: 'Cmd+Shift+S',
    keyWin: 'Ctrl+Shift+S',
    tooltipMac: '畫面截圖與匯出 (Cmd+Shift+S)',
    tooltipWin: '畫面截圖與匯出 (Ctrl+Shift+S / Alt+S)',
    matches: (e, { isMac }) => {
      if (isMac) {
        return e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && e.code === 'KeyS';
      }
      return (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyS') ||
             (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyS');
    },
  },
  {
    id: 'shortcuts_help',
    category: 'common',
    name: '鍵盤熱鍵速查',
    description: '開關本快捷鍵說明一覽',
    keyMac: 'F1',
    keyWin: 'F1',
    tooltipMac: '鍵盤快捷鍵一覽 (F1)',
    tooltipWin: '鍵盤快捷鍵一覽 (F1)',
    matches: (e) => {
      return e.key === 'F1' && !e.ctrlKey && !e.altKey && !e.metaKey;
    },
  },

  // 2. Tab Management
  {
    id: 'new_tab',
    category: 'tabs',
    name: '開啟新連線分頁',
    description: '開啟新的站台連線',
    keyMac: 'Cmd+T',
    keyWin: 'Alt+N',
    tooltipMac: '開啟新連線分頁 (Cmd+T)',
    tooltipWin: '開啟新連線分頁 (Alt+N)',
    matches: (e, { isMac }) => {
      if (isMac) {
        return e.metaKey && !e.altKey && !e.ctrlKey && e.code === 'KeyT';
      }
      return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyN';
    },
  },
  {
    id: 'close_tab',
    category: 'tabs',
    name: '關閉目前分頁',
    description: '關閉當前分頁連線',
    keyMac: 'Cmd+W',
    keyWin: 'Alt+Q',
    tooltipMac: '關閉此分頁 (Cmd+W)',
    tooltipWin: '關閉此分頁 (Alt+Q)',
    matches: (e, { isMac }) => {
      // Note: Alt+W is strictly yielded to BBS Ctrl+W
      if (isMac) {
        return e.metaKey && !e.altKey && !e.ctrlKey && e.code === 'KeyW';
      }
      return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyQ';
    },
  },
  {
    id: 'switch_tab_digits',
    category: 'tabs',
    name: '切換分頁 1 ~ 9',
    description: '直接跳轉指定編號分頁',
    keyMac: 'Cmd+1~9',
    keyWin: 'Alt+1~9',
    tooltipMac: '切換分頁 1~9 (Cmd+1~9)',
    tooltipWin: '切換分頁 1~9 (Alt+1~9)',
    matches: (e, { isMac }) => {
      if (isMac) {
        return e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.code.startsWith('Digit');
      }
      return e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.code.startsWith('Digit');
    },
  },
  {
    id: 'cycle_tab',
    category: 'tabs',
    name: '循環切換分頁',
    description: '切換至下一分頁 (桌面版)',
    keyMac: 'Ctrl+Tab',
    keyWin: 'Ctrl+Tab',
    tooltipMac: '循環切換分頁 (Ctrl+Tab)',
    tooltipWin: '循環切換分頁 (Ctrl+Tab)',
    matches: (e) => {
      return e.ctrlKey && e.key === 'Tab';
    },
  },

  // 3. Search & Clipboard
  {
    id: 'search_find',
    category: 'search',
    name: '畫面文字搜尋',
    description: '在當前畫面搜尋關鍵字',
    keyMac: 'Cmd+F',
    keyWin: 'Ctrl+Shift+F',
    tooltipMac: '在畫面中搜尋 (Cmd+F)',
    tooltipWin: '在畫面中搜尋 (Ctrl+Shift+F)',
    matches: (e, { isMac }) => {
      if (isMac) {
        return e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.code === 'KeyF';
      }
      return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyF';
    },
  },
  {
    id: 'search_next',
    category: 'search',
    name: '找下一處相符',
    description: '在搜尋結果間向後跳轉',
    keyMac: 'Enter / Cmd+G / F3',
    keyWin: 'Enter / F3',
    tooltipMac: '下一處 (Enter / Cmd+G / F3)',
    tooltipWin: '下一處 (Enter / F3)',
    matches: (e, { isMac }) => {
      if (e.key === 'F3' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) return true;
      if (isMac && e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.code === 'KeyG') return true;
      return false;
    },
  },
  {
    id: 'search_prev',
    category: 'search',
    name: '找上一處相符',
    description: '在搜尋結果間向前跳轉',
    keyMac: 'Shift+Enter / Cmd+Shift+G / Shift+F3',
    keyWin: 'Shift+Enter / Shift+F3',
    tooltipMac: '上一處 (Shift+Enter / Cmd+Shift+G / Shift+F3)',
    tooltipWin: '上一處 (Shift+Enter / Shift+F3)',
    matches: (e, { isMac }) => {
      if (e.key === 'F3' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) return true;
      if (isMac && e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.code === 'KeyG') return true;
      return false;
    },
  },
  {
    id: 'copy_text',
    category: 'search',
    name: '複製選取文字',
    description: '有選取文字時複製純文字',
    keyMac: 'Cmd+C',
    keyWin: 'Ctrl+C',
    tooltipMac: '複製選取文字 (Cmd+C)',
    tooltipWin: '複製選取文字 (Ctrl+C)',
    matches: (e, { isMac }) => {
      return (isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey) && !e.shiftKey && e.code === 'KeyC';
    },
  },
  {
    id: 'copy_ansi',
    category: 'search',
    name: '複製含色彩 ANSI',
    description: '複製保留色彩代碼',
    keyMac: 'Cmd+Shift+C',
    keyWin: 'Ctrl+Shift+C',
    tooltipMac: '複製含色彩 ANSI (Cmd+Shift+C)',
    tooltipWin: '複製含色彩 ANSI (Ctrl+Shift+C)',
    matches: (e, { isMac }) => {
      return (isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey) && e.shiftKey && e.code === 'KeyC';
    },
  },
  {
    id: 'paste_text',
    category: 'search',
    name: '貼上至終端機',
    description: '安全分段斷行發送至 BBS',
    keyMac: 'Cmd+V',
    keyWin: 'Ctrl+V / Shift+Insert',
    tooltipMac: '貼上文字 (Cmd+V)',
    tooltipWin: '貼上文字 (Ctrl+V / Shift+Insert)',
    matches: (e, { isMac }) => {
      if (isMac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyV') return true;
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyV') return true;
      if (e.shiftKey && (e.code === 'Insert' || e.key === 'Insert') && !e.ctrlKey && !e.altKey && !e.metaKey) return true;
      return false;
    },
  },

  // 4. Essential BBS / PTT Controls
  {
    id: 'bbs_post',
    category: 'bbs',
    name: '發表文章',
    description: '看板中按此鍵開始發文',
    keyMac: 'Ctrl+P',
    keyWin: 'Ctrl+P',
    tooltipMac: '發表文章 (Ctrl+P)',
    tooltipWin: '發表文章 (Ctrl+P)',
  },
  {
    id: 'bbs_save',
    category: 'bbs',
    name: '存檔發表 / 暫存',
    description: '文章編輯完成後存檔離開',
    keyMac: 'Ctrl+X',
    keyWin: 'Ctrl+X',
    tooltipMac: '存檔發表 (Ctrl+X)',
    tooltipWin: '存檔發表 (Ctrl+X)',
  },
  {
    id: 'bbs_user_list',
    category: 'bbs',
    name: '使用者名單',
    description: '查看線上使用者或發水球',
    keyMac: 'Ctrl+U',
    keyWin: 'Ctrl+U',
    tooltipMac: '使用者名單 (Ctrl+U)',
    tooltipWin: '使用者名單 (Ctrl+U)',
  },
  {
    id: 'bbs_waterball_reply',
    category: 'bbs',
    name: '水球回呼 (回覆水球)',
    description: '收到水球時直接回覆 (Alt+R 備用鍵)',
    keyMac: 'Ctrl+R / Option+R',
    keyWin: 'Ctrl+R / Alt+R',
    tooltipMac: '水球回覆 (Ctrl+R / Option+R)',
    tooltipWin: '水球回覆 (Ctrl+R / Alt+R)',
  },
  {
    id: 'bbs_ctrl_t',
    category: 'bbs',
    name: 'BBS 控制碼 Ctrl+T',
    description: 'BBS 功能碼 (Alt+T 備用鍵)',
    keyMac: 'Ctrl+T / Option+T',
    keyWin: 'Ctrl+T / Alt+T',
    tooltipMac: '控制碼 Ctrl+T (Alt+T)',
    tooltipWin: '控制碼 Ctrl+T (Alt+T)',
  },
  {
    id: 'bbs_ctrl_w',
    category: 'bbs',
    name: 'BBS 控制碼 Ctrl+W',
    description: 'BBS 功能碼 (Alt+W 備用鍵)',
    keyMac: 'Ctrl+W / Option+W',
    keyWin: 'Ctrl+W / Alt+W',
    tooltipMac: '控制碼 Ctrl+W (Alt+W)',
    tooltipWin: '控制碼 Ctrl+W (Alt+W)',
  },
  {
    id: 'bbs_cancel',
    category: 'bbs',
    name: '取消 / 中斷 (Break)',
    description: '無選取時送出中斷訊號',
    keyMac: 'Ctrl+C',
    keyWin: 'Ctrl+C',
    tooltipMac: '取消中斷 (Ctrl+C)',
    tooltipWin: '取消中斷 (Ctrl+C)',
  },
];

/**
 * Returns displayed keys for the current platform and build target.
 */
export function getShortcutKeys(id, env) {
  const item = SHORTCUTS_REGISTRY.find(s => s.id === id);
  if (!item) return '';
  return (env.isMac ? item.keyMac : item.keyWin) || '';
}

export function getShortcutTooltip(id, env) {
  const item = SHORTCUTS_REGISTRY.find(s => s.id === id);
  if (!item) return '';
  return (env.isMac ? item.tooltipMac : item.tooltipWin) || getShortcutKeys(id, env);
}

/**
 * Finds shortcut matching an event.
 */
export function matchShortcut(id, event, env) {
  const item = SHORTCUTS_REGISTRY.find(s => s.id === id);
  if (!item || typeof item.matches !== 'function') return false;
  return item.matches(event, env);
}
