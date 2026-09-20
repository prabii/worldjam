import type { LoopEvent } from '@/types';

/**
 * Expands an arrangement plan's bar-relative pattern into loop events.
 *
 * Kept separate from `transport.ts` because it is pure: transport imports the
 * native engine, and this translation is the part worth unit-testing.
 */
export function planToLoopEvents(
  pattern: Array<{ object: string; beats: number[] }>,
  labelToId: Map<string, string>,
  bars: number,
): LoopEvent[] {
  const events: LoopEvent[] = [];
  for (const entry of pattern) {
    const objectId = labelToId.get(entry.object.toLowerCase());
    if (!objectId) continue;
    for (let bar = 0; bar < bars; bar++) {
      for (const beat of entry.beats) {
        // Plan beats are 1-indexed within a bar; loop beats are 0-indexed
        // across the whole loop.
        events.push({ objectId, beat: bar * 4 + (beat - 1), velocity: 1 });
      }
    }
  }
  return events.sort((a, b) => a.beat - b.beat);
}
