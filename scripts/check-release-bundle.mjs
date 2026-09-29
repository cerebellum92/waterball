import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const assetsDirectory = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const javascriptFiles = readdirSync(assetsDirectory).filter((file) => file.endsWith('.js'));
const forbiddenMarkers = [
  '[Waterball diagnostics]',
  'waterballDiagnostics',
  'waterballCapture',
  'terminal-raw-read',
];

if (javascriptFiles.length === 0) {
  throw new Error('Release build contains no JavaScript assets');
}

for (const file of javascriptFiles) {
  const contents = readFileSync(fileURLToPath(new URL(`../dist/assets/${file}`, import.meta.url)), 'utf8');
  const marker = forbiddenMarkers.find((value) => contents.includes(value));
  if (marker) {
    throw new Error(`Release build includes diagnostic marker ${marker} in ${file}`);
  }
}

console.log('Release bundle contains no terminal diagnostic capture code.');
