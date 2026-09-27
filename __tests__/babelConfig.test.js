/**
 * Release builds must not ship console.log/info/debug to logcat/syslog.
 * `expo export` / EAS release bundling run Babel with NODE_ENV=production.
 */
const path = require('path');
const babel = require('@babel/core');

const configFile = path.join(__dirname, '..', 'babel.config.js');
const SRC = "console.log('LOG_MARKER'); console.info('INFO_MARKER'); console.debug('DEBUG_MARKER'); console.warn('WARN_MARKER'); console.error('ERROR_MARKER');";

const transform = (envName) =>
  babel.transformSync(SRC, { configFile, babelrc: false, envName, filename: path.join(__dirname, 'fixture.js') }).code;

describe('babel.config.js', () => {
  it('declares transform-remove-console for env.production (keeping error + warn)', () => {
    const config = require(configFile)({ cache: () => {} , env: () => 'production' });
    const plugins = config.env.production.plugins;
    expect(plugins).toEqual(
      expect.arrayContaining([['transform-remove-console', { exclude: ['error', 'warn'] }]])
    );
  });

  it('strips console.log/info/debug in production but keeps warn/error', () => {
    const out = transform('production');
    expect(out).not.toMatch(/LOG_MARKER|INFO_MARKER|DEBUG_MARKER/);
    expect(out).toMatch(/WARN_MARKER/);
    expect(out).toMatch(/ERROR_MARKER/);
  });

  it('keeps console.log in development', () => {
    expect(transform('development')).toMatch(/LOG_MARKER/);
  });
});
