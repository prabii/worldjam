import * as Speech from 'expo-speech';
import { GuidanceScheduler } from './guidance';

/**
 * Text-to-speech, wrapped so the rest of the app never has to care whether it
 * is available.
 *
 * On a device without a TTS engine every call becomes a no-op rather than an
 * error: guidance is an enhancement, and losing it must never break the
 * instrument.
 */

let enabled = false;
let available: boolean | null = null;

/** Speech rate. Slightly brisk — cues must land inside a musical gap. */
const RATE = 1.15;
const PITCH = 1.0;

export async function checkAvailable(): Promise<boolean> {
  if (available != null) return available;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    available = voices.length > 0;
  } catch {
    available = false;
  }
  return available;
}

export function setGuidanceEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopSpeaking();
}

export function isGuidanceEnabled(): boolean {
  return enabled;
}

/**
 * Speaks immediately, interrupting anything in progress.
 *
 * Interrupting is deliberate: a stale cue about the previous beat is worse
 * than silence, because it tells the user to do the wrong thing.
 */
export function speakNow(text: string): void {
  if (!enabled) return;
  try {
    Speech.stop();
    Speech.speak(text, { rate: RATE, pitch: PITCH });
  } catch {
    // A missing engine must not break the loop.
  }
}

/** Speaks without interrupting — for cues that can wait their turn. */
export function speakQueued(text: string): void {
  if (!enabled) return;
  try {
    Speech.speak(text, { rate: RATE, pitch: PITCH });
  } catch {
    // ignored
  }
}

export function stopSpeaking(): void {
  try {
    Speech.stop();
  } catch {
    // ignored
  }
}

/**
 * The shared scheduler, wired to the queued speak so musical cues do not
 * interrupt each other mid-word.
 */
export const guidance = new GuidanceScheduler(speakQueued);
