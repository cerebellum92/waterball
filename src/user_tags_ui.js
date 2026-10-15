// User Tags UI Controller for Waterball BBS
import { TAG_COLORS, userTagsManager } from './user_tags.js';

export class UserTagsUI {
  constructor({
    userTagsManager: manager = userTagsManager,
    onShowToast = () => {},
    onTagChange = () => {},
    onFocusTerminal = () => {},
  } = {}) {
    this.manager = manager;
    this.onShowToast = onShowToast;
    this.onTagChange = onTagChange;
    this.onFocusTerminal = onFocusTerminal;

    this.selectedColor = 'blue';
    this.searchFilter = '';

    // Elements cache
    this.modalEl = document.getElementById('user-tag-modal');
    this.modalCloseBtn = document.getElementById('user-tag-modal-close');
    this.modalSaveBtn = document.getElementById('tag-btn-save');
    this.modalCancelBtn = document.getElementById('tag-btn-cancel');
    this.modalDeleteBtn = document.getElementById('tag-btn-delete');
    this.inputUserId = document.getElementById('tag-input-userid');
    this.inputTagText = document.getElementById('tag-input-text');
    this.inputNote = document.getElementById('tag-input-note');
    this.colorPaletteEl = document.getElementById('tag-color-palette');

    // Settings tab elements
    this.listContainer = document.getElementById('user-tags-list-container');
    this.countEl = document.getElementById('user-tags-count');
    this.searchInput = document.getElementById('user-tags-search-input');
    this.btnNew = document.getElementById('btn-user-tag-new');
    this.btnImport = document.getElementById('btn-user-tags-import');
    this.fileImport = document.getElementById('file-user-tags-import');
    this.btnExport = document.getElementById('btn-user-tags-export');
    this.btnClear = document.getElementById('btn-user-tags-clear');

    // Tooltip element
    this.tooltipEl = document.getElementById('user-tag-tooltip');

    this.initColorPalette();
    this.initEventListeners();

    // Listen to data mutations to automatically re-render settings list
    this.manager.addListener(() => {
      this.renderList();
      this.onTagChange();
    });
  }

  initColorPalette() {
    if (!this.colorPaletteEl) return;
    this.colorPaletteEl.innerHTML = '';

    for (const [colorKey, colorDef] of Object.entries(TAG_COLORS)) {
      const pill = document.createElement('div');
      pill.className = `tag-color-pill ${colorKey === this.selectedColor ? 'active' : ''}`;
      pill.dataset.color = colorKey;
      pill.style.background = colorDef.bg;
      pill.style.borderColor = colorDef.border;
      pill.style.color = colorDef.text;
      pill.textContent = colorDef.label;

      pill.addEventListener('click', () => {
        this.selectColor(colorKey);
      });

      this.colorPaletteEl.appendChild(pill);
    }
  }

  selectColor(colorKey) {
    if (!TAG_COLORS[colorKey]) return;
    this.selectedColor = colorKey;
    if (this.colorPaletteEl) {
      this.colorPaletteEl.querySelectorAll('.tag-color-pill').forEach((pill) => {
        pill.classList.toggle('active', pill.dataset.color === colorKey);
      });
    }
  }

