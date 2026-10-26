import test from 'node:test';
import assert from 'node:assert/strict';
import { BlacklistManager, BUILTIN_GREAT_TREASURE } from '../src/blacklist.js';
import { NotificationManager } from '../src/notifications.js';
import { ArticleMonitorManager } from '../src/article_monitor.js';

class MockStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

test('BlacklistManager manages ID blacklist with case-insensitivity and toggle', () => {
  const storage = new MockStorage();
  const manager = new BlacklistManager(storage);

  assert.equal(manager.isBlacklisted('spammer123'), false);

  // Add
  assert.equal(manager.add('Spammer123'), true);
  assert.equal(manager.isBlacklisted('spammer123'), true);
  assert.equal(manager.isBlacklisted('SPAMMER123'), true);
  assert.equal(manager.isBlacklisted('Spammer123'), true);

  // Duplicate add
  assert.equal(manager.add('spammer123'), false);

  // Toggle
  const nowRemoved = manager.toggle('spammer123');
  assert.equal(nowRemoved, false); // Removed
  assert.equal(manager.isBlacklisted('spammer123'), false);

  const nowAdded = manager.toggle('spammer123');
  assert.equal(nowAdded, true); // Added back
  assert.equal(manager.isBlacklisted('spammer123'), true);

  // Remove
  assert.equal(manager.remove('SPAMMER123'), true);
  assert.equal(manager.isBlacklisted('spammer123'), false);

  // Invalid IDs (< 2 chars or empty)
  assert.equal(manager.add('a'), false);
  assert.equal(manager.add(''), false);
});

test('BlacklistManager includes PTT Great Treasure and respects enableGreatTreasure toggle', () => {
  const storage = new MockStorage();
  const manager = new BlacklistManager(storage);

  assert.equal(manager.isBlacklisted('idcc'), false, 'unverified list defaults off');
  manager.saveSettings({ enableGreatTreasure: true });
  // Explicitly enabled legacy accounts
  assert.equal(manager.isBlacklisted('idcc'), true);
  assert.equal(manager.isBlacklisted('IDCC'), true);
  assert.ok(manager.getGreatTreasureCount() >= 30);

  // Disable great treasure
  manager.saveSettings({ enableGreatTreasure: false });
  assert.equal(manager.isBlacklisted('idcc'), false);

  // Custom addition still works even if great treasure disabled
  manager.add('idcc');
  assert.equal(manager.isBlacklisted('idcc'), true);
});

test('BlacklistManager manages Keyword blacklist and substring matching', () => {
  const storage = new MockStorage();
  const manager = new BlacklistManager(storage);

  assert.equal(manager.isKeywordBlacklisted('這是一篇普通文章'), null);

  // Add keywords
  assert.equal(manager.addKeyword('買一送一'), true);
  assert.equal(manager.addKeyword('爆雷'), true);
  assert.equal(manager.addKeyword('BUY1GET1'), true);

  // Substring matching
  assert.equal(manager.isKeywordBlacklisted('限時特賣買一送一快來'), '買一送一');
  assert.equal(manager.isKeywordBlacklisted('[閒聊] 結局有重大爆雷慎入'), '爆雷');
  assert.equal(manager.isKeywordBlacklisted('Check out our buy1get1 promo'), 'buy1get1');
  assert.equal(manager.isKeywordBlacklisted('無關內容'), null);

  // Toggle keyword
  assert.equal(manager.toggleKeyword('買一送一'), false); // Removed
  assert.equal(manager.isKeywordBlacklisted('限時特賣買一送一快來'), null);

  // Disable keywords in settings
  manager.saveSettings({ enableKeywords: false });
  assert.equal(manager.isKeywordBlacklisted('[閒聊] 結局有重大爆雷慎入'), null);
});

test('BlacklistManager persists IDs, keywords and settings to storage and reloads', () => {
  const storage = new MockStorage();
  const manager1 = new BlacklistManager(storage);

  manager1.saveSettings({ mode: 'mask', blockWaterball: true, blockPushNotification: true });
  manager1.add('trollUser');
  manager1.addKeyword('股票群組');

  // Instantiate second manager with same storage
  const manager2 = new BlacklistManager(storage);
  assert.equal(manager2.settings.mode, 'mask');
  assert.equal(manager2.settings.blockWaterball, true);
  assert.equal(manager2.settings.blockPushNotification, true);
  assert.equal(manager2.isBlacklisted('trollUser'), true);
  assert.equal(manager2.isKeywordBlacklisted('加入獲利股票群組'), '股票群組');
});

