import { useEffect, useRef, useState } from 'react';

import { WorldJamMedia, isMediaModuleAvailable } from '../../../modules/worldjam-media/src';

export type ListenState = 'idle' | 'starting' | 'listening' | 'processing';

/**
 * Voice prompts: the phone's on-device recognizer, streaming partial text.
 * The final text lands in `onFinal`, which feeds the same prompt pipeline as
 * typing does.
 */
export function useVoicePrompt(onFinal: (text: string) => void): {
  state: ListenState;
  partial: string;
  level: number;
  error: string | null;
  available: boolean;
  start(): Promise<void>;
  stop(): void;
  cancel(): void;
} {
  const [state, setState] = useState<ListenState>('idle');
  const [partial, setPartial] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  useEffect(() => {
    if (!isMediaModuleAvailable) return;
    WorldJamMedia.speechAvailability().then((a) => setAvailable(a.available)).catch(() => setAvailable(false));
    const subs = [
      WorldJamMedia.addListener('onSpeechPartial', (e) => setPartial(e.text)),
      WorldJamMedia.addListener('onSpeechResult', (e) => {
        setPartial('');
        if (e.text.trim()) cb.current(e.text.trim());
      }),
      WorldJamMedia.addListener('onSpeechError', (e) => setError(e.message)),
      WorldJamMedia.addListener('onSpeechState', (e) => {
        setState(e.state === 'idle' ? 'idle' : e.state);
        if (e.rmsDb != null) setLevel(Math.max(0, Math.min(1, (e.rmsDb + 2) / 12)));
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      void WorldJamMedia.cancelListening().catch(() => {});
    };
  }, []);

  return {
    state,
    partial,
    level,
    error,
    available,
    start: async () => {
      setError(null);
      setPartial('');
      setState('starting');
      try {
        await WorldJamMedia.startListening({ language: 'en-US', preferOffline: true, partialResults: true });
      } catch (err) {
        setState('idle');
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    stop: () => void WorldJamMedia.stopListening().catch(() => {}),
    cancel: () => {
      setState('idle');
      setPartial('');
      void WorldJamMedia.cancelListening().catch(() => {});
    },
  };
}
