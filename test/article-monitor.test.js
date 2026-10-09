import assert from 'node:assert/strict';
import test from 'node:test';
import { ArticleMonitorManager } from '../src/article_monitor.js';

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
