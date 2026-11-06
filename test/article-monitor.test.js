import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ArticleMonitorManager,
  formatTelegramArticleMessage,
  normalizePttArticleUrl,
  isValidDiscordWebhookUrl,
  normalizeDiscordWebhookUrl,
  formatDiscordArticlePayload,
  createDiscordTestPayload,
} from '../src/article_monitor.js';

class MockStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.get(key) || null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
}

test('ArticleMonitorManager manages rules correctly', () => {
  const storage = new MockStorage();
  const manager = new ArticleMonitorManager(storage);

  assert.equal(manager.getRules().length, 2);

  const rule = manager.addRule({
    board: 'HardwareSale',
    keywords: ['顯卡', '4070'],
    author: '',
    minPushes: 0,
  });

  assert.ok(rule.id);
  assert.equal(rule.board, 'HardwareSale');
  assert.deepEqual(rule.keywords, ['顯卡', '4070']);
  assert.equal(manager.getRules().length, 3);

  manager.toggleRule(rule.id);
  assert.equal(manager.getRules().find((r) => r.id === rule.id).enabled, false);

  manager.updateRule(rule.id, { minPushes: 5 });
  assert.equal(manager.getRules().find((r) => r.id === rule.id).minPushes, 5);

  manager.deleteRule(rule.id);
  assert.equal(manager.getRules().length, 2);
});

test('ArticleMonitorManager matches articles based on keywords, author, and pushes', () => {
  const manager = new ArticleMonitorManager(new MockStorage());

  const rule = {
    id: 'r1',
    board: 'Stock',
    keywords: ['情報', '營收'],
    author: 'analyst',
    minPushes: 10,
    enabled: true,
  };

  // Positive match
  const matchingArticle = {
    id: 'art1',
    board: 'Stock',
    title: '[情報] 2330 台積電9月營收公布',
    author: 'analyst',
    nrec: '15',
  };
  assert.equal(manager.matchesRule(matchingArticle, rule), true);

  // Author mismatch
  assert.equal(manager.matchesRule({ ...matchingArticle, author: 'other' }, rule), false);

  // Keyword mismatch
  assert.equal(manager.matchesRule({ ...matchingArticle, title: '[新聞] 美股大漲' }, rule), false);

  // Push count below threshold
  assert.equal(manager.matchesRule({ ...matchingArticle, nrec: '5' }, rule), false);

  // Push count '爆' satisfies minPushes
  assert.equal(manager.matchesRule({ ...matchingArticle, nrec: '爆' }, rule), true);

  // Disabled rule does not match
  assert.equal(manager.matchesRule(matchingArticle, { ...rule, enabled: false }), false);
});

test('ArticleMonitorManager respects baseline on first check and alerts on new articles afterwards', async () => {
  const storage = new MockStorage();

  const mockArticles = [
    { id: 'art_old_1', board: 'Stock', title: '[情報] 舊情報一', author: 'a1', nrec: '5', link: '/1' },
    { id: 'art_old_2', board: 'Stock', title: '[情報] 舊情報二', author: 'a2', nrec: '12', link: '/2' },
  ];

  let currentFeed = [...mockArticles];
  const mockFetch = async () => currentFeed;

  const manager = new ArticleMonitorManager(storage, mockFetch);
  // Keep only Stock rule with keyword [情報]
  manager.rules = [
    { id: 'r_stock', board: 'Stock', keywords: ['情報'], author: '', minPushes: 0, enabled: true },
  ];

  // 1. First check: establishes baseline, should NOT fire alert for existing articles
  const firstAlerts = await manager.checkBoard('Stock');
  assert.equal(firstAlerts.length, 0);
  assert.equal(manager.getHistory().length, 0);

  // 2. New matching article arrives
  const newArticle = { id: 'art_new_1', board: 'Stock', title: '[情報] 最新台積電重磅情報', author: 'hero', nrec: '8', link: '/3' };
  currentFeed = [...mockArticles, newArticle];

  const secondAlerts = await manager.checkBoard('Stock');
  assert.equal(secondAlerts.length, 1);
  assert.equal(secondAlerts[0].id, 'art_new_1');
  assert.equal(manager.getHistory().length, 1);
  assert.equal(manager.getUnreadCount(), 1);

  // 3. Duplicate check without new articles should yield zero alerts
  const thirdAlerts = await manager.checkBoard('Stock');
  assert.equal(thirdAlerts.length, 0);
  assert.equal(manager.getHistory().length, 1);

  // 4. Mark all as read
  manager.markAllRead();
  assert.equal(manager.getUnreadCount(), 0);
});

test('formatTelegramArticleMessage formats HTML and escapes reserved characters', () => {
  const item = {
    board: 'Stock',
    title: '[情報] 2330 台積電 & 聯電 <最新法說>',
    author: 'market_watch',
    nrec: '爆',
    link: 'https://www.ptt.cc/bbs/Stock/M.123456.html',
  };

  const message = formatTelegramArticleMessage(item);
  assert.ok(message.includes('【Waterball PTT 文章追蹤通知】'));
  assert.ok(message.includes('<b>看板</b>：#Stock'));
  assert.ok(message.includes('&amp; 聯電 &lt;最新法說&gt;'));
  assert.ok(message.includes('<b>推文</b>：爆推'));
  assert.ok(message.includes('<a href="https://www.ptt.cc/bbs/Stock/M.123456.html">'));
});

test('ArticleMonitorManager persists and loads Telegram config', () => {
  const storage = new MockStorage();
  const manager = new ArticleMonitorManager(storage);

  assert.deepEqual(manager.getTelegramConfig(), {
    enabled: false,
    botToken: '',
    chatId: '',
    silent: false,
  });

  manager.saveTelegramConfig({
    enabled: true,
    botToken: '123456:ABC-DEF',
    chatId: '987654321',
    silent: true,
  });

  assert.deepEqual(manager.getTelegramConfig(), {
    enabled: true,
    botToken: '123456:ABC-DEF',
    chatId: '987654321',
    silent: true,
  });

  // Verify reload from storage
  const manager2 = new ArticleMonitorManager(storage);
  assert.deepEqual(manager2.getTelegramConfig(), {
    enabled: true,
    botToken: '123456:ABC-DEF',
    chatId: '987654321',
    silent: true,
  });
});

