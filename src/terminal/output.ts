const ESC = '\x1b';
const ALT_SCREEN_ON = `${ESC}[?1049h`;
const ALT_SCREEN_OFF = `${ESC}[?1049l`;
const CURSOR_HIDE = `${ESC}[?25l`;
const CURSOR_SHOW = `${ESC}[?25h`;
const CURSOR_HOME = `${ESC}[H`;
const CLEAR_SCREEN = `${ESC}[2J`;

export class TerminalOutput {
  private active = false;
  private resizeCallbacks: Array<() => void> = [];
  private boundCleanup: () => void;

  constructor() {
    this.boundCleanup = () => this.leave();
  }

  enter(): void {
    if (this.active) return;
    this.active = true;

    process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE + CLEAR_SCREEN + CURSOR_HOME);

    process.on('SIGINT', this.boundCleanup);
    process.on('SIGTERM', this.boundCleanup);
    process.on('uncaughtException', (err) => {
      this.leave();
      console.error(err);
      process.exit(1);
    });
  }

  leave(): void {
    if (!this.active) return;
    this.active = false;

    process.stdout.write(CURSOR_SHOW + ALT_SCREEN_OFF);

    process.removeListener('SIGINT', this.boundCleanup);
    process.removeListener('SIGTERM', this.boundCleanup);
    process.removeAllListeners('SIGWINCH');
  }

  setCursorHome(): void {
    process.stdout.write(CURSOR_HOME);
  }

  write(data: string): void {
    if (typeof process.stdout.cork === 'function') {
      process.stdout.cork();
    }
    process.stdout.write(data);
    if (typeof process.stdout.uncork === 'function') {
      process.stdout.uncork();
    }
  }

  getSize(): { cols: number; rows: number } {
    return {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
    };
  }

  onResize(callback: () => void): void {
    this.resizeCallbacks.push(callback);

    if (this.resizeCallbacks.length === 1) {
      process.on('SIGWINCH', () => {
        for (const cb of this.resizeCallbacks) {
          cb();
        }
      });
    }
  }
}
