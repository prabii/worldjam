import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Button, Field, Screen } from '../components/ui';
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
    <Screen>
      <View style={styles.body}>
        <Image source={LOGO} style={styles.logo} accessibilityIgnoresInvertColors accessibilityLabel="WorldJam" />
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
      </View>
      <View style={styles.footer}>
        {step === 'name' ? (
          <Button label="Continue" kind="primary" onPress={saveName} disabled={!name.trim()} busy={saving} />
        ) : (
          <Button label={`Enter WorldJam, ${name.trim()}`} kind="primary" onPress={onDone} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  logo: { width: 132, height: 132, marginBottom: space.xl },
  center: { textAlign: 'center' },
  footer: { paddingBottom: space.xl, paddingTop: space.md, backgroundColor: color.bg },
});
