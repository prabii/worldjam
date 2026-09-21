/**
 * Babel config.
 *
 * The project ran without one until frame processors arrived: Metro falls back
 * to babel-preset-expo on its own, so nothing complained. Worklets change that.
 * Both plugins below rewrite functions marked 'worklet' so they can run on a
 * separate JS runtime — without them a frame processor throws at the first
 * frame, on device, with a message that points at the wrong place.
 *
 * Order matters and is not interchangeable: react-native-worklets-core must
 * come before reanimated, and reanimated must be last in the list.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-worklets-core/plugin',
      'react-native-reanimated/plugin',
    ],
  };
};
