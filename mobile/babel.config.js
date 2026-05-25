module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo auto-configures expo-router and the reanimated/worklets plugin.
    presets: ["babel-preset-expo"],
  };
};
