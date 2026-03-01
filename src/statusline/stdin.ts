/**
 * Parse Claude Code's stdin JSON for the statusline.
 * Uses Bun.stdin for native async reading.
 */

export interface StdinData {
  modelName: string;
  contextPercent: number;
  contextTokens: number;
  contextWindowSize: number;
  cwd: string;
}

export function parseStdin(raw: string): StdinData {
  const defaults: StdinData = {
    modelName: '',
    contextPercent: 0,
    contextTokens: 0,
    contextWindowSize: 200_000,
    cwd: '',
  };

  if (!raw.trim()) return defaults;

  try {
    const data = JSON.parse(raw);
    const modelName = data?.model?.display_name || '';
    const inputTokens = data?.context_window?.current_usage?.input_tokens || 0;
    const windowSize = data?.context_window?.context_window_size || 200_000;
    const contextPercent = windowSize > 0
      ? Math.min(100, Math.round((inputTokens / windowSize) * 100))
      : 0;
    const cwd = data?.cwd || '';

    return { modelName, contextPercent, contextTokens: inputTokens, contextWindowSize: windowSize, cwd };
  } catch {
    return defaults;
  }
}

export async function readStdin(): Promise<string> {
  try {
    return await Bun.stdin.text();
  } catch {
    return '';
  }
}