test('ArticleMonitorManager forwards alert to Telegram when enabled', async () => {
  const storage = new MockStorage();
  const sentMessages = [];

  const mockTelegramSend = async (botToken, chatId, text, silent, buttonUrl, buttonText) => {
    sentMessages.push({ botToken, chatId, text, silent, buttonUrl, buttonText });
    return { success: true, message: 'ok' };
  };

  let currentFeed = [
    { id: 'art_old', board: 'Lifeismoney', title: '特賣', author: 'u1', nrec: '10', link: '/1' },
  ];
  const mockFetch = async () => currentFeed;

  const manager = new ArticleMonitorManager(storage, mockFetch, mockTelegramSend);
  manager.rules = [
    { id: 'r1', board: 'Lifeismoney', keywords: ['特價'], author: '', minPushes: 0, enabled: true },
  ];

  // Configure Telegram
  manager.saveTelegramConfig({
    enabled: true,
    botToken: 'bot123456:test_token', // test auto-strip of 'bot' prefix
    chatId: 'test_chat_id',
    silent: false,
  });

  // 1. Establish baseline
  await manager.checkBoard('Lifeismoney');
  assert.equal(sentMessages.length, 0);

  // 2. Incoming new article
  currentFeed = [
    ...currentFeed,
    { id: 'art_new', board: 'Lifeismoney', title: '[情報] 超市特價買一送一', author: 'shopper', nrec: '15', link: '/2' },
  ];

  await manager.checkBoard('Lifeismoney');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].botToken, '123456:test_token');
  assert.equal(sentMessages[0].chatId, 'test_chat_id');
  assert.ok(sentMessages[0].text.includes('超市特價買一送一'));
  assert.equal(sentMessages[0].buttonUrl, 'https://www.ptt.cc/2');
  assert.equal(sentMessages[0].buttonText, '📖 開啟 PTT 好讀版');

  // 3. testTelegram sends verification message with normalization
  const testRes = await manager.testTelegram('https://api.telegram.org/bot123456:test_token/sendMessage', 'test_chat_id');
  assert.equal(testRes.success, true);
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[1].botToken, '123456:test_token');
  assert.ok(sentMessages[1].text.includes('連線測試成功'));
});

test('isValidDiscordWebhookUrl and normalizeDiscordWebhookUrl validate and sanitize URLs correctly', () => {
  // Valid Discord Webhook URLs
  assert.equal(isValidDiscordWebhookUrl('https://discord.com/api/webhooks/123456789/abcdef_gh-123'), true);
  assert.equal(isValidDiscordWebhookUrl('https://discordapp.com/api/webhooks/987654321/secret_token'), true);
  assert.equal(isValidDiscordWebhookUrl('https://ptb.discord.com/api/webhooks/111222333/canary_token'), true);
  assert.equal(isValidDiscordWebhookUrl('https://canary.discord.com/api/webhooks/444555666/canary_token'), true);

  // Normalization strips query params and extra trailing slashes
  assert.equal(
    normalizeDiscordWebhookUrl('https://discord.com/api/webhooks/123456789/abcdef?wait=true'),
    'https://discord.com/api/webhooks/123456789/abcdef'
  );

  // Invalid: non-https
  assert.equal(isValidDiscordWebhookUrl('http://discord.com/api/webhooks/123/abc'), false);
  assert.equal(normalizeDiscordWebhookUrl('http://discord.com/api/webhooks/123/abc'), '');

  // Invalid: evil domains
  assert.equal(isValidDiscordWebhookUrl('https://evil-discord.com/api/webhooks/123/abc'), false);
  assert.equal(isValidDiscordWebhookUrl('https://discord.com.attacker.com/api/webhooks/123/abc'), false);

  // Invalid: wrong path
  assert.equal(isValidDiscordWebhookUrl('https://discord.com/api/users/@me'), false);
  assert.equal(isValidDiscordWebhookUrl('https://discord.com/api/webhooks/'), false);

  // Invalid: empty or non-string
  assert.equal(isValidDiscordWebhookUrl(''), false);
  assert.equal(isValidDiscordWebhookUrl(null), false);
  assert.equal(isValidDiscordWebhookUrl(undefined), false);
});

test('formatDiscordArticlePayload builds correct embed structure and dynamic colors', () => {
  // Test 爆文 (Gold: 0xF1C40F)
  const itemGold = { board: 'Stock', title: '台積電法說會大爆發', author: 'analyst', nrec: '爆', link: '/bbs/Stock/1.html' };
  const payloadGold = formatDiscordArticlePayload(itemGold);
  assert.equal(payloadGold.username, 'Waterball 水球');
  assert.ok(payloadGold.embeds.length === 1);
  assert.equal(payloadGold.embeds[0].title, '台積電法說會大爆發');
  assert.equal(payloadGold.embeds[0].color, 0xF1C40F);
  assert.equal(payloadGold.embeds[0].fields[0].value, '[Stock](https://www.ptt.cc/bbs/Stock/index.html)');
  assert.equal(payloadGold.embeds[0].fields[1].value, 'analyst');
  assert.equal(payloadGold.embeds[0].fields[2].value, '爆推');

  // Test 噓文 (Red: 0xE74C3C)
  const itemRed = { board: 'Gossiping', title: '爭議事件報導', author: 'someone', nrec: 'XX', link: '/bbs/Gossiping/2.html' };
  const payloadRed = formatDiscordArticlePayload(itemRed);
  assert.equal(payloadRed.embeds[0].color, 0xE74C3C);

  // Test 普通推文 (Green: 0x2ECC71)
  const itemGreen = { board: 'Lifeismoney', title: '特價優惠情報', author: 'buyer', nrec: '35', link: '/bbs/Lifeismoney/3.html' };
  const payloadGreen = formatDiscordArticlePayload(itemGreen);
  assert.equal(payloadGreen.embeds[0].color, 0x2ECC71);

  // Test 0推或無推文 (Blue: 0x3498DB)
  const itemBlue = { board: 'C_Chat', title: '新番閒聊', author: 'otaku', nrec: '', link: '/bbs/C_Chat/4.html' };
  const payloadBlue = formatDiscordArticlePayload(itemBlue);
  assert.equal(payloadBlue.embeds[0].color, 0x3498DB);

  // Test createDiscordTestPayload
  const testPayload = createDiscordTestPayload();
  assert.ok(testPayload.embeds[0].title.includes('測試成功'));
});

test('ArticleMonitorManager persists and loads Discord config', () => {
  const storage = new MockStorage();
  const manager = new ArticleMonitorManager(storage);

  assert.deepEqual(manager.getDiscordConfig(), { enabled: false, webhookUrl: '' });

  manager.saveDiscordConfig({
    enabled: true,
    webhookUrl: 'https://discord.com/api/webhooks/123456789/abcdef_token?wait=true',
  });

  // Stored URL should be normalized without query params
  const config = manager.getDiscordConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.webhookUrl, 'https://discord.com/api/webhooks/123456789/abcdef_token');

  // Reload in a new manager instance
  const manager2 = new ArticleMonitorManager(storage);
  assert.deepEqual(manager2.getDiscordConfig(), {
    enabled: true,
    webhookUrl: 'https://discord.com/api/webhooks/123456789/abcdef_token',
  });
});

