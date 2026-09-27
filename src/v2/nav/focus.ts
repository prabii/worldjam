import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Pushed screens are only mounted while on top of the stack, so "focused"
 * reduces to "the app is in the foreground" — enough to release the camera
 * and microphone when the user switches apps.
 */
export function useIsFocused(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}
