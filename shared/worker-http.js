export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
export async function readBoundedBody(request, maxBytes = 512 * 1024) {
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw Object.assign(new Error('Payload too large'), { status: 413 });
  if (!request.body) return null;
  const reader = request.body.getReader();
  let total = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw Object.assign(new Error('Payload too large'), { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
