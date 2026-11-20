import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { ONCADE } from './oncade.ts';

export interface TestEnv {
  /** Configure Oncade with the `ONCADE` test values. Default: unset. */
  oncade?: boolean;
  /** Default: `production`, the strictest mode (no 500 messages, CSP upgrades requests). */
  nodeEnv?: string;
  /** Directory of the built UI. Default: a path that does not exist, so no SPA is served. */
  uiDir?: string;
}

/**
 * Sets every variable `config.ts` reads, so nothing leaks in from the shell. It must run before
 * the first import of `src/api/config.ts` in the process: config is read once, at import. Each
 * test file runs in its own process (`--test-isolation=process`), so each file gets one setting.
 */
export const setTestEnv = ({ oncade = false, nodeEnv = 'production', uiDir }: TestEnv = {}) => {
  process.env['NODE_ENV'] = nodeEnv;
  process.env['UI_DIST_DIR'] = uiDir ?? path.join(os.tmpdir(), `no-ui-${randomUUID()}`);
  delete process.env['PORT'];

  if (oncade) {
    process.env['ONCADE_API_KEY'] = ONCADE.apiKey;
    process.env['ONCADE_BUSINESS_ID'] = ONCADE.businessId;
    process.env['ONCADE_API_URL'] = ONCADE.apiUrl;
  } else {
    delete process.env['ONCADE_API_KEY'];
    delete process.env['ONCADE_BUSINESS_ID'];
    delete process.env['ONCADE_API_URL'];
  }
};

/** Sets the environment, then imports and builds the app. Call it once per test file. */
export const loadApp = async (env?: TestEnv): Promise<Express> => {
  setTestEnv(env);
  const { createApp } = await import('../../src/api/app.ts');
  return createApp();
};
