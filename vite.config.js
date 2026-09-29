import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  resolve: {
    alias: command === 'build' ? [{
      find: /^\.\/terminal_diagnostics\.js$/,
      replacement: fileURLToPath(new URL('./src/terminal_diagnostics_stub.js', import.meta.url)),
    }] : [],
  },
}));
