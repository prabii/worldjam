import type {
  AccompanimentLayer,
  ArrangementPlan,
  MusicalRole,
  Style,
  WorldJamObject,
} from '@/types';

/**
 * The rule-based arranger.
 *
 * This is not a placeholder for the model — it is the safety floor the HLD
 * demands. If Gemma is slow, absent, or returns junk, this produces a musical
 * pattern instantly so the loop never stalls. It is also what runs on the very
 * first tap, before the model has been asked anything.
 *
 * The patterns are per-role and per-style, built on the conventional backbeat:
 * kick on 1 and 3, snare on 2 and 4, hats on the offbeats.
 */

type RolePatterns = Record<MusicalRole, number[]>;

const STYLE_PATTERNS: Record<Style, RolePatterns> = {
  chill: {
    kick: [1, 3],
    snare: [2, 4],
    hat: [1, 2, 3, 4],
    perc: [2, 4],
    bass: [1, 3],
    lead: [1],
    texture: [1],
  },
  jazz: {
    // Jazz moves the weight off the downbeat and rides the offbeats.
    kick: [1],
    snare: [2, 4],
    hat: [1, 2.66, 3, 4.66],
    perc: [2.66, 4.66],
    bass: [1, 2, 3, 4],
    lead: [1],
    texture: [3],
  },
  lofi: {
    kick: [1, 3.5],
    snare: [3],
    hat: [1, 2, 3, 4],
    perc: [4.5],
    bass: [1, 3.5],
    lead: [1],
    texture: [1],
  },
  cinematic: {
    kick: [1],
    snare: [3],
    hat: [],
    perc: [4],
    bass: [1],
    lead: [1],
    texture: [1, 3],
  },
  edm: {
    kick: [1, 2, 3, 4],
    snare: [2, 4],
    hat: [1.5, 2.5, 3.5, 4.5],
    perc: [4.5],
    bass: [1, 2, 3, 4],
    lead: [1],
    texture: [1],
  },
  rock: {
    kick: [1, 3],
    snare: [2, 4],
    hat: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5],
    perc: [4],
    bass: [1, 3],
    lead: [1],
    texture: [1],
  },
};

const STYLE_BPM: Record<Style, number> = {
  chill: 92,
  jazz: 120,
  lofi: 78,
  cinematic: 70,
  edm: 128,
  rock: 110,
};

/**
 * Layers per style.
 *
 * Every style includes 'perc': two recorded objects cannot carry a groove on
 * their own, and a shaker/hat pattern underneath gives the loop a pulse
 * without competing with the real sounds. Sparse captures sounded empty
 * without it.
 */
const STYLE_LAYERS: Record<Style, AccompanimentLayer[]> = {
  chill: ['bass', 'chords', 'perc'],
  jazz: ['bass', 'chords', 'perc'],
  lofi: ['bass', 'chords', 'pad', 'perc'],
  cinematic: ['pad', 'chords', 'perc'],
  edm: ['bass', 'arp', 'perc'],
  rock: ['bass', 'guitar', 'perc'],
};

/**
 * Builds a playable plan from the objects alone. Deterministic: the same
 * objects and style always yield the same arrangement, which matters when
 * rehearsing a demo.
 */
export function buildFallbackPlan(
  objects: WorldJamObject[],
  style: Style = 'chill',
  bpmHint?: number | null,
): ArrangementPlan {
  const patterns = STYLE_PATTERNS[style];
  const bpm = bpmHint && bpmHint >= 60 && bpmHint <= 180 ? Math.round(bpmHint) : STYLE_BPM[style];

  // Two objects sharing a role would play in unison and sound like one thicker
  // object, so the second gets offset to keep both audible.
  const usedRoles = new Map<MusicalRole, number>();

  const objectPattern = objects
    .map((obj) => {
      const seen = usedRoles.get(obj.role) ?? 0;
      usedRoles.set(obj.role, seen + 1);

      let beats = [...(patterns[obj.role] ?? patterns.perc)];
      if (seen > 0 && beats.length > 0) {
        beats = beats.map((b) => {
          const shifted = b + 0.5 * seen;
          return shifted > 4.99 ? shifted - 4 : shifted;
        });
        beats.sort((a, b) => a - b);
      }

      return { object: obj.label, beats };
    })
    .filter((p) => p.beats.length > 0);

  return {
    bpm,
    bars: 4,
    objectPattern,
    voiceRole: 'lead',
    accompaniment: STYLE_LAYERS[style],
    style,
    source: 'fallback',
    reasoning: `Rule-based ${style} arrangement from ${objects.length} captured object(s).`,
  };
}

/**
 * Re-styles a plan while keeping the same captured objects and their roles.
 * This is what "make it jazz" falls back to when the model is unavailable:
 * the beats genuinely change per the new style's feel, but every sound in the
 * arrangement is still the user's own recording.
 */
export function restylePlan(
  plan: ArrangementPlan,
  objects: WorldJamObject[],
  style: Style,
): ArrangementPlan {
  const restyled = buildFallbackPlan(objects, style);
  return {
    ...restyled,
    bars: plan.bars,
    voiceRole: plan.voiceRole,
    reasoning: `Re-styled to ${style}: same captured sounds, new rhythmic feel.`,
  };
}

export { STYLE_PATTERNS, STYLE_BPM, STYLE_LAYERS };
