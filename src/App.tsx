import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { Audio } from 'expo-av';
import { CaptureScreen } from '@/screens/CaptureScreen';
import { JamScreen } from '@/screens/JamScreen';
import { nativeAvailable, startEngine, stopEngine } from '@/audio/engine';
import { initModel, releaseModel } from '@/ai/modelLoader';
import { colors, spacing, type } from '@/theme';

type Screen = 'capture' | 'jam';

export default function App() {
  // A demo dies if the screen sleeps mid-jam.
  useKeepAwake();

  const [screen, setScreen] = useState<Screen>('capture');
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // The native engine opens its own Oboe streams, but Android still
        // requires the runtime RECORD_AUDIO grant, which expo-av asks for.
        const { granted } = await Audio.requestPermissionsAsync();
        if (cancelled) return;
        if (!granted) {
          setEngineError('Microphone permission denied — capture will not work.');
          return;
        }

        if (!nativeAvailable) {
          setEngineError(
            'Native audio module not loaded. Run a dev build (npx expo run:android) — Expo Go cannot host it.',
          );
          return;
        }

        if (!startEngine()) {
          setEngineError('Audio engine failed to start.');
          return;
        }

        // Detached on purpose: HLD v2 §4 requires the interaction loop never
        // wait on the model. The app is fully playable on the rule-based
        // arranger while a 3 GB file loads, or if none is present at all.
        void initModel();
      } catch (err) {
        if (!cancelled) {
          setEngineError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      stopEngine();
      void releaseModel();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {screen === 'capture' ? (
          <CaptureScreen onDone={() => setScreen('jam')} />
        ) : (
          <JamScreen onBack={() => setScreen('capture')} />
        )}

        {engineError && (
          <View style={styles.banner} pointerEvents="none">
            <Text style={styles.bannerText}>{engineError}</Text>
          </View>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 52,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(248,113,113,0.92)',
  },
  bannerText: { ...type.caption, color: '#1A0B0B', fontWeight: '700' },
});
