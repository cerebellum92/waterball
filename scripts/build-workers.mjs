import fs from 'node:fs';
import { build } from 'esbuild';

const entryPoints = { 'self-hosted-worker': 'cloudflare/self-hosted-worker.js' };
if (fs.existsSync('cloudflare/worker.js')) {
  entryPoints['official-worker'] = 'cloudflare/worker.js';
}

await build({
  entryPoints,
  outdir: 'cloudflare/dist',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});

console.log(`Worker bundle(s) [${Object.keys(entryPoints).join(', ')}] built successfully.`);
