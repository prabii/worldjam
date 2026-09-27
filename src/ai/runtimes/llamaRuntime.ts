import { initLlama, type LlamaContext } from 'llama.rn';
import type { GemmaRuntime } from '@/ai/gemma';

/**
 * On-device Gemma via llama.cpp (llama.rn), reading a GGUF q4_0 model from the
 * phone's filesystem.
 *
 * The weights are NOT bundled in the APK. At ~3 GB that would blow past every
 * distribution limit and make every rebuild unbearable, so the model is a file
 * on the device and this reads it by path. Same arrangement AI Edge Gallery
 * uses.
 *
 * Everything here is tuned for one job: emit a small, valid JSON arrangement
 * fast. It is not a chat model in this app.
 */

export interface LlamaOptions {
  /** Absolute on-device path to the .gguf file. */
  modelPath: string;
  /**
   * Short by design. The prompt is a compact session summary and the reply is
   * one small JSON object, so a large window only costs memory and prefill
   * time.
   */
  contextSize?: number;
  /**
   * GPU layers. 0 = CPU only, which is the safe default: Adreno offload via
   * llama.cpp is inconsistent across drivers and a wrong value fails at load
   * rather than degrading. Raise it once measured on the actual handset.
   */
  gpuLayers?: number;
  threads?: number;
}

export interface LlamaRuntimeHandle extends GemmaRuntime {
  /** Loads the model. Safe to call more than once. */
  load(): Promise<void>;
  release(): Promise<void>;
  /** Populated after a failed load, for surfacing in the UI. */
  readonly lastError: string | null;
  generateJson(prompt: string, maxTokens: number, jsonSchema: object | null, temperature: number): Promise<string>;
}

const DEFAULTS = {
  /**
   * The arrangement prompt is a compact session summary and the reply is one
   * small JSON object. 1024 is ample, and on a 4.6B model every extra token of
   * context costs real KV-cache memory on a phone.
   */
  // V2 prompts carry a sound inventory and knowledge-base rules; 4096 fits
  // them plus a full plan reply with room to spare.
  contextSize: 4096,
  gpuLayers: 0,
  /*
   * Six threads on an eight-core phone.
   *
   * Four left half the CPU idle while the arranger timed out; eight starves
   * the audio callback and the UI, which on this app is worse than a slow
   * plan. Six uses the big cores and leaves the little ones for everything
   * that has to stay responsive.
   */
  threads: 6,
};

/**
 * Creates the runtime. Loading is deliberately separate from creation so the
 * app can start instantly and load the model in the background — the core
 * capture/play loop must never wait on a 3 GB file being mapped.
 */
export function createLlamaRuntime(opts: LlamaOptions): LlamaRuntimeHandle {
  const config = { ...DEFAULTS, ...opts };

  let context: LlamaContext | null = null;
  let loading: Promise<void> | null = null;
  let lastError: string | null = null;

  const handle: LlamaRuntimeHandle = {
    name: 'llama.rn-gemma',

    get lastError() {
      return lastError;
    },

    isReady: () => context != null,

    async load(): Promise<void> {
      if (context) return;
      // Concurrent callers share one load rather than mapping the file twice.
      if (loading) return loading;

      loading = (async () => {
        try {
          context = await initLlama({
            model: config.modelPath,
            n_ctx: config.contextSize,
            n_gpu_layers: config.gpuLayers,
            n_threads: config.threads,
            // The arrangement prompt is stateless, so no chat history is kept.
            use_mlock: false,
          });
          lastError = null;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          context = null;
          throw err;
        } finally {
          loading = null;
        }
      })();

      return loading;
    },

    async generate(prompt: string, maxTokens: number): Promise<string> {
      if (!context) {
        throw new Error('model not loaded');
      }

      const result = await context.completion({
        prompt,
        n_predict: maxTokens,
        // Near-zero temperature: this is a structured-output task, and
        // creativity here means malformed JSON.
        temperature: 0.1,
        top_k: 20,
        top_p: 0.9,
        // Gemma 4's turn terminators, plus a guard in case the model tries to
        // emit a second object after the first.
        stop: [...GEMMA4_STOPS, '\n\n\n', '}\n{'],
        penalty_repeat: 1.0,
      });

      return result.text ?? '';
    },

    async generateJson(prompt: string, maxTokens: number, jsonSchema: object | null, temperature: number): Promise<string> {
      if (!context) {
        throw new Error('model not loaded');
      }
      const result = await context.completion({
        prompt,
        n_predict: maxTokens,
        temperature,
        top_k: 40,
        top_p: 0.92,
        stop: [...GEMMA4_STOPS],
        penalty_repeat: 1.05,
        ...(jsonSchema ? { response_format: { type: 'json_schema' as const, json_schema: { strict: true, schema: jsonSchema } } } : {}),
      });
      return result.text ?? '';
    },

    async release(): Promise<void> {
      if (context) {
        await context.release();
        context = null;
      }
    },
  };

  return handle;
}

