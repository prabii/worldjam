import React, { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { WelcomeScreen } from '@/screens/WelcomeScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { CaptureScreen } from '@/screens/CaptureScreen';
import { JamScreen } from '@/screens/JamScreen';
import { JamsScreen } from '@/screens/JamsScreen';
import { PlayScreen } from '@/screens/PlayScreen';
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
    screen === 'play' ? 'play' :
    'studio';

  const navSelect = (t: NavTab) => {
    if (t === 'home') setScreen('home');
    else if (t === 'profile') setScreen('profile');
    else if (t === 'play') setScreen('play');
    else setScreen('jam');
  };

  const showNav = screen !== 'welcome' && screen !== 'capture' && screen !== 'play';

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
            onOpenSession={async (id) => {
              await openSession(id);
              setScreen('jam');
            }}
          />
        ) : screen === 'capture' ? (
          <CaptureScreen onDone={() => setScreen('jam')} />
        ) : screen === 'jams' ? (
          <JamsScreen
            onBack={() => setScreen('home')}
            onOpenSession={async (id) => {
              await openSession(id);
              setScreen('jam');
            }}
            onNewJam={() => setScreen('capture')}
          />
        ) : screen === 'play' ? (
          <PlayScreen onBack={() => setScreen('home')} />
        ) : screen === 'profile' ? (
          <ProfileScreen onBack={() => setScreen('home')} />
        ) : (
          <JamScreen onBack={() => setScreen('home')} onCapture={() => setScreen('capture')} />
        )}

        {showNav && (
          <BottomNav
            active={activeTab}
            onSelect={navSelect}
            onCapture={() => setScreen('capture')}
          />
        )}

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
