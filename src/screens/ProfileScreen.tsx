import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useSession } from '@/state/sessionStore';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  onBack: () => void;
}

export function ProfileScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const objects = useSession((s) => s.objects);
  const savedSessions = useSession((s) => s.savedSessions);
  const guidanceOn = useSession((s) => s.guidanceOn);
  const setGuidance = useSession((s) => s.setGuidance);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={onBack} accessibilityRole="button" style={styles.backBtn}>
          <Text style={styles.backChevron}>{'‹'}</Text>
          <Text style={styles.backLabel}>Home</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar card */}
        <View style={styles.avatarCard}>
          <LinearGradient
            colors={['#6366F1', '#A855F7', '#EC4899']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarRing}
          >
            <View style={styles.avatarInner}>
              <Text style={styles.avatarText}>C</Text>
            </View>
          </LinearGradient>
          <Text style={styles.userName}>Creator</Text>
          <Text style={styles.userSub}>WorldJam Artist</Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard value={String(objects.length)} label="Sounds" />
          <StatCard value={String(savedSessions.length)} label="Jams" />
          <StatCard value="--" label="Shared" />
        </View>

        {/* Settings */}
        <Text style={styles.sectionLabel}>SETTINGS</Text>
        <View style={styles.settingsCard}>
          <SettingRow
            label="Voice guidance"
            sub="Speak object names when detected"
            trailing={
              <Switch
                value={guidanceOn}
                onValueChange={setGuidance}
                trackColor={{ false: colors.surfaceRaised, true: 'rgba(99,102,241,0.4)' }}
                thumbColor={guidanceOn ? '#6366F1' : colors.textDim}
              />
            }
          />
          <View style={styles.divider} />
          <SettingRow label="Audio quality" sub="44.1 kHz, 16-bit" />
          <View style={styles.divider} />
          <SettingRow label="AI model" sub="Gemma 4 E2B (on-device)" />
          <View style={styles.divider} />
          <SettingRow label="Texture engine" sub="Stable Audio Open Small" />
        </View>

        {/* About */}
        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.settingsCard}>
          <SettingRow label="Version" sub="0.1.0" />
          <View style={styles.divider} />
          <SettingRow label="Team" sub="PRXFR" />
          <View style={styles.divider} />
          <SettingRow label="Built for" sub="iQOO City Battles 2026" />
        </View>

        <Text style={styles.footer}>
          All sounds are recorded by you.{'\n'}All AI runs on your phone.
        </Text>
      </ScrollView>
    </View>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SettingRow({
  label,
  sub,
  trailing,
}: {
  label: string;
  sub: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingText}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingSub}>{sub}</Text>
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 72,
    gap: 2,
  },
  backChevron: { fontSize: 22, fontWeight: '300', color: colors.vibe, marginTop: -1 },
  backLabel: { ...type.body, color: colors.vibe },
  headerTitle: {
    ...type.title,
    fontSize: 18,
    color: colors.text,
    textAlign: 'center',
  },
  scroll: { paddingHorizontal: spacing.xl, gap: spacing.lg },

  avatarCard: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  avatarRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInner: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
  },
  userName: {
    ...type.title,
    fontSize: 22,
    color: colors.text,
  },
  userSub: {
    ...type.body,
    color: colors.textDim,
  },

  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  statValue: {
    ...type.title,
    fontSize: 24,
    color: colors.text,
  },
  statLabel: {
    ...type.caption,
    color: colors.textDim,
  },

  sectionLabel: {
    ...type.caption,
    letterSpacing: 2,
    color: colors.textFaint,
    marginTop: spacing.sm,
  },
  settingsCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  settingText: { flex: 1, gap: 2 },
  settingLabel: { ...type.body, color: colors.text },
  settingSub: { ...type.caption, color: colors.textDim },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },

  footer: {
    ...type.caption,
    color: colors.textFaint,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: spacing.md,
  },
});
