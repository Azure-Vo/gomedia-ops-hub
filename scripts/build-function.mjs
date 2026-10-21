// Bundles the Edge Function into ONE file that can be pasted into
// Supabase → Edge Functions → Deploy a new function → Via Editor.
// Also builds a Node copy of the same code for local end-to-end tests.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_JS = 'npm:@supabase/supabase-js@2.117.3';

function domainFingerprint() {
  const dir = join(root, 'src', 'domain');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f).update(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 10);
}

const version = domainFingerprint();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const define = { __DOMAIN_VERSION__: JSON.stringify(version) };

const npmSpecifier = {
  name: 'npm-specifier',
  setup(b) {
    b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: SUPABASE_JS, external: true }));
  },
};

// 1) Deno bundle for Supabase
const outDir = join(root, 'dist', 'edge', 'ops-hub');
mkdirSync(outDir, { recursive: true });
const deno = await build({
  entryPoints: [join(root, 'supabase/functions/ops-hub/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  write: false,
  define,
  plugins: [npmSpecifier],
  legalComments: 'none',
});
const banner = `// @ts-nocheck
// Go Media Ops Hub · Edge Function "ops-hub" · app ${pkg.version} · domain ${version}
// GENERATED FILE: paste the whole file into Supabase → Edge Functions → ops-hub → index.ts.
// Source code: supabase/functions/ops-hub and src/domain in the repository. Do not edit here.
`;
writeFileSync(join(outDir, 'index.ts'), banner + deno.outputFiles[0].text);

// 2) Node bundle for local tests (same code, supabase-js from node_modules)
const nodeOut = join(root, 'tools', 'local-stack', '.build');
mkdirSync(nodeOut, { recursive: true });
await build({
  entryPoints: [join(root, 'supabase/functions/ops-hub/handler.ts'), join(root, 'supabase/functions/ops-hub/env.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outdir: nodeOut,
  outExtension: { '.js': '.mjs' },
  define,
  external: ['@supabase/supabase-js'],
  nodePaths: [join(root, 'node_modules')],
});
console.log(`Edge Function bundled: dist/edge/ops-hub/index.ts (domain ${version}, ${Math.round(deno.outputFiles[0].text.length / 1024)} KB)`);
