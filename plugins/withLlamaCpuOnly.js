const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Keeps llama.rn (Gemma) on the CPU.
 *
 * llama.rn's Gradle hook (syncRNLlamaHtpAssets) copies its Hexagon DSP backend
 * into the app's src/main/assets/ggml-hexagon/ before every build, and at
 * startup llama.rn extracts and brings up that backend when the assets exist.
 * On the iQOO 15 every Gemma load then fails with "Unknown error". Our earlier
 * dev builds predate the asset sync and ran Gemma on the CPU without trouble.
 * Dropping the folder from the merged assets makes llama.rn fall back to that
 * CPU path. (The vision module's QNN runtime is separate and unaffected.)
 *
 * AGP 8 ignores androidResources.ignoreAssetsPattern when merging assets, so
 * the folder is removed from each merge task's output instead.
 */
const MARKER = '// withLlamaCpuOnly';
const BLOCK = `
${MARKER}
tasks.matching { it.name ==~ /merge\\w*Assets/ }.configureEach { mergeTask ->
    mergeTask.doLast {
        delete(new File(mergeTask.outputDir.get().asFile, "ggml-hexagon"))
    }
}
`;

module.exports = function withLlamaCpuOnly(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    // Drop the earlier androidResources attempt if a previous prebuild added it.
    gradle = gradle.replace(/[ \t]*\/\/ withLlamaCpuOnly\r?\n[ \t]*androidResources \{[\s\S]*?\r?\n[ \t]*\}\r?\n/, '');
    if (!gradle.includes(MARKER)) gradle = gradle.trimEnd() + '\n' + BLOCK;
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
