import type { GemmaRuntime } from '@/ai/gemma';

/**
 * Adapter scaffold for MediaPipe's LLM Inference API (the most likely on-device
 * Gemma backend for Android).
 *
 * This file is deliberately NOT wired up. Which runtime works — MediaPipe,
 * llama.rn, or ExecuTorch — must be decided on the actual iQOO 15, and the HLD
 * (§9, Day 4) makes that a pre-event task. What is settled is the *contract*:
 * whichever backend wins, it implements `GemmaRuntime` and everything
 * downstream (validation, repair, fallback, timeout) already works.
 *
 * To activate, install a MediaPipe GenAI binding, implement `generate` below,
 * and call `registerGemmaRuntime(createMediaPipeRuntime(...))` at app start.
 */

export interface MediaPipeOptions {
  /** Absolute path to the .task/.bin model bundle on device. */
  modelPath: string;
  /** Keep this low. Longer contexts cost linear time on device. */
  maxTokens?: number;
  /** Near-zero: we want valid JSON, not creative prose. */
  temperature?: number;
  topK?: number;
}

/**
 * Creates a runtime backed by MediaPipe LLM Inference.
 *
 * @throws if called before a MediaPipe binding is installed — failing loudly
 *         here is better than silently registering a runtime that never works,
 *         because `generatePlan` would then just time out on every call.
 */
export function createMediaPipeRuntime(opts: MediaPipeOptions): GemmaRuntime {
  let ready = false;

  return {
    name: 'mediapipe-gemma',

    isReady: () => ready,

    generate: async (_prompt: string, _maxTokens: number): Promise<string> => {
      throw new Error(
        'MediaPipe runtime not implemented. Install a MediaPipe GenAI binding, ' +
          `load the model at ${opts.modelPath}, and implement generate(). ` +
          'Until then WorldJam uses the rule-based arranger, which is fully functional.',
      );
    },
  };
}

/**
 * Notes for whoever wires this up at the event:
 *
 * 1. Model choice: Gemma 3 1B / Gemma 3n E2B int4 are the realistic on-device
 *    sizes. E4B is likely too slow for a 4-second budget on a phone.
 *
 * 2. Measure before trusting. `generatePlan` reports `elapsedMs`; the UI shows
 *    it. If it exceeds PLAN_TIMEOUT_MS the fallback takes over and the demo
 *    still works — but you want to know that is happening.
 *
 * 3. Constrain the output. Set temperature near 0 and cap tokens around 320.
 *    The prompt already demands JSON only; low temperature makes it comply.
 *
 * 4. Do not block app start on model load. Load lazily in the background and
 *    let `isReady()` flip to true when it finishes. The core loop must be
 *    playable the instant the app opens.
 */
