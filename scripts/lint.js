#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)
  .filter((file) => /\.(ts|tsx)$/.test(file));

const disallowedConsole = /\bconsole\.(log|debug|info)\s*\(/;
let hasErrors = false;

for (const file of trackedFiles) {
  const path = join(process.cwd(), file);
  const content = readFileSync(path, 'utf8');

  if (disallowedConsole.test(content)) {
    hasErrors = true;
    console.error(`Lint error: disallowed console statement found in ${file}`);
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log(`Lint passed: scanned ${trackedFiles.length} TypeScript files.`);
