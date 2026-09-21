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
import { BottomNav, type NavTab } from '@/components/ui/BottomNav';
import { useSession } from '@/state/sessionStore';
import { JamScreen } from '@/screens/JamScreen';
import { nativeAvailable, startEngine, stopEngine } from '@/audio/engine';
import { initModel, releaseModel } from '@/ai/modelLoader';
import { colors, spacing, type } from '@/theme';

type Screen =
  | 'welcome'
  | 'home'
  | 'scan'
  | 'object'
  | 'jams'
  | 'create'
  | 'track'
  | 'jam';

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
              setScreen('jam');
            }}
          />
        ) : screen === 'scan' ? (
          <ScanScreen
            onBack={() => setScreen('home')}
            onAddToStudio={() => {
              // Straight to the newest object's own screen, which is where
              // the style, tempo and AI direction are set.
              const latest = useSession.getState().objects.at(-1);
              if (latest) {
                setObjectId(latest.id);
                setScreen('object');
              } else {
                setScreen('jam');
              }
            }}
            onOpenObject={(id) => {
              setObjectId(id);
              setScreen('object');
            }}
          />
        ) : screen === 'object' && objectId ? (
          <ObjectDetailScreen
            objectId={objectId}
            onBack={() => setScreen('scan')}
            onGenerate={() => setScreen('track')}
            onAddObject={() => setScreen('scan')}
          />
        ) : screen === 'track' ? (
          <TrackDetailScreen
            onBack={() => setScreen('jam')}
            onKeepCreating={() => setScreen('scan')}
            onAddSounds={() => setScreen('scan')}
          />
        ) : screen === 'create' ? (
          <CreateJamScreen
            onBack={() => setScreen('home')}
            onRecord={() => setScreen('scan')}
            onGenerate={() => setScreen('track')}
          />
        ) : screen === 'jams' ? (
          <MyJamsScreen
            onBack={() => setScreen('home')}
            onOpen={async (id) => {
              await openSession(id);
              setScreen('jam');
            }}
            onNewJam={() => setScreen('scan')}
          />
        ) : (
          <JamScreen onBack={() => setScreen('home')} />
        )}

        {/* Nav is hidden on the welcome screen, which is a full-bleed
            standalone moment rather than part of the tabbed app. */}
        {screen !== 'welcome' && screen !== 'scan' && (
          <BottomNav
            active={
              screen === 'home' ? 'home' : screen === 'jams' ? 'jams' : 'studio'
            }
            onSelect={(t) =>
              setScreen(t === 'home' ? 'home' : t === 'jams' ? 'jams' : 'jam')
            }
            onCapture={() => setScreen('scan')}
            disabled={['profile']}
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
