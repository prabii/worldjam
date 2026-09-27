import React, { useEffect, useState } from 'react';
import { BackHandler, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';

import { nativeAvailable, startEngine, stopEngine } from '@/audio/engine';
import { initModel, releaseModel } from '@/ai/modelLoader';

import { color, font, space } from './theme';
import { useNav } from './nav/store';
import { TabBar, TAB_BAR_HEIGHT } from './nav/TabBar';
import { getLibrary } from './services/library';
import { Toasts } from './components/Toasts';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { HomeScreen } from './screens/HomeScreen';
import { MyJamsScreen } from './screens/MyJamsScreen';
import { StudioScreen } from './screens/StudioScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { CaptureScreen } from './screens/CaptureScreen';
import { CaptureDetailScreen } from './screens/CaptureDetailScreen';
import { TrackDetailScreen } from './screens/TrackDetailScreen';
import { LyricsEditorScreen } from './screens/LyricsEditorScreen';
import { SourcePickerScreen } from './screens/SourcePickerScreen';
import { resumePendingWork } from './services/maintenance';

type Boot = 'loading' | 'onboarding' | 'ready';

/**
 * WorldJam V2 root: boots the audio engine and library, gates on onboarding,
 * then renders the tab the user is on with any pushed screen on top.
 */
export function V2App() {
  useKeepAwake();
  const [boot, setBoot] = useState<Boot>('loading');
  const [engineError, setEngineError] = useState<string | null>(null);
  const { tab, stack, setTab, push, back } = useNav();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await getLibrary();
        const profile = await lib.profile.get();
        if (!cancelled) setBoot(profile ? 'ready' : 'onboarding');
        void resumePendingWork(lib);
      } catch (err) {
        if (!cancelled) {
          setEngineError(`Library failed to open: ${err instanceof Error ? err.message : String(err)}`);
          setBoot('onboarding');
        }
      }

      const granted =
        Platform.OS !== 'android' ||
        (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
          title: 'Microphone',
          message: 'WorldJam records the real sounds around you.',
          buttonPositive: 'Allow',
        })) === PermissionsAndroid.RESULTS.GRANTED;
      if (cancelled) return;
      if (!granted) {
        setEngineError('Microphone is off — you can still play and edit, but not capture.');
      } else if (!nativeAvailable || !startEngine()) {
        setEngineError('Audio engine failed to start.');
      }
      // The music director loads in the background; nothing waits on it.
      void initModel();
    })();
    return () => {
      cancelled = true;
      stopEngine();
      void releaseModel();
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => back());
    return () => sub.remove();
  }, [back]);

  const top = stack[stack.length - 1];
  const fullScreen = top?.name === 'capture';

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {boot === 'loading' ? (
          <View style={styles.center}>
            <Text style={font.caption}>WorldJam</Text>
          </View>
        ) : boot === 'onboarding' ? (
          <OnboardingScreen onDone={() => setBoot('ready')} />
        ) : (
          <>
            <View style={[styles.layer, top && styles.hidden]} pointerEvents={top ? 'none' : 'auto'}>
              {tab === 'home' && <HomeScreen bottomInset={TAB_BAR_HEIGHT} />}
              {tab === 'jams' && <MyJamsScreen bottomInset={TAB_BAR_HEIGHT} />}
              {tab === 'studio' && <StudioScreen bottomInset={TAB_BAR_HEIGHT} />}
              {tab === 'settings' && <SettingsScreen bottomInset={TAB_BAR_HEIGHT} />}
            </View>
            {top && (
              <View style={styles.layer}>
                {top.name === 'capture' && <CaptureScreen sessionId={top.sessionId} />}
                {top.name === 'captureDetail' && <CaptureDetailScreen id={top.id} />}
                {top.name === 'trackDetail' && <TrackDetailScreen id={top.id} />}
                {top.name === 'lyricsEditor' && (
                  <LyricsEditorScreen id={top.id} trackId={top.trackId} captureIds={top.captureIds} />
                )}
                {top.name === 'sourcePicker' && <SourcePickerScreen sessionId={top.sessionId} />}
              </View>
            )}
            {!fullScreen && !top && (
              <TabBar active={tab} onSelect={setTab} onCapture={() => push({ name: 'capture' })} />
            )}
          </>
        )}
        {engineError && (
          <View style={styles.banner} pointerEvents="none">
            <Text style={[font.caption, { color: color.text }]}>{engineError}</Text>
          </View>
        )}
        <Toasts />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  layer: { ...StyleSheet.absoluteFillObject },
  hidden: { opacity: 0 },
  banner: {
    position: 'absolute',
    top: 40,
    left: space.lg,
    right: space.lg,
    padding: space.md,
    borderRadius: 12,
    backgroundColor: 'rgba(251,113,133,0.18)',
    borderWidth: 1,
    borderColor: color.error,
  },
});
