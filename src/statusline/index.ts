/**
 * Statusline entry point for Claude Code (Bun runtime).
 *
 * Claude Code invokes this every ~300ms:
 *   echo '<stdin json>' | bun run src/statusline/index.ts
 *
 * Reads stdin, loads config, collects data from file-based caches, renders to stdout, exits.
 */

import { readStdin, parseStdin } from './stdin.js';
import { scanUsage } from './usage-scanner.js';
import { render } from './render.js';
import { getQuota } from '../data/quota-api.js';
import { loadConfig } from './config.js';
import { parseTranscript } from './transcript.js';

async function main(): Promise<void> {
  // 1. Read stdin and config in parallel
  const [raw, config] = await Promise.all([
    readStdin(),
    loadConfig(),
  ]);
  const stdin = parseStdin(raw);

  // 2. Collect data in parallel (each uses file-based caches)
  const needsTranscript = config.showTools || config.showAgents || config.showTodos;
  const [quota, usage, transcript] = await Promise.all([
    getQuota(),
    scanUsage(),
    needsTranscript ? parseTranscript(stdin.transcriptPath) : null,
  ]);

  // 3. Render and output
  const output = render(stdin, quota, usage, config, transcript);
  if (output) {
    process.stdout.write(output + '\n');
  }
}

main().catch(() => {
  process.stdout.write('\u00A0\n');
});
