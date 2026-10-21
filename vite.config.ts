import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

/** Same fingerprint as scripts/build-function.mjs, so Diagnostics can tell when the
 *  deployed Edge Function runs an older copy of src/domain than the web app. */
function domainFingerprint(): string {
  const dir = join(root, 'src', 'domain');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f).update(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 10);
}

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': join(root, 'src') } },
  define: { __DOMAIN_VERSION__: JSON.stringify(domainFingerprint()) },
  build: { outDir: 'dist/web', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1200 },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
