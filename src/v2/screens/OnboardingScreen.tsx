import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Field, useKeyboardHeight } from '../components/ui';
import { toast } from '../components/Toasts';
import { getLibrary } from '../services/library';
import { color, font, space } from '../theme';

const LOGO = require('../../../assets/branding/adaptive-foreground.png');

/**
 * "What's your name?" → "Your world is your sound." → enter.
 * No account: the name lives only in the local library.
 */
export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'name' | 'welcome'>('name');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();

  const saveName = async () => {
    const clean = name.trim();
    if (!clean) return;
    setSaving(true);
    try {
      const lib = await getLibrary();
      await lib.profile.setName(clean);
      setStep('welcome');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save your name', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: kb > 0 ? kb + insets.bottom : insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* The logo shrinks while typing so the field and button stay above the keyboard. */}
        <Image source={LOGO} style={kb > 0 ? styles.logoSmall : styles.logo} accessibilityIgnoresInvertColors accessibilityLabel="WorldJam" />
        {step === 'name' ? (
          <>
            <Text style={[font.display, styles.center]}>What's your name?</Text>
            <Text style={[font.body, styles.center]}>Everything you make stays on this phone.</Text>
            <Field
              label="Your name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Maya"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveName}
              maxLength={40}
              style={{ alignSelf: 'stretch', marginTop: space.xl }}
            />
          </>
        ) : (
          <>
            <Text style={[font.display, styles.center]}>Your world is your sound.</Text>
            <Text style={[font.body, styles.center]}>
              Capture anything — a cup, the rain, your voice. Shape it into a jam, by hand or with on-device AI.
            </Text>
          </>
        )}
      </ScrollView>
      <View style={styles.footer}>
        {step === 'name' ? (
          <Button label="Continue" kind="primary" onPress={saveName} disabled={!name.trim()} busy={saving} />
        ) : (
          <Button label={`Enter WorldJam, ${name.trim()}`} kind="primary" onPress={onDone} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.lg },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.lg },
  logo: { width: 132, height: 132, marginBottom: space.xl },
  logoSmall: { width: 64, height: 64, marginBottom: space.sm },
  center: { textAlign: 'center' },
  footer: { paddingBottom: space.xl, paddingTop: space.md, backgroundColor: color.bg },
});
