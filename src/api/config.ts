import path from 'node:path';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
};

export const config = {
  port: Number.parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  /** Required at boot: the server refuses to start without it. */
  adminPass: requireEnv('ADMIN_PASS'),
  /** Directory holding the built React bundle that Express serves. */
  uiDir: path.resolve(process.cwd(), process.env['UI_DIST_DIR'] ?? 'dist/ui'),
} as const;
