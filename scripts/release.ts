#!/usr/bin/env bun
/**
 * Release script — bumps version across all 3 files, updates CHANGELOG, commits, and tags.
 *
 * Usage:
 *   bun run release:bump patch   # 1.0.0 → 1.0.1
 *   bun run release:bump minor   # 1.0.0 → 1.1.0
 *   bun run release:bump major   # 1.0.0 → 2.0.0
 *   bun run release:bump auto    # detect bump from conventional commits
 *   bun run release:bump detect  # output next version (no side effects)
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Conventional Commit Parsing ──────────────────────────────────────────────

/** Map conventional commit prefixes to Keep a Changelog sections */
const SECTION_MAP: Record<string, string> = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Performance',
  refactor: 'Changed',
  docs: 'Documentation',
  style: 'Changed',
  test: 'Changed',
  ci: 'Changed',
  build: 'Changed',
  chore: 'Changed',
};

/** Types that trigger a patch version bump (docs/style/test/build do not) */
const PATCH_TYPES = new Set(['fix', 'perf', 'refactor', 'ci', 'chore']);

interface ParsedCommit {
  type: string;
  scope: string;
  breaking: boolean;
  message: string;
}

function parseCommitLine(line: string): ParsedCommit | null {
  const match = line.match(/^(\w+)(\(([^)]+)\))?(!)?\s*:\s*(.+)/);
  if (!match) return null;
  return {
    type: match[1],
    scope: match[3] || '',
    breaking: !!match[4],
    message: match[5].trim(),
  };
}

interface CommitEntry {
  subject: string;
  body: string;
}

/** Match the conventional commit footer "BREAKING CHANGE:" or "BREAKING-CHANGE:" */
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE\s*:/m;

function getCommitsSinceLastTag(): CommitEntry[] {
  let lastTag = '';
  try {
    lastTag = execSync('git describe --tags --abbrev=0', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    // No tags yet
  }

  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  try {
    const raw = execSync(`git log --pretty=format:"%B%x00" ${range}`, { cwd: ROOT, encoding: 'utf-8' });
    return raw.split('\0').map(msg => {
      const lines = msg.trim().split('\n');
      return {
        subject: lines[0]?.trim() || '',
        body: lines.slice(1).join('\n').trim(),
      };
    }).filter(e => e.subject);
  } catch {
    return [];
  }
}

// ── CHANGELOG Generation ─────────────────────────────────────────────────────

function generateChangelogSection(newVersion: string): string {
  const commits = getCommitsSinceLastTag();
  const sections: Record<string, string[]> = {};

  for (const { subject, body } of commits) {
    if (subject.startsWith('release:')) continue;

    const parsed = parseCommitLine(subject);
    if (!parsed) continue;

    if (parsed.breaking || BREAKING_FOOTER_RE.test(body)) {
      sections['BREAKING'] ??= [];
      const scope = parsed.scope ? `**${parsed.scope}**: ` : '';
      sections['BREAKING'].push(`${scope}${parsed.message}`);
    }

    const section = SECTION_MAP[parsed.type];
    if (!section) continue;

    sections[section] ??= [];
    const scope = parsed.scope ? `**${parsed.scope}**: ` : '';
    sections[section].push(`${scope}${parsed.message}`);
  }

  const today = new Date().toISOString().split('T')[0];
  const lines: string[] = [`## [${newVersion}] - ${today}`];

  // Ordered: Breaking first, then Added, Fixed, Changed, Performance, Documentation
  const order = ['BREAKING', 'Added', 'Fixed', 'Changed', 'Performance', 'Documentation'];
  for (const key of order) {
    const items = sections[key];
    if (!items?.length) continue;
    lines.push('');
    lines.push(`### ${key === 'BREAKING' ? 'BREAKING CHANGES' : key}`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}

function updateChangelog(newVersion: string): void {
  const path = join(ROOT, 'CHANGELOG.md');
  const content = readFileSync(path, 'utf-8');
  const section = generateChangelogSection(newVersion);

  const marker = '## [';
  const idx = content.indexOf(marker);
  if (idx >= 0) {
    const updated = content.slice(0, idx) + section + '\n\n' + content.slice(idx);
    writeFileSync(path, updated);
  } else {
    writeFileSync(path, content.trimEnd() + '\n\n' + section + '\n');
  }
  console.log(`  ✓ CHANGELOG.md — generated from commits`);
}

// ── Version Bump Detection ───────────────────────────────────────────────────

function detectBump(): Bump | null {
  const commits = getCommitsSinceLastTag();
  const nonRelease = commits.filter(c => !c.subject.startsWith('release:'));
  if (nonRelease.length === 0) return null;

  let bump: Bump | null = null;

  for (const { subject, body } of nonRelease) {
    const parsed = parseCommitLine(subject);
    if (!parsed) continue;

    if (parsed.breaking || BREAKING_FOOTER_RE.test(body)) {
      return 'major';
    }
    if (parsed.type === 'feat') {
      bump = 'minor';
    }
    if (bump === null && PATCH_TYPES.has(parsed.type)) {
      bump = 'patch';
    }
  }

  return bump;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const arg = process.argv[2];
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

function resolveBump(): { bump: Bump; current: string; next: string } | null {
  let bump: Bump;
  if (arg === 'auto' || arg === 'detect') {
    const detected = detectBump();
    if (!detected) return null;
    bump = detected;
  } else if (['major', 'minor', 'patch'].includes(arg)) {
    bump = arg as Bump;
  } else {
    console.error('Usage: bun run release:bump <major|minor|patch|auto|detect>');
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const current = pkg.version;
  const next = bumpVersion(current, bump);
  return { bump, current, next };
}

const resolved = resolveBump();

if (!resolved) {
  console.log('No versionable commits since last tag. SKIP_RELEASE');
  process.exit(0);
}

const { bump, current, next } = resolved;

// detect mode: output version and bump type, then exit (no side effects)
if (arg === 'detect') {
  console.log(`${next} ${bump}`);
  process.exit(0);
}

console.log(`Auto-detected bump: ${bump}`);
console.log(`\nBumping ${current} → ${next} (${bump})\n`);

// Update all files
for (const file of FILES) {
  updateFile(file, next);
}
updateChangelog(next);

// Git commit (and tag unless --no-tag)
const skipTag = process.argv.includes('--no-tag');
console.log(`\nCommitting${skipTag ? '' : ' and tagging'}...\n`);

if (isCI) {
  execSync('git config user.name "github-actions[bot]"', { cwd: ROOT, stdio: 'inherit' });
  execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { cwd: ROOT, stdio: 'inherit' });
}

execSync('git add -A', { cwd: ROOT, stdio: 'inherit' });
execSync(`git commit -m "release: v${next}"`, { cwd: ROOT, stdio: 'inherit' });
if (!skipTag) {
  execSync(`git tag v${next}`, { cwd: ROOT, stdio: 'inherit' });
}

console.log(`\n✅ Release v${next} ready!`);

if (!isCI) {
  console.log(`\nNext steps:`);
  console.log(`  1. git push origin main --tags`);
  console.log(`  2. GitHub Actions will create the release automatically\n`);
}
