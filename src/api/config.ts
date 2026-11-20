import path from 'node:path';

/** An unset or empty variable is `undefined`, so a blank line in `.env` means "not configured". */
const optionalEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

export interface OncadeConfig {
  apiKey: string;
  /** Our single Oncade business; sent as `X-Target-Business-Id` on every invoice call. */
  businessId: string;
  apiUrl: string;
  /** Taken from the key prefix. Oncade puts every invoice in the key's environment. */
  environment: 'test' | 'live';
}

/**
 * Optional for now: the server boots without Oncade, and the invoice endpoints answer "not
 * configured" instead. Both values must be set together, so a half-configured deploy fails at boot
 * rather than on the first invoice. Error messages name the variable but never echo its value.
 */
const loadOncadeConfig = (): OncadeConfig | undefined => {
  const apiKey = optionalEnv('ONCADE_API_KEY');
  const businessId = optionalEnv('ONCADE_BUSINESS_ID');
  if (apiKey === undefined && businessId === undefined) return undefined;
  if (apiKey === undefined || businessId === undefined) {
    throw new Error('Set both ONCADE_API_KEY and ONCADE_BUSINESS_ID, or neither.');
  }

  const environment = /^oncade_platform_(test|live)_/.exec(apiKey)?.[1];
  if (environment !== 'test' && environment !== 'live') {
    throw new Error(
      'ONCADE_API_KEY must be a platform key starting with oncade_platform_test_ or oncade_platform_live_.',
    );
  }

  const apiUrl = optionalEnv('ONCADE_API_URL') ?? 'https://www.oncade.gg';
  if (!URL.canParse(apiUrl) || new URL(apiUrl).protocol !== 'https:') {
    throw new Error('ONCADE_API_URL must be an https:// URL.');
  }

  return { apiKey, businessId, apiUrl: apiUrl.replace(/\/+$/, ''), environment };
};

export const config = {
  port: Number.parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  /** Directory holding the built React bundle that Express serves. */
  uiDir: path.resolve(process.cwd(), process.env['UI_DIST_DIR'] ?? 'dist/ui'),
  /** `undefined` when Oncade is not configured. */
  oncade: loadOncadeConfig(),
} as const;
