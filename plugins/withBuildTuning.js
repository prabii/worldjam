const { withGradleProperties } = require('expo/config-plugins');

/**
 * Build settings that must survive `expo prebuild`.
 *
 * android/ is regenerated wholesale by prebuild, so anything hand-edited there
 * is lost. These were all found the hard way on a 7.4 GB machine:
 *
 *  - Gradle's default 2 GB daemon heap OOM-crashes the JVM outright.
 *  - The CMake/prefab step forks ANOTHER JVM, so a heap that fits on its own
 *    still dies at prefab time ("The paging file is too small").
 *  - A separate Kotlin daemon is a third JVM; in-process avoids it.
 *
 * On a machine with plenty of RAM these are merely conservative, not wrong.
 */
const PROPERTIES = [
  ['org.gradle.jvmargs', '-Xmx900m -XX:MaxMetaspaceSize=320m -Dfile.encoding=UTF-8'],
  ['org.gradle.parallel', 'false'],
  ['org.gradle.configureondemand', 'true'],
  // Without this Gradle tries to auto-provision a JDK toolchain and fails.
  ['org.gradle.java.installations.auto-download', 'false'],
  ['kotlin.compiler.execution.strategy', 'in-process'],
  ['kotlin.incremental', 'false'],
  // The loaner is arm64; dropping the other ABIs roughly halves build time.
  ['reactNativeArchitectures', 'arm64-v8a'],
];

module.exports = function withBuildTuning(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of PROPERTIES) {
      const existing = cfg.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );
      if (existing) {
        existing.value = value;
      } else {
        cfg.modResults.push({ type: 'property', key, value });
      }
    }
    return cfg;
  });
};
