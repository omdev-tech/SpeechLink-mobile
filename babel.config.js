module.exports = function(api) {
  api.cache(true);
  return {
    // babel-preset-expo already applies @babel/plugin-transform-runtime (helpers + regenerator).
    presets: ['babel-preset-expo'],
  };
};
