/**
 * Statusline entry point for Claude Code (Bun runtime).
 *
 * Claude Code invokes this every ~300ms:
 *   echo '<stdin json>' | bun run src/statusline/index.ts
 *
 * Reads stdin, collects data from file-based caches, renders to stdout, exits.
 */

import { readStdin, parseStdin } from './stdin.js';
import { scanAgents } from './agent-scanner.js';
import { scanUsage } from './usage-scanner.js';
import { render } from './render.js';
import { getQuota } from '../data/quota-api.js';

async function main(): Promise<void> {
  // 1. Read stdin (Bun.stdin native)
  const raw = await readStdin();
  const stdin = parseStdin(raw);

  // 2. Collect data in parallel (each uses file-based caches)
  const [quota, agents, usage] = await Promise.all([
    getQuota(),
    scanAgents(),
    scanUsage(),
  ]);

  // 3. Render and output
  const output = render(stdin, quota, agents, usage);
  if (output) {
    process.stdout.write(output + '\n');
  }
}

main().catch(() => {
  process.stdout.write('\u00A0\n');
});