test('ArticleMonitorManager forwards alert to Discord when enabled', async () => {
  const storage = new MockStorage();
  let currentFeed = [
    { id: 'art_1', board: 'Lifeismoney', title: '[情報] 舊特價情報', author: 'olduser', nrec: '10', link: '/1' },
  ];
  const sentDiscordMessages = [];

  const manager = new ArticleMonitorManager(
    storage,
    async () => currentFeed,
    null,
    null,
    async (webhookUrl, payload) => {
      sentDiscordMessages.push({ webhookUrl, payload });
      return { success: true, message: 'ok' };
    }
  );

  manager.addRule({ board: 'Lifeismoney', keywords: ['[情報]'] });

  // 1. Initial baseline check
  await manager.checkBoard('Lifeismoney');
  assert.equal(sentDiscordMessages.length, 0);

  // 2. Enable Discord Webhook
  manager.saveDiscordConfig({
    enabled: true,
    webhookUrl: 'https://discord.com/api/webhooks/123456789/my_webhook',
  });

  // Add new matching article
  currentFeed = [
    ...currentFeed,
    { id: 'art_new', board: 'Lifeismoney', title: '[情報] 買一送一超值優惠', author: 'saver', nrec: '12', link: '/2' },
  ];

  await manager.checkBoard('Lifeismoney');
  assert.equal(sentDiscordMessages.length, 1);
  assert.equal(sentDiscordMessages[0].webhookUrl, 'https://discord.com/api/webhooks/123456789/my_webhook');
  assert.equal(sentDiscordMessages[0].payload.embeds[0].title, '[情報] 買一送一超值優惠');
  assert.equal(sentDiscordMessages[0].payload.embeds[0].fields[1].value, 'saver');

  // 3. Test testDiscord
  const testRes = await manager.testDiscord('https://discord.com/api/webhooks/123456789/my_webhook');
  assert.equal(testRes.success, true);
  assert.equal(sentDiscordMessages.length, 2);
  assert.ok(sentDiscordMessages[1].payload.embeds[0].title.includes('測試成功'));

  // 4. Test invalid webhook url rejection in testDiscord
  const invalidRes = await manager.testDiscord('https://attacker.com/webhook');
  assert.equal(invalidRes.success, false);
  assert.ok(invalidRes.message.includes('正確的 Discord Webhook 網址'));
});

test('ArticleMonitorManager sendDiscordRawMessage fallback works with fetch', async () => {
  const storage = new MockStorage();
  let fetchCall = null;
  const mockFetch = async (url, options) => {
    fetchCall = { url, options };
    return {
      status: 200,
      ok: true,
    };
  };

  const manager = new ArticleMonitorManager(storage, null, null, null, null);
  manager.customFetch = mockFetch;

  const res = await manager.sendDiscordRawMessage(
    'https://discord.com/api/webhooks/123/token',
    { test: true }
  );
  assert.equal(res.success, true);
  assert.equal(fetchCall.url, 'https://discord.com/api/webhooks/123/token?wait=true');
  assert.equal(fetchCall.options.method, 'POST');
});

test('index.html integrity: all modals are properly closed and not nested', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const html = fs.readFileSync(path.resolve('index.html'), 'utf8');

  // Verify none of the key modals are nested inside another modal
  const modalIds = [
    'settings-modal',
    'push-modal',
    'waterball-modal',
    'user-tag-modal',
    'article-monitor-modal',
  ];

  for (const modalId of modalIds) {
    const modalPattern = new RegExp(`<div[^>]*id=["']${modalId}["'][^>]*>`, 'i');
    assert.ok(modalPattern.test(html), `Expected modal #${modalId} in index.html`);
  }

  // Verify waterball-modal is closed before article-monitor-modal
  const waterballIdx = html.indexOf('id="waterball-modal"');
  const monitorIdx = html.indexOf('id="article-monitor-modal"');
  assert.ok(waterballIdx > 0 && monitorIdx > 0);
  assert.ok(monitorIdx > waterballIdx);

  // Substring between waterball and article-monitor must balance all open/close divs
  const between = html.slice(waterballIdx, monitorIdx);
  const openDivs = (between.match(/<div\b/gi) || []).length;
  const closeDivs = (between.match(/<\/div>/gi) || []).length;
  assert.equal(
    openDivs,
    closeDivs,
    `waterball-modal must be fully closed before article-monitor-modal begins (open: ${openDivs}, close: ${closeDivs})`
  );
});

test('normalizePttArticleUrl normalizes relative, full, and duplicated URLs properly', () => {
  // Relative URL
  assert.equal(
    normalizePttArticleUrl('/bbs/Stock/M.123456.A.789.html', 'Stock'),
    'https://www.ptt.cc/bbs/Stock/M.123456.A.789.html'
  );
  // Full URL
  assert.equal(
    normalizePttArticleUrl('https://www.ptt.cc/bbs/Stock/M.123456.A.789.html'),
    'https://www.ptt.cc/bbs/Stock/M.123456.A.789.html'
  );
  // Duplicated prefix bug
  assert.equal(
    normalizePttArticleUrl('https://www.ptt.cchttps://www.ptt.cc/bbs/Stock/M.123456.A.789.html'),
    'https://www.ptt.cc/bbs/Stock/M.123456.A.789.html'
  );
  // Empty URL with board
  assert.equal(
    normalizePttArticleUrl('', 'Gossiping'),
    'https://www.ptt.cc/bbs/Gossiping/index.html'
  );
});

test('ArticleMonitorManager sanitizes and excludes Cloudflare honeypot trap items', () => {
  const storage = new MockStorage();
  // Pre-seed storage with corrupted honeypot history
  storage.setItem(
    'bbsterm_monitor_history',
    JSON.stringify([
      {
        id: 'content?id=trap123',
        board: 'Stock',
        title: '批踢踢實業坊',
        author: '',
        link: 'https://www.ptt.cc/cdn-cgi/content?id=trap123',
      },
      {
        id: 'M.1791535001.A.2E5',
        board: 'Stock',
        title: '[情報] 正常文章',
        author: 'analyst',
        link: '/bbs/Stock/M.1791535001.A.2E5.html',
      },
    ])
  );
  storage.setItem(
    'bbsterm_monitor_seen',
    JSON.stringify(['content?id=trap123', 'M.1791535001.A.2E5'])
  );

  const manager = new ArticleMonitorManager(storage);

  // Honeypot should be automatically purged from loaded history
  const history = manager.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].id, 'M.1791535001.A.2E5');

  // Attempting to add honeypot alert item should be rejected
  manager.addAlertItem({
    id: 'content?id=another',
    board: 'Stock',
    title: '批踢踢實業坊',
    link: '/cdn-cgi/content?id=another',
  });
  assert.equal(manager.getHistory().length, 1);
});

