import React, { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { WelcomeScreen } from '@/screens/WelcomeScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { CaptureScreen } from '@/screens/CaptureScreen';
import { BottomNav, type NavTab } from '@/components/ui/BottomNav';
import { useSession } from '@/state/sessionStore';
import { JamScreen } from '@/screens/JamScreen';
import { VisionScreen } from '@/vision/screens/VisionScreen';
import { nativeAvailable, startEngine, stopEngine } from '@/audio/engine';
import { initModel, releaseModel } from '@/ai/modelLoader';
import { colors, spacing, type } from '@/theme';

type Screen = 'welcome' | 'home' | 'capture' | 'jam' | 'vision';

export default function App() {
  // A demo dies if the screen sleeps mid-jam.
  useKeepAwake();

  const [screen, setScreen] = useState<Screen>('welcome');
  const openSession = useSession((s) => s.openSession);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // The native engine opens its own Oboe streams, but Android still
        // requires the runtime RECORD_AUDIO grant. Asked for directly rather
        // than through expo-av, which drags in expo-asset and its native
        // module for no benefit here.
        const granted =
          Platform.OS !== 'android' ||
          (await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            {
              title: 'Microphone access',
              message: 'WorldJam records the real sound of objects around you.',
              buttonPositive: 'Allow',
            },
          )) === PermissionsAndroid.RESULTS.GRANTED;
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
        {screen === 'welcome' ? (
          <WelcomeScreen
            onStart={() => setScreen('home')}
            onHowItWorks={() => setScreen('home')}
          />
        ) : screen === 'home' ? (
          <HomeScreen
            onScan={() => setScreen('capture')}
            onCompose={() => setScreen('jam')}
            onOpenSession={async (id) => {
              await openSession(id);
              setScreen('jam');
            }}
          />
        ) : screen === 'capture' ? (
          <CaptureScreen onDone={() => setScreen('jam')} />
        ) : screen === 'vision' ? (
          <VisionScreen onBack={() => setScreen('home')} />
        ) : (
          <JamScreen onBack={() => setScreen('home')} />
        )}

        {/* Nav is hidden on the welcome screen, which is a full-bleed
            standalone moment rather than part of the tabbed app. */}
        {/* Vision (object read-out) entry. Rendered here so no music screen changes. */}
        {screen === 'home' && (
          <Pressable
            onPress={() => setScreen('vision')}
            accessibilityRole="button"
            accessibilityLabel="Object Guide"
            accessibilityHint="Opens the camera and describes objects aloud"
            style={[styles.visionEntry, { top: (initialWindowMetrics?.insets.top ?? 24) + 14 }]}
          >
            <Text style={styles.visionEntryText}>👁 Object Guide</Text>
          </Pressable>
        )}

        {screen !== 'welcome' && screen !== 'capture' && screen !== 'vision' && (
          <BottomNav
            active={screen === 'home' ? 'home' : 'studio'}
            onSelect={(t) => setScreen(t === 'home' ? 'home' : 'jam')}
            onCapture={() => setScreen('capture')}
            disabled={['jams', 'profile']}
          />
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
  visionEntry: {
    position: 'absolute',
    right: spacing.lg,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.vibe,
  },
  visionEntryText: { ...type.label, fontSize: 15, color: colors.bg, fontWeight: '800' },
});
