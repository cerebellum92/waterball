// Settings & Blacklist UI Controller for Waterball BBS
import { safeInvoke, writeClipboardText } from './platform.js';
import { imageUploadHistory, deleteUploadedImage } from './image_uploader.js';

export class SettingsUI {
  constructor({
    settingsManager,
    blacklistManager,
    tabManager,
    imagePreview,
    notificationManager,
    updateChecker,
    elements,
    onBookmarksRender,
    onUserTagsRender,
    onFocusTerminal,
    onShowToast,
    onMouseBrowsingChange,
  }) {
    this.settingsManager = settingsManager;
    this.blacklistManager = blacklistManager;
    this.tabManager = tabManager;
    this.imagePreview = imagePreview;
    this.notificationManager = notificationManager;
    this.updateChecker = updateChecker;
    this.elements = elements;
    this.onBookmarksRender = onBookmarksRender || (() => {});
    this.onUserTagsRender = onUserTagsRender || (() => {});
    this.onFocusTerminal = onFocusTerminal || (() => {});
    this.onShowToast = onShowToast || (() => {});
    this.onMouseBrowsingChange = onMouseBrowsingChange || (() => {});

    this.initEventListeners();
  }

  initEventListeners() {
    const protect = action => (...args) => {
      try { return action(...args); }
      catch (error) { this.onShowToast(`黑名單儲存失敗，原有規則未變更：${error.message}`); }
    };
    const {
      settingsModal,
      settingsBtn,
      modalCloseBtn,
      modalSaveBtn,
      settingFontFamily,
      customFontGroup,
      settingImageHostProvider,
      settingImageImgurClientGroup,
      settingImageCustomEndpointGroup,
      btnCheckUpdate,
      updateStatusMsg,
      btnBlacklistAdd,
      inputBlacklistAdd,
      btnBlacklistClear,
      btnBlacklistExportTxt,
      btnBlacklistExportJson,
      btnBlacklistImport,
      fileBlacklistImport,
      btnBlacklistKwAdd,
      inputBlacklistKwAdd,
      btnBlacklistKwClear,
      btnBlacklistKwExportTxt,
      btnBlacklistKwImport,
      fileBlacklistKwImport,
    } = this.elements;

    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => this.open());
    }
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', () => this.close());
    }
    if (modalSaveBtn) {
      modalSaveBtn.addEventListener('click', () => this.save());
    }

    // Custom Font dropdown toggle
    if (settingFontFamily && customFontGroup) {
      settingFontFamily.addEventListener('change', () => {
        if (settingFontFamily.value === 'custom') {
          customFontGroup.classList.remove('hidden');
        } else {
          customFontGroup.classList.add('hidden');
        }
      });
    }

    // Image Host dropdown toggle
    if (settingImageHostProvider) {
      settingImageHostProvider.addEventListener('change', () => {
        const val = settingImageHostProvider.value;
        if (settingImageImgurClientGroup) {
          settingImageImgurClientGroup.classList.toggle('hidden', val !== 'imgur');
        }
        if (settingImageCustomEndpointGroup) {
          settingImageCustomEndpointGroup.classList.toggle('hidden', val !== 'custom');
        }
      });
    }

    const btnClearImageHistory = document.getElementById('btn-clear-image-history');
    if (btnClearImageHistory) {
      btnClearImageHistory.addEventListener('click', () => {
        if (confirm('確定要清除本機的圖片上傳紀錄嗎？（不會刪除圖床上的檔案）')) {
          imageUploadHistory.clear();
          this.renderImageHistory();
          this.onShowToast('已清除圖片上傳紀錄');
        }
      });
    }
    imageUploadHistory.subscribe(() => {
      this.renderImageHistory();
    });

    // Modal tabs switching
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.tab);
        if (target) {
          target.classList.add('active');
          if (btn.dataset.tab === 'tab-user-tags') {
            this.onUserTagsRender();
          }
        }
      });
    });

    // Check Update Button
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
          const res = await this.updateChecker.checkUpdate();
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

    // Blacklist Buttons
    if (btnBlacklistAdd && inputBlacklistAdd) {
      const doAdd = protect(() => {
        const val = inputBlacklistAdd.value.trim();
        if (val) {
          if (this.blacklistManager.add(val)) {
            this.onShowToast(`已將 ${val} 加入黑名單`);
            this.renderBlacklistUI();
            this.tabManager.getActiveTab()?.view?.redraw();
          } else {
            this.onShowToast(`${val} 已存在、格式不合法或清單已達上限`);
          }
          inputBlacklistAdd.value = '';
        }
      });
      btnBlacklistAdd.addEventListener('click', doAdd);
      inputBlacklistAdd.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doAdd();
        }
      });
    }

    if (btnBlacklistClear) {
      btnBlacklistClear.addEventListener('click', protect(() => {
        if (this.blacklistManager.customList.size === 0) return;
        this.blacklistManager.clear();
        this.renderBlacklistUI();
        this.tabManager.getActiveTab()?.view?.redraw();
        this.onShowToast('已清空自訂黑名單');
      }));
    }

    if (btnBlacklistExportTxt) {
      btnBlacklistExportTxt.addEventListener('click', () => {
        const txt = this.blacklistManager.exportAsText();
        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `waterball_blacklist_${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        this.onShowToast('已匯出黑名單 (TXT)');
      });
    }

    if (btnBlacklistExportJson) {
      btnBlacklistExportJson.addEventListener('click', () => {
        const json = this.blacklistManager.exportAsJSON();
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `waterball_blacklist_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.onShowToast('已匯出黑名單 (JSON)');
      });
    }

    if (btnBlacklistImport && fileBlacklistImport) {
      btnBlacklistImport.addEventListener('click', () => {
        fileBlacklistImport.click();
      });
      fileBlacklistImport.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 1024 * 1024) {
          this.onShowToast('匯入檔案不可超過 1 MiB');
          e.target.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (evt) => {
          const content = evt.target?.result;
          if (typeof content === 'string') {
            let added = 0;
            try {
              if (file.name.toLowerCase().endsWith('.json')) {
                const result = this.blacklistManager.importFromJSON(content);
                if (!result.success) throw new Error(result.error);
                this.loadSettingsToUI();
                this.onShowToast(`已合併備份：新增 ${result.addedUsers} 個帳號、${result.addedKeywords} 個關鍵字，並還原設定`);
                this.renderBlacklistUI();
                fileBlacklistImport.value = '';
                return;
              } else {
                added = this.blacklistManager.importFromText(content);
              }
              this.onShowToast(`成功匯入 ${added} 個黑名單帳號`);
              this.renderBlacklistUI();
              this.tabManager.getActiveTab()?.view?.redraw();
            } catch (err) {
              this.onShowToast('匯入失敗，請確認檔案格式是否正確');
            }
          }
          fileBlacklistImport.value = '';
        };
        reader.readAsText(file);
      });
    }

    // Keyword Blacklist Buttons
    if (btnBlacklistKwAdd && inputBlacklistKwAdd) {
      const doAddKw = protect(() => {
        const val = inputBlacklistKwAdd.value.trim();
        if (val) {
          if (this.blacklistManager.addKeyword(val)) {
            const suspended = this.blacklistManager.settings.enabled && this.blacklistManager.settings.enableKeywords && this.blacklistManager.settings.blockWaterball;
            this.onShowToast(`已將關鍵字「${val}」加入黑名單${suspended ? '；水球通知與鈴聲暫停，終端仍接收' : ''}`);
            this.renderBlacklistUI();
            this.tabManager.getActiveTab()?.view?.redraw();
          } else {
            this.onShowToast(`關鍵字「${val}」已存在、格式不合法或清單已達上限`);
          }
          inputBlacklistKwAdd.value = '';
        }
      });
      btnBlacklistKwAdd.addEventListener('click', doAddKw);
      inputBlacklistKwAdd.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doAddKw();
        }
      });
    }

    if (btnBlacklistKwClear) {
      btnBlacklistKwClear.addEventListener('click', protect(() => {
        if (this.blacklistManager.customKeywords.size === 0) return;
        this.blacklistManager.clearKeywords();
        this.renderBlacklistUI();
        this.tabManager.getActiveTab()?.view?.redraw();
        this.onShowToast('已清空關鍵字黑名單');
      }));
    }

    if (btnBlacklistKwExportTxt) {
      btnBlacklistKwExportTxt.addEventListener('click', () => {
        const txt = this.blacklistManager.exportKeywordsAsText();
        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `waterball_blacklist_keywords_${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        this.onShowToast('已匯出關鍵字黑名單 (TXT)');
      });
    }

    if (btnBlacklistKwImport && fileBlacklistKwImport) {
      btnBlacklistKwImport.addEventListener('click', () => {
        fileBlacklistKwImport.click();
      });
      fileBlacklistKwImport.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 1024 * 1024) {
          this.onShowToast('匯入檔案不可超過 1 MiB');
          e.target.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (evt) => {
          const content = evt.target?.result;
          if (typeof content === 'string') {
            let added = 0;
            try {
              if (file.name.toLowerCase().endsWith('.json')) {
                const parsed = JSON.parse(content);
                const result = this.blacklistManager.importFromJSON(Array.isArray(parsed) ? { keywords: parsed } : parsed);
                if (!result.success) throw new Error(result.error);
                added = result.addedKeywords;
                this.loadSettingsToUI();
              } else {
                added = this.blacklistManager.importKeywordsFromText(content);
              }
              this.onShowToast(`成功匯入 ${added} 個關鍵字`);
              this.renderBlacklistUI();
              this.tabManager.getActiveTab()?.view?.redraw();
            } catch (err) {
              this.onShowToast('匯入失敗，請確認檔案格式是否正確');
            }
          }
          fileBlacklistKwImport.value = '';
        };
        reader.readAsText(file);
      });
    }
  }

  isOpen() {
    return Boolean(this.elements.settingsModal && !this.elements.settingsModal.classList.contains('hidden'));
  }

  open() {
    this.loadSettingsToUI();
    this.onBookmarksRender();
    this.renderBlacklistUI();
    this.renderImageHistory();
    this.onUserTagsRender();
    this.elements.settingsModal?.classList.remove('hidden');

    // Clear red badge dot on settingsBtn
    const badgeDot = this.elements.settingsBtn?.querySelector('.tb-btn-badge-dot');
    if (badgeDot) {
      badgeDot.remove();
    }
  }

  close() {
    this.elements.settingsModal?.classList.add('hidden');
    this.onFocusTerminal();
  }

  loadSettingsToUI() {
    const s = this.settingsManager.settings;
    const {
      settingAntiIdle,
      settingAntiIdleInterval,
      settingNotifyEnabled,
      settingNotifySound,
      settingSmartDbcs,
      settingMouseBrowsing,
      settingWheelScroll,
      settingAutoCopy,
      settingTheme,
      settingCursorStyle,
      settingBlinkRate,
      settingImagePreview,
      settingRememberWindow,
      settingToolbarScale,
      settingFontFamily,
      settingCustomFont,
      customFontGroup,
      settingImageUpload,
      settingImageHostProvider,
      settingImageImgurClientId,
      settingImageCustomEndpoint,
      settingImageImgurClientGroup,
      settingImageCustomEndpointGroup,
      settingBlacklistEnabled,
      settingBlacklistGreatTreasure,
    } = this.elements;

    if (settingAntiIdle) settingAntiIdle.checked = s.antiIdleEnabled;
    if (settingAntiIdleInterval) settingAntiIdleInterval.value = String(s.antiIdleInterval);
    if (settingNotifyEnabled) settingNotifyEnabled.checked = s.notifyEnabled !== false;
    if (settingNotifySound) settingNotifySound.checked = s.notifySound !== false;
    if (settingSmartDbcs) settingSmartDbcs.checked = s.smartDbcsBackspace;
    if (settingMouseBrowsing) settingMouseBrowsing.checked = s.mouseBrowsingEnabled !== false;
    if (settingWheelScroll) settingWheelScroll.checked = s.wheelScrollPage;
    if (settingAutoCopy) settingAutoCopy.checked = s.autoCopySelection;
    if (settingTheme) settingTheme.value = s.theme || 'pcman';
    if (settingCursorStyle) settingCursorStyle.value = s.cursorStyle || 'smart';
    if (settingBlinkRate) settingBlinkRate.value = String(s.cursorBlinkRate ?? 500);
    if (settingImagePreview) settingImagePreview.checked = s.imagePreviewEnabled !== false;
    if (settingRememberWindow) settingRememberWindow.checked = s.rememberWindowState !== false;
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

    // Image Upload settings
    if (settingImageUpload) settingImageUpload.checked = s.imageUploadEnabled !== false;
    if (settingImageHostProvider) settingImageHostProvider.value = s.imageUploadProvider || 'imgur';
    if (settingImageImgurClientId) settingImageImgurClientId.value = s.imageUploadImgurClientId || '';
    if (settingImageCustomEndpoint) settingImageCustomEndpoint.value = s.imageUploadCustomEndpoint || '';
    if (settingImageImgurClientGroup) {
      settingImageImgurClientGroup.classList.toggle('hidden', (s.imageUploadProvider || 'imgur') !== 'imgur');
    }
    if (settingImageCustomEndpointGroup) {
      settingImageCustomEndpointGroup.classList.toggle('hidden', (s.imageUploadProvider || 'imgur') !== 'custom');
    }

    // Blacklist settings
    const bs = this.blacklistManager.settings;
    if (settingBlacklistEnabled) settingBlacklistEnabled.checked = bs.enabled !== false;
    if (this.elements.settingBlacklistMode) this.elements.settingBlacklistMode.value = bs.mode || 'dim';
    if (this.elements.settingBlacklistBlockWaterball) this.elements.settingBlacklistBlockWaterball.checked = bs.blockWaterball !== false;
    if (this.elements.settingBlacklistBlockPush) this.elements.settingBlacklistBlockPush.checked = bs.blockPushNotification !== false;
    if (this.elements.settingBlacklistEnableKeywords) this.elements.settingBlacklistEnableKeywords.checked = bs.enableKeywords !== false;
    if (settingBlacklistGreatTreasure) settingBlacklistGreatTreasure.checked = bs.enableGreatTreasure !== false;
  }

  renderBlacklistUI() {
    const render = (container, count, values, keyword) => {
      if (count) count.textContent = String(values.length);
      if (!container) return;
      container.replaceChildren();
      if (!values.length) {
        const hint = document.createElement('div');
        hint.className = 'blacklist-empty-hint';
        hint.textContent = keyword ? '目前尚未加入任何關鍵字。' : '目前尚未加入任何自訂黑名單帳號。';
        container.appendChild(hint);
      }
      // Legacy oversized inventories remain stored; bound synchronous DOM work.
      if (values.length > 200) {
        const hint = document.createElement('p');
        hint.textContent = '先顯示前 200 筆；備份包含全部規則，刪減後可繼續查看其餘項目。';
        container.appendChild(hint);
      }
      for (const value of values.slice(0, 200)) {
        const tag = document.createElement('div');
        tag.className = keyword ? 'blacklist-tag blacklist-kw-tag' : 'blacklist-tag';
        const label = document.createElement('span');
        label.textContent = `${keyword ? '🔤 ' : ''}${value}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'blacklist-tag-remove';
        remove.textContent = '×';
        remove.title = keyword ? '移出關鍵字黑名單' : '移出黑名單';
        remove.addEventListener('click', e => {
          e.stopPropagation();
          try {
            if (keyword) this.blacklistManager.removeKeyword(value);
            else this.blacklistManager.remove(value);
            this.renderBlacklistUI();
          } catch (error) { this.onShowToast(`黑名單儲存失敗：${error.message}`); }
        });
        tag.append(label, remove);
        container.appendChild(tag);
      }
    };
    const e = this.elements;
    render(e.blacklistTagsContainer, e.blacklistCount, this.blacklistManager.getCustomListArray(), false);
    render(e.blacklistKwTagsContainer, e.blacklistKwCount, this.blacklistManager.getCustomKeywordsArray(), true);
    const warnings = this.blacklistManager.getLimitWarnings();
    if (warnings.length && e.blacklistTagsContainer) {
      const warning = document.createElement('p');
      warning.className = 'blacklist-limit-warning';
      warning.textContent = `${warnings.join('；')}。原有規則仍生效；請先匯出備份再刪減，超量期間不可新增或合併匯入。`;
      e.blacklistTagsContainer.appendChild(warning);
    }
    if (e.greatTreasureBadge) e.greatTreasureBadge.textContent = `舊版名單：${this.blacklistManager.getGreatTreasureCount()} 帳號（來源未驗證）`;
  }

  renderImageHistory() {
    const listEl = document.getElementById('image-upload-history-list');
    if (!listEl) return;
    const entries = imageUploadHistory.getEntries();
    if (!entries.length) {
      listEl.innerHTML = '<p style="text-align: center; color: var(--text-muted); margin: 8px 0;">尚無上傳紀錄</p>';
      return;
    }

    const storageWarning = imageUploadHistory.persistenceError
      ? '<p role="alert">撤回紀錄尚未存入本機，僅保留於此視窗記憶體；請先撤回或備份後再關閉。</p>' : '';
    listEl.innerHTML = storageWarning + entries.map((e) => {
      const timeStr = new Date(e.timestamp).toLocaleTimeString();
      const safeUrl = this.escapeHtml(e.url);
      const safeProvider = this.escapeHtml(e.provider);
      const isImgur = e.provider === 'imgur';
      const canDelete = isImgur && e.deletehash && !e.deleted;
      const statusHtml = e.deleted
        ? '<span style="color:#ef4444; font-weight: 500;">(已從圖床撤回刪除)</span>'
        : canDelete
          ? `<button type="button" class="btn-danger btn-delete-upload" data-url="${safeUrl}" style="font-size: 11px; padding: 2px 6px; background:#dc2626; color:#fff; border:none; border-radius:3px; cursor:pointer;">🗑️ 撤回刪除</button>`
          : '<span style="color:var(--text-muted);">(無撤回金鑰)</span>';

      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--border-color); gap: 8px;">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
            <span style="color: var(--text-muted); font-size: 11px; margin-right: 4px;">[${timeStr}]</span>
            <span style="font-weight: 500; font-size: 11px; text-transform: uppercase; margin-right: 4px; color: var(--text-secondary);">${safeProvider}</span>
            <a href="${safeUrl}" target="_blank" style="color: var(--link-color, #38bdf8); text-decoration: underline;" title="${safeUrl}">${safeUrl}</a>
          </div>
          <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
            ${statusHtml}
            <button type="button" class="btn-secondary btn-copy-upload-url" data-url="${safeUrl}" style="font-size: 11px; padding: 2px 6px; cursor:pointer;">📋 複製</button>
          </div>
        </div>
      `;
    }).join('');

    // Bind delete buttons
    listEl.querySelectorAll('.btn-delete-upload').forEach(btn => {
      btn.addEventListener('click', async (evt) => {
        const url = evt.currentTarget.dataset.url;
        if (!url) return;
        if (!confirm(`確定要從圖床永久撤回並刪除這張圖片嗎？\n\n網址：${url}\n（刪除後圖片將無法再被任何人存取）`)) return;
        btn.disabled = true;
        btn.textContent = '⏳ 刪除中...';
        try {
          await deleteUploadedImage({ url });
          this.onShowToast('✅ 圖片已成功從圖床撤回並銷毀！');
          this.renderImageHistory();
        } catch (err) {
          this.onShowToast(`❌ 撤回失敗：${err.message}`);
          btn.disabled = false;
          btn.textContent = '🗑️ 撤回刪除';
        }
      });
    });

    // Bind copy buttons
    listEl.querySelectorAll('.btn-copy-upload-url').forEach(btn => {
      btn.addEventListener('click', async (evt) => {
        const url = evt.currentTarget.dataset.url;
        if (!url) return;
        try {
          await writeClipboardText(url);
          this.onShowToast('✅ 已複製圖片網址');
        } catch {
          this.onShowToast('❌ 複製失敗');
        }
      });
    });
  }

  applyToolbarScale(scale = 'medium') {
    document.body.classList.remove('toolbar-scale-standard', 'toolbar-scale-medium', 'toolbar-scale-large');
    document.body.classList.add(`toolbar-scale-${scale}`);
    window.dispatchEvent(new Event('toolbar-scale-changed'));
    setTimeout(() => {
      this.tabManager.tabs.forEach((t) => t.view?.resize());
    }, 60);
  }

  save() {
    const {
      settingAntiIdle,
      settingAntiIdleInterval,
      settingNotifyEnabled,
      settingNotifySound,
      settingSmartDbcs,
      settingMouseBrowsing,
      settingWheelScroll,
      settingAutoCopy,
      settingTheme,
      settingCursorStyle,
      settingBlinkRate,
      settingImagePreview,
      settingRememberWindow,
      settingToolbarScale,
      settingFontFamily,
      settingCustomFont,
      settingImageUpload,
      settingImageHostProvider,
      settingImageImgurClientId,
      settingImageCustomEndpoint,
      settingBlacklistEnabled,
      settingBlacklistGreatTreasure,
    } = this.elements;

    const isImgPrev = settingImagePreview ? settingImagePreview.checked : true;
    const isNotify = settingNotifyEnabled ? settingNotifyEnabled.checked : true;
    const isSound = settingNotifySound ? settingNotifySound.checked : true;
    const toolbarScale = settingToolbarScale ? settingToolbarScale.value : 'medium';
    const fontFamily = settingFontFamily ? settingFontFamily.value : 'auto';
    const customFont = settingCustomFont ? settingCustomFont.value.trim() : '';
    const cursorStyle = settingCursorStyle ? settingCursorStyle.value : 'smart';

    this.imagePreview.enabled = isImgPrev;

    if (isNotify) {
      this.notificationManager.requestPermission();
    }

    this.applyToolbarScale(toolbarScale);

    // Apply font family and cursor style across all tabs
    this.tabManager.tabs.forEach((t) => {
      t.view?.setFontStyle(fontFamily, customFont);
      t.view?.setCursorStyle(cursorStyle);
      t.view?.setMouseBrowsingEnabled(settingMouseBrowsing ? settingMouseBrowsing.checked : true);
    });

    const antiIdleEnabled = settingAntiIdle ? settingAntiIdle.checked : true;
    const antiIdleInterval = settingAntiIdleInterval ? parseInt(settingAntiIdleInterval.value, 10) : 60;

    // Sync with native Rust background anti-idle system (24/7 background protected)
    safeInvoke('set_anti_idle', { enabled: antiIdleEnabled, intervalSecs: antiIdleInterval }).catch(() => {});

    // Save Blacklist settings
    const blacklistEnabled = settingBlacklistEnabled ? settingBlacklistEnabled.checked : true;
    const blacklistMode = this.elements.settingBlacklistMode ? this.elements.settingBlacklistMode.value : 'dim';
    const blockWaterball = this.elements.settingBlacklistBlockWaterball ? this.elements.settingBlacklistBlockWaterball.checked : true;
    const blockPush = this.elements.settingBlacklistBlockPush ? this.elements.settingBlacklistBlockPush.checked : true;
    const enableKeywords = this.elements.settingBlacklistEnableKeywords ? this.elements.settingBlacklistEnableKeywords.checked : true;
    const greatTreasureEnabled = settingBlacklistGreatTreasure ? settingBlacklistGreatTreasure.checked : true;
    this.blacklistManager.saveSettings({
      enabled: blacklistEnabled,
      mode: blacklistMode,
      blockWaterball,
      blockPushNotification: blockPush,
      enableKeywords,
      enableGreatTreasure: greatTreasureEnabled,
    });
    this.tabManager.getActiveTab()?.view?.redraw();

    this.settingsManager.saveSettings({
      antiIdleEnabled,
      antiIdleInterval,
      notifyEnabled: isNotify,
      notifySound: isSound,
      smartDbcsBackspace: settingSmartDbcs ? settingSmartDbcs.checked : true,
      mouseBrowsingEnabled: settingMouseBrowsing ? settingMouseBrowsing.checked : true,
      wheelScrollPage: settingWheelScroll ? settingWheelScroll.checked : true,
      autoCopySelection: settingAutoCopy ? settingAutoCopy.checked : false,
      imageUploadEnabled: settingImageUpload ? settingImageUpload.checked : true,
      imageUploadProvider: settingImageHostProvider ? settingImageHostProvider.value : 'imgur',
      imageUploadImgurClientId: settingImageImgurClientId ? settingImageImgurClientId.value.trim() : '',
      imageUploadCustomEndpoint: settingImageCustomEndpoint ? settingImageCustomEndpoint.value.trim() : '',
      theme: settingTheme ? settingTheme.value : 'pcman',
      cursorStyle,
      cursorBlinkRate: settingBlinkRate ? parseInt(settingBlinkRate.value, 10) : 500,
      imagePreviewEnabled: isImgPrev,
      rememberWindowState: settingRememberWindow ? settingRememberWindow.checked : true,
      toolbarScale,
      fontFamily,
      customFont,
    });
    safeInvoke('set_remember_window_state', {
      enabled: settingRememberWindow ? settingRememberWindow.checked : true,
    }).catch(() => {});
    this.onMouseBrowsingChange(settingMouseBrowsing ? settingMouseBrowsing.checked : true);

    this.close();
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
