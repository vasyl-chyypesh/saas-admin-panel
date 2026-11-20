import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

type Config = (typeof import('../../src/api/config.ts'))['config'];

const VARIABLES = [
  'PORT',
  'NODE_ENV',
  'UI_DIST_DIR',
  'ONCADE_API_KEY',
  'ONCADE_BUSINESS_ID',
  'ONCADE_API_URL',
] as const;

const TEST_KEY = 'oncade_platform_test_abc123';
const LIVE_KEY = 'oncade_platform_live_abc123';

let loads = 0;

/**
 * `config.ts` reads the environment once, at import. A new query string is a new module URL, so
 * each call evaluates the module afresh against exactly `env`.
 */
const loadConfig = async (env: Partial<Record<(typeof VARIABLES)[number], string>>) => {
  for (const name of VARIABLES) delete process.env[name];
  Object.assign(process.env, env);
  loads += 1;
  const specifier = `../../src/api/config.ts?load=${loads}`;
  const module = (await import(specifier)) as { config: Config };
  return module.config;
};

describe('config', () => {
  it('boots with an empty environment', async () => {
    const config = await loadConfig({});
    assert.equal(config.port, 3000);
    assert.equal(config.nodeEnv, 'development');
    assert.equal(config.uiDir, path.resolve(process.cwd(), 'dist/ui'));
    assert.equal(config.oncade, undefined);
  });

  it('reads PORT, NODE_ENV and UI_DIST_DIR', async () => {
    const config = await loadConfig({
      PORT: '8080',
      NODE_ENV: 'production',
      UI_DIST_DIR: '/srv/ui',
    });
    assert.equal(config.port, 8080);
    assert.equal(config.nodeEnv, 'production');
    assert.equal(config.uiDir, path.resolve('/srv/ui'));
  });

  describe('oncade', () => {
    it('is undefined when both variables are blank', async () => {
      const config = await loadConfig({ ONCADE_API_KEY: '', ONCADE_BUSINESS_ID: '' });
      assert.equal(config.oncade, undefined);
    });

    it('takes the environment from a test key and defaults the API URL', async () => {
      const config = await loadConfig({ ONCADE_API_KEY: TEST_KEY, ONCADE_BUSINESS_ID: 'biz_1' });
      assert.deepEqual(config.oncade, {
        apiKey: TEST_KEY,
        businessId: 'biz_1',
        apiUrl: 'https://www.oncade.gg',
        environment: 'test',
      });
    });

    it('takes the environment from a live key', async () => {
      const config = await loadConfig({ ONCADE_API_KEY: LIVE_KEY, ONCADE_BUSINESS_ID: 'biz_1' });
      assert.equal(config.oncade?.environment, 'live');
    });

    it('strips trailing slashes from ONCADE_API_URL', async () => {
      const config = await loadConfig({
        ONCADE_API_KEY: TEST_KEY,
        ONCADE_BUSINESS_ID: 'biz_1',
        ONCADE_API_URL: 'https://oncade.example//',
      });
      assert.equal(config.oncade?.apiUrl, 'https://oncade.example');
    });

    it('fails at boot when only the key is set', async () => {
      await assert.rejects(loadConfig({ ONCADE_API_KEY: TEST_KEY }), {
        message: 'Set both ONCADE_API_KEY and ONCADE_BUSINESS_ID, or neither.',
      });
    });

    it('fails at boot when only the business id is set', async () => {
      await assert.rejects(loadConfig({ ONCADE_BUSINESS_ID: 'biz_1' }), /Set both/);
    });

    it('rejects a key without the platform prefix, without echoing it', async () => {
      const key = 'sk_live_do-not-echo-me';
      await assert.rejects(
        loadConfig({ ONCADE_API_KEY: key, ONCADE_BUSINESS_ID: 'biz_1' }),
        (err: Error) => {
          assert.match(err.message, /must be a platform key/);
          assert.ok(!err.message.includes(key), 'the error message quotes the key');
          return true;
        },
      );
    });

    for (const url of ['http://oncade.example', 'not a url']) {
      it(`rejects ONCADE_API_URL ${JSON.stringify(url)}`, async () => {
        await assert.rejects(
          loadConfig({
            ONCADE_API_KEY: TEST_KEY,
            ONCADE_BUSINESS_ID: 'biz_1',
            ONCADE_API_URL: url,
          }),
          { message: 'ONCADE_API_URL must be an https:// URL.' },
        );
      });
    }
  });
});