test('ArticleMonitorManager loads and saves Cloudflare sync config correctly', () => {
  const storage = new MockStorage();
  const manager = new ArticleMonitorManager(storage);

  // Default config
  const def = manager.getCloudSyncConfig();
  assert.equal(def.enabled, false);
  assert.equal(def.workerUrl, '');
  assert.equal(def.syncSecret, '');
  assert.equal(def.autoSync, true);
  assert.equal(def.lastSyncTime, null);

  // Save config
  manager.saveCloudSyncConfig({
    enabled: true,
    workerUrl: 'https://my-worker.subdomain.workers.dev/',
    syncSecret: 'secret12345',
    autoSync: true,
  });

  const updated = manager.getCloudSyncConfig();
  assert.equal(updated.enabled, true);
  // Trailing slash stripped
  assert.equal(updated.workerUrl, 'https://my-worker.subdomain.workers.dev');
  assert.equal(updated.syncSecret, 'secret12345');
  assert.equal(updated.autoSync, true);

  // Verify persistence
  const manager2 = new ArticleMonitorManager(storage);
  const loaded = manager2.getCloudSyncConfig();
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.workerUrl, 'https://my-worker.subdomain.workers.dev');
  assert.equal(loaded.syncSecret, 'secret12345');
});

test('ArticleMonitorManager syncToCloud triggers auto-sync on rule or Telegram changes', async () => {
  const storage = new MockStorage();
  let syncPayload = null;
  let syncCallCount = 0;

  const mockCloudSync = async (_options, payload) => {
    syncCallCount++;
    syncPayload = payload;
    return { success: true, rule_count: payload.rules.length };
  };

  const manager = new ArticleMonitorManager(storage, null, null, mockCloudSync);

  // 1. Without cloud enabled, saving rule should not trigger sync
  manager.addRule({ board: 'Baseball', keywords: ['WBC'], author: '', minPushes: 0 });
  assert.equal(syncCallCount, 0);

  // 2. Enable cloud sync
  manager.saveCloudSyncConfig({
    enabled: true,
    workerUrl: 'https://ptt-worker.workers.dev',
    syncSecret: 'abc123secret',
    autoSync: true,
  });

  // 3. Modifying rule should automatically trigger syncToCloud
  manager.addRule({ board: 'NBA', keywords: ['Curry'], author: '', minPushes: 10 });
  assert.equal(syncCallCount, 1);
  assert.ok(syncPayload);
  assert.ok(syncPayload.rules.some((r) => r.board === 'NBA'));

  // 4. Modifying Telegram settings should also trigger syncToCloud
  manager.saveTelegramConfig({
    enabled: true,
    botToken: '123456:ABC-DEF',
    chatId: '987654321',
    silent: false,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(syncCallCount, 2);
  assert.equal(syncPayload.telegram.chatId, '987654321');
  assert.equal(syncPayload.telegram.botToken, '123456:ABC-DEF');

  // 5. When autoSync is turned off, rules change should NOT trigger sync
  manager.saveCloudSyncConfig({
    enabled: true,
    workerUrl: 'https://ptt-worker.workers.dev',
    syncSecret: 'abc123secret',
    autoSync: false,
  });
  manager.addRule({ board: 'C_Chat', keywords: ['動漫'], author: '', minPushes: 0 });
  assert.equal(syncCallCount, 2); // Still 2, no extra call
});

test('ArticleMonitorManager syncToCloud validates parameters', async () => {
  const storage = new MockStorage();
  const manager = new ArticleMonitorManager(storage);

  // Missing URL
  const res1 = await manager.syncToCloud({ workerUrl: '', syncSecret: 'sec' });
  assert.equal(res1.success, false);
  assert.match(res1.message, /網址/);

  // Missing Secret / Chat ID
  const res2 = await manager.syncToCloud({ workerUrl: 'https://test.dev', syncSecret: '' });
  assert.equal(res2.success, false);
  assert.match(res2.message, /密鑰|綁定碼|配對碼/);
});

test('ArticleMonitorManager allows unlimited configured rules but enforces max 10 concurrently checked boards', () => {
  const storage = new MockStorage();
  const manager = new ArticleMonitorManager(storage, async () => []);

  // Clear default initial rules
  for (const r of manager.getRules()) {
    manager.deleteRule(r.id);
  }
  assert.equal(manager.getSubscribedBoards().length, 0);

  // Add 10 distinct boards (all enabled by default)
  const addedRules = [];
  for (let i = 1; i <= 10; i++) {
    const added = manager.addRule({ board: `Board_${i}`, keywords: ['test'] });
    assert.ok(added, `Should allow board #${i}`);
    assert.equal(added.enabled, true);
    addedRules.push(added);
  }
  assert.equal(manager.getSubscribedBoards().length, 10);

  // Adding another rule for an ALREADY checked board should succeed as enabled: true
  const sameBoardRule = manager.addRule({ board: 'board_1', keywords: ['second_rule'] });
  assert.ok(sameBoardRule, 'Should allow multiple rules on an already checked board');
  assert.equal(sameBoardRule.enabled, true);
  assert.equal(manager.getSubscribedBoards().length, 10);

  // Adding an 11th distinct board should still succeed, but automatically saved as unchecked (enabled: false)
  const eleventh = manager.addRule({ board: 'Board_11', keywords: ['overflow'] });
  assert.ok(eleventh, 'Should allow configuring an 11th board in the list');
  assert.equal(eleventh.enabled, false, '11th distinct board should default to unchecked');
  assert.match(manager.lastWarning, /10/);
  assert.equal(manager.getSubscribedBoards().length, 10);

  // Trying to check/enable the 11th board while 10 boards are still checked should be blocked
  const toggleFail = manager.toggleRule(eleventh.id);
  assert.equal(toggleFail, false);
  assert.match(manager.lastError, /10/);

  // Unchecking Board_2 (which only has 1 rule) reduces checked boards to 9, allowing Board_11 to be checked
  const toggleOff = manager.toggleRule(addedRules[1].id);
  assert.equal(toggleOff, true);
  assert.equal(manager.getSubscribedBoards().length, 9);

  const toggleOn = manager.toggleRule(eleventh.id);
  assert.equal(toggleOn, true);
  assert.equal(manager.getSubscribedBoards().length, 10);
});

test('ArticleMonitorManager supports Local OS Notification toggle and Official Bot test push without personal Bot Token', async () => {
  const storage = new MockStorage();
  let capturedSyncPayload = null;

  const mockCloudSync = async (_opts, payload) => {
    capturedSyncPayload = payload;
    return { success: true, message: '測試推播成功' };
  };

  const manager = new ArticleMonitorManager(storage, async () => [], null, mockCloudSync);

  // Default local OS notification is enabled
  assert.equal(manager.isLocalNotifEnabled(), true);
  manager.setLocalNotifEnabled(false);
  assert.equal(manager.isLocalNotifEnabled(), false);

  // Official Bot mode: empty botToken, only chatId pairing code + server URL
  const res = await manager.testTelegram('', '888123456-a1b2c3', 'https://official-push.workers.dev');
  assert.equal(res.success, true);
  assert.ok(capturedSyncPayload);
  assert.equal(capturedSyncPayload.sendTestPush, true);
  assert.equal(capturedSyncPayload.telegram.chatId, '888123456-a1b2c3');
});

test('ArticleMonitorManager saves and reuses deviceToken returned by server', async () => {
  const storage = new MockStorage();
  let receivedAuth = '';

  const mockFetch = async (_url, options) => {
    receivedAuth = options?.headers?.Authorization || '';
    return {
      ok: true,
      json: async () => ({
        success: true,
        token: 'dev_token_abc_123456',
        rule_count: 1,
      }),
    };
  };

  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const manager = new ArticleMonitorManager(storage);
    manager.saveCloudSyncConfig({
      enabled: true,
      workerUrl: 'https://test-worker.dev',
      syncSecret: 'WB2-init-pairing-code',
      serverMode: 'selfHosted',
      autoSync: true,
    });

    const res = await manager.syncToCloud({
      workerUrl: 'https://test-worker.dev',
      syncSecret: 'WB2-init-pairing-code',
    });

    assert.equal(res.success, true);
    assert.equal(receivedAuth, 'Bearer dev_token_abc_123456'); // /pair was completed and persisted before /sync

    // Token should now be persisted in cloudSyncConfig
    const updatedConfig = manager.getCloudSyncConfig();
    assert.equal(updatedConfig.deviceToken, 'dev_token_abc_123456');

    // Next sync should automatically use the new deviceToken
    await manager.syncToCloud({ workerUrl: 'https://test-worker.dev' });
    assert.equal(receivedAuth, 'Bearer dev_token_abc_123456');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('ArticleMonitorUI handles font scaling initialization and cycling', async () => {
  const { ArticleMonitorUI } = await import('../src/article_monitor_ui.js');
  const classList = new Set();
  const mockContentEl = {
    classList: {
      add: (cls) => classList.add(cls),
      remove: (cls) => classList.delete(cls),
      contains: (cls) => classList.has(cls),
    },
  };
  const mockModalEl = {
    querySelector: (sel) => (sel === '.monitor-modal-content' ? mockContentEl : null),
  };
  const fontValEl = { textContent: '' };
  const fontDecBtn = { disabled: false, style: {} };
  const fontIncBtn = { disabled: false, style: {} };

  const storage = new Map();
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v)),
  };

  try {
    const ui = Object.create(ArticleMonitorUI.prototype);
    ui.modalEl = mockModalEl;
    ui.fontValEl = fontValEl;
    ui.fontDecBtn = fontDecBtn;
    ui.fontIncBtn = fontIncBtn;
    ui.currentFontScaleIndex = 0;

    ui.initFontScaling();
    assert.equal(fontValEl.textContent, '標準');
    assert.equal(mockContentEl.classList.contains('font-scale-standard'), true);
    assert.equal(fontDecBtn.disabled, true);
    assert.equal(fontIncBtn.disabled, false);

    // Increase font
    ui.currentFontScaleIndex = 1;
    ui.applyFontScale();
    assert.equal(fontValEl.textContent, '舒適');
    assert.equal(mockContentEl.classList.contains('font-scale-medium'), true);
    assert.equal(storage.get('waterball_monitor_font_scale'), 'medium');

    // Increase again
    ui.currentFontScaleIndex = 2;
    ui.applyFontScale();
    assert.equal(fontValEl.textContent, '特大');
    assert.equal(mockContentEl.classList.contains('font-scale-large'), true);
    assert.equal(fontIncBtn.disabled, true);
    assert.equal(storage.get('waterball_monitor_font_scale'), 'large');

    // Reload with saved 'large'
    ui.initFontScaling();
    assert.equal(ui.currentFontScaleIndex, 2);
    assert.equal(fontValEl.textContent, '特大');
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('ArticleMonitorUI handles Discord form loading, validation and saving', async () => {
  const { ArticleMonitorUI } = await import('../src/article_monitor_ui.js');
  const storage = new MockStorage();
  const manager = new ArticleMonitorManager(storage);

  const discordEnabledInput = { checked: false };
  const discordWebhookInput = { value: '', type: 'password', focus: () => {} };
  const discordStatusEl = { className: 'hidden', textContent: '', classList: { remove: () => {} } };
  let shownToast = null;

  const ui = Object.create(ArticleMonitorUI.prototype);
  ui.manager = manager;
  ui.discordEnabledInput = discordEnabledInput;
  ui.discordWebhookInput = discordWebhookInput;
  ui.discordStatusEl = discordStatusEl;
  ui.localNotifInput = { checked: true };
  ui.tgEnabledInput = { checked: false };
  ui.tgTokenInput = { value: '' };
  ui.tgChatIdInput = { value: '', style: {} };
  ui.tgSilentInput = { checked: false };
  ui.cloudEnabledInput = { checked: false };
  ui.cloudUrlInput = { value: '' };
  ui.cloudSecretInput = { value: '' };
  ui.cloudAutoSyncInput = { checked: false, disabled: false };
  ui.cloudAutoMergeInput = { checked: false, disabled: false, closest: () => ({ hidden: false }) };
  ui.isOfficialForm = () => false;
  ui.onShowToast = (msg) => { shownToast = msg; };

  // 1. Initial load
  ui.loadTelegramForm();
  assert.equal(discordEnabledInput.checked, false);
  assert.equal(discordWebhookInput.value, '');

  // 2. Save invalid URL with enabled=true
  discordEnabledInput.checked = true;
  discordWebhookInput.value = 'https://invalid-host.com/webhook';
  if (discordEnabledInput.checked && !isValidDiscordWebhookUrl(discordWebhookInput.value)) {
    ui.showDiscordStatus('error', '❌ Webhook 網址格式不正確');
  }
  assert.ok(discordStatusEl.textContent.includes('格式不正確'));
  assert.ok(shownToast.includes('格式不正確'));

  // 3. Save valid URL
  const validUrl = 'https://discord.com/api/webhooks/123456789/valid_token';
  discordWebhookInput.value = validUrl;
  manager.saveDiscordConfig({ enabled: true, webhookUrl: validUrl });
  ui.showDiscordStatus('success', '✅ Discord 推播設定已成功儲存！');

  assert.equal(manager.getDiscordConfig().enabled, true);
  assert.equal(manager.getDiscordConfig().webhookUrl, validUrl);

  // 4. Reload form and verify populated values
  discordEnabledInput.checked = false;
  discordWebhookInput.value = '';
  ui.loadTelegramForm();
  assert.equal(discordEnabledInput.checked, true);
  assert.equal(discordWebhookInput.value, validUrl);
});




test('Discord URL boundaries and normalization reject alternate destinations', () => {
  for (const url of ['https://user@discord.com/api/webhooks/123/token', 'https://discord.com:8443/api/webhooks/123/token', 'https://discord.com/api/webhooks/123/token/slack', 'https://discord.com/api/webhooks/123/token?thread_id=10', 'https://discord.com/api/webhooks/123/token#x']) assert.equal(isValidDiscordWebhookUrl(url), false, url);
  assert.equal(normalizeDiscordWebhookUrl('https://discord.com/api/webhooks/123/token/?wait=true'), 'https://discord.com/api/webhooks/123/token');
});

test('Discord batch summarizes and reports failures without exposing returned secrets', async () => {
  const sent = [];
  const manager = new ArticleMonitorManager(new MockStorage(), null, null, null, async (url, payload) => { sent.push(payload); return { success: false, status: 404, message: url }; });
  manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/123/token' });
  const items = Array.from({length: 5}, (_, i) => ({ board: 'Stock', title: `Article ${i}`, link: `/bbs/Stock/${i}.html` }));
  manager.enqueueDiscordAlerts(items);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].title, /5 篇/);
  assert.deepEqual(sent[0].allowed_mentions, { parse: [] });
  assert.match(manager.discordLastError, /失效/);
  assert.doesNotMatch(manager.discordLastError, /token/);
});

test('Discord storage failure and hostile native error do not claim success or reveal a token', async () => {
  const storage = new MockStorage();
  storage.setItem = () => { throw new Error('token'); };
  const manager = new ArticleMonitorManager(storage);
  assert.equal(manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/123/token' }), false);
  global.window = { __TAURI__: { core: { invoke: async () => { throw new Error('https://discord.com/api/webhooks/123/token'); } } } };
  try { const result = await manager.testDiscord('https://discord.com/api/webhooks/123/token'); assert.equal(result.success, false); assert.doesNotMatch(result.message, /token/); }
  finally { delete global.window; }
});

test('Discord embeds respect limits and reject external article URLs', () => {
  const payload = formatDiscordArticlePayload({ board: 'Stock', title: 'a'.repeat(400), author: 'b'.repeat(1200), nrec: '-1', link: 'https://evil.example/' });
  assert.equal(payload.embeds[0].title.length, 256);
  assert.equal(payload.embeds[0].fields[1].value.length, 1024);
  assert.equal(payload.embeds[0].color, 0xE74C3C);
  assert.match(payload.embeds[0].url, /^https:\/\/www\.ptt\.cc\//);
});

test('Discord form click handlers validate and report persistence failures', async () => {
  const { ArticleMonitorUI } = await import('../src/article_monitor_ui.js');
  const manager = new ArticleMonitorManager(new MockStorage());
  const listeners = {};
  const button = name => ({ addEventListener: (event, handler) => { listeners[name] = handler; }, disabled: false });
  const ui = Object.create(ArticleMonitorUI.prototype);
  ui.manager = manager;
  ui.discordEnabledInput = { checked: true };
  ui.discordWebhookInput = { value: 'https://bad.example/', focus() {} };
  ui.discordStatusEl = { className: '', textContent: '', classList: { remove() {} } };
  ui.discordSaveBtn = button('save'); ui.discordTestBtn = button('test');
  ui.onShowToast = () => {};
  ui.initEventListeners();
  listeners.save();
  assert.match(ui.discordStatusEl.textContent, /格式不正確/);
  assert.equal(manager.getDiscordConfig().enabled, false);
  ui.discordWebhookInput.value = 'https://discord.com/api/webhooks/123/token';
  listeners.save();
  assert.equal(manager.getDiscordConfig().enabled, true);
  manager.storage.setItem = () => { throw new Error('failed'); };
  listeners.save();
  assert.match(ui.discordStatusEl.textContent, /儲存失敗/);
  manager.testDiscord = async () => ({ success: false, message: 'network' });
  await listeners.test();
  assert.equal(ui.discordTestBtn.disabled, false);
  assert.match(ui.discordStatusEl.textContent, /測試發送失敗/);
});

test('Discord serializes retries after a rate limit without blocking scanning', async () => {
  const sent = [];
  const manager = new ArticleMonitorManager(new MockStorage(), null, null, null, async (url, payload) => {
    sent.push(payload);
    return sent.length === 1 ? { success: false, status: 429, retry_after_ms: 1 } : { success: true };
  });
  manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/123/token' });
  manager.enqueueDiscordAlerts([{ board: 'Stock', title: 'first', link: '/1' }, { board: 'Stock', title: 'second', link: '/2' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.match(manager.discordLastError, /頻率限制/);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(sent.length, 3);
  assert.equal(sent[1].embeds[0].title, 'first');
  assert.equal(sent[2].embeds[0].title, 'second');
});

test('cloud server error messages redact stored and supplied credentials', () => {
  const manager = new ArticleMonitorManager(new MockStorage());
  manager.saveTelegramConfig({ botToken: '123456:abcdefghijklmnop', chatId: '12' }, { sync: false });
  manager.saveCloudSyncConfig({ syncSecret: 'sync-secret-value', deviceToken: 'device-secret-value' });
  manager.saveDiscordConfig({ webhookUrl: 'https://discord.com/api/webhooks/123/token' });
  const message = manager.cloudClient.safeMessage('sync-secret-value device-secret-value 123456:abcdefghijklmnop https://discord.com/api/webhooks/123/token other-token', 'other-token');
  for (const secret of ['sync-secret-value', 'device-secret-value', '123456:abcdefghijklmnop', 'https://discord.com/api/webhooks/123/token', 'other-token']) assert.equal(message.includes(secret), false);
});

test('Discord wait confirmation does not treat an unconfirmed 204 as success', async () => {
  const manager = new ArticleMonitorManager(new MockStorage());
  manager.customFetch = async () => ({ status: 204 });
  const result = await manager.testDiscord('https://discord.com/api/webhooks/123/token');
  assert.equal(result.success, false);
});

test('ArticleMonitorManager suppresses local desktop Discord alerts when cloud push is active', async () => {
  const sent = [];
  const manager = new ArticleMonitorManager(
    new MockStorage(),
    null,
    null,
    null,
    async (url, payload) => {
      sent.push({ url, payload });
      return { success: true };
    }
  );
  manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/123/token' });
  manager.saveCloudSyncConfig({ enabled: true, workerUrl: 'https://my-cloud-worker.workers.dev' });

  // 1. Single alert via sendDiscordAlert should be suppressed (delegated to cloud)
  const alertResult = await manager.sendDiscordAlert({ board: 'Stock', title: 'Test article', link: '/1' });
  assert.equal(alertResult, null);
  assert.equal(sent.length, 0);

  // 2. Batch enqueueDiscordAlerts should also be suppressed to prevent duplicates
  manager.enqueueDiscordAlerts([{ board: 'Stock', title: 'Test article', link: '/1' }]);
  assert.equal(manager.discordQueue.length, 1);
  assert.equal(sent.length, 0);
  assert.match(manager.discordLastError, /尚未確認/);

  // 3. Disabling cloud push restores local desktop Discord alerts
  manager.saveCloudSyncConfig({ enabled: false, workerUrl: '' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
});

test('Discord queue 429 retry exhaustion discards only failed job and preserves remaining queue', async () => {
  const sent = [];
  let attempts = 0;
  const manager = new ArticleMonitorManager(
    new MockStorage(),
    null,
    null,
    null,
    async (url, payload) => {
      sent.push(payload.embeds[0].title);
      attempts++;
      // First article always fails with 429, no retry_after_ms header
      if (payload.embeds[0].title === 'failing') {
        return { success: false, status: 429, retry_after_ms: null };
      }
      return { success: true };
    }
  );
  manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/123/token' });

  manager.discordSleep = async () => {};
  // Enqueue two alerts: one that fails 429 and one that succeeds
  manager.discordQueue.push(
    { webhookUrl: 'https://discord.com/api/webhooks/123/token', payload: { embeds: [{ title: 'failing' }] }, attempts: 0 },
    { webhookUrl: 'https://discord.com/api/webhooks/123/token', payload: { embeds: [{ title: 'succeeding' }] }, attempts: 0 }
  );

  const drainPromise = manager.drainDiscordQueue();
  await drainPromise;

  // The failing job was discarded after 429, but succeeding was also delivered!
  assert.deepEqual(sent, ['failing', 'succeeding']);
  assert.equal(manager.discordQueue.length, 0);
});

test('createDiscordDigestPayload includes board tags and displays latest items first', async () => {
  const { createDiscordDigestPayload } = await import('../src/discord_push.js');
  const items = [
    { board: 'Stock', title: '舊文章 1', link: '/bbs/Stock/1.html' },
    { board: 'Lifeismoney', title: '中文章 2', link: '/bbs/Lifeismoney/2.html' },
    { board: 'Gossiping', title: '最新文章 3', link: '/bbs/Gossiping/3.html' },
  ];
  const payload = createDiscordDigestPayload(items);
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].title, '📚 3 篇文章追蹤摘要');
  // Check board tags in description
  assert.ok(payload.embeds[0].description.includes('**[Gossiping]**'));
  assert.ok(payload.embeds[0].description.includes('**[Lifeismoney]**'));
  assert.ok(payload.embeds[0].description.includes('**[Stock]**'));
  // Latest article (item[2]) should appear first in description
  const gossipingIdx = payload.embeds[0].description.indexOf('[Gossiping]');
  const stockIdx = payload.embeds[0].description.indexOf('[Stock]');
  assert.ok(gossipingIdx < stockIdx, 'Latest article should appear before older articles');
});

test('ArticleMonitorUI switches push channel sections and remembers preference in storage', async () => {
  const { ArticleMonitorUI } = await import('../src/article_monitor_ui.js');
  const manager = new ArticleMonitorManager(new MockStorage());

  const channelSelect = { value: 'telegram' };
  const hiddenMap = { telegram: false, discord: true, local: true, selfhosted: true };
  const mockSection = (id) => ({
    classList: {
      add: (cls) => { if (cls === 'hidden') hiddenMap[id] = true; },
      remove: (cls) => { if (cls === 'hidden') hiddenMap[id] = false; },
    },
  });

  const storageMap = new Map();
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => storageMap.get(k) || null,
    setItem: (k, v) => storageMap.set(k, String(v)),
  };

  try {
    const ui = Object.create(ArticleMonitorUI.prototype);
    ui.manager = manager;
    ui.pushChannelSelect = channelSelect;
    ui.sectionTelegram = mockSection('telegram');
    ui.sectionDiscord = mockSection('discord');
    ui.sectionLocal = mockSection('local');
    ui.sectionSelfHosted = mockSection('selfhosted');

    // Switch to discord
    ui.switchPushChannel('discord');
    assert.equal(channelSelect.value, 'discord');
    assert.equal(hiddenMap.discord, false);
    assert.equal(hiddenMap.telegram, true);
    assert.equal(storageMap.get('waterball_monitor_push_channel_tab'), 'discord');

    // Switch to local
    ui.switchPushChannel('local');
    assert.equal(channelSelect.value, 'local');
    assert.equal(hiddenMap.local, false);
    assert.equal(hiddenMap.discord, true);

    // Switch to selfhosted
    ui.switchPushChannel('selfhosted');
    assert.equal(channelSelect.value, 'selfhosted');
    assert.equal(hiddenMap.selfhosted, false);
    assert.equal(hiddenMap.local, true);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('failed Discord persistence does not mutate config or start cloud sync', async () => {
  const storage = new MockStorage(); const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key === 'bbsterm_monitor_discord') throw new Error('quota'); originalSet(key, value); };
  let calls = 0; const manager = new ArticleMonitorManager(storage, null, null, async () => { calls++; return { success: true }; });
  manager.saveCloudSyncConfig({ enabled: true, workerUrl: 'https://example.test', serverMode: 'selfHosted', autoSync: true, syncSecret: 'x'.repeat(32) });
  const before = manager.getDiscordConfig();
  assert.equal(manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/1/token' }), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(manager.getDiscordConfig(), before); assert.equal(calls, 0); assert.notEqual(manager.cloudSyncConfig.discordDirty, true);
});

test('queued local Discord sends pause while cloud handoff is unconfirmed', async () => {
  let release; const sent = [];
  const manager = new ArticleMonitorManager(new MockStorage(), null, null, null, async (_url, payload) => { sent.push(payload.embeds[0].title); if (sent.length === 1) return new Promise(r => { release = r; }); return { success: true }; });
  manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/1/token' });
  manager.enqueueDiscordAlerts([{ title: 'one' }, { title: 'two' }]);
  manager.saveCloudSyncConfig({ ...manager.cloudSyncConfig, enabled: true, workerUrl: 'https://example.test' });
  release({ success: true }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, ['one']); assert.equal(manager.discordQueue.length, 1);
  manager.saveCloudSyncConfig({ ...manager.cloudSyncConfig, enabled: false }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, ['one', 'two']);
});

test('late 404 from old Discord config does not discard new config jobs', async () => {
  let release; const sent = [];
  const manager = new ArticleMonitorManager(new MockStorage(), null, null, null, async (url) => { sent.push(url); if (sent.length === 1) return new Promise(r => { release = r; }); return { success: true }; });
  manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/1/old' });
  manager.enqueueDiscordAlerts([{ title: 'old' }]);
  manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/2/new' });
  manager.enqueueDiscordAlerts([{ title: 'new' }]);
  release({ success: false, status: 404 }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 2); assert.ok(sent[1].endsWith('/2/new')); assert.equal(manager.discordQueue.length, 0);
});

test('Discord retry exhaustion honors the latest rate limit before the next job', async () => {
  const delays = [], sent = []; const manager = new ArticleMonitorManager(new MockStorage(), null, null, null, async (_url, payload) => { sent.push(payload.embeds[0].title); return sent.length <= 4 ? { success: false, status: 429, retry_after_ms: 70000 } : { success: true }; });
  manager.discordSleep = async ms => { delays.push(ms); };
  manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/1/token' });
  manager.discordQueue.push({ webhookUrl: manager.discordConfig.webhookUrl, payload: { embeds: [{ title: 'one' }] }, attempts: 0 }, { webhookUrl: manager.discordConfig.webhookUrl, payload: { embeds: [{ title: 'two' }] }, attempts: 0 });
  await manager.drainDiscordQueue(); assert.deepEqual(delays, [70000, 70000, 70000, 70000]); assert.equal(sent.at(-1), 'two');
});

test('Discord digest sorts shuffled PTT timestamps newest first', async () => {
  const { createDiscordDigestPayload } = await import('../src/discord_push.js');
  const desc = createDiscordDigestPayload([{ id: 'M.200.A.X', title: 'middle' }, { id: 'M.300.A.X', title: 'newest' }, { id: 'M.100.A.X', title: 'oldest' }]).embeds[0].description;
  assert.ok(desc.indexOf('newest') < desc.indexOf('middle')); assert.ok(desc.indexOf('middle') < desc.indexOf('oldest'));
});

test('only a confirmed active matching cloud version suppresses local Discord', () => {
  const manager = new ArticleMonitorManager(new MockStorage());
  manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/1/token' });
  const remote = { status: 'active', discordVersion: 4, discordEnabled: true, discordDeliveryIssue: false };
  manager.saveCloudSyncConfig({ ...manager.cloudSyncConfig, enabled: true, workerUrl: 'https://example.test', discordDirty: false, remoteConfig: remote, discordConfirmedOrigin: 'https://example.test', discordConfirmedVersion: 4 });
  assert.equal(manager.discordDeliveryMode(), 'cloud');
  manager.saveCloudSyncConfig({ ...manager.cloudSyncConfig, remoteConfig: { ...remote, discordVersion: 5 } });
  assert.equal(manager.discordDeliveryMode(), 'pending');
  manager.saveCloudSyncConfig({ ...manager.cloudSyncConfig, remoteConfig: { ...remote, discordEnabled: false } });
  assert.equal(manager.discordDeliveryMode(), 'local');
  manager.saveCloudSyncConfig({ ...manager.cloudSyncConfig, remoteConfig: { ...remote, status: 'paused' } });
  assert.equal(manager.discordDeliveryMode(), 'pending');
});

test('self-hosted save feedback appears in the visible cloud section', async () => {
  const { ArticleMonitorUI } = await import('../src/article_monitor_ui.js');
  const ui = Object.create(ArticleMonitorUI.prototype);
  ui.pushChannelSelect = { value: 'selfhosted' };
  ui.cloudStatusEl = { className: '', textContent: '', classList: { remove() {} } };
  ui.tgStatusEl = { className: '', textContent: '', classList: { remove() {} } };
  ui.onShowToast = () => {};
  ui.showTelegramStatus('error', 'test error');
  assert.equal(ui.cloudStatusEl.textContent, 'test error');
  assert.equal(ui.tgStatusEl.textContent, '');
});

test('extreme Discord retry delay pauses without sending remaining jobs early', async () => {
  let calls = 0; const manager = new ArticleMonitorManager(new MockStorage(), null, null, null, async () => { calls++; return { success: false, status: 429, retry_after_ms: 1e100 }; });
  manager.saveDiscordConfig({ enabled: true, webhookUrl: 'https://discord.com/api/webhooks/1/token' });
  manager.enqueueDiscordAlerts([{ title: 'first' }, { title: 'second' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(manager.discordQueue.length, 1); assert.match(manager.discordLastError, /暫停/);
});

test('Discord digest escapes markdown and rejects PTT URLs with credentials or custom ports', async () => {
  const { createDiscordDigestPayload, formatDiscordArticlePayload } = await import('../src/discord_push.js');
  const item = { board: 'Stock', title: 'hello *bold* [bad](https://evil.test)', link: 'https://user@www.ptt.cc:8443/bbs/Stock/M.1.html' };
  assert.equal(formatDiscordArticlePayload(item).embeds[0].url, 'https://www.ptt.cc/bbs/Stock/index.html');
  const text = createDiscordDigestPayload([item]).embeds[0].description;
  assert.ok(text.includes('\\*bold\\*')); assert.ok(text.includes('\\[bad\\]\\('));
  assert.ok(!text.includes('user@www.ptt.cc'));
});
