import { validateAndSanitizeRules } from '../shared/push-rules.js';
import { rulesSignature } from './cloud_restore.js';

const fields = ['board', 'keywords', 'author', 'minPushes', 'enabled'];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalize = rules => {
  const result = validateAndSanitizeRules(rules.filter(r => r.enabled));
  if (!result.valid) throw new Error(result.message);
  return result.rules;
};

/** Stable IDs distinguish deletion from modification; no timestamps order edits. */
export function mergeRules(baseRules, localRules, remoteRules, choices = {}) {
  const base = new Map(normalize(baseRules).map(r => [r.id, r]));
  const local = new Map(normalize(localRules).map(r => [r.id, r]));
  const remote = new Map(normalize(remoteRules).map(r => [r.id, r]));
  const rules = [], conflicts = [];
  const choose = (id, field, b, l, r) => {
    if (equal(l, r)) return l;
    if (equal(l, b)) return r;
    if (equal(r, b)) return l;
    const key = JSON.stringify([id, field]);
    if (choices[key] === 'local') return l;
    if (choices[key] === 'remote') return r;
    conflicts.push({ key, id, field, base: b ?? null, local: l ?? null, remote: r ?? null });
    return l;
  };
  for (const id of new Set([...remote.keys(), ...local.keys(), ...base.keys()])) {
    const b = base.get(id), l = local.get(id), r = remote.get(id);
    let merged;
    if (!l || !r || !b) merged = choose(id, '$rule', b, l, r);
    else {
      merged = { id };
      for (const field of fields) merged[field] = choose(id, field, b[field], l[field], r[field]);
    }
    if (merged) rules.push(structuredClone(merged));
  }
  return { rules, conflicts };
}

export function mergeSilent(base, local, remote, choices = {}) {
  if (local === remote || remote === base) return { value: local, conflicts: [] };
  if (local === base) return { value: remote, conflicts: [] };
  const key = JSON.stringify(['$telegram', 'silent']);
  if (choices[key] === 'local' || choices[key] === 'remote') return { value: choices[key] === 'remote' ? remote : local, conflicts: [] };
  return { value: local, conflicts: [{ key, id: '$telegram', field: 'silent', base, local, remote }] };
}

export function withLocalBackups(activeRules, localRules) {
  const ids = new Set(activeRules.map(r => r.id));
  return [...structuredClone(activeRules), ...structuredClone(localRules.filter(r => !r.enabled && !ids.has(r.id)))];
}

export function makeMergePlan(baseline, localRules, localSilent, remote, origin, choices = {}, selectedBoards) {
  const merged = mergeRules(baseline.rules, localRules, remote.rules, choices);
  const silent = mergeSilent(baseline.silent, localSilent, remote.telegram.silent, choices);
  const boards = [...new Set(merged.rules.map(r => r.board.toLowerCase()))];
  const maxBoards = remote.maxActiveBoards || 10;
  const disabled = selectedBoards ? merged.rules.filter(r => !selectedBoards.includes(r.board.toLowerCase())).map(r => ({ ...r, enabled: false })) : [];
  const rules = selectedBoards ? merged.rules.filter(r => selectedBoards.includes(r.board.toLowerCase())) : merged.rules;
  const quotaExceeded = new Set(rules.map(r => r.board.toLowerCase())).size > maxBoards || rules.length > 100;
  return {
    origin, serviceId: remote.serviceId, bindingVersion: remote.bindingVersion, revision: remote.configRevision,
    localSignature: rulesSignature(localRules), localSilent, remoteSignature: rulesSignature(remote.rules),
    baseline: structuredClone(baseline), localRules: structuredClone(localRules), remote: structuredClone(remote),
    rules, silent: silent.value, disabled, boards, maxBoards, quotaExceeded,
    conflicts: [...merged.conflicts, ...silent.conflicts],
    needsWrite: rulesSignature(rules) !== rulesSignature(remote.rules.filter(r => r.enabled)) || silent.value !== remote.telegram.silent,
  };
}
