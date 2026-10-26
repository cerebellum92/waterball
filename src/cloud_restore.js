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
    updatedAt: raw.updatedAt, entitlement: raw.entitlement, rules: validation.rules.filter(rule => rule.enabled),
    telegram: { chatId: raw.telegram.chatId, silent: raw.telegram.silent, enabled: raw.telegram.enabled },
    syncCapabilities: Array.isArray(raw.syncCapabilities) ? raw.syncCapabilities.filter(v => v === 'mergeRules') : [],
    maxActiveBoards: Number.isSafeInteger(raw.maxActiveBoards) && raw.maxActiveBoards > 0 && raw.maxActiveBoards <= 50 ? raw.maxActiveBoards : 10,
  };
}

// Self-hosted workers intentionally have no official service identity or lease.
export function checkedSelfHostedConfig(raw) {
  const validation = validateAndSanitizeRules(raw?.rules);
  if (!isRecord(raw) || raw.mode !== 'selfHosted' || !validation.valid ||
      !Number.isSafeInteger(raw.configRevision) || raw.configRevision < 0 ||
      !Number.isSafeInteger(raw.lifecycleVersion) || raw.lifecycleVersion < 0 ||
      !['active', 'paused', 'expired'].includes(raw.status) ||
      !isRecord(raw.telegram) || typeof raw.telegram.chatId !== 'string' ||
      !(raw.telegram.chatId === '' && raw.status !== 'active' || /^\d+$/.test(raw.telegram.chatId)) ||
      typeof raw.telegram.enabled !== 'boolean' || typeof raw.telegram.silent !== 'boolean') {
    throw new Error('自架設定格式不完整或不合法，本機規則保持不變');
  }
  return {
    mode: 'selfHosted', serviceId: null, bindingVersion: null,
    configRevision: raw.configRevision, lifecycleVersion: raw.lifecycleVersion,
    status: raw.status, leaseExpiresAt: null, rules: validation.rules.filter(rule => rule.enabled),
    telegram: { chatId: raw.telegram.chatId, enabled: raw.telegram.enabled, silent: raw.telegram.silent },
  };
}

// Choose the validator from the local service context, never from an untrusted response.
export function checkedRemoteConfig(raw, mode = 'official') {
  return mode === 'selfHosted' ? checkedSelfHostedConfig(raw) : checkedCloudConfig(raw);
}

export function reconcileRulesWithCloud(localRules, remoteActiveRules) {
  // IDs are shared by restore and three-way merge. Same-board rules may have
  // different filters, so a board name must never replace or consume another ID.
  const remote = new Map((remoteActiveRules || []).filter(rule => rule.enabled !== false)
    .map(rule => [rule.id, { ...structuredClone(rule), enabled: true }]));
  const updated = (localRules || []).map(local => {
    const authoritative = remote.get(local.id);
    if (!authoritative) return { ...structuredClone(local), enabled: false };
    remote.delete(local.id);
    return authoritative;
  });
  return [...updated, ...remote.values()];
}

export function restorePreview(localRules, remote, origin, mode = 'official') {
  const cloud = checkedRemoteConfig(remote, mode);
  const current = new Map(localRules.map(r => [r.id, r]));
  const changes = [];
  const matchedLocalIds = new Set();

  for (const r of cloud.rules) {
    const localMatch = current.get(r.id);
    if (localMatch) {
      matchedLocalIds.add(localMatch.id);
      if (!localMatch.enabled) {
        changes.push({ kind: '勾選', rule: r, previous: localMatch });
      } else if (rulesSignature([r]) !== rulesSignature([localMatch])) {
        changes.push({ kind: '修改', rule: r, previous: localMatch });
      } else {
        changes.push({ kind: '相同', rule: r, previous: localMatch });
      }
    } else {
      changes.push({ kind: '新增並勾選', rule: r });
    }
  }

  for (const r of localRules) {
    if (!matchedLocalIds.has(r.id)) {
      changes.push({
        kind: r.enabled ? '取消勾選（保留於本機清單）' : '保留未勾選',
        rule: { ...r, enabled: false },
        previous: r,
      });
    }
  }

  return {
    origin, mode, serviceId: cloud.serviceId, bindingVersion: cloud.bindingVersion,
    configRevision: cloud.configRevision, localSignature: rulesSignature(localRules),
    cloudSignature: rulesSignature(cloud.rules), localCount: localRules.length, cloudCount: cloud.rules.length,
    changes: changes.filter(c => c.kind !== '相同'), cloud,
  };
}

export function describeRestorePreview(preview) {
  const describe = r => `[${r.board}] ${r.enabled ? '勾選' : '未勾選'}；關鍵字：${r.keywords?.join('、') || '不限'}；作者：${r.author || '不限'}；至少 ${r.minPushes} 推`;
  const lines = [`雲端版本 ${preview.configRevision}：${preview.cloudCount} 條生效規則。本機目前 ${preview.localCount} 條（保留本機清單，同步勾選與篩選設定）。`, '同看板的不同規則會各自保留，不會因看板同名而覆寫。', ''];
  for (const change of preview.changes.slice(0, 12)) {
    if (change.previous) lines.push(`原設定：${describe(change.previous)}`);
    lines.push(`${change.kind}：${describe(change.rule)}`);
  }
  if (preview.changes.length > 12) lines.push(`另有 ${preview.changes.length - 12} 筆差異。`);
  lines.push('', '是否同步雲端勾選與篩選設定至此裝置？未勾選與既有看板將完整保留於本機清單，不會被刪除；雲端未變更。');
  return lines.join('\n');
}
