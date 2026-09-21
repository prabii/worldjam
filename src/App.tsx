import React, { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { WelcomeScreen } from '@/screens/WelcomeScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { CaptureScreen } from '@/screens/CaptureScreen';
import { ScanScreen } from '@/screens/ScanScreen';
import { ObjectDetailScreen } from '@/screens/ObjectDetailScreen';
import { MyJamsScreen } from '@/screens/MyJamsScreen';
import { CreateJamScreen } from '@/screens/CreateJamScreen';
import { TrackDetailScreen } from '@/screens/TrackDetailScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { BottomNav, type NavTab } from '@/components/ui/BottomNav';
import { useSession } from '@/state/sessionStore';
import { JamScreen } from '@/screens/JamScreen';
import { nativeAvailable, startEngine, stopEngine } from '@/audio/engine';
import { initModel, releaseModel } from '@/ai/modelLoader';
import { colors, spacing, type } from '@/theme';

/**
 * The screens, in the order the four-step bar promises:
 *
 *   scan (1) -> studio (2, 3) -> track (4)
 *
 * 'object' is a detour off scan for one sound's settings, 'create' is the
 * guided alternative to the studio, and 'jams' is the library. There is
 * deliberately no separate 'jam' route any more: it and 'track' were two
 * studios with no stated relationship, and "back" from one led to a screen the
 * user had never visited.
 */
type Screen =
  | 'welcome'
  | 'home'
  | 'scan'
  | 'object'
  | 'studio'
  | 'create'
  | 'track'
  | 'jams'
  | 'profile';

export default function App() {
  // A demo dies if the screen sleeps mid-jam.
  useKeepAwake();

  const [screen, setScreen] = useState<Screen>('welcome');
  /** Which object the detail screen is showing. */
  const [objectId, setObjectId] = useState<string | null>(null);
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
            onScan={() => setScreen('scan')}
            onCompose={() => setScreen('create')}
            onOpenSession={async (id) => {
              await openSession(id);
              setScreen('track');
            }}
          />
        ) : screen === 'scan' ? (
          /* Step 1. "Add to Studio" carries EVERY captured object forward,
             which is the point of the studio; opening one object is a
             deliberate detour via its chip, not the default path. */
          <ScanScreen
            onBack={() => setScreen('home')}
            onAddToStudio={() => setScreen('studio')}
            onOpenObject={(id) => {
              setObjectId(id);
              setScreen('object');
            }}
          />
        ) : screen === 'object' && objectId ? (
          /* A single object's settings. Generating from here still arranges
             the whole session, so it returns to the studio rather than
             jumping past it. */
          <ObjectDetailScreen
            objectId={objectId}
            onBack={() => setScreen('studio')}
            onGenerate={() => setScreen('studio')}
            onAddObject={() => setScreen('scan')}
          />
        ) : screen === 'studio' ? (
          /* Steps 2 and 3 — all the captured sounds together, arranged. */
          <JamScreen
            onBack={() => setScreen('scan')}
            onFinish={() => setScreen('track')}
          />
        ) : screen === 'create' ? (
          <CreateJamScreen
            onBack={() => setScreen('home')}
            onRecord={() => setScreen('scan')}
            onGenerate={() => setScreen('studio')}
          />
        ) : screen === 'track' ? (
          /* Step 4 — the finished jam. */
          <TrackDetailScreen
            onBack={() => setScreen('studio')}
            onKeepCreating={() => setScreen('scan')}
            onAddSounds={() => setScreen('scan')}
          />
        ) : screen === 'profile' ? (
          <ProfileScreen
            onBack={() => setScreen('home')}
            onOpenJams={() => setScreen('jams')}
          />
        ) : (
          <MyJamsScreen
            onBack={() => setScreen('home')}
            onOpen={async (id) => {
              await openSession(id);
              setScreen('track');
            }}
            onNewJam={() => setScreen('scan')}
          />
        )}

        {/* Nav is hidden on the welcome screen, a full-bleed standalone
            moment, and on scan, where it would cover the capture controls. */}
        {screen !== 'welcome' && screen !== 'scan' && (
          <BottomNav
            active={
              screen === 'home'
                ? 'home'
                : screen === 'jams'
                  ? 'jams'
                  : screen === 'profile'
                    ? 'profile'
                    : 'studio'
            }
            onSelect={(t) => setScreen(t)}
            onCapture={() => setScreen('scan')}
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
});
