// Pure helpers shared by the client and official summary service.
export const SUMMARY_REQUEST_BYTES = 128 * 1024;
export function sampleSummaryPushes(pushes) {
  if (pushes.length <= 200) return pushes.slice();
  const headCount = 50;
  const tailCount = 50;
  const midCount = 100;
  const midStart = headCount;
  const midRange = pushes.length - tailCount - 1 - midStart;
  const sampled = [];
  for (let i = 0; i < headCount; i++) sampled.push(pushes[i]);
  for (let k = 0; k < midCount; k++) {
    sampled.push(pushes[midStart + Math.round(k * midRange / (midCount - 1))]);
  }
  const tailStart = pushes.length - tailCount;
  for (let i = 0; i < tailCount; i++) sampled.push(pushes[tailStart + i]);
  return sampled;
}
export function fitSummaryPayload(payload) {
  const data = payload.fallback;
  const bytes = () => new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  // Send the captured text intact when it fits; measure JSON escaping and UTF-8 bytes.
  data.title = String(data.title || '').slice(0, 200);
  if (typeof data.body === 'string' && data.body.length > 10000) {
    let max = 10000;
    if (data.body.charCodeAt(max - 1) >= 0xD800 && data.body.charCodeAt(max - 1) <= 0xDBFF) max--;
    data.body = data.body.slice(0, max);
    data.truncated = true;
  }
  while (bytes() > SUMMARY_REQUEST_BYTES && data.pushes.length) {
    const original = data.pushes;
    const count = Math.floor(original.length / 2);
    data.pushes = Array.from({ length: count }, (_, i) => original[count === 1 ? 0 : Math.floor(i * (original.length - 1) / (count - 1))]);
    data.truncated = true;
  }
  while (bytes() > SUMMARY_REQUEST_BYTES && data.body.length) {
    let keep = Math.floor(data.body.length / 4);
    if (keep > 0 && data.body.charCodeAt(keep - 1) >= 0xD800 && data.body.charCodeAt(keep - 1) <= 0xDBFF) keep--;
    data.body = keep ? data.body.slice(0, keep) + data.body.slice(-keep) : '';
    data.truncated = true;
  }
  return payload;
}