/**
 * Wraps the arrangement prompt in Gemma 4's chat template.
 *
 * Gemma 4 does NOT use the `<start_of_turn>` markers of Gemma 2/3. Its
 * canonical template (read directly from the GGUF's metadata) is:
 *
 *     <|turn>user\n ... <turn|>\n<|turn>model\n
 *
 * Using the older markers produces a prompt the model was never trained on,
 * and the output degrades badly without any obvious error — so this is
 * verified against the file rather than assumed.
 *
 * Thinking mode is deliberately not opened: `<|channel>thought` would make the
 * model reason at length before answering, and this task needs one small JSON
 * object inside a 4-second budget.
 */
export function formatGemmaPrompt(prompt: string): string {
  return `<|turn>user\n${prompt}<turn|>\n<|turn>model\n`;
}

/** Turn terminators for Gemma 4, used as stop sequences. */
export const GEMMA4_STOPS = ['<turn|>', '<|turn>', '<|channel>', '<eos>'];

/**
 * Qwen's ChatML template.
 *
 * `/no_think` is appended because Qwen3 opens a reasoning block by default.
 * Left on, it spends the whole token budget thinking and returns prose rather
 * than the JSON object the arranger needs.
 */
export function formatQwenPrompt(prompt: string): string {
  return `<|im_start|>user
${prompt} /no_think<|im_end|>
<|im_start|>assistant
`;
}

export const QWEN_STOPS = ['<|im_end|>', '<|im_start|>', '<|endoftext|>'];

/**
 * Picks the chat template from the model file's name.
 *
 * Reading the template from the GGUF metadata would be better, but llama.rn
 * does not expose it before the context is built. Every published GGUF carries
 * its family in the filename, so that is the signal, and the fallback is
 * Gemma's template — what the project shipped with.
 *
 * Using the wrong template does not error. The model just produces worse
 * output, which is exactly why it is worth naming here.
 */
export function promptFormatterFor(modelPath: string): {
  format: (prompt: string) => string;
  stops: string[];
} {
  if (modelPath.toLowerCase().includes('qwen')) {
    return { format: formatQwenPrompt, stops: QWEN_STOPS };
  }
  return { format: formatGemmaPrompt, stops: GEMMA4_STOPS };
}

/**
 * Common locations a GGUF may sit on an Android device.
 *
 * Checked in order by the model picker. App-private storage is preferred:
 * scoped storage on Android 11+ makes shared directories unreliable without
 * extra permissions, and a model the app copied into its own sandbox is always
 * readable.
 */
export const MODEL_SEARCH_PATHS = [
  // App-private external storage FIRST. Everything below needs a runtime
  // storage grant the app does not request, and /data/local/tmp is shell-owned
  // so the app's uid cannot read it at all - the model appeared "missing"
  // despite being on the device.
  '/sdcard/WorldJam/',
  '/storage/emulated/0/WorldJam/',
  '/sdcard/Android/data/com.prxfr.worldjam/files/',
  '/storage/emulated/0/Android/data/com.prxfr.worldjam/files/',
  '/data/local/tmp/llama/',
  '/sdcard/Download/',
  '/sdcard/models/',
  '/storage/emulated/0/Download/',
];
