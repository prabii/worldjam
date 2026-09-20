const { withGradleProperties } = require('expo/config-plugins');

/**
 * Build settings that must survive `expo prebuild`.
 *
 * android/ is regenerated wholesale by prebuild, so anything hand-edited there
 * is lost. These were all found the hard way on a 7.4 GB machine:
 *
 *  - Gradle's default heap OOM-crashed the JVM when the page file was small.
 *  - The CMake/prefab step forks ANOTHER JVM, so a heap that fits on its own
 *    still dies at prefab time ("The paging file is too small") unless the
 *    system has real virtual-memory headroom.
 *  - Metaspace, not heap, is what kills the Kotlin compiler here: it holds
 *    class metadata per module, and ~30 modules overflow the default.
 *
 * On a machine with plenty of RAM these are merely conservative, not wrong.
 */
const PROPERTIES = [
  ['org.gradle.jvmargs', '-Xmx2048m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8'],
  ['org.gradle.parallel', 'false'],
  ['org.gradle.configureondemand', 'true'],
  // Without this Gradle tries to auto-provision a JDK toolchain and fails.
  ['org.gradle.java.installations.auto-download', 'false'],
  // A separate Kotlin daemon gets its own metaspace. Compiling ~30 modules
  // in-process piles every module's class metadata into the Gradle daemon and
  // dies with "OutOfMemoryError: Metaspace" — an error that surfaces as the
  // opaque "Compiler terminated with internal error".
  ['kotlin.compiler.execution.strategy', 'daemon'],
  ['kotlin.daemon.jvmargs', '-Xmx1536m -XX:MaxMetaspaceSize=768m'],
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
