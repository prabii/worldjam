const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro config.
 *
 * The project ran without one until the detector arrived. Metro only bundles
 * file types it knows are assets, and `.tflite` is not on its default list —
 * so `require('...efficientdet-lite.tflite')` returned undefined and
 * loadTensorflowModel() rejected it with "Invalid source passed", which reads
 * like a bad model file rather than a missing bundler setting.
 */
const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('tflite');

module.exports = config;
