// Customizable Two-Row Toolbar Layout Helpers

export const TOOLBAR_BUTTON_CATALOG = [
  { id: 'board-btn', icon: '⚡', label: '看板' },
  { id: 'aid-btn', icon: '🎯', label: '跳文' },
  { id: 'article-reader-btn', icon: '📖', label: '好讀版' },
  { id: 'live-chat-btn', icon: '📺', label: '實況' },
  { id: 'mouse-browsing-btn', icon: '🖱️', label: '滑鼠操作' },
  { id: 'push-helper-btn', icon: '💬', label: '推文' },
  { id: 'picket-report-btn', icon: '🚨', label: '檢舉' },
  { id: 'article-monitor-btn', icon: '📢', label: '追蹤' },
  { id: 'palette-btn', icon: '🎨', label: '調色盤' },
  { id: 'export-btn', icon: '📷', label: '截圖' },
  { id: 'add-bookmark-btn', icon: '⭐', label: '存書籤' },
  { id: 'settings-btn', icon: '⚙️', label: '設定' },
  { id: 'shortcuts-btn', icon: '⌨️', label: '熱鍵' },
];

export const DEFAULT_PINNED_TOOLBAR_BUTTONS = [
  'palette-btn',
  'export-btn',
  'add-bookmark-btn',
  'settings-btn',
  'shortcuts-btn',
];

const CATALOG_INDEX = new Map(TOOLBAR_BUTTON_CATALOG.map((item, idx) => [item.id, idx]));

/**
 * Validates, deduplicates, and sorts pinned button IDs into canonical catalog order.
 * Returns defaults when input is not an array; preserves an explicit empty array.
 */
export function normalizePinnedToolbarButtons(list) {
  if (!Array.isArray(list)) {
    return [...DEFAULT_PINNED_TOOLBAR_BUTTONS];
  }
  const seen = new Set();
  for (const rawId of list) {
    if (typeof rawId === 'string' && CATALOG_INDEX.has(rawId)) {
      seen.add(rawId);
    }
  }
  return Array.from(seen).sort((a, b) => CATALOG_INDEX.get(a) - CATALOG_INDEX.get(b));
}

export function togglePinnedToolbarButton(currentList, buttonId) {
  const normalized = normalizePinnedToolbarButtons(currentList);
  if (!CATALOG_INDEX.has(buttonId)) {
    return { pinned: normalized, isPinned: false, changed: false };
  }
  const nextSet = new Set(normalized);
  let isPinned;
  if (nextSet.has(buttonId)) {
    nextSet.delete(buttonId);
    isPinned = false;
  } else {
    nextSet.add(buttonId);
    isPinned = true;
  }
  const pinned = Array.from(nextSet).sort((a, b) => CATALOG_INDEX.get(a) - CATALOG_INDEX.get(b));
  return { pinned, isPinned, changed: true };
}

export function partitionToolbarButtons(pinnedList) {
  const pinnedSet = new Set(normalizePinnedToolbarButtons(pinnedList));
  const topRowIds = [];
  const bottomRowIds = [];
  for (const item of TOOLBAR_BUTTON_CATALOG) {
    if (pinnedSet.has(item.id)) {
      topRowIds.push(item.id);
    } else {
      bottomRowIds.push(item.id);
    }
  }
  return { topRowIds, bottomRowIds };
}

/**
 * Distributes toolbar action buttons between Row 1 (#tab-bar-actions) and
 * Row 2 (#toolbar-actions). Keeps statusIndicatorEl and collapseBtnEl anchored
 * in Row 1 on desktop so Row 2 can collapse without hiding connection state
 * or the expand toggle.
 */
export function applyToolbarButtonLayout({
  pinnedIds,
  tabBarActionsEl,
  toolbarActionsEl,
  collapseBtnEl = null,
  statusIndicatorEl = null,
  isMobile = false,
  doc = typeof document !== 'undefined' ? document : null,
} = {}) {
  if (!toolbarActionsEl || !doc) {
    return { topRowIds: [], bottomRowIds: [] };
  }

  const getBtn = (id) => doc.getElementById(id);

  if (isMobile || !tabBarActionsEl) {
    const allIds = TOOLBAR_BUTTON_CATALOG.map((item) => item.id);
    for (const id of allIds) {
      const btn = getBtn(id);
      if (btn) {
        if (btn.dataset) btn.dataset.pinned = 'false';
        toolbarActionsEl.appendChild(btn);
      }
    }
    if (collapseBtnEl) toolbarActionsEl.appendChild(collapseBtnEl);
    if (statusIndicatorEl) toolbarActionsEl.appendChild(statusIndicatorEl);
    return { topRowIds: [], bottomRowIds: allIds };
  }

  const { topRowIds, bottomRowIds } = partitionToolbarButtons(pinnedIds);

  for (const id of bottomRowIds) {
    const btn = getBtn(id);
    if (btn) {
      if (btn.dataset) btn.dataset.pinned = 'false';
      toolbarActionsEl.appendChild(btn);
    }
  }

  for (const id of topRowIds) {
    const btn = getBtn(id);
    if (btn) {
      if (btn.dataset) btn.dataset.pinned = 'true';
      tabBarActionsEl.appendChild(btn);
    }
  }

  if (statusIndicatorEl) tabBarActionsEl.appendChild(statusIndicatorEl);
  if (collapseBtnEl) tabBarActionsEl.appendChild(collapseBtnEl);

  return { topRowIds, bottomRowIds };
}
