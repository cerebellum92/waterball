import assert from 'node:assert/strict';
import test from 'node:test';
import { ArticleMonitorManager, formatTelegramArticleMessage, normalizePttArticleUrl } from '../src/article_monitor.js';

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

  // Missing Secret
  const res2 = await manager.syncToCloud({ workerUrl: 'https://test.dev', syncSecret: '' });
  assert.equal(res2.success, false);
  assert.match(res2.message, /密鑰/);
});



