#!/usr/bin/env bun
/**
 * Release script — bumps version across all 3 files, updates CHANGELOG, commits, and tags.
 *
 * Usage:
 *   bun run release:bump patch   # 1.0.0 → 1.0.1
 *   bun run release:bump minor   # 1.0.0 → 1.1.0
 *   bun run release:bump major   # 1.0.0 → 2.0.0
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = join(import.meta.dir, '..');
const FILES = [
  'package.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
];

type Bump = 'major' | 'minor' | 'patch';

function bumpVersion(version: string, bump: Bump): string {
  const [major, minor, patch] = version.split('.').map(Number);
  switch (bump) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
  }
}

function updateFile(filePath: string, newVersion: string): void {
  const fullPath = join(ROOT, filePath);
  const content = JSON.parse(readFileSync(fullPath, 'utf-8'));

  if ('version' in content) {
    content.version = newVersion;
  }
  if (content.metadata?.version) {
    content.metadata.version = newVersion;
  }

  writeFileSync(fullPath, JSON.stringify(content, null, 2) + '\n');
  console.log(`  ✓ ${filePath} → ${newVersion}`);
}

function updateChangelog(newVersion: string): void {
  const path = join(ROOT, 'CHANGELOG.md');
  const content = readFileSync(path, 'utf-8');
  const today = new Date().toISOString().split('T')[0];
  const header = `## [${newVersion}] - ${today}\n\n### Changed\n- \n`;

  // Insert after the first "## [" line (or after the format description)
  const marker = '## [';
  const idx = content.indexOf(marker);
  if (idx >= 0) {
    const updated = content.slice(0, idx) + header + '\n' + content.slice(idx);
    writeFileSync(path, updated);
  }
  console.log(`  ✓ CHANGELOG.md — added ${newVersion} section`);
}

// --- Main ---
const bump = process.argv[2] as Bump;
if (!['major', 'minor', 'patch'].includes(bump)) {
  console.error('Usage: bun run release:bump <major|minor|patch>');
  process.exit(1);
}

// Read current version
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const current = pkg.version;
const next = bumpVersion(current, bump);

console.log(`\nBumping ${current} → ${next} (${bump})\n`);

// Update all files
for (const file of FILES) {
  updateFile(file, next);
}
updateChangelog(next);

// Git commit and tag
console.log('\nCommitting and tagging...\n');
execSync(`git add -A`, { cwd: ROOT, stdio: 'inherit' });
execSync(`git commit -m "release: v${next}"`, { cwd: ROOT, stdio: 'inherit' });
execSync(`git tag v${next}`, { cwd: ROOT, stdio: 'inherit' });

console.log(`\n✅ Release v${next} ready!`);
console.log(`\nNext steps:`);
console.log(`  1. Edit CHANGELOG.md with release notes`);
console.log(`  2. git push origin main --tags`);
console.log(`  3. GitHub Actions will create the release automatically\n`);