test('BlacklistManager text and JSON import and export', () => {
  const storage = new MockStorage();
  const manager = new BlacklistManager(storage);

  // Text import
  const rawText = `
    # Some comment
    userA
    userB, userC;
    userD
  `;
  const count = manager.importFromText(rawText);
  assert.equal(count, 4);
  assert.equal(manager.getCustomListArray().length, 4);

  // Keyword text import
  const kwText = `
    廣告
    點我連結
    好康分享
  `;
  const kwCount = manager.importKeywordsFromText(kwText);
  assert.equal(kwCount, 3);
  assert.equal(manager.getCustomKeywordsArray().length, 3);

  // Unified JSON export & import
  const exported = manager.exportAsJSON();
  assert.ok(exported.includes('usera'));
  assert.ok(exported.includes('廣告'));

  // Clear and re-import
  manager.clear();
  manager.clearKeywords();
  assert.equal(manager.getCustomListArray().length, 0);
  assert.equal(manager.getCustomKeywordsArray().length, 0);

  const res = manager.importFromJSON(exported);
  assert.equal(res.success, true);
  assert.equal(res.addedUsers, 4);
  assert.equal(res.addedKeywords, 3);
  assert.equal(manager.isBlacklisted('usera'), true);
  assert.equal(manager.isKeywordBlacklisted('點我連結看看'), '點我連結');
});

test('NotificationManager waterball blacklist blocking suppresses alerts', async () => {
  const notif = new NotificationManager();
  let triggered = false;
  notif.triggerWaterballNotification = async () => {
    triggered = true;
  };

  const { blacklistManager } = await import('../src/blacklist.js');
  blacklistManager.saveSettings({ enabled: true, blockWaterball: true });
  blacklistManager.add('blockedDude');
  blacklistManager.addKeyword('黑名單詞彙');

  // 1. Waterball from blocked user
  triggered = false;
  notif.feedScreenLines('tab1', [
    '                                                                                ',
    '★blockedDude 呼叫: 嗨在嗎？                                                     ',
  ], 'PTT');
  assert.equal(triggered, false, 'Waterball from blocked user must be dropped');

  // 2. Waterball with blocked keyword
  triggered = false;
  notif.feedScreenLines('tab1', [
    '                                                                                ',
    '★normalUser 呼叫: 這是黑名單詞彙測試                                            ',
  ], 'PTT');
  assert.equal(triggered, false, 'Waterball containing blacklisted keyword must be dropped');

  // 3. Normal waterball
  triggered = false;
  notif.feedScreenLines('tab1', [
    '                                                                                ',
    '★normalUser 呼叫: 安安你好 [10/19 12:34]                                                     ',
  ], 'PTT');
  assert.equal(triggered, false, 'Content-rule mode must not publish any snapshot without a trustworthy boundary');
  blacklistManager.removeKeyword('黑名單詞彙');
  notif.feedScreenLines('tab1', ['★normalUser 呼叫: 安安你好 [10/19 12:34]'], 'PTT');
  assert.equal(triggered, true, 'Normal waterball alerts resume without content rules');

  // Cleanup
  blacklistManager.remove('blockedDude');
  blacklistManager.removeKeyword('黑名單詞彙');
});

test('ArticleMonitorManager respects blacklist in matchesRule', async () => {
  const monitor = new ArticleMonitorManager(new MockStorage());
  const rule = {
    id: 'r1',
    board: 'Gossiping',
    keywords: [],
    author: '',
    minPushes: 0,
    enabled: true,
  };

  const { blacklistManager } = await import('../src/blacklist.js');
  blacklistManager.saveSettings({ enabled: true, blockPushNotification: true });
  blacklistManager.add('shillWriter');
  blacklistManager.addKeyword('爭議詐騙商品');

  // 1. Article by blacklisted author
  const art1 = {
    board: 'Gossiping',
    author: 'shillWriter (知名公關)',
    title: '[新聞] 最新獨家八卦',
    nrec: '10',
  };
  assert.equal(monitor.matchesRule(art1, rule), false, 'Blacklisted author must not match rule');

  // 2. Article containing blacklisted keyword in title
  const art2 = {
    board: 'Gossiping',
    author: 'cleanUser',
    title: '[新聞] 知名藝人代言爭議詐騙商品遭約談',
    nrec: '10',
  };
  assert.equal(monitor.matchesRule(art2, rule), false, 'Title with blacklisted keyword must not match rule');

  // 3. Normal article
  const art3 = {
    board: 'Gossiping',
    author: 'cleanUser',
    title: '[問卦] 今天天氣真好',
    nrec: '10',
  };
  assert.equal(monitor.matchesRule(art3, rule), true, 'Normal article should match rule');

  // Cleanup
  blacklistManager.remove('shillWriter');
  blacklistManager.removeKeyword('爭議詐騙商品');
});