  initEventListeners() {
    // Modal buttons
    this.modalCloseBtn?.addEventListener('click', () => this.closeModal());
    this.modalCancelBtn?.addEventListener('click', () => this.closeModal());
    this.modalSaveBtn?.addEventListener('click', () => this.saveModal());
    this.modalDeleteBtn?.addEventListener('click', () => this.deleteModal());

    // Enter key submits modal
    const handleEnter = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.saveModal();
      }
    };
    this.inputUserId?.addEventListener('keydown', handleEnter);
    this.inputTagText?.addEventListener('keydown', handleEnter);

    // Settings tab search
    this.searchInput?.addEventListener('input', (e) => {
      this.searchFilter = e.target.value.trim().toLowerCase();
      this.renderList();
    });

    // Settings tab new button
    this.btnNew?.addEventListener('click', () => {
      this.openModal('');
    });

    // Settings tab import
    this.btnImport?.addEventListener('click', () => {
      this.fileImport?.click();
    });

    this.fileImport?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const result = this.manager.importJson(text);
        if (result.success) {
          this.onShowToast(`成功匯入 ${result.count} 筆鄉民標籤！`);
        } else {
          this.onShowToast(`匯入失敗：${result.error || '格式不符'}`);
        }
      } catch (err) {
        this.onShowToast(`讀取檔案失敗：${err.message}`);
      }
      e.target.value = '';
    });

    // Settings tab export
    this.btnExport?.addEventListener('click', () => {
      const json = this.manager.exportJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `waterball_user_tags_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.onShowToast('已匯出鄉民標籤備份檔案');
    });

    // Settings tab clear all
    this.btnClear?.addEventListener('click', () => {
      const allTags = this.manager.getAllTags();
      if (allTags.length === 0) return;
      this.manager.clear();
      this.onShowToast('已清空所有鄉民標籤');
    });
  }

  openModal(userId = '') {
    if (!this.modalEl) return;
    const cleanId = String(userId || '').trim();
    const existing = cleanId ? this.manager.getTag(cleanId) : null;

    if (this.inputUserId) {
      this.inputUserId.value = existing ? existing.userId : cleanId;
      // If opened for existing user or preset user, make ID readonly
      this.inputUserId.readOnly = Boolean(cleanId);
    }

    if (this.inputTagText) {
      this.inputTagText.value = existing?.tag || '';
    }

    if (this.inputNote) {
      this.inputNote.value = existing?.note || '';
    }

    this.selectColor(existing?.color || 'blue');

    if (this.modalDeleteBtn) {
      this.modalDeleteBtn.classList.toggle('hidden', !existing);
    }

    this.modalEl.classList.remove('hidden');

    // Focus input
    setTimeout(() => {
      if (!cleanId && this.inputUserId) {
        this.inputUserId.focus();
      } else if (this.inputTagText) {
        this.inputTagText.focus();
      }
    }, 50);
  }

  closeModal() {
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
    }
    this.onFocusTerminal?.();
  }

  isOpen() {
    return Boolean(this.modalEl && !this.modalEl.classList.contains('hidden'));
  }

  saveModal() {
    const rawUserId = this.inputUserId?.value?.trim() || '';
    if (!rawUserId || rawUserId.length < 2) {
      this.onShowToast('請輸入有效的鄉民帳號 ID (至少 2 個字元)');
      this.inputUserId?.focus();
      return;
    }

    const tag = this.inputTagText?.value?.trim() || '';
    const note = this.inputNote?.value?.trim() || '';
    const color = this.selectedColor;

    if (!tag && !note) {
      // If both empty, delete
      this.manager.removeTag(rawUserId);
      this.onShowToast(`已移除 ${rawUserId} 的標籤與備註`);
    } else {
      this.manager.setTag(rawUserId, { tag, color, note });
      this.onShowToast(`已儲存 ${rawUserId} 的自訂標籤`);
    }

    this.closeModal();
  }

  deleteModal() {
    const rawUserId = this.inputUserId?.value?.trim() || '';
    if (!rawUserId) return;
    this.manager.removeTag(rawUserId);
    this.onShowToast(`已刪除 ${rawUserId} 的標籤與備註`);
    this.closeModal();
  }

  renderList() {
    if (!this.listContainer) return;
    this.listContainer.innerHTML = '';

    const allTags = this.manager.getAllTags();
    if (this.countEl) {
      this.countEl.textContent = String(allTags.length);
    }

    let filtered = allTags;
    if (this.searchFilter) {
      const q = this.searchFilter;
      filtered = allTags.filter((item) =>
        item.userId.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        item.note.toLowerCase().includes(q)
      );
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'user-tags-empty-hint';
      empty.textContent = this.searchFilter
        ? '找不到符合關鍵字的鄉民標籤。'
        : '目前尚未自訂任何鄉民標籤。可在上方點選「新增鄉民標籤」或在文章/推文中右鍵點擊快速標記！';
      this.listContainer.appendChild(empty);
      return;
    }

    filtered.forEach((item) => {
      const colorDef = TAG_COLORS[item.color] || TAG_COLORS.blue;
      const card = document.createElement('div');
      card.className = 'user-tag-item-card';

      const dateStr = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '';

      card.innerHTML = `
        <div class="user-tag-item-left">
          <div class="user-tag-item-id">
            👤 <strong>${item.userId}</strong>
          </div>
          ${item.tag ? `
            <span class="user-tag-badge-preview" style="color: ${colorDef.text}; background: ${colorDef.bg}; border-color: ${colorDef.border};">
              🏷️ ${item.tag}
            </span>
          ` : ''}
          ${item.note ? `
            <div class="user-tag-item-note" title="${item.note}">
              📝 ${item.note}
            </div>
          ` : ''}
        </div>
        <div class="user-tag-item-right">
          <span class="user-tag-item-date">${dateStr}</span>
          <button class="btn-user-tag-edit btn-secondary" title="編輯標籤">✏️ 編輯</button>
          <button class="btn-user-tag-delete btn-danger" title="刪除標籤">&times;</button>
        </div>
      `;

      card.querySelector('.btn-user-tag-edit')?.addEventListener('click', () => {
        this.openModal(item.userId);
      });

      card.querySelector('.btn-user-tag-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.manager.removeTag(item.userId);
        this.onShowToast(`已刪除 ${item.userId} 的標籤`);
      });

      this.listContainer.appendChild(card);
    });
  }

  // Floating hover tooltip on terminal screen
  showTooltip(userId, clientX, clientY) {
    if (!this.tooltipEl || !userId) return;
    const tag = this.manager.getTag(userId);
    if (!tag) {
      this.hideTooltip();
      return;
    }

    const colorDef = TAG_COLORS[tag.color] || TAG_COLORS.blue;

    const idEl = this.tooltipEl.querySelector('.user-tag-tooltip-id');
    const badgeEl = this.tooltipEl.querySelector('.user-tag-tooltip-badge');
    const noteEl = this.tooltipEl.querySelector('.user-tag-tooltip-note');

    if (idEl) idEl.textContent = tag.userId;

    if (badgeEl) {
      if (tag.tag) {
        badgeEl.textContent = `🏷️ ${tag.tag}`;
        badgeEl.style.color = colorDef.text;
        badgeEl.style.background = colorDef.bg;
        badgeEl.style.borderColor = colorDef.border;
        badgeEl.style.display = 'inline-block';
      } else {
        badgeEl.style.display = 'none';
      }
    }

    if (noteEl) {
      if (tag.note) {
        noteEl.textContent = tag.note;
        noteEl.style.display = 'block';
      } else {
        noteEl.style.display = 'none';
      }
    }

    // Positioning
    this.tooltipEl.classList.remove('hidden');
    const tipW = 220;
    const tipH = 70;
    let posX = clientX + 14;
    let posY = clientY + 14;

    if (posX + tipW > window.innerWidth) {
      posX = clientX - tipW - 10;
    }
    if (posY + tipH > window.innerHeight) {
      posY = clientY - tipH - 10;
    }

    this.tooltipEl.style.left = `${Math.max(8, posX)}px`;
    this.tooltipEl.style.top = `${Math.max(8, posY)}px`;
  }

  hideTooltip() {
    if (this.tooltipEl && !this.tooltipEl.classList.contains('hidden')) {
      this.tooltipEl.classList.add('hidden');
    }
  }

  // Helper to render inline HTML badge
  renderBadgeHtml(userId, extraClass = '') {
    if (!userId) return '';
    const tag = this.manager.getTag(userId);
    if (!tag || !tag.tag) return '';
    const colorDef = TAG_COLORS[tag.color] || TAG_COLORS.blue;
    const noteAttr = tag.note ? ` title="備註: ${tag.note.replace(/"/g, '&quot;')}"` : '';
    return `<span class="user-tag-badge ${extraClass}" data-user="${tag.userId}" style="color: ${colorDef.text}; background: ${colorDef.bg}; border-color: ${colorDef.border};"${noteAttr}>🏷️ ${tag.tag}</span>`;
  }
}

export const userTagsUI = new UserTagsUI();
