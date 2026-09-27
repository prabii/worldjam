import React, { useEffect, useState } from 'react';
import { Alert, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { WelcomeScreen } from '@/screens/WelcomeScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { CaptureScreen } from '@/screens/CaptureScreen';
import { JamScreen } from '@/screens/JamScreen';
import { JamsScreen } from '@/screens/JamsScreen';
import { PlayScreen } from '@/screens/PlayScreen';
import { PracticeScreen } from '@/screens/PracticeScreen';
import { GuideButton } from '@/components/GuideButton';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { BottomNav, type AppScreen, type NavTab } from '@/components/ui/BottomNav';
import { useSession } from '@/state/sessionStore';
import { ToastHost } from '@/components/ui/ToastHost';
import { nativeAvailable, startEngine, stopEngine } from '@/audio/engine';
import { initModel, releaseModel } from '@/ai/modelLoader';
import { colors, spacing, type } from '@/theme';

export default function App() {
  useKeepAwake();

  const [screen, setScreen] = useState<AppScreen>('welcome');
  const openSession = useSession((s) => s.openSession);
  const resetJam = useSession((s) => s.reset);

  /**
   * The + button starts a jam. With sounds already captured it asks first:
   * a new jam wipes them, and doing that silently would lose work, while
   * never doing it meant old sounds kept turning up in every new jam.
   */
  const startCapture = () => {
    const s = useSession.getState();
    if (s.objects.length === 0 && !s.vocalTake) {
      setScreen('capture');
      return;
    }
    Alert.alert(
      'Start a new jam?',
      `You have ${s.objects.length} sound${s.objects.length === 1 ? '' : 's'} in this jam.`,
      [
        { text: 'Add to this jam', onPress: () => setScreen('capture') },
        {
          text: 'New jam',
          style: 'destructive',
          onPress: () => {
            resetJam();
            setScreen('capture');
          },
        },
      ],
      { cancelable: true },
    );
  };
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
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

  const activeTab: NavTab =
    screen === 'home' || screen === 'jams' ? 'home' :
    screen === 'profile' ? 'profile' :
    screen === 'play' || screen === 'tiles' ? 'play' :
    'studio';

  const navSelect = (t: NavTab) => {
    if (t === 'home') setScreen('home');
    else if (t === 'profile') setScreen('profile');
    else if (t === 'play') setScreen('play');
    else setScreen('jam');
  };

  const showNav =
    screen !== 'welcome' &&
    screen !== 'capture' &&
    screen !== 'tiles';

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
            onJams={() => setScreen('jams')}
            onOpenSession={(id) => {
              // Saved jams play where they are listed; they do not reopen Studio.
              void useSession.getState().toggleSavedJam(id);
            }}
          />
        ) : screen === 'capture' ? (
          <CaptureScreen onDone={() => setScreen('jam')} />
        ) : screen === 'jams' ? (
          <JamsScreen
            onBack={() => setScreen('home')}
            onOpenSession={(id) => {
              // Saved jams play where they are listed; they do not reopen Studio.
              void useSession.getState().toggleSavedJam(id);
            }}
            onNewJam={() => {
              resetJam();
              setScreen('capture');
            }}
          />
        ) : screen === 'play' ? (
          <PracticeScreen onBack={() => setScreen('home')} onTiles={() => setScreen('tiles')} />
        ) : screen === 'tiles' ? (
          <PlayScreen onBack={() => setScreen('play')} />
        ) : screen === 'profile' ? (
          <ProfileScreen onBack={() => setScreen('home')} />
        ) : (
          <JamScreen onBack={() => setScreen('home')} onCapture={() => setScreen('capture')} />
        )}

        {showNav && (
          <BottomNav
            active={activeTab}
            onSelect={navSelect}
            onCapture={startCapture}
          />
        )}

        {/* The AI guide floats everywhere except the welcome and the tiles game. */}
        {screen !== 'welcome' && screen !== 'tiles' && <GuideButton screen={screen} />}

        {engineError && (
          <View style={styles.banner} pointerEvents="none">
            <Text style={styles.bannerText}>{engineError}</Text>
          </View>
        )}

        <ToastHost bridgeStatus={screen === 'jam'} />
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
