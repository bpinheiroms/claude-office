export type Protocol = 'sixel' | 'kitty' | 'halfblock';

// Only match TERM_PROGRAM (not TERM!) to avoid false positives
// like xterm-256color which is used by many non-sixel terminals
const SIXEL_TERM_PROGRAMS = ['WezTerm', 'iTerm.app', 'foot', 'mlterm'];

export function detectProtocol(): Protocol {
  const env = process.env;
  const termProgram = env.TERM_PROGRAM ?? '';
  const term = env.TERM ?? '';

  // Kitty: highest priority (Kitty, Ghostty both support kitty protocol)
  if (env.KITTY_WINDOW_ID || term.includes('kitty') ||
      termProgram === 'ghostty' || term.includes('ghostty')) {
    return 'kitty';
  }

  // Sixel: only check TERM_PROGRAM to avoid xterm-256color false positives
  for (const name of SIXEL_TERM_PROGRAMS) {
    if (termProgram.includes(name)) {
      return 'sixel';
    }
  }

  // Real xterm (not xterm-256color used by other terminals)
  if (termProgram === 'xterm' || termProgram === 'XTerm') {
    return 'sixel';
  }

  // Halfblock: universal fallback (Zed, Alacritty, Zellij, etc.)
  return 'halfblock';
}

export function getCanvasSize(protocol: Protocol): { width: number; height: number } {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  if (protocol === 'halfblock') {
    return { width: cols, height: rows * 2 };
  }

  // Sixel and Kitty: full pixel resolution
  return { width: cols * 8, height: rows * 16 };
}
