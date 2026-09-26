import type {
  AccompanimentLayer,
  ArrangementPlan,
  MusicalRole,
  Style,
  WorldJamObject,
} from '@/types';
import { STYLE_FEEL } from '@/audio/groove';

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

/*
 * Director-grade grooves, one bar each (beats 1–4.75 on a sixteenth grid).
 *
 * The earlier set was skeletal — quarter-note hats, kick on 1 and 3 in every
 * genre — which is why every style sounded like the same metronome in a
 * different coat. These are the patterns a drummer actually plays in each
 * genre: syncopated kicks, eighth or sixteenth hats, the offbeat bass of
 * house, the walking bass of jazz. Swing and humanisation are applied later
 * (audio/groove.ts), so these stay on the straight grid.
 */
const STYLE_PATTERNS: Record<Style, RolePatterns> = {
  chill: {
    kick: [1, 2.75, 3],
    snare: [2, 4],
    hat: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5],
    perc: [2.5, 4.75],
    bass: [1, 2.75, 3],
    lead: [1],
    texture: [1],
  },
  jazz: {
    // Kick "feathers" lightly; the ride carries the time: 1, 2-and, 3, 4-and.
    kick: [1, 3.5],
    snare: [2, 4],
    hat: [1, 2, 2.5, 3, 4, 4.5],
    perc: [2.5, 4.5],
    bass: [1, 2, 3, 4],
    lead: [1],
    texture: [1, 3],
  },
  lofi: {
    // Lazy boom-bap: kick lands late, snare on 2 and 4, swung hats.
    kick: [1, 2.75, 3.5],
    snare: [2, 4],
    hat: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5],
    perc: [2.25, 4.75],
    bass: [1, 2.75, 3.5],
    lead: [1],
    texture: [1],
  },
  cinematic: {
    // Space is the instrument: few hits, big gaps.
    kick: [1],
    snare: [3],
    hat: [],
    perc: [2.5, 4],
    bass: [1],
    lead: [1],
    texture: [1, 3],
  },
  edm: {
    // Four on the floor, offbeat hats, offbeat bass — the house engine.
    kick: [1, 2, 3, 4],
    snare: [2, 4],
    hat: [1.5, 2.5, 3.5, 4.5],
    perc: [1.75, 3.75],
    bass: [1.5, 2.5, 3.5, 4.5],
    lead: [1],
    texture: [1],
  },
  rock: {
    kick: [1, 2.5, 3],
    snare: [2, 4],
    hat: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5],
    perc: [4.5],
    bass: [1, 2.5, 3],
    lead: [1],
    texture: [1],
  },
};

// Home tempos come from the director's style table so both arrangers agree.
const STYLE_BPM: Record<Style, number> = {
  chill: STYLE_FEEL.chill.homeBpm,
  jazz: STYLE_FEEL.jazz.homeBpm,
  lofi: STYLE_FEEL.lofi.homeBpm,
  cinematic: STYLE_FEEL.cinematic.homeBpm,
  edm: STYLE_FEEL.edm.homeBpm,
  rock: STYLE_FEEL.rock.homeBpm,
};

/**
 * Layers per style.
 *
 * Every style includes 'perc': two recorded objects cannot carry a groove on
 * their own, and a shaker/hat pattern underneath gives the loop a pulse
 * without competing with the real sounds. Sparse captures sounded empty
 * without it.
 *
 * Deliberately no 'perc' layer. The user's recorded objects ARE the
 * percussion — laying a synthesised drum track over them makes the result
 * sound like a backing track the app shipped with, which is the opposite of
 * the product's promise that every sound is one you captured. Accompaniment
 * is limited to the harmonic parts an object cannot supply: something to hold
 * the low end and something to state the chords.
 */
const STYLE_LAYERS: Record<Style, AccompanimentLayer[]> = {
  chill: ['bass', 'chords'],
  jazz: ['bass', 'chords'],
  lofi: ['bass', 'chords'],
  cinematic: ['pad'],
  edm: ['bass', 'arp'],
  rock: ['bass', 'guitar'],
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
        // Interlock rather than double: try an eighth, then a sixteenth, and
        // keep the first shift that actually lands somewhere new. A straight
        // eighth-note hat shifted by an eighth is the same pattern again, but
        // shifted by a sixteenth the two hats trade off like a real shaker.
        const base = beats;
        const original = base.join(',');
        for (const step of [0.5, 0.25, 0.75]) {
          const shifted = base
            .map((b) => {
              const s = b + step * seen;
              return ((s - 1) % 4) + 1;
            })
            .sort((a, b) => a - b);
          beats = shifted;
          if (shifted.join(',') !== original) break;
        }
      }

      return { object: obj.label, beats };
    })
    .filter((p) => p.beats.length > 0);

  return {
    bpm,
    bars: 8,
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
