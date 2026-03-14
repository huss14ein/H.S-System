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
const allowedConsoleWithDisable = /\/\/ eslint-disable-next-line no-console\s*\n\s*console\.(log|warn|error|debug|info)\s*\(/;
let hasErrors = false;

for (const file of trackedFiles) {
  const path = join(process.cwd(), file);
  const content = readFileSync(path, 'utf8');

  // Find all console statements
  const consoleMatches = content.match(/\bconsole\.(log|debug|info|warn|error)\s*\(/g) || [];
  
  for (const match of consoleMatches) {
    const index = content.indexOf(match);
    const linesBefore = content.substring(0, index).split('\n');
    const lineIndex = linesBefore.length - 1;
    const lineContent = linesBefore[lineIndex];
    
    // Check if the line before has eslint-disable comment
    const hasEslintDisable = lineContent.includes('eslint-disable-next-line no-console') ||
                             (lineIndex > 0 && linesBefore[lineIndex - 1].includes('eslint-disable-next-line no-console'));
    
    if (!hasEslintDisable) {
      hasErrors = true;
      console.error(`Lint error: disallowed console statement found in ${file} at line ${lineIndex + 1}`);
      break;
    }
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log(`Lint passed: scanned ${trackedFiles.length} TypeScript files.`);
