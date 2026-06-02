/**
 * Build a single-file Windows exe via Node SEA (Single Executable Application).
 * Steps: esbuild bundle -> SEA blob -> copy node.exe -> postject inject.
 * No network/base-binary download required (reuses the local node runtime).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_NAME = process.env.EXE_NAME || 'QQ空间时光机.exe';
const exePath = join(root, 'dist-exe', OUT_NAME);
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
}

// 1. Bundle to a single CJS file.
run(process.execPath, [join(root, 'node_modules/esbuild/bin/esbuild'),
  'src/main.ts', '--bundle', '--platform=node', '--format=cjs', '--target=node20',
  '--outfile=build/launcher.cjs']);

// 2. Generate the SEA preparation blob.
run(process.execPath, ['--experimental-sea-config', 'sea-config.json']);

// 3. Copy the running node binary as the exe base.
mkdirSync(join(root, 'dist-exe'), { recursive: true });
copyFileSync(process.execPath, exePath);
console.log(`Copied node -> ${exePath}`);

// 4. Inject the blob.
run(process.execPath, [join(root, 'node_modules/postject/dist/cli.js'),
  exePath, 'NODE_SEA_BLOB', 'build/sea-prep.blob', '--sentinel-fuse', FUSE]);

if (existsSync(exePath)) console.log(`\n✅ Built: ${exePath}`);
else { console.error('Build failed'); process.exit(1); }
