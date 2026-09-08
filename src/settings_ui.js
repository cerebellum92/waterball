// Settings & Blacklist UI Controller for Waterball BBS

const { invoke } = window.__TAURI__.core;

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
    onFocusTerminal,
    onShowToast,
  }) {
    this.settingsManager = settingsManager;
    this.blacklistManager = blacklistManager;
    this.tabManager = tabManager;
    this.imagePreview = imagePreview;
    this.notificationManager = notificationManager;
    this.updateChecker = updateChecker;
    this.elements = elements;
    this.onBookmarksRender = onBookmarksRender || (() => {});
    this.onFocusTerminal = onFocusTerminal || (() => {});
    this.onShowToast = onShowToast || (() => {});

    this.initEventListeners();
  }

  initEventListeners() {
    const {
      settingsModal,
      settingsBtn,
      modalCloseBtn,
      modalSaveBtn,
      settingFontFamily,
      customFontGroup,
      btnCheckUpdate,
      updateStatusMsg,
      btnBlacklistAdd,
      inputBlacklistAdd,
      btnBlacklistClear,
      btnBlacklistExportTxt,
      btnBlacklistExportJson,
      btnBlacklistImport,
      fileBlacklistImport,
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

    if (settingsModal) {
      settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
          this.close();
        }
      });
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

    // Modal tabs switching
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.tab);
        if (target) target.classList.add('active');
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
      const doAdd = () => {
        const val = inputBlacklistAdd.value.trim();
        if (val) {
          if (this.blacklistManager.add(val)) {
            this.onShowToast(`已將 ${val} 加入黑名單`);
            this.renderBlacklistUI();
            this.tabManager.getActiveTab()?.view?.redraw();
          } else {
            this.onShowToast(`${val} 已在黑名單中`);
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
          this.blacklistManager.customList.clear();
          this.blacklistManager.saveCustomList();
          this.renderBlacklistUI();
          this.tabManager.getActiveTab()?.view?.redraw();
          this.onShowToast('已清空自訂黑名單');
        }
      });
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
                    if (this.blacklistManager.add(id)) added++;
                  }
                }
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
  }

  isOpen() {
    return Boolean(this.elements.settingsModal && !this.elements.settingsModal.classList.contains('hidden'));
  }

  open() {
    this.loadSettingsToUI();
    this.onBookmarksRender();
    this.renderBlacklistUI();
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
      settingWheelScroll,
      settingAutoCopy,
      settingTheme,
      settingCursorStyle,
      settingBlinkRate,
      settingImagePreview,
      settingToolbarScale,
      settingFontFamily,
      settingCustomFont,
      customFontGroup,
      settingBlacklistEnabled,
      settingBlacklistGreatTreasure,
    } = this.elements;

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
    if (settingBlacklistEnabled) settingBlacklistEnabled.checked = this.blacklistManager.settings.enabled !== false;
    if (settingBlacklistGreatTreasure) settingBlacklistGreatTreasure.checked = this.blacklistManager.settings.enableGreatTreasure !== false;
  }

  renderBlacklistUI() {
    const { blacklistTagsContainer, blacklistCount, greatTreasureBadge } = this.elements;
    if (!blacklistTagsContainer) return;
    blacklistTagsContainer.innerHTML = '';

    const list = this.blacklistManager.getCustomListArray();
    if (blacklistCount) {
      blacklistCount.textContent = String(list.length);
    }
    if (greatTreasureBadge) {
      greatTreasureBadge.textContent = `已收錄 ${this.blacklistManager.getGreatTreasureCount()}+ 帳號`;
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
          this.blacklistManager.remove(u);
          this.renderBlacklistUI();
          this.tabManager.getActiveTab()?.view?.redraw();
        }
      });
    });
  }

  applyToolbarScale(scale = 'medium') {
    document.body.classList.remove('toolbar-scale-standard', 'toolbar-scale-medium', 'toolbar-scale-large');
    document.body.classList.add(`toolbar-scale-${scale}`);
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
      settingWheelScroll,
      settingAutoCopy,
      settingTheme,
      settingCursorStyle,
      settingBlinkRate,
      settingImagePreview,
      settingToolbarScale,
      settingFontFamily,
      settingCustomFont,
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
    });

    const antiIdleEnabled = settingAntiIdle ? settingAntiIdle.checked : true;
    const antiIdleInterval = settingAntiIdleInterval ? parseInt(settingAntiIdleInterval.value, 10) : 60;

    // Sync with native Rust background anti-idle system (24/7 background protected)
    invoke('set_anti_idle', { enabled: antiIdleEnabled, intervalSecs: antiIdleInterval }).catch(() => {});

    // Save Blacklist settings
    const blacklistEnabled = settingBlacklistEnabled ? settingBlacklistEnabled.checked : true;
    const greatTreasureEnabled = settingBlacklistGreatTreasure ? settingBlacklistGreatTreasure.checked : true;
    this.blacklistManager.saveSettings({
      enabled: blacklistEnabled,
      enableGreatTreasure: greatTreasureEnabled,
    });
    this.tabManager.getActiveTab()?.view?.redraw();

    this.settingsManager.saveSettings({
      antiIdleEnabled,
      antiIdleInterval,
      notifyEnabled: isNotify,
      notifySound: isSound,
      smartDbcsBackspace: settingSmartDbcs ? settingSmartDbcs.checked : true,
      wheelScrollPage: settingWheelScroll ? settingWheelScroll.checked : true,
      autoCopySelection: settingAutoCopy ? settingAutoCopy.checked : false,
      theme: settingTheme ? settingTheme.value : 'pcman',
      cursorStyle,
      cursorBlinkRate: settingBlinkRate ? parseInt(settingBlinkRate.value, 10) : 500,
      imagePreviewEnabled: isImgPrev,
      toolbarScale,
      fontFamily,
      customFont,
    });

    this.close();
  }
}
