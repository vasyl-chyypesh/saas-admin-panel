import { mock } from 'node:test';

/**
 * Silences `console.error` and `console.warn` for the whole test file (each file runs in its own
 * process) and keeps the calls, so tests can check what was logged, and what never was.
 */
export const captureConsole = () => {
  const error = mock.method(console, 'error', () => {});
  const warn = mock.method(console, 'warn', () => {});

  return {
    error,
    warn,
    /** Every captured line, arguments joined by spaces. */
    lines: (): string[] =>
      [...error.mock.calls, ...warn.mock.calls].map((call) =>
        call.arguments.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      ),
    reset: (): void => {
      error.mock.resetCalls();
      warn.mock.resetCalls();
    },
  };
};
