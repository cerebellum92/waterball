import { build } from 'esbuild';

const entryPoints = { 'self-hosted-worker': 'cloudflare/self-hosted-worker.js' };
if (!process.argv.includes('--self-hosted-only')) entryPoints['official-worker'] = 'cloudflare/worker.js';
await build({ entryPoints, outdir: 'cloudflare/dist', bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
console.log(`Worker bundle(s) [${Object.keys(entryPoints).join(', ')}] built successfully.`);
