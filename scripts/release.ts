#!/usr/bin/env bun
/**
 * Release script — bumps version across all 3 files, updates CHANGELOG, commits, and tags.
 *
 * Usage:
 *   bun run release:bump patch   # 1.0.0 → 1.0.1
 *   bun run release:bump minor   # 1.0.0 → 1.1.0
 *   bun run release:bump major   # 1.0.0 → 2.0.0
 *   bun run release:bump auto    # detect bump from conventional commits
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

  const marker = '## [';
  const idx = content.indexOf(marker);
  if (idx >= 0) {
    const updated = content.slice(0, idx) + header + '\n' + content.slice(idx);
    writeFileSync(path, updated);
  }
  console.log(`  ✓ CHANGELOG.md — added ${newVersion} section`);
}

/**
 * Parse conventional commits since last tag to determine bump type.
 * Returns null if no versionable commits found.
 *
 * Conventions:
 *   feat!: or BREAKING CHANGE → major
 *   feat:                      → minor
 *   fix: / perf: / refactor:   → patch
 *   chore: / docs: / ci: etc   → patch
 */
function detectBump(): Bump | null {
  let lastTag = '';
  try {
    lastTag = execSync('git describe --tags --abbrev=0', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    // No tags yet — treat all commits as new
  }

  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  let commits: string;
  try {
    commits = execSync(`git log --pretty=format:"%s" ${range}`, { cwd: ROOT, encoding: 'utf-8' });
  } catch {
    return null;
  }

  if (!commits.trim()) return null;

  const lines = commits.split('\n').map(l => l.trim()).filter(Boolean);

  // Skip if the only commits are release commits
  const nonRelease = lines.filter(l => !l.startsWith('release:'));
  if (nonRelease.length === 0) return null;

  let bump: Bump | null = null;

  for (const line of nonRelease) {
    // Breaking change → major
    if (/^(feat|fix|perf|refactor|chore|docs|style|test|ci|build)(\(.+\))?!:/.test(line)) {
      return 'major';
    }
    if (/BREAKING CHANGE/.test(line)) {
      return 'major';
    }
    // Feature → minor
    if (/^feat(\(.+\))?:/.test(line)) {
      if (bump !== 'minor') bump = 'minor';
    }
    // Fix/perf/refactor → patch
    if (/^(fix|perf|refactor)(\(.+\))?:/.test(line)) {
      if (bump === null) bump = 'patch';
    }
    // chore/docs/style/test/ci/build → patch
    if (/^(chore|docs|style|test|ci|build)(\(.+\))?:/.test(line)) {
      if (bump === null) bump = 'patch';
    }
  }

  return bump;
}

// --- Main ---
const arg = process.argv[2];
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

let bump: Bump;

if (arg === 'auto') {
  const detected = detectBump();
  if (!detected) {
    console.log('No versionable commits since last tag. SKIP_RELEASE');
    process.exit(0);
  }
  bump = detected;
  console.log(`Auto-detected bump: ${bump}`);
} else if (['major', 'minor', 'patch'].includes(arg)) {
  bump = arg as Bump;
} else {
  console.error('Usage: bun run release:bump <major|minor|patch|auto>');
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

if (isCI) {
  execSync('git config user.name "github-actions[bot]"', { cwd: ROOT, stdio: 'inherit' });
  execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { cwd: ROOT, stdio: 'inherit' });
}

execSync('git add -A', { cwd: ROOT, stdio: 'inherit' });
execSync(`git commit -m "release: v${next}"`, { cwd: ROOT, stdio: 'inherit' });
execSync(`git tag v${next}`, { cwd: ROOT, stdio: 'inherit' });

console.log(`\n✅ Release v${next} ready!`);

if (!isCI) {
  console.log(`\nNext steps:`);
  console.log(`  1. Edit CHANGELOG.md with release notes`);
  console.log(`  2. git push origin main --tags`);
  console.log(`  3. GitHub Actions will create the release automatically\n`);
}
