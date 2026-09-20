const { withProjectBuildGradle } = require('expo/config-plugins');

/**
 * Forces the Kotlin Gradle plugin to 1.9.25.
 *
 * React Native 0.76's version catalog (node_modules/react-native/gradle/
 * libs.versions.toml) pins Kotlin to 1.9.24, and that wins over the
 * `android.kotlinVersion` property the generated build.gradle reads. But
 * expo-modules-core ships Compose Compiler 1.5.15, which refuses to compile
 * against anything other than 1.9.25 — so the build fails on a stock prebuild.
 *
 * A buildscript resolution strategy is used rather than editing the catalog
 * because node_modules is not ours to patch and would be lost on reinstall.
 * This runs as part of `expo prebuild`, so it survives regeneration of
 * android/ — which hand-editing android/build.gradle does not.
 */
const KOTLIN_VERSION = '1.9.25';

const FORCE_BLOCK = `
// --- worldjam: pin Kotlin (see plugins/withKotlinPin.js) ---
buildscript {
    configurations.classpath {
        resolutionStrategy {
            force "org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}"
            force "org.jetbrains.kotlin:kotlin-stdlib:${KOTLIN_VERSION}"
            force "org.jetbrains.kotlin:kotlin-reflect:${KOTLIN_VERSION}"
            force "org.jetbrains.kotlin:kotlin-compiler-embeddable:${KOTLIN_VERSION}"
        }
    }
}

allprojects {
    configurations.configureEach {
        resolutionStrategy {
            force "org.jetbrains.kotlin:kotlin-stdlib:${KOTLIN_VERSION}"
            force "org.jetbrains.kotlin:kotlin-reflect:${KOTLIN_VERSION}"
        }
    }
}
// --- end worldjam ---
`;

module.exports = function withKotlinPin(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withKotlinPin: expected a Groovy build.gradle');
    }
    if (cfg.modResults.contents.includes('worldjam: pin Kotlin')) {
      return cfg;
    }
    cfg.modResults.contents += FORCE_BLOCK;
    return cfg;
  });
};
