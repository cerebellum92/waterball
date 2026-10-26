// UI Controller for Article Monitor & Push Notification Center

import {
  articleMonitorManager,
  normalizePttArticleUrl,
  DEFAULT_OFFICIAL_WORKER_URL,
} from './article_monitor.js';
import {
  writeClipboardText,
  sendNativeNotification,
  requestNotificationPermission,
} from './platform.js';
import { describeRestorePreview } from './cloud_restore.js';
import { makeMergePlan } from './cloud_merge.js';

const FONT_SCALES = [
  { id: 'standard', label: '標準', class: 'font-scale-standard' },
  { id: 'medium', label: '舒適', class: 'font-scale-medium' },
  { id: 'large', label: '特大', class: 'font-scale-large' },
];

export class ArticleMonitorUI {
  constructor({
    manager = articleMonitorManager,
    onOpenArticleReader = () => {},
    onSwitchBoard = () => {},
    onFocusTerminal = () => {},
    onShowToast = () => {},
  } = {}) {
    this.manager = manager;
    this.onOpenArticleReader = onOpenArticleReader;
    this.onSwitchBoard = onSwitchBoard;
    this.onFocusTerminal = onFocusTerminal;
    this.onShowToast = onShowToast;

    // Cache elements
    this.modalEl = document.getElementById('article-monitor-modal');
    this.closeBtn = document.getElementById('monitor-close-btn');
    this.fontDecBtn = document.getElementById('monitor-font-dec');
    this.fontIncBtn = document.getElementById('monitor-font-inc');
    this.fontValEl = document.getElementById('monitor-font-val');
    this.currentFontScaleIndex = 0;
    this.toolbarBtn = document.getElementById('article-monitor-btn');
    this.unreadBadge = document.getElementById('monitor-unread-badge');

    this.tabHistoryBtn = document.getElementById('monitor-tab-history-btn');
    this.tabRulesBtn = document.getElementById('monitor-tab-rules-btn');
    this.paneHistory = document.getElementById('monitor-pane-history');
    this.paneRules = document.getElementById('monitor-pane-rules');

    this.historyList = document.getElementById('monitor-history-list');
    this.rulesList = document.getElementById('monitor-rules-list');
    this.historyCount = document.getElementById('monitor-history-count');
    this.rulesCount = document.getElementById('monitor-rules-count');
    this.boardsCount = document.getElementById('monitor-boards-count');

    this.checkNowBtn = document.getElementById('monitor-check-now-btn');
    this.markReadBtn = document.getElementById('monitor-mark-read-btn');
    this.clearHistoryBtn = document.getElementById('monitor-clear-history-btn');

    this.addRuleBtn = document.getElementById('monitor-add-rule-btn');
    this.cancelEditBtn = document.getElementById('monitor-cancel-edit-btn');
    this.inputBoard = document.getElementById('monitor-input-board');
    this.inputKeywords = document.getElementById('monitor-input-keywords');
    this.inputAuthor = document.getElementById('monitor-input-author');
    this.inputPushes = document.getElementById('monitor-input-pushes');
    this.editingRuleId = null;

    this.tabTelegramBtn = document.getElementById('monitor-tab-telegram-btn');
    this.paneTelegram = document.getElementById('monitor-pane-telegram');
    this.localNotifInput = document.getElementById('monitor-local-notif-enabled');
    this.testLocalNotifBtn = document.getElementById('monitor-test-local-notif-btn');
    this.tgEnabledInput = document.getElementById('monitor-tg-enabled');
    this.tgTokenInput = document.getElementById('monitor-tg-token');
    this.tgChatIdInput = document.getElementById('monitor-tg-chatid');
    this.tgSilentInput = document.getElementById('monitor-tg-silent');
    this.tgToggleTokenBtn = document.getElementById('monitor-tg-toggle-token-btn');
    this.openBotBtn = document.getElementById('monitor-open-bot-btn');
    this.botUsernameInput = document.getElementById('monitor-bot-username');
    this.tgTestBtn = document.getElementById('monitor-tg-test-btn');
    this.tgSaveBtn = document.getElementById('monitor-tg-save-btn');
    this.tgStatusEl = document.getElementById('monitor-tg-status');

    this.tabCloudBtn = document.getElementById('monitor-tab-cloud-btn');
    this.paneCloud = document.getElementById('monitor-pane-cloud');
    this.cloudEnabledInput = document.getElementById('monitor-cloud-enabled');
    this.cloudUrlInput = document.getElementById('monitor-cloud-url');
    this.cloudSecretInput = document.getElementById('monitor-cloud-secret');
    this.cloudGenSecretBtn = document.getElementById('monitor-cloud-gen-secret-btn');
    this.cloudAutoSyncInput = document.getElementById('monitor-cloud-autosync');
    this.cloudSyncBtn = document.getElementById('monitor-cloud-sync-btn');
    this.cloudReplaceBtn = document.getElementById('monitor-cloud-replace-btn');
    this.cloudAutoMergeInput = document.getElementById('monitor-cloud-auto-merge');
    this.cloudTestBtn = document.getElementById('monitor-cloud-test-btn');
    this.cloudSaveBtn = document.getElementById('monitor-cloud-save-btn');
    this.cloudStatusEl = document.getElementById('monitor-cloud-status');
    this.cloudReadBtn = document.getElementById('monitor-cloud-read-btn');
    this.cloudRestoreBtn = document.getElementById('monitor-cloud-restore-btn');
    this.cloudDraftBtn = document.getElementById('monitor-cloud-draft-btn');
    this.rebindBtn = document.getElementById('monitor-tg-rebind-btn');
    this.rebindCodeInput = document.getElementById('monitor-tg-rebind-code');

    this.initEventListeners();
    this.initFontScaling();
    this.updateToolbarBadge();
    this.manager.canAutoRestoreRules = () => !this.editingRuleId;

    // Listen to manager changes
    this.manager.addListener(() => {
      this.updateToolbarBadge();
      if (this.isOpen()) {
        this.renderHistory();
        this.renderRules();
      }
    });
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isOpen()) this.refreshCloudSettings();
    });

    // Handle new incoming alert while app is focused
    this.manager.onNewAlert = (alertItem) => {
      this.onShowToast(`📢 [${alertItem.board}] ${alertItem.title}`);
    };
  }

  initEventListeners() {
    this.toolbarBtn?.addEventListener('click', () => {
      if (this.isOpen()) {
        this.close();
      } else {
        this.open();
      }
    });

    this.closeBtn?.addEventListener('click', () => this.close());

    // Font Scaling controls
    this.fontDecBtn?.addEventListener('click', () => {
      if (this.currentFontScaleIndex > 0) {
        this.currentFontScaleIndex--;
        this.applyFontScale();
      }
    });

    this.fontIncBtn?.addEventListener('click', () => {
      if (this.currentFontScaleIndex < FONT_SCALES.length - 1) {
        this.currentFontScaleIndex++;
        this.applyFontScale();
      }
    });

    // Tab switching
    this.tabHistoryBtn?.addEventListener('click', () => {
      this.switchTab('history');
    });

    this.tabRulesBtn?.addEventListener('click', () => {
      this.switchTab('rules');
    });

    this.tabTelegramBtn?.addEventListener('click', () => {
      this.switchTab('telegram');
    });

    this.tabCloudBtn?.addEventListener('click', () => {
      this.switchTab('cloud');
    });

    // Local OS Notification toggle
    this.localNotifInput?.addEventListener('change', () => {
      const enabled = Boolean(this.localNotifInput.checked);
      this.manager.setLocalNotifEnabled(enabled);
      this.onShowToast(enabled ? '💻 已啟用本地作業系統通知' : '🔕 已停用本地作業系統通知');
    });

    // Test Local OS Notification button
    this.testLocalNotifBtn?.addEventListener('click', async () => {
      const localStatusEl = document.getElementById('monitor-local-notif-status');
      const setLocalStatus = (type, msg) => {
        if (localStatusEl) {
          localStatusEl.className = `tg-status-banner ${type}`;
          localStatusEl.textContent = msg;
          localStatusEl.classList.remove('hidden');
          try { localStatusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
        }
        this.onShowToast(msg);
      };

      if (this.testLocalNotifBtn) {
        this.testLocalNotifBtn.textContent = '⏳ 發送測試通知中...';
        this.testLocalNotifBtn.disabled = true;
      }
      setLocalStatus('loading', '⏳ 正在發送本地系統推播通知...');
      try {
        await requestNotificationPermission();
        const sent = await sendNativeNotification(
          '📢 [Waterball] 本地推播測試',
          '這是一則測試通知，代表您的作業系統推播功能運作正常！',
          null,
          { sound: true, subtitle: '[測試通知]', throwOnError: true }
        );
        if (sent) {
          setLocalStatus('success', '🔔 測試通知已發送，請查看螢幕右上角橫幅或系統通知中心！');
        } else {
          setLocalStatus('error', '⚠️ 無法發送通知，請確認系統或瀏覽器通知權限是否已開啟。');
        }
      } catch (err) {
        setLocalStatus('error', `⚠️ 發送測試通知失敗: ${err.message || err}`);
      } finally {
        if (this.testLocalNotifBtn) {
          this.testLocalNotifBtn.textContent = '🔔 測試發送本地通知';
          this.testLocalNotifBtn.disabled = false;
        }
      }
    });

    // Open Official Telegram Bot button (@WaterballAlertBot)
    this.openBotBtn?.addEventListener('click', () => {
      const botUrl = 'https://t.me/WaterballAlertBot';
      if (typeof window !== 'undefined' && window.open) {
        window.open(botUrl, '_blank');
      }
      this.onShowToast('正在開啟 Telegram @WaterballAlertBot，請點擊 Start 領取綁定碼');
    });

    // Cloudflare secret generator button
    this.cloudGenSecretBtn?.addEventListener('click', () => {
      if (this.cloudSecretInput) {
        this.cloudSecretInput.value = this.generateRandomSecret();
        this.cloudSecretInput.type = 'text';
      }
    });

    // Advanced settings share the same lifecycle-aware save path.
    this.cloudSaveBtn?.addEventListener('click', () => this.tgSaveBtn?.click());

    // Cloudflare test connection button
    this.cloudTestBtn?.addEventListener('click', async () => {
      const workerUrl = String(this.cloudUrlInput?.value || DEFAULT_OFFICIAL_WORKER_URL).trim();
      const syncSecret = String(this.cloudSecretInput?.value || this.manager.cloudSyncConfig?.deviceToken || this.tgChatIdInput?.value || '').trim();
      if (!workerUrl || !syncSecret) {
        this.showCloudStatus('error', '❌ 請先填寫推播伺服器網址與綁定碼（或密鑰）才能進行測試！');
        return;
      }
      if (this.cloudTestBtn) {
        this.cloudTestBtn.textContent = '⏳ 連線測試中...';
        this.cloudTestBtn.disabled = true;
      }
      try {
        const res = await this.manager.testCloudConnection(workerUrl, syncSecret);
        if (res && res.success) {
          this.showCloudStatus('success', `✅ ${res.message}`);
          this.onShowToast('推播伺服器連線測試成功');
        } else {
          this.showCloudStatus('error', `❌ 測試失敗：${res?.message || '未知錯誤'}`);
        }
      } catch (e) {
        this.showCloudStatus('error', `❌ 測試發生異常：${e}`);
      } finally {
        if (this.cloudTestBtn) {
          this.cloudTestBtn.textContent = '🧪 測試伺服器連線';
          this.cloudTestBtn.disabled = false;
        }
      }
    });

    // Cloudflare sync now button
    this.cloudSyncBtn?.addEventListener('click', async () => {
      if (this.isOfficialForm()) return this.runOfficial('merge');
      const enabled = Boolean(this.tgEnabledInput?.checked);
      const botToken = String(this.tgTokenInput?.value || '').trim();
      const chatId = String(this.tgChatIdInput?.value || '').trim();
      const silent = Boolean(this.tgSilentInput?.checked);
      const workerUrl = String(this.cloudUrlInput?.value || DEFAULT_OFFICIAL_WORKER_URL).trim();
      const customSecret = String(this.cloudSecretInput?.value || '').trim();
      const effectiveSecret = customSecret || chatId;
      const autoSync = Boolean(this.cloudAutoSyncInput?.checked);
      const botUsername = 'WaterballAlertBot';

      if (!workerUrl || !effectiveSecret) {
        this.showCloudStatus('error', '❌ 請先填寫推播伺服器網址與 Telegram 綁定碼（或密鑰）才能執行同步！');
        return;
      }
      const previous = this.manager.getCloudSyncConfig();
      const oldTelegram = this.manager.getTelegramConfig();
      if (workerUrl.replace(/\/+$/, '').replace(/\/sync$/, '') !== (previous.workerUrl || '').replace(/\/+$/, '').replace(/\/sync$/, '') || enabled !== oldTelegram.enabled || botToken !== oldTelegram.botToken || chatId !== oldTelegram.chatId) {
        this.tgSaveBtn?.click();
        return;
      }

      this.manager.saveCloudSyncConfig({
        enabled: true,
        workerUrl,
        syncSecret: customSecret,
        autoSync,
        botUsername,
      });
      this.manager.saveTelegramConfig({ enabled, botToken, chatId, silent }, { sync: false });
      if (this.cloudEnabledInput) this.cloudEnabledInput.checked = true;

      if (this.cloudSyncBtn) {
        this.cloudSyncBtn.textContent = '⏳ 正在同步...';
        this.cloudSyncBtn.disabled = true;
      }

      try {
        const res = await this.manager.syncToCloud({ workerUrl, syncSecret: effectiveSecret, chatId, userInitiated: true });
        if (res && res.success) {
          const count = res.rule_count !== undefined ? res.rule_count : (res.ruleCount !== undefined ? res.ruleCount : this.manager.getRules().length);
          this.showCloudStatus('success', `🎉 同步成功！已將 ${count} 筆追蹤規則更新至 24H 推播伺服器。`);
          this.onShowToast('已成功同步至推播伺服器');
        } else {
          this.showCloudStatus('error', `❌ 同步失敗：${res?.message || '未知錯誤'}`);
        }
      } catch (e) {
        this.showCloudStatus('error', `❌ 同步異常：${e}`);
      } finally {
        if (this.cloudSyncBtn) {
          this.cloudSyncBtn.textContent = '🔄 手動立即同步規則';
          this.cloudSyncBtn.disabled = false;
        }
      }
    });

    this.cloudReadBtn?.addEventListener('click', () => this.runOfficial('read'));
    this.cloudReplaceBtn?.addEventListener('click', () => this.runOfficial('apply'));
    this.tgSilentInput?.addEventListener('change', () => this.manager.saveTelegramConfig({ ...this.manager.getTelegramConfig(), silent: Boolean(this.tgSilentInput.checked) }));
    this.cloudAutoMergeInput?.addEventListener('change', () => {
      const c = this.manager.getCloudSyncConfig();
      if (!this.isOfficialForm() || !c.deviceToken) { this.cloudAutoMergeInput.checked = false; this.showTelegramStatus('error', '請先配對並讀取雲端設定。'); return; }
      this.manager.saveCloudSyncConfig({ ...c, autoMerge: this.cloudAutoMergeInput.checked, mergeBlocked: null });
      if (this.cloudAutoMergeInput.checked) this.manager.cloudClient.dirty();
      this.manager.cloudClient.scheduleMerge();
    });
    if (typeof window !== 'undefined') window.addEventListener?.('online', () => this.manager.cloudClient.retry()?.catch(() => {}));
    this.cloudRestoreBtn?.addEventListener('click', () => this.runOfficial('restore'));
    this.cloudDraftBtn?.addEventListener('click', () => {
      const result = this.manager.restoreCloudDraft(); this.renderRules(); this.loadCloudForm();
      this.showTelegramStatus(result.success ? 'success' : 'error', result.message);
    });
    this.rebindBtn?.addEventListener('click', () => this.runOfficial('rebind'));

    // Toggle token password visibility
    this.tgToggleTokenBtn?.addEventListener('click', () => {
      if (!this.tgTokenInput) return;
      const isPassword = this.tgTokenInput.type === 'password';
      this.tgTokenInput.type = isPassword ? 'text' : 'password';
      this.tgToggleTokenBtn.textContent = isPassword ? '🙈' : '👁️';
    });

    // Save Telegram & Push config button (One-Click Save & Sync)
    this.tgSaveBtn?.addEventListener('click', async () => {
      if (this.isOfficialForm()) return this.runOfficial(this.manager.cloudSyncConfig.deviceToken ? 'lifecycle' : 'pair');
      const localEnabled = this.localNotifInput ? Boolean(this.localNotifInput.checked) : true;
      const enabled = Boolean(this.tgEnabledInput?.checked);
      const botToken = String(this.tgTokenInput?.value || '').trim();
      const chatId = String(this.tgChatIdInput?.value || '').trim();
      const silent = Boolean(this.tgSilentInput?.checked);
      const workerUrl = String(this.cloudUrlInput?.value || DEFAULT_OFFICIAL_WORKER_URL).trim();
      const customSecret = String(this.cloudSecretInput?.value || '').trim();
      const autoSync = this.cloudAutoSyncInput ? Boolean(this.cloudAutoSyncInput.checked) : true;
      const botUsername = 'WaterballAlertBot';

      this.manager.setLocalNotifEnabled(localEnabled);
      if (enabled && botToken && workerUrl.replace(/\/+$/, '').replace(/\/sync$/, '') === DEFAULT_OFFICIAL_WORKER_URL) {
        this.showTelegramStatus('error', '官方模式請清空個人 Bot Token；使用自己的 Bot 時請改填獨立自架網址。');
        return;
      }

      if (enabled && !chatId) {
        this.showTelegramStatus('error', '❌ 啟用 Telegram 推播前，請先填入您的「專屬推播綁定碼 (Chat ID)」！');
        this.tgChatIdInput?.focus();
        return;
      }

      const previous = this.manager.getCloudSyncConfig();
      const changingService = previous.workerUrl && previous.workerUrl.replace(/\/+$/, '') !== workerUrl.replace(/\/+$/, '');
      const changingAccount = previous.pairedCode && chatId.startsWith('WB2-') && previous.pairedCode !== chatId;
      if (changingService && enabled && chatId.startsWith('WB2-') && chatId === this.manager.getTelegramConfig().chatId) {
        this.showTelegramStatus('error', '切換服務時請填新服務的配對碼，或自架服務自己的數字 Chat ID。');
        return;
      }
      if ((changingService || changingAccount) && (previous.deviceToken || previous.syncSecret)) {
        const stopped = await this.manager.syncToCloud({ lifecycleAction: 'pause', userInitiated: true });
        if (!stopped?.success) {
          this.showTelegramStatus('error', '舊服務尚未確認暫停；請恢復連線後再切換帳號或網址。');
          return;
        }
      }
      this.manager.saveCloudSyncConfig({
        ...(changingAccount ? { deviceToken: '', configRevision: null, lifecycleVersion: null, pendingRequest: null } : {}),
        enabled: Boolean(enabled && workerUrl),
        workerUrl,
        syncSecret: customSecret,
        autoSync,
        botUsername,
      });
      this.manager.saveTelegramConfig({ enabled, botToken, chatId, silent }, { sync: false });

      if (changingService && !enabled && !customSecret) {
        this.manager.saveTelegramConfig({ enabled: false, botToken: '', chatId: '', silent }, { sync: false });
        this.showTelegramStatus('success', '舊雲端已暫停，新服務尚未連線。');
        return;
      }
      if (workerUrl && (enabled || previous.deviceToken || previous.syncSecret)) {
        this.showTelegramStatus('loading', enabled ? '⏳ 正在同步並啟用雲端推播...' : '⏳ 正在暫停雲端推播...');
        try {
          const effectiveSecret = customSecret || this.manager.cloudSyncConfig?.deviceToken || chatId;
          const res = await this.manager.syncToCloud({
            workerUrl,
            syncSecret: effectiveSecret,
            chatId,
            ...(enabled ? { pairingCode: chatId } : {}),
            lifecycleAction: enabled ? 'resume' : 'pause',
            userInitiated: true,
          });
          if (res && res.success) {
            this.showTelegramStatus('success', res.warning ? `⚠️ ${res.warning}` : enabled ? (res.mode === 'selfHosted' ? '✅ 獨立自架推播已啟用，由您自己的 Cloudflare 與 Bot 處理。' : '✅ 雲端推播已啟用，租約 30 天；可在 Telegram 使用 /renew 續用。') : (res.mode === 'selfHosted' ? '✅ 獨立自架推播已暫停。' : '✅ 雲端推播已暫停，資料保留 60 天。'));
            this.onShowToast('推播設定已儲存並同步');
            return;
          }
          this.showTelegramStatus('error', `⚠️ 本機設定已儲存，雲端尚未確認：${res?.message || '請檢查伺服器網址'}`);
          return;
        } catch (e) {
          this.showTelegramStatus('error', `⚠️ 本機設定已儲存，但無法連線至推播伺服器：${e}`);
          return;
        }
      }

      this.showTelegramStatus('success', '✅ 推播設定已成功儲存！');
      this.onShowToast('推播設定已儲存');
    });

    // Test Telegram connection & send button (Supports Official Bot & Custom Bot)
    this.tgTestBtn?.addEventListener('click', async () => {
      const botToken = String(this.tgTokenInput?.value || '').trim();
      const chatId = String(this.tgChatIdInput?.value || '').trim();
      const workerUrl = String(this.cloudUrlInput?.value || DEFAULT_OFFICIAL_WORKER_URL).trim();

      if (!chatId) {
        this.showTelegramStatus('error', '❌ 請先填寫您的「Telegram 專屬推播綁定碼 (Chat ID)」才能發送測試私訊！');
        this.tgChatIdInput?.focus();
        return;
      }

      if (this.tgTestBtn) {
        this.tgTestBtn.textContent = '⏳ 傳送測試私訊中...';
        this.tgTestBtn.disabled = true;
      }
      this.showTelegramStatus('loading', '⏳ 正在透過官方機器人傳送測試私訊至您的 Telegram 聊天視窗...');

      try {
        const res = await this.manager.testTelegram(botToken, chatId, workerUrl);
        if (res && res.success) {
          this.showTelegramStatus('success', '🎉 測試成功！官方機器人已傳送私訊至您的 Telegram 聊天室，請查看手機！');
          this.onShowToast('Telegram 測試私訊發送成功');
        } else {
          this.showTelegramStatus('error', `❌ 測試失敗：${res?.message || '請確認是否已對官方機器人按過 Start 與綁定碼是否正確'}`);
        }
      } catch (e) {
        this.showTelegramStatus('error', `❌ 測試發生異常：${e}`);
      } finally {
        if (this.tgTestBtn) {
          this.tgTestBtn.textContent = '📱 發送測試私訊';
          this.tgTestBtn.disabled = false;
        }
      }
    });

    // Check now button
    this.checkNowBtn?.addEventListener('click', async () => {
      if (this.checkNowBtn) {
        this.checkNowBtn.textContent = '⏳ 檢查中...';
        this.checkNowBtn.disabled = true;
      }
      try {
        const alerts = await this.manager.checkAll();
        if (alerts.length > 0) {
          this.onShowToast(`檢查完成！發現 ${alerts.length} 篇新文章`);
        } else {
          this.onShowToast('檢查完成，目前無符合條件的新文章');
        }
      } catch (e) {
        this.onShowToast(`檢查失敗: ${e}`);
      } finally {
        if (this.checkNowBtn) {
          this.checkNowBtn.textContent = '⚡ 立即檢查';
          this.checkNowBtn.disabled = false;
        }
      }
    });

    // Mark all read button
    this.markReadBtn?.addEventListener('click', () => {
      this.manager.markAllRead();
      this.renderHistory();
      this.updateToolbarBadge();
      this.onShowToast('已全部標為已讀');
    });

    // Clear history button (remove blocking window.confirm for Tauri compatibility)
    this.clearHistoryBtn?.addEventListener('click', () => {
      if (this.manager.getHistory().length === 0) return;
      this.manager.clearHistory();
      this.renderHistory();
      this.updateToolbarBadge();
      this.onShowToast('已清空通知紀錄');
    });

    // Add or Update rule button
    this.addRuleBtn?.addEventListener('click', () => {
      const board = this.inputBoard?.value?.trim();
      const keywords = this.inputKeywords?.value?.trim() || '';
      const author = this.inputAuthor?.value?.trim() || '';
      const minPushes = this.inputPushes?.value || 0;

      if (!board) {
        if (this.inputBoard) this.inputBoard.focus();
        this.onShowToast('請輸入要追蹤的看板名稱');
        return;
      }

      if (this.editingRuleId) {
        const updated = this.manager.updateRule(this.editingRuleId, { board, keywords, author, minPushes });
        if (!updated) {
          this.onShowToast(this.manager.lastError || '更新失敗');
          return;
        }
        this.onShowToast(this.manager.lastWarning || `已更新 [${board}] 追蹤規則`);
        this.cancelEdit();
      } else {
        const added = this.manager.addRule({ board, keywords, author, minPushes });
        if (!added) {
          this.onShowToast(this.manager.lastError || '新增失敗');
          return;
        }
        if (this.inputBoard) this.inputBoard.value = '';
        if (this.inputKeywords) this.inputKeywords.value = '';
        if (this.inputAuthor) this.inputAuthor.value = '';
        if (this.inputPushes) this.inputPushes.value = '0';
        this.onShowToast(this.manager.lastWarning || `已新增 [${board}] 追蹤規則`);
        this.renderRules();
      }
      this.updateToolbarBadge();
    });

    // Cancel edit button
    this.cancelEditBtn?.addEventListener('click', () => {
      this.cancelEdit();
    });

    // Quick board recommendation chips
    const chips = this.modalEl?.querySelectorAll('.chip-btn');
    chips?.forEach((chip) => {
      chip.addEventListener('click', () => {
        const board = chip.getAttribute('data-board');
        if (board && this.inputBoard) {
          this.inputBoard.value = board;
          this.inputKeywords?.focus();
        }
      });
    });
  }

  isOpen() {
    return Boolean(this.modalEl && !this.modalEl.classList.contains('hidden'));
  }

  open(tab = 'history') {
    if (!this.modalEl) return;
    this.modalEl.classList.remove('hidden');
    this.switchTab(tab);
    this.renderHistory();
    this.renderRules();
    this.updateToolbarBadge();
    this.refreshCloudSettings();
  }

  refreshCloudSettings() {
    if (this.editingRuleId) return;
    this.manager.cloudClient.refreshOfficial()?.then(() => {
      if (this.isOpen()) this.loadCloudForm();
    }).catch(() => {});
  }

  initFontScaling() {
    let saved = 'standard';
    try {
      saved = localStorage?.getItem('waterball_monitor_font_scale') || 'standard';
    } catch (_) {}
    const idx = FONT_SCALES.findIndex(s => s.id === saved);
    this.currentFontScaleIndex = idx >= 0 ? idx : 0;
    this.applyFontScale();
  }

  applyFontScale() {
    const scale = FONT_SCALES[this.currentFontScaleIndex] || FONT_SCALES[0];
    const contentEl = this.modalEl?.querySelector('.monitor-modal-content');
    if (contentEl) {
      FONT_SCALES.forEach(s => contentEl.classList.remove(s.class));
      contentEl.classList.add(scale.class);
    }
    if (this.fontValEl) {
      this.fontValEl.textContent = scale.label;
    }
    if (this.fontDecBtn) {
      this.fontDecBtn.disabled = this.currentFontScaleIndex === 0;
      this.fontDecBtn.style.opacity = this.currentFontScaleIndex === 0 ? '0.4' : '1';
    }
    if (this.fontIncBtn) {
      this.fontIncBtn.disabled = this.currentFontScaleIndex === FONT_SCALES.length - 1;
      this.fontIncBtn.style.opacity = this.currentFontScaleIndex === FONT_SCALES.length - 1 ? '0.4' : '1';
    }
    try {
      localStorage?.setItem('waterball_monitor_font_scale', scale.id);
    } catch (_) {}
  }

  close() {
    this.cancelEdit();
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
    }
    this.onFocusTerminal?.();
  }

  startEdit(rule) {
    if (!rule) return;
    this.editingRuleId = rule.id;
    if (this.inputBoard) this.inputBoard.value = rule.board || '';
    if (this.inputKeywords) {
      this.inputKeywords.value = Array.isArray(rule.keywords) ? rule.keywords.join(', ') : (rule.keywords || '');
    }
    if (this.inputAuthor) this.inputAuthor.value = rule.author || '';
    if (this.inputPushes) this.inputPushes.value = String(rule.minPushes || 0);

    if (this.addRuleBtn) {
      this.addRuleBtn.textContent = '💾 儲存修改';
    }
    if (this.cancelEditBtn) {
      this.cancelEditBtn.classList.remove('hidden');
    }
    if (this.inputBoard) {
      this.inputBoard.focus();
    }
    this.renderRules();
    this.onShowToast(`正在修改 [${rule.board}] 追蹤規則`);
  }

  cancelEdit() {
    this.editingRuleId = null;
    if (this.inputBoard) this.inputBoard.value = '';
    if (this.inputKeywords) this.inputKeywords.value = '';
    if (this.inputAuthor) this.inputAuthor.value = '';
    if (this.inputPushes) this.inputPushes.value = '0';

    if (this.addRuleBtn) {
      this.addRuleBtn.textContent = '➕ 新增追蹤規則';
    }
    if (this.cancelEditBtn) {
      this.cancelEditBtn.classList.add('hidden');
    }
    this.renderRules();
  }

  switchTab(tab) {
    const normalizedTab = tab === 'cloud' ? 'telegram' : tab;
    const tabs = [
      { id: 'history', btn: this.tabHistoryBtn, pane: this.paneHistory },
      { id: 'rules', btn: this.tabRulesBtn, pane: this.paneRules },
      { id: 'telegram', btn: this.tabTelegramBtn, pane: this.paneTelegram },
    ];

    tabs.forEach((t) => {
      if (t.id === normalizedTab) {
        t.btn?.classList.add('active');
        t.pane?.classList.remove('hidden');
      } else {
        t.btn?.classList.remove('active');
        t.pane?.classList.add('hidden');
      }
    });

    if (normalizedTab === 'history') {
      this.manager.markAllRead();
      this.updateToolbarBadge();
    } else if (normalizedTab === 'telegram') {
      this.loadTelegramForm();
    }
  }

  isOfficialForm() {
    const url = String(this.cloudUrlInput?.value || DEFAULT_OFFICIAL_WORKER_URL).trim().replace(/\/+$/, '').replace(/\/sync$/, '');
    return url === DEFAULT_OFFICIAL_WORKER_URL || (this.manager.cloudSyncConfig.serverMode === 'official' && url === this.manager.cloudSyncConfig.workerUrl);
  }
  confirmOfficial(message) {
    const dialog = document.getElementById('monitor-cloud-confirm');
    if (!dialog || dialog.open || typeof dialog.showModal !== 'function') return Promise.resolve(false);
    return new Promise(resolve => {
      const listeners = new AbortController();
      const finish = accepted => { listeners.abort(); dialog.close(); resolve(accepted); };
      document.getElementById('monitor-cloud-confirm-text').textContent = message;
      document.getElementById('monitor-cloud-confirm-accept').addEventListener('click', () => finish(true), { signal: listeners.signal });
      document.getElementById('monitor-cloud-confirm-cancel').addEventListener('click', () => finish(false), { signal: listeners.signal });
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); }, { signal: listeners.signal });
      dialog.showModal();
    });
  }
  resolveCloudMerge(plan) {
    const dialog = document.getElementById('monitor-cloud-confirm');
    const container = document.getElementById('monitor-cloud-merge-choices');
    if (!dialog || !container || dialog.open || typeof dialog.showModal !== 'function') return Promise.resolve(null);
    return new Promise(resolve => {
      const listeners = new AbortController(), accept = document.getElementById('monitor-cloud-confirm-accept');
      const finish = value => { listeners.abort(); accept.disabled = false; container.replaceChildren(); container.hidden = true; dialog.close(); resolve(value); };
      document.getElementById('monitor-cloud-confirm-text').textContent = '不同規則及欄位已自動合併。請選擇衝突欄位；停用／刪除與修改不會自動互相覆蓋。';
      container.replaceChildren(); container.hidden = false;
      const selectors = []; let checks = [], boardKey = '';
      const value = v => v === null ? '刪除／停用' : Array.isArray(v) ? v.join('、') || '不限' : typeof v === 'object' ? `[${v.board}] 關鍵字：${v.keywords?.join('、') || '不限'}；作者：${v.author || '不限'}；至少 ${v.minPushes} 推` : typeof v === 'boolean' ? v ? '開啟' : '關閉' : String(v);
      const fields = { '$rule': '整筆規則', keywords: '關鍵字', board: '看板', author: '作者', minPushes: '推數門檻', enabled: '勾選', silent: 'Telegram 靜音' };
      for (const conflict of plan.conflicts) {
        const label = document.createElement('label'), select = document.createElement('select');
        const rule = plan.localRules.find(r => r.id === conflict.id) || plan.remote.rules.find(r => r.id === conflict.id);
        label.textContent = `${rule ? `[${rule.board}] 關鍵字：${rule.keywords?.join('、') || '不限'}` : '通知設定'} · ${fields[conflict.field] || conflict.field}`;
        for (const [key, text] of [['', '請選擇'], ['local', `本機：${value(conflict.local)}`], ['remote', `雲端：${value(conflict.remote)}`]]) {
          const option = document.createElement('option'); option.value = key; option.textContent = text; select.append(option);
        }
        label.append(select); container.append(label); selectors.push({ key: conflict.key, select });
      }
      const count = document.createElement('p'); container.append(count);
      const boardChoices = document.createElement('div'); container.append(boardChoices);
      const update = () => {
        const choices = Object.fromEntries(selectors.filter(s => s.select.value).map(s => [s.key, s.select.value]));
        const resolved = makeMergePlan(plan.baseline, plan.localRules, plan.localSilent, plan.remote, plan.origin, choices);
        const showBoards = plan.quotaExceeded || resolved.quotaExceeded;
        const key = showBoards ? JSON.stringify(resolved.boards) : '';
        if (key !== boardKey) {
          const previous = new Map(checks.map(c => [c.board, c.cb.checked]));
          boardKey = key; checks = []; boardChoices.replaceChildren();
          if (showBoards) {
            const title = document.createElement('p'); title.textContent = `最多 ${plan.maxBoards} 板、100 條生效規則。取消的看板會保留為此裝置未勾選備用規則。`; boardChoices.append(title);
            for (const board of resolved.boards) {
              const label = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = previous.get(board) ?? true;
              label.append(cb, document.createTextNode(board)); boardChoices.append(label); checks.push({ board, cb });
            }
          }
        }
        const selected = checks.length ? checks.filter(c => c.cb.checked).map(c => c.board) : resolved.boards;
        const rules = resolved.rules.filter(r => selected.includes(r.board.toLowerCase())).length;
        count.textContent = `選取 ${selected.length} / ${plan.maxBoards} 板，${rules} / 100 條規則`;
        accept.disabled = selectors.some(s => !s.select.value) || selected.length > plan.maxBoards || rules > 100;
      };
      container.addEventListener('change', update, { signal: listeners.signal }); update();
      accept.addEventListener('click', () => {
        if (accept.disabled) return;
        finish({ plan, choices: Object.fromEntries(selectors.map(s => [s.key, s.select.value])), ...(checks.length ? { selectedBoards: checks.filter(c => c.cb.checked).map(c => c.board) } : {}) });
      }, { signal: listeners.signal });
      document.getElementById('monitor-cloud-confirm-cancel').addEventListener('click', () => finish(null), { signal: listeners.signal });
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); }, { signal: listeners.signal });
      dialog.showModal();
    });
  }
  async runOfficial(operation) {
    if (this.officialBusy) return;
    if (this.editingRuleId && ['pair', 'read', 'restore', 'merge'].includes(operation)) {
      this.showTelegramStatus('error', '請先儲存或取消正在編輯的規則，再下載或還原雲端設定。'); return;
    }
    const m = this.manager, previous = m.getCloudSyncConfig();
    const workerUrl = String(this.cloudUrlInput?.value || DEFAULT_OFFICIAL_WORKER_URL).trim();
    if (['apply', 'merge'].includes(operation) && !previous.deviceToken) { this.showTelegramStatus('error', '請先配對並讀取雲端設定，再同步規則。'); return; }
    if (operation === 'rebind' && !previous.deviceToken) { this.showTelegramStatus('error', '必須先配對原服務，才能更換 Telegram。'); return; }
    const code = String(this.tgChatIdInput?.value || '').trim();
    const newCode = String(this.rebindCodeInput?.value || '').trim();
    if (operation === 'pair' && !code.startsWith('WB2-')) { this.showTelegramStatus('error', '請填入官方 Bot 提供的單次配對碼。'); return; }
    if (operation === 'rebind' && !newCode.startsWith('WB2-')) { this.showTelegramStatus('error', '請填入新 Telegram 的單次配對碼。'); return; }
    if (operation === 'apply' && !(await this.confirmOfficial('將以目前規則整份取代所有裝置共用的雲端規則。是否套用？'))) return;
    if (operation === 'rebind' && !(await this.confirmOfficial('將保留規則與權益，改綁新 Telegram；其他裝置需要重新配對。是否更換？'))) return;
    this.officialBusy = true;
    for (const button of [this.tgSaveBtn, this.cloudSyncBtn, this.cloudReadBtn, this.cloudRestoreBtn, this.cloudReplaceBtn, this.rebindBtn, this.cloudDraftBtn]) if (button) button.disabled = true;
    try {
      if (this.localNotifInput) m.setLocalNotifEnabled(Boolean(this.localNotifInput.checked));
      m.saveCloudSyncConfig({ ...previous, workerUrl, autoSync: false });
      if (['apply', 'merge'].includes(operation) && this.tgSilentInput) m.saveTelegramConfig({ ...m.getTelegramConfig(), silent: Boolean(this.tgSilentInput.checked) }, { sync: false });
      let result = operation === 'restore' ? { success: true, restoreRequired: true } : await m.syncToCloud({ userInitiated: true, operation: operation === 'apply' || operation === 'lifecycle' ? undefined : operation, ...(operation === 'pair' ? { pairingCode: code } : {}), ...(operation === 'rebind' ? { newPairingCode: newCode } : {}), ...(operation === 'lifecycle' ? { lifecycleAction: this.tgEnabledInput?.checked ? 'resume' : 'pause' } : {}) });
      if (operation === 'merge' && result.baselineRequired && await this.confirmOfficial('此裝置尚未完成首次同步。是否保留兩邊的規則作首次合併？同一筆規則內容不同時仍需選擇，不會自動刪除雲端原有規則。')) result = await m.syncToCloud({ operation: 'merge', userInitiated: true, bootstrapMerge: true });
      if (operation === 'merge' && result.mergeRequired) {
        const resolution = await this.resolveCloudMerge(result.plan);
        if (resolution) result = await m.syncToCloud({ operation: 'merge', userInitiated: true, resolution, bootstrapMerge: result.plan.baseline.revision === 0 && !m.getSyncBaseline() });
      }
      if (result.success && result.restoreRequired) {
        const preview = m.getCloudRestorePreview();
        if (preview && await this.confirmOfficial(describeRestorePreview(preview))) result = m.applyCloudRestore(preview);
        else result = { ...result, message: '雲端設定已下載，本機規則保持不變；可稍後按「預覽並還原」' };
      }
      this.loadTelegramForm(); this.renderRules();
      if (result.success && operation === 'rebind' && this.rebindCodeInput) this.rebindCodeInput.value = '';
      const message = result.success ? result.warning || (operation === 'pair' ? result.message || '配對成功，已讀取雲端設定；雲端規則未變更。' : operation === 'apply' ? result.message || '已套用到雲端。' : operation === 'rebind' ? 'Telegram 已更換；其他裝置需要重新配對。' : result.message || '操作完成。') : result.message || '操作失敗，本機草稿保留。';
      this.showTelegramStatus(result.success ? 'success' : 'error', message);
    } catch (e) { this.showTelegramStatus('error', `操作未確認：${e.message}。請重新配對或讀取雲端狀態確認，勿自動重送。`); }
    finally { this.officialBusy = false; for (const button of [this.tgSaveBtn, this.cloudSyncBtn, this.cloudReadBtn, this.cloudRestoreBtn, this.cloudReplaceBtn, this.rebindBtn, this.cloudDraftBtn]) if (button) button.disabled = false; }
  }
  loadTelegramForm() {
    if (this.localNotifInput) {
      this.localNotifInput.checked = Boolean(this.manager.isLocalNotifEnabled());
    }
    const config = this.manager.getTelegramConfig();
    if (this.tgEnabledInput) this.tgEnabledInput.checked = Boolean(config.enabled);
    if (this.tgTokenInput) this.tgTokenInput.value = config.botToken || '';
    if (this.tgChatIdInput) this.tgChatIdInput.value = config.chatId || '';
    if (this.tgSilentInput) this.tgSilentInput.checked = Boolean(config.silent);
    if (this.tgStatusEl) {
      this.tgStatusEl.className = 'tg-status-banner hidden';
      this.tgStatusEl.textContent = '';
    }
    this.loadCloudForm();
  }

  showTelegramStatus(type, msg) {
    if (!this.tgStatusEl) return;
    this.tgStatusEl.className = `tg-status-banner ${type}`;
    this.tgStatusEl.textContent = msg;
    this.tgStatusEl.classList.remove('hidden');
    try {
      this.tgStatusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch {}
    if (msg && typeof this.onShowToast === 'function') {
      this.onShowToast(msg);
    }
  }

  loadCloudForm() {
    const config = this.manager.getCloudSyncConfig();
    const tgConfig = this.manager.getTelegramConfig();
    if (this.cloudEnabledInput) this.cloudEnabledInput.checked = Boolean(config.enabled);
    if (this.cloudUrlInput) this.cloudUrlInput.value = config.workerUrl || DEFAULT_OFFICIAL_WORKER_URL;
    if (this.cloudSecretInput) {
      const secret = config.syncSecret === config.deviceToken ? '' : config.syncSecret || '';
      this.cloudSecretInput.value = secret && secret !== tgConfig.chatId ? secret : '';
    }
    const official = this.isOfficialForm();
    if (this.cloudAutoSyncInput) { this.cloudAutoSyncInput.checked = !official && Boolean(config.autoSync); this.cloudAutoSyncInput.disabled = official; }
    if (this.cloudSyncBtn) this.cloudSyncBtn.textContent = official ? '☁️ 合併並同步規則' : '🔄 手動立即同步規則';
    if (this.cloudReplaceBtn) this.cloudReplaceBtn.hidden = !official;
    if (this.cloudAutoMergeInput) { this.cloudAutoMergeInput.checked = Boolean(config.autoMerge); this.cloudAutoMergeInput.disabled = !official || !config.deviceToken; this.cloudAutoMergeInput.closest('label').hidden = !official; }
    if (this.tgSaveBtn) this.tgSaveBtn.textContent = official ? (config.deviceToken ? '💾 更新雲端啟用／暫停狀態' : '🔑 配對並讀取雲端設定') : '💾 儲存並同步推播設定';
    if (this.cloudReadBtn) this.cloudReadBtn.hidden = false;
    if (this.cloudRestoreBtn) this.cloudRestoreBtn.hidden = !config.restorePending;
    if (this.cloudDraftBtn) this.cloudDraftBtn.hidden = !this.manager.getLocalRulesBackup();
    if (this.tgChatIdInput) {
      if (official && config.deviceToken) {
        this.tgChatIdInput.readOnly = true;
        this.tgChatIdInput.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
        this.tgChatIdInput.style.cursor = 'default';
        this.tgChatIdInput.title = '官方推播已成功綁定此 Telegram 帳號。若要更換綁定，請點擊下方「更換綁定」按鈕。';
      } else {
        this.tgChatIdInput.readOnly = false;
        this.tgChatIdInput.style.backgroundColor = '';
        this.tgChatIdInput.style.cursor = '';
        this.tgChatIdInput.title = '';
      }
    }
    if (this.rebindBtn) this.rebindBtn.disabled = !official || !config.deviceToken;
    const summary = document.getElementById('monitor-cloud-summary');
    if (summary) summary.textContent = config.requiresPairing ? '綁定已變更或憑證失效，請重新配對。本機草稿保留。' : config.remoteConfig ? `Telegram：${config.remoteConfig.telegram.chatId}｜雲端版本 ${config.configRevision}｜${config.remoteConfig.rules.length} 條規則｜${config.serverStatus}${config.mergeBlocked ? `｜同步已暫停：${config.mergeBlocked}` : config.restorePending ? '｜雲端規則已下載，等待還原確認' : config.dirty ? '｜本機有未同步草稿' : ''}${config.pendingRequest ? '｜前次操作結果待確認' : ''}` : '尚未讀取雲端設定；配對與下載不會上傳規則。';
    if (this.cloudStatusEl) {
      this.cloudStatusEl.className = 'tg-status-banner hidden';
      this.cloudStatusEl.textContent = '';
    }
  }

  showCloudStatus(type, msg) {
    if (!this.cloudStatusEl) return;
    this.cloudStatusEl.className = `tg-status-banner ${type}`;
    this.cloudStatusEl.textContent = msg;
    this.cloudStatusEl.classList.remove('hidden');
    try {
      this.cloudStatusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch {}
    if (msg && typeof this.onShowToast === 'function') {
      this.onShowToast(msg);
    }
  }

  generateRandomSecret() {
    if (!globalThis.crypto?.getRandomValues) {
      this.showCloudStatus('error', '此環境無安全亂數來源，請自行建立至少 32 字元的同步密鑰。');
      return '';
    }
    return [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  updateToolbarBadge() {
    const unread = this.manager.getUnreadCount();
    if (this.unreadBadge) {
      if (unread > 0) {
        this.unreadBadge.textContent = unread > 99 ? '99+' : String(unread);
        this.unreadBadge.classList.remove('hidden');
      } else {
        this.unreadBadge.classList.add('hidden');
      }
    }
    if (this.historyCount) {
      this.historyCount.textContent = String(this.manager.getHistory().length);
    }
    const subscribedBoards = this.manager.getSubscribedBoards();
    if (this.rulesCount) {
      this.rulesCount.textContent = String(subscribedBoards.length);
    }
    if (this.boardsCount) {
      this.boardsCount.textContent = String(subscribedBoards.length);
    }
    const syncNote = document.getElementById('monitor-sync-note');
    if (syncNote) {
      const c = this.manager.getCloudSyncConfig();
      syncNote.textContent = c.pendingAction === 'pause' ? '本機已關閉；雲端暫停尚待確認。' : c.mergeBlocked ? `同步已暫停：${c.mergeBlocked}` : c.conflict ? '雲端設定或狀態已變更，請到推播設定重新確認。' : c.lastError ? `雲端操作尚未確認：${c.lastError}` : c.restorePending ? '雲端規則已下載；請到推播設定預覽並確認還原。' : c.serverMode === 'official' && c.dirty ? c.autoMerge ? '規則已存本機；等待合併同步，離線時保留修改。' : '規則已存本機；請手動合併同步，或開啟自動同步。' : c.enabled && c.dirty ? '設定已存本機；雲端同步中或待網路恢復。' : c.enabled && ['expired', 'paused'].includes(c.serverStatus) ? `雲端目前${c.serverStatus === 'expired' ? '已到期' : '已暫停'}，請明確續用或恢復。` : '';
      syncNote.classList.toggle('hidden', !syncNote.textContent);
    }
  }

  renderHistory() {
    if (!this.historyList) return;
    this.historyList.innerHTML = '';

    const rawHistory = this.manager.getHistory();
    const history = rawHistory.filter((item) => {
      if (!item || !item.link) return false;
      const strLink = String(item.link);
      const strId = String(item.id || '');
      if (strLink.includes('cdn-cgi') || strId.startsWith('content?')) return false;
      if (item.title === '批踢踢實業坊' && (!item.author || item.author === '-')) return false;
      return true;
    });

    if (history.length === 0) {
      this.historyList.innerHTML = `
        <div class="monitor-empty-box">
          <div style="font-size: 32px; margin-bottom: 8px;">🔔</div>
          <div style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">目前尚無新文章推播紀錄</div>
          <div style="font-size: 12px; color: var(--text-secondary);">請切換至「追蹤規則與看板」新增您感興趣的看板與關鍵字。</div>
        </div>
      `;
      return;
    }

    history.forEach((item) => {
      const card = document.createElement('div');
      card.className = `monitor-history-card ${item.isRead ? 'read' : 'unread'}`;

      let nrecClass = 'nrec-normal';
      if (item.nrec === '爆') nrecClass = 'nrec-hot';
      else if (parseInt(item.nrec, 10) >= 10) nrecClass = 'nrec-warm';

      const fullUrl = normalizePttArticleUrl(item.link, item.board);

      card.innerHTML = `
        <div class="card-left">
          <div class="card-badges">
            <span class="board-badge">[${item.board}]</span>
            ${item.nrec ? `<span class="nrec-badge ${nrecClass}">${item.nrec}</span>` : ''}
          </div>
          <div class="card-title">${this.escapeHtml(item.title)}</div>
          <div class="card-meta">
            <span class="card-author">✍️ ${item.author}</span>
            <span class="card-time">🕒 ${item.timeStr || item.date}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-read" title="以圖文好讀模式觀看">📖 好讀版</button>
          <button class="btn-board" title="終端機切換至看板">💻 進板</button>
          <button class="btn-copy" title="複製文章連結">🔗 複製</button>
        </div>
      `;

      // Read button
      card.querySelector('.btn-read')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        this.onOpenArticleReader(fullUrl);
      });

      // Jump to board in terminal
      card.querySelector('.btn-board')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        this.onSwitchBoard(item.board);
      });

      // Copy URL
      card.querySelector('.btn-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        writeClipboardText(fullUrl).catch(() => {});
        this.onShowToast('已複製文章連結');
      });

      // Click card opens reader
      card.addEventListener('click', () => {
        this.close();
        this.onOpenArticleReader(fullUrl);
      });

      this.historyList.appendChild(card);
    });
  }

  renderRules() {
    if (!this.rulesList) return;
    this.rulesList.innerHTML = '';
    this.updateToolbarBadge();

    // Check if there is a local rules backup containing previously configured rules
    const backup = this.manager.getLocalRulesBackup();
    const rules = this.manager.getRules();
    const showBackupBanner = Array.isArray(backup) && backup.length > 0 &&
      (backup.length > rules.length || backup.some(b => !rules.some(r => String(r.board || '').trim().toLowerCase() === String(b.board || '').trim().toLowerCase())));

    if (showBackupBanner) {
      const banner = document.createElement('div');
      banner.className = 'monitor-backup-banner';
      banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>📋 發現本機保留的看板規則備份（共 <b>${backup.length}</b> 條，包含先前設定的未勾選看板）</span>
        </div>
        <button type="button" class="btn-primary btn-restore-draft" style="padding: 4px 12px; font-size: 12px; border-radius: 5px; cursor: pointer; flex-shrink: 0;">一鍵取回所有看板規則</button>
      `;
      banner.querySelector('.btn-restore-draft')?.addEventListener('click', () => {
        const res = this.manager.restoreCloudDraft();
        this.renderRules();
        this.updateToolbarBadge();
        this.onShowToast(res.message);
      });
      this.rulesList.appendChild(banner);
    }
    if (rules.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'monitor-empty-box';
      emptyBox.innerHTML = '<div style="font-size: 13px; color: var(--text-secondary);">尚未建立任何追蹤規則，請使用上方表單新增。</div>';
      this.rulesList.appendChild(emptyBox);
      return;
    }

    rules.forEach((rule) => {
      const card = document.createElement('div');
      const isEditing = this.editingRuleId === rule.id;
      card.className = `monitor-rule-card ${rule.enabled ? 'enabled' : 'disabled'}${isEditing ? ' is-editing' : ''}`;

      const kwChips =
        rule.keywords && rule.keywords.length > 0
          ? rule.keywords.map((k) => `<span class="rule-kw-chip">${this.escapeHtml(k)}</span>`).join('')
          : '<span class="rule-kw-chip all">全部文章</span>';

      card.innerHTML = `
        <div class="rule-card-left">
          <input type="checkbox" class="rule-toggle-cb" ${rule.enabled ? 'checked' : ''} title="啟用/停用此規則" />
          <div class="rule-details">
            <div class="rule-board-name">[${this.escapeHtml(rule.board)}]</div>
            <div class="rule-keywords-row">${kwChips}</div>
            <div class="rule-sub-info">
              ${rule.author ? `<span>作者: <b>${this.escapeHtml(rule.author)}</b></span>` : '<span>作者: 不限</span>'}
              <span>門檻: ${rule.minPushes > 0 ? `≥ ${rule.minPushes} 推` : '不限推文'}</span>
            </div>
          </div>
        </div>
        <div class="rule-card-right">
          <button class="rule-btn-edit" title="編輯此規則">✏️</button>
          <button class="rule-btn-delete" title="刪除此規則">🗑️</button>
        </div>
      `;

      card.querySelector('.rule-toggle-cb')?.addEventListener('change', (e) => {
        const ok = this.manager.toggleRule(rule.id);
        if (!ok) {
          e.target.checked = Boolean(rule.enabled);
          this.onShowToast(this.manager.lastError || '最多只能同時勾選訂閱 10 個不同看板');
          return;
        }
        this.renderRules();
        this.updateToolbarBadge();
      });

      card.querySelector('.rule-btn-edit')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startEdit(rule);
      });

      card.querySelector('.rule-btn-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.editingRuleId === rule.id) {
          this.cancelEdit();
        }
        this.manager.deleteRule(rule.id);
        this.renderRules();
        this.updateToolbarBadge();
        this.onShowToast(`已刪除 [${rule.board}] 追蹤規則`);
      });

      this.rulesList.appendChild(card);
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export const articleMonitorUI = typeof document !== 'undefined' ? new ArticleMonitorUI() : null;
