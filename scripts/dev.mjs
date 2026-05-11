#!/usr/bin/env node
/**
 * Default: `npx netlify dev` — injects **linked Netlify site** env into `netlify/functions` + runs Vite (see `netlify.toml` [dev]).
 * Fallback: plain Vite if `FORCE_VITE_DEV=1`, `CI=true`, or `netlify-cli` not installed.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const hasNetlifyCli = existsSync(join(root, 'node_modules', 'netlify-cli', 'package.json'));
const forceVite = process.env.FORCE_VITE_DEV === '1' || process.env.CI === 'true';

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: true, cwd: root, env: process.env });
  child.on('exit', (code) => process.exit(code ?? 0));
}

if (forceVite || !hasNetlifyCli) {
  run('npx', ['vite']);
} else {
  run('npx', ['netlify', 'dev']);
}
