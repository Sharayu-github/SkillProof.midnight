/**
 * Copies the compiled zero-knowledge assets (prover keys + circuits) from
 * contracts/managed/verification into frontend/public so that:
 *   - `npm run frontend:dev` can serve them through the Vite dev server, and
 *   - the browser can fetch them via FetchZkConfigProvider at build time.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const managedDir = path.join(repoRoot, 'contracts', 'managed', 'verification');
const publicDir = path.join(repoRoot, 'frontend', 'public');

if (!fs.existsSync(path.join(managedDir, 'contract', 'index.js'))) {
  console.error('❌ Contract not compiled yet. Run: npm run compile');
  process.exit(1);
}

for (const asset of ['keys', 'zkir']) {
  const from = path.join(managedDir, asset);
  const to = path.join(publicDir, asset);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`  ✓ copied ${asset} → frontend/public/${asset}`);
}
