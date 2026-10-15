import { isRecord, validateAndSanitizeRules } from '../shared/push-rules.js';

// The signature describes rules only; notification preferences do not imply rule edits.
export const rulesSignature = rules => JSON.stringify(rules.map(r => ({
  id: r.id, board: r.board, keywords: [...(r.keywords || [])], author: r.author || '',
  minPushes: r.minPushes, enabled: r.enabled,
})).sort((a, b) => String(a.id).localeCompare(String(b.id))));

export function checkedCloudConfig(raw) {
  const validation = validateAndSanitizeRules(raw?.rules);
  if (!isRecord(raw) || raw.protocolVersion !== 4 || !validation.valid ||
      typeof raw.serviceId !== 'string' || !raw.serviceId || raw.serviceId.length > 80 ||
      !Number.isSafeInteger(raw.bindingVersion) || raw.bindingVersion < 1 ||
      !Number.isSafeInteger(raw.configRevision) || raw.configRevision < 0 ||
      !Number.isSafeInteger(raw.lifecycleVersion) || raw.lifecycleVersion < 0 ||
      !['active', 'paused', 'expired'].includes(raw.status) ||
      !Number.isFinite(raw.serverTime) || !Number.isFinite(raw.leaseExpiresAt) ||
      !isRecord(raw.telegram) || typeof raw.telegram.chatId !== 'string' || !/^\d+$/.test(raw.telegram.chatId) ||
      typeof raw.telegram.silent !== 'boolean' || typeof raw.telegram.enabled !== 'boolean') {
    throw new Error('雲端設定格式不完整或不合法，本機規則保持不變');
  }
  // Never import credentials or arbitrary fields from a configuration response.
  return {
    protocolVersion: 4, serviceId: raw.serviceId, bindingVersion: raw.bindingVersion,
    configRevision: raw.configRevision, lifecycleVersion: raw.lifecycleVersion,
    status: raw.status, serverTime: raw.serverTime, leaseExpiresAt: raw.leaseExpiresAt,
    updatedAt: raw.updatedAt, entitlement: raw.entitlement, rules: validation.rules,
    telegram: { chatId: raw.telegram.chatId, silent: raw.telegram.silent, enabled: raw.telegram.enabled },
    syncCapabilities: Array.isArray(raw.syncCapabilities) ? raw.syncCapabilities.filter(v => v === 'mergeRules') : [],
    maxActiveBoards: Number.isSafeInteger(raw.maxActiveBoards) && raw.maxActiveBoards > 0 && raw.maxActiveBoards <= 50 ? raw.maxActiveBoards : 10,
  };
}

export function restorePreview(localRules, remote, origin) {
  const cloud = checkedCloudConfig(remote), current = new Map(localRules.map(r => [r.id, r]));
  const changes = cloud.rules.map(r => ({ kind: !current.has(r.id) ? '新增' : rulesSignature([r]) !== rulesSignature([current.get(r.id)]) ? '修改' : '相同', rule: r, previous: current.get(r.id) }));
  for (const r of localRules) if (!cloud.rules.some(c => c.id === r.id)) changes.push({ kind: '移至本機備份', rule: r });
  return {
    origin, serviceId: cloud.serviceId, bindingVersion: cloud.bindingVersion,
    configRevision: cloud.configRevision, localSignature: rulesSignature(localRules),
    cloudSignature: rulesSignature(cloud.rules), localCount: localRules.length, cloudCount: cloud.rules.length,
    changes: changes.filter(c => c.kind !== '相同'), cloud,
  };
}

export function describeRestorePreview(preview) {
  const describe = r => `[${r.board}] ${r.enabled ? '勾選' : '未勾選'}；關鍵字：${r.keywords?.join('、') || '不限'}；作者：${r.author || '不限'}；至少 ${r.minPushes} 推`;
  const lines = [`雲端版本 ${preview.configRevision}：${preview.cloudCount} 條規則。本機目前 ${preview.localCount} 條。`, ''];
  for (const change of preview.changes.slice(0, 12)) {
    if (change.previous) lines.push(`修改前：${describe(change.previous)}`);
    lines.push(`${change.kind}：${describe(change.rule)}`);
  }
  if (preview.changes.length > 12) lines.push(`另有 ${preview.changes.length - 12} 筆差異。`);
  lines.push('', '是否將雲端規則還原到此裝置？原本規則會保留為本機備份，可取回；不會上傳、續租或恢復推播。');
  return lines.join('\n');
}
