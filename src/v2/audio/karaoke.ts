import type { MusicPlan, PlanLyrics } from '../contracts/musicPlan';

export interface KaraokeLine {
  text: string;
  startMs: number;
  section: string;
}

/**
 * Times lyric lines onto the song: lyric sections go, in order, onto the
 * plan's singing sections (not intro/outro), and each section's lines share
 * its length evenly — so the highlight follows the arrangement the user hears.
 */
export function karaokeLines(lyrics: PlanLyrics, plan: MusicPlan | null, durationMs: number): KaraokeLine[] {
  const lyricSections = lyrics.sections.filter((s) => s.lines.some((l) => l.trim()));
  if (!lyricSections.length) return [];
  let windows: Array<{ start: number; end: number }> = [];
  if (plan && plan.sections.length) {
    const secPerBar = (60 / plan.tempoBpm) * 4;
    let t = 0;
    const all = plan.sections.map((s) => {
      const w = { kind: s.kind, start: t, end: t + s.bars * secPerBar };
      t = w.end;
      return w;
    });
    const scale = t > 0 ? durationMs / 1000 / t : 1;
    const singing = all.filter((w) => w.kind !== 'intro' && w.kind !== 'outro');
    windows = (singing.length ? singing : all).map((w) => ({ start: w.start * scale * 1000, end: w.end * scale * 1000 }));
  } else {
    const n = lyricSections.length;
    windows = lyricSections.map((_, i) => ({ start: (i * durationMs) / n, end: ((i + 1) * durationMs) / n }));
  }
  const out: KaraokeLine[] = [];
  lyricSections.forEach((sec, i) => {
    // More lyric sections than song sections: the last window is shared.
    const w = windows[Math.min(i, windows.length - 1)];
    const extra = i >= windows.length ? i - windows.length + 1 : 0;
    const span = (w.end - w.start) / (1 + extra);
    const base = w.start + span * extra;
    const lines = sec.lines.filter((l) => l.trim());
    lines.forEach((text, j) => out.push({ text, startMs: base + (span * j) / lines.length, section: sec.type }));
  });
  return out;
}
