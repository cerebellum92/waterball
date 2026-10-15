import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceNotifications, digestPayload, notificationDue, reserveNotification, notificationMatches } from '../shared/notification-policy.js';
const article = n => ({ id: `M.${1800000000 + n}.A`, board: 'Stock', title: '<script> & "a"', author: 'tester', nrec: '1' });
const job = n => ({ id: `job-${n}`, kind: 'article', article: article(n), userKey: 'one', epoch: 1, createdAt: 100, nextAttemptAt: 100, attempts: 0 });
test('Three or fewer singles remain individual; four or more unpushed become digest; already delivered are excluded', () => {
  // 1, 2, 3 singles remain individual
  assert.equal(coalesceNotifications([job(1)], 100, () => ({}), () => true).some(j => j.digest), false);
  assert.equal(coalesceNotifications([job(1), job(2)], 100, () => ({}), () => true).some(j => j.digest), false);
  assert.equal(coalesceNotifications([job(1), job(2), job(3)], 100, () => ({}), () => true).some(j => j.digest), false);

  // 4 singles coalesce into a digest
  const four = coalesceNotifications([job(1), job(2), job(3), job(4)], 100, () => ({}), () => true);
  assert.equal(four.length, 1);
  assert.equal(four[0].digest, true);
  assert.equal(four[0].articles.length, 4);

  // If 2 of 4 articles are already delivered, only 2 remain, so they stay individual (not a digest)
  const deliveredOwner = () => ({ delivered: { 'stock:M.1800000001.A': 50, 'stock:M.1800000002.A': 50 } });
  const partial = coalesceNotifications([job(1), job(2), job(3), job(4)], 100, deliveredOwner, () => true);
  assert.equal(partial.length, 2);
  assert.equal(partial.some(j => j.digest), false);
  assert.deepEqual(partial.map(j => j.article.id).sort(), ['M.1800000003.A', 'M.1800000004.A']);

  // If all articles in group are already delivered, drop them completely
  const allDeliveredOwner = () => ({ delivered: { 'stock:M.1800000001.A': 50, 'stock:M.1800000002.A': 50 } });
  const empty = coalesceNotifications([job(1), job(2)], 100, allDeliveredOwner, () => true);
  assert.equal(empty.length, 0);

  // Large groups become bounded, escaped summaries of newest five
  const grouped = coalesceNotifications(Array.from({ length: 200 }, (_, i) => job(i)), 100, () => ({}), () => true);
  assert.equal(grouped.length, 2); assert.ok(grouped.every(j => j.articles.length === 100));
  const payload = digestPayload(grouped[0], '123', false);
  assert.ok(payload.text.includes('100 篇')); assert.ok(payload.text.includes('95 篇'));
  assert.ok(payload.text.includes('M.1800000099.A')); assert.equal(payload.text.includes('M.1800000000.A'), false);
  assert.equal(payload.text.includes('<script>'), false); assert.ok(payload.text.includes('&lt;script&gt;')); assert.ok(payload.text.length < 4000);
});
test('Sealed retries never merge; distinct owners and epochs never mix', () => {
  const sealed = { ...job(1), attempts: 1, sealed: true, digest: true, articles: [article(1)] };
  const input = [sealed, ...Array.from({ length: 4 }, (_, i) => job(i + 2)), ...Array.from({ length: 4 }, (_, i) => ({ ...job(i + 10), userKey: 'two' }))];
  const out = coalesceNotifications(input, 100, () => ({}), () => true);
  assert.deepEqual(out.find(j => j.id === sealed.id), sealed);
  assert.equal(out.length, 3); assert.equal(out.filter(j => j.userKey === 'two').length, 1);
});
test('Budget reservation is rolling, bounded, and includes attempts with an unknown delivery outcome', () => {
  const owner = {};
  reserveNotification(owner, 100); reserveNotification(owner, 200); reserveNotification(owner, 300);
  assert.equal(notificationDue(owner.notificationStarts, 1000), 300100);
  assert.equal(notificationDue(owner.notificationStarts, 300100), 300100);
  reserveNotification(owner, 300100); assert.equal(owner.notificationStarts.length, 3);
});
test('A rule removed from an immutable digest invalidates the entire snapshot before delivery', () => {
  const rules = [{ board: 'Stock', enabled: true, minPushes: 0, keywords: [] }];
  assert.equal(notificationMatches({ articles: [article(1), article(2)] }, rules), true);
  assert.equal(notificationMatches({ articles: [article(1), { ...article(2), board: 'NBA' }] }, rules), false);
});
