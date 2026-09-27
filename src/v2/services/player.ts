import { Audio, type AVPlaybackStatus } from 'expo-av';
import { create } from 'zustand';

/**
 * One playback at a time, app-wide. Starting any capture/track stops whatever
 * else was playing — including inline videos, which watch `activeId` and pause
 * themselves when it moves away from them.
 */
export type PlayState = 'idle' | 'loading' | 'playing' | 'paused';

interface PlayerState {
  activeId: string | null;
  state: PlayState;
  positionMs: number;
  durationMs: number;
  error: string | null;
}

export const usePlayer = create<PlayerState>(() => ({
  activeId: null,
  state: 'idle',
  positionMs: 0,
  durationMs: 0,
  error: null,
}));

let sound: Audio.Sound | null = null;
let audioModeSet = false;

async function ensureAudioMode(): Promise<void> {
  if (audioModeSet) return;
  audioModeSet = true;
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  }).catch(() => {});
}

function onStatus(id: string) {
  return (s: AVPlaybackStatus) => {
    if (usePlayer.getState().activeId !== id) return;
    if (!s.isLoaded) {
      if (s.error) usePlayer.setState({ state: 'idle', error: s.error });
      return;
    }
    if (s.didJustFinish) {
      usePlayer.setState({ state: 'idle', positionMs: 0 });
      return;
    }
    usePlayer.setState({
      state: s.isPlaying ? 'playing' : 'paused',
      positionMs: s.positionMillis,
      durationMs: s.durationMillis ?? usePlayer.getState().durationMs,
    });
  };
}

/** Plays `uri` (file:// or absolute path) as item `id`, replacing any current playback. */
export async function play(id: string, uri: string): Promise<void> {
  await ensureAudioMode();
  await stop();
  usePlayer.setState({ activeId: id, state: 'loading', positionMs: 0, durationMs: 0, error: null });
  try {
    const src = uri.startsWith('file://') ? uri : `file://${uri}`;
    const { sound: s } = await Audio.Sound.createAsync({ uri: src }, { shouldPlay: true, progressUpdateIntervalMillis: 100 }, onStatus(id));
    if (usePlayer.getState().activeId !== id) {
      await s.unloadAsync();
      return;
    }
    sound = s;
  } catch (err) {
    usePlayer.setState({ state: 'idle', error: err instanceof Error ? err.message : String(err) });
  }
}

/** Tap on a play button: start, pause or resume depending on what is active. */
export async function toggle(id: string, uri: string): Promise<void> {
  const { activeId, state } = usePlayer.getState();
  if (activeId === id && sound) {
    if (state === 'playing') await sound.pauseAsync();
    else if (state === 'paused') await sound.playAsync();
    else await play(id, uri);
    return;
  }
  await play(id, uri);
}

export async function seek(positionMs: number): Promise<void> {
  if (sound) await sound.setPositionAsync(Math.max(0, positionMs)).catch(() => {});
}

export async function stop(): Promise<void> {
  const s = sound;
  sound = null;
  usePlayer.setState({ activeId: null, state: 'idle', positionMs: 0 });
  if (s) await s.unloadAsync().catch(() => {});
}

/** For inline video players: claim the single playback slot. */
export async function claimForVideo(id: string): Promise<void> {
  await stop();
  usePlayer.setState({ activeId: id, state: 'playing' });
}
