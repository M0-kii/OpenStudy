import { defineConfig } from 'vite';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export default defineConfig(() => {
  const require = createRequire(import.meta.url);
  const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'));
  const assets = 'public/pdfjs';
  mkdirSync(assets, { recursive: true });
  for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    const source = join(pdfjs, name);
    if (existsSync(source)) cpSync(source, join(assets, name), { recursive: true });
  }

  return {
    clearScreen: false,
    server: { watch: { ignored: ['**/src-tauri/**'] } },
    build: { target: ['chrome105', 'safari16'] },
  };
});
