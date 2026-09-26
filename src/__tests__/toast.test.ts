import { kindFor, useToast } from '@/state/toastStore';

describe('kindFor', () => {
  it.each([
    ['Save failed: disk full', 'error'],
    ['Microphone unavailable — check permissions.', 'error'],
    ['Too short — hold while the sound rings out.', 'error'],
    ['Gemma is arranging… 4s', 'progress'],
    ['Saving jam…', 'progress'],
    ['Gemma arranged jazz · 120 BPM · swung eighths · 8 bars', 'ai'],
    ['Rule-based lofi · 80 BPM · swung sixteenths · 8 bars', 'success'],
    ['Saved "Morning"', 'success'],
    ['Timing 62% → 94%', 'success'],
    ['lofi · 80 BPM', 'info'],
  ])('%s -> %s', (msg, kind) => {
    expect(kindFor(msg)).toBe(kind);
  });
});

describe('toast store', () => {
  beforeEach(() => useToast.setState({ current: null }));

  it('replaces the current toast with the newest', () => {
    useToast.getState().show('one', 'info');
    useToast.getState().show('two', 'success');
    expect(useToast.getState().current?.message).toBe('two');
  });

  it('updates a progress toast in place, keeping its id', () => {
    useToast.getState().show('Gemma is arranging… 1s');
    const id = useToast.getState().current!.id;
    useToast.getState().show('Gemma is arranging… 2s');
    expect(useToast.getState().current!.id).toBe(id);
    expect(useToast.getState().current!.message).toBe('Gemma is arranging… 2s');
  });

  it('only hides the toast it was asked to', () => {
    useToast.getState().show('first', 'info');
    const stale = useToast.getState().current!.id;
    useToast.getState().show('second', 'info');
    useToast.getState().hide(stale);
    expect(useToast.getState().current?.message).toBe('second');
  });
});
