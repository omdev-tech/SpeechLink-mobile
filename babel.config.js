module.exports = function(api) {
  api.cache(true);
  return {
    // babel-preset-expo already applies @babel/plugin-transform-runtime (helpers + regenerator).
    presets: ['babel-preset-expo'],
    env: {
      // Release bundles (`expo export`, EAS / Gradle `export:embed`) run with NODE_ENV=production.
      // Strip console.log/info/debug so they never reach logcat / the iOS syslog. warn + error are
      // kept for crash diagnostics; src/utils/safeConsole redacts secrets from whatever remains.
      production: {
        plugins: [['transform-remove-console', { exclude: ['error', 'warn'] }]],
      },
    },
  };
};
