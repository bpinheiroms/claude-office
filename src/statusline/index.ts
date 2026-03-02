/**
 * Statusline entry point for Claude Code (Bun runtime).
 *
 * Claude Code invokes this every ~300ms:
 *   echo '<stdin json>' | bun run src/statusline/index.ts
 *
 * Reads stdin, collects quota + usage data, renders single line to stdout, exits.
 */

import { readStdin, parseStdin } from './stdin.js';
import { scanUsage } from './usage-scanner.js';
import { render } from './render.js';
import { getQuota } from '../data/quota-api.js';

async function main(): Promise<void> {
  const raw = await readStdin();
  const stdin = parseStdin(raw);

  const [quota, usage] = await Promise.all([
    getQuota(),
    scanUsage(),
  ]);

  const output = render(stdin, quota, usage);
  if (output) {
    process.stdout.write(output + '\n');
  }
}

main().catch(() => {
  process.stdout.write('\u00A0\n');
});
