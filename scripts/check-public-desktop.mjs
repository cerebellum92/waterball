import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkPublicDesktop(root) {
  for (const name of ['extension', 'src/extension', 'dist-extension', 'vite.extension.config.js', 'scripts/build-extension.mjs', 'src/websocket_transport.js', 'src/uao_encoder.js', 'server', 'cloudflare/worker.js', 'scripts/verify-worker-runtime.mjs']) {
    if (fs.existsSync(path.join(root, name))) throw new Error(`Desktop-only public checkout contains excluded path: ${name}`);
  }
  if (fs.readdirSync(root).some(name => /^waterball-extension.*\.zip$/.test(name))) throw new Error('Chrome ZIP in public checkout');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (Object.keys(pkg.scripts || {}).some(name => /extension|official/.test(name))) throw new Error('Private build command in public package');
  const forbidden = /\bchrome\s*(?:\.|\[)|\b(?:isExtension|isSidePanel|isFullTab|WebSocketTransport|EXTENSION_DEFAULT_BOOKMARKS|wsTransports)\b|chrome-extension:\/\/|is-sidepanel/;
  let count = 0;
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, file.name);
      if (file.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${full}`);
      if (file.isDirectory()) walk(full);
      else if (/\.(?:js|css|html)$/.test(file.name)) {
        if (forbidden.test(fs.readFileSync(full, 'utf8'))) throw new Error(`Chrome code in public desktop: ${path.relative(root, full)}`);
        count++;
      }
    }
  };
  for (const name of ['src', 'test', 'dist']) walk(path.join(root, name));
  return count;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = checkPublicDesktop(fileURLToPath(new URL('../', import.meta.url)));
  console.log(`Public desktop isolation verified (${count} source/bundle files).`);
}
