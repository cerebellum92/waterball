import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        splash: fileURLToPath(new URL('./splash.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: command === 'build' ? [{
      find: /^\.\/terminal_diagnostics\.js$/,
      replacement: fileURLToPath(new URL('./src/terminal_diagnostics_stub.js', import.meta.url)),
    }] : [],
  },
}));
