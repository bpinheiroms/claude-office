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
  transcriptPath: string;
}

export function parseStdin(raw: string): StdinData {
  const defaults: StdinData = {
    modelName: '',
    contextPercent: 0,
    contextTokens: 0,
    contextWindowSize: 200_000,
    cwd: '',
    transcriptPath: '',
  };

  if (!raw.trim()) return defaults;

  try {
    const data = JSON.parse(raw);
    const modelName = data?.model?.display_name || '';
    const ctxWindow = data?.context_window;
    const windowSize = ctxWindow?.context_window_size || 200_000;

    // Prefer the pre-computed used_percentage from Claude Code
    let contextPercent = ctxWindow?.used_percentage ?? 0;
    if (!contextPercent && ctxWindow?.current_usage) {
      // Fallback: compute from total tokens
      const totalInput = (ctxWindow.current_usage.input_tokens || 0)
        + (ctxWindow.current_usage.cache_read_input_tokens || 0)
        + (ctxWindow.current_usage.cache_creation_input_tokens || 0);
      contextPercent = windowSize > 0
        ? Math.min(100, Math.round((totalInput / windowSize) * 100))
        : 0;
    }

    const contextTokens = ctxWindow?.total_input_tokens || 0;
    const cwd = data?.cwd || '';
    const transcriptPath = data?.transcript_path || '';

    return { modelName, contextPercent, contextTokens, contextWindowSize: windowSize, cwd, transcriptPath };
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
