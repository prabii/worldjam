import type { MusicPlan, NoteName, PlanLyrics, PlanPatch, ScaleId, StyleId } from '../contracts/musicPlan';
import { extractJson } from '@/ai/schema';

import { buildEditPrompt, buildPlanPrompt, patchSchema, planSchema, SYSTEM_PROMPT_VERSION } from './context';
import { captureRefs, fallbackPatch, fallbackPlan, type PlannerCapture } from './fallback';
import { interpretPrompt } from './interpret';
import { KB_VERSION } from './kb/rules';
import { applyPatch } from './patches';
import { validatePlan, type ValidateContext } from './validator';

/** The on-device model, injected so orchestration is testable without it. */
export interface LlmClient {
  readonly model: string;
  complete(prompt: string, opts: { jsonSchema?: object | null; maxTokens: number; temperature: number }): Promise<string>;
}

export interface PlanRequest {
  captures: PlannerCapture[];
  prompt: string;
  style?: StyleId | null;
  durationSec: number;
  lock?: { tempoBpm?: number | null; key?: NoteName | null; scale?: ScaleId | null };
  lyrics?: PlanLyrics | null;
  /** Called as the job advances, for the progress UI. */
  onStage?: (stage: 'ANALYZING' | 'PLANNING' | 'VALIDATING') => void;
}

export interface PlanOutcome {
  plan: MusicPlan;
  source: 'model' | 'repaired' | 'fallback';
  repairs: string[];
  /** Why the model's answer was not used, when source = fallback. */
  error: string | null;
  timings: { planningMs: number };
  versions: { model: string | null; kb: string; systemPrompt: string };
}

const PLAN_TIMEOUT_MS = 120_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`model took longer than ${Math.round(ms / 1000)} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function ctxFor(req: PlanRequest, style: StyleId, intent: ReturnType<typeof interpretPrompt>): ValidateContext {
  return {
    captures: captureRefs(req.captures),
    durationSec: intent.durationSec ?? req.durationSec,
    style,
    lock: req.lock,
    featured: intent.featured,
    excluded: intent.excluded,
  };
}

/**
 * Prompt → MusicPlan: model with grammar-constrained JSON, validate, one
 * repair round with the validator's complaints, then the deterministic
 * planner. Always returns a playable plan.
 */
export async function generatePlan(req: PlanRequest, llm: LlmClient | null): Promise<PlanOutcome> {
  req.onStage?.('ANALYZING');
  const intent = interpretPrompt(req.prompt, req.captures);
  const style: StyleId = intent.style ?? req.style ?? 'chill';
  const ctx = ctxFor(req, style, intent);
  const versions = { model: llm?.model ?? null, kb: KB_VERSION, systemPrompt: SYSTEM_PROMPT_VERSION };
  const started = Date.now();
  const fallback = (error: string, repairs: string[] = []): PlanOutcome => ({
    plan: withLyrics(fallbackPlan({ captures: req.captures, intent, style, durationSec: req.durationSec, lock: req.lock }), req.lyrics),
    source: 'fallback',
    repairs,
    error,
    timings: { planningMs: Date.now() - started },
    versions,
  });

  if (req.captures.length === 0) return fallback('no sounds selected');
  if (!llm) return fallback('music director model not loaded');

  const prompt = buildPlanPrompt({ captures: req.captures, prompt: req.prompt, intent, style, durationSec: ctx.durationSec, lock: req.lock, lyrics: req.lyrics });
  const schema = planSchema(req.captures.map((c) => c.id));
  req.onStage?.('PLANNING');
  let raw: string;
  try {
    raw = await withTimeout(llm.complete(prompt, { jsonSchema: schema, maxTokens: 700, temperature: 0.4 }), PLAN_TIMEOUT_MS);
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  }
  req.onStage?.('VALIDATING');
  let v = validatePlan(raw, ctx);
  if (v.plan && v.errors.length === 0) {
    return { plan: withLyrics(v.plan, req.lyrics), source: 'model', repairs: v.repairs, error: null, timings: { planningMs: Date.now() - started }, versions };
  }

  // One repair round: tell the model exactly what was wrong.
  const complaint = v.errors.join('; ') || 'the plan could not be used';
  try {
    req.onStage?.('PLANNING');
    const retry = await withTimeout(
      llm.complete(`${prompt}\n\nYour previous answer had problems: ${complaint}. Use only the listed sound ids. Reply with corrected JSON.`, {
        jsonSchema: schema,
        maxTokens: 700,
        temperature: 0.2,
      }),
      PLAN_TIMEOUT_MS,
    );
    req.onStage?.('VALIDATING');
    v = validatePlan(retry, ctx);
    if (v.plan) {
      return { plan: withLyrics(v.plan, req.lyrics), source: 'repaired', repairs: [...v.repairs, `repaired: ${complaint}`], error: null, timings: { planningMs: Date.now() - started }, versions };
    }
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err), v.repairs);
  }
  return fallback(`model plan unusable: ${complaint}`, v.repairs);
}

function withLyrics(plan: MusicPlan, lyrics: PlanLyrics | null | undefined): MusicPlan {
  return lyrics ? { ...plan, lyrics } : plan;
}

export interface EditOutcome {
  plan: MusicPlan;
  summary: string;
  applied: string[];
  rejected: string[];
  source: 'model' | 'fallback';
  error: string | null;
}

/**
 * Prompt edit of an existing plan. The model answers with a PATCH (small,
 * controllable changes, per the HLD); if it cannot, the editing-language rules
 * produce one. The patched plan is re-validated.
 */
export async function editPlan(
  plan: MusicPlan,
  instruction: string,
  captures: PlannerCapture[],
  llm: LlmClient | null,
  lock?: PlanRequest['lock'],
): Promise<EditOutcome> {
  const intent = interpretPrompt(instruction, captures);
  const ctx: ValidateContext = { captures: captureRefs(captures), durationSec: plan.durationSec, style: plan.style, lock };
  const deterministic = (error: string | null): EditOutcome => {
    const patch = fallbackPatch(plan, instruction, intent);
    const r = applyPatch(plan, patch, ctx);
    return { plan: r.plan, summary: patch.summary ?? '', applied: r.applied, rejected: r.rejected, source: 'fallback', error };
  };
  if (!llm) return deterministic('music director model not loaded');
  try {
    const raw = await withTimeout(
      llm.complete(buildEditPrompt(plan, instruction, captures), {
        jsonSchema: patchSchema(plan.layers.map((l) => l.id), plan.sections.map((s) => s.id)),
        maxTokens: 400,
        temperature: 0.3,
      }),
      PLAN_TIMEOUT_MS,
    );
    const patch = extractJson(raw) as PlanPatch | null;
    if (!patch || !Array.isArray(patch.operations) || patch.operations.length === 0) return deterministic('model returned no changes');
    const r = applyPatch(plan, patch, ctx);
    if (r.applied.length === 0) return deterministic('model changes did not apply');
    return { plan: r.plan, summary: patch.summary ?? r.applied.join(', '), applied: r.applied, rejected: r.rejected, source: 'model', error: null };
  } catch (err) {
    return deterministic(err instanceof Error ? err.message : String(err));
  }
}
