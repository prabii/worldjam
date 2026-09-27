import { textureEngine } from '@/audio/engine';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system';
import { useSession } from '@/state/sessionStore';
import { colors, radius, spacing, type } from '@/theme';

const LEADERBOARD_PATH = `${FileSystem.documentDirectory}worldjam-leaderboard.json`;
const PROFILE_PATH = `${FileSystem.documentDirectory}worldjam-profile.json`;

interface LeaderboardEntry {
  name: string;
  score: number;
  combo: number;
  date: string;
}

interface Profile {
  name: string;
  handle: string;
}

async function loadProfile(): Promise<Profile> {
  try {
    const raw = await FileSystem.readAsStringAsync(PROFILE_PATH);
    return JSON.parse(raw) as Profile;
  } catch {
    return { name: 'Creator', handle: 'worldjam_artist' };
  }
}

async function saveProfile(p: Profile): Promise<void> {
  await FileSystem.writeAsStringAsync(PROFILE_PATH, JSON.stringify(p));
}

async function loadLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(LEADERBOARD_PATH);
    return JSON.parse(raw) as LeaderboardEntry[];
  } catch {
    return [];
  }
}

interface Props {
  onBack: () => void;
}

export function ProfileScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const objects = useSession((s) => s.objects);
  const savedSessions = useSession((s) => s.savedSessions);
  const guidanceOn = useSession((s) => s.guidanceOn);
  const setGuidance = useSession((s) => s.setGuidance);

  const [profile, setProfile] = useState<Profile>({ name: 'Creator', handle: 'worldjam_artist' });
  const [editingName, setEditingName] = useState(false);
  const [editingHandle, setEditingHandle] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftHandle, setDraftHandle] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    void loadProfile().then((p) => {
      setProfile(p);
      setDraftName(p.name);
      setDraftHandle(p.handle);
    });
    void loadLeaderboard().then(setLeaderboard);
  }, []);

  const commitName = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) return;
    const updated = { ...profile, name: trimmed };
    setProfile(updated);
    await saveProfile(updated);
    setEditingName(false);
  };

  const commitHandle = async () => {
    const trimmed = draftHandle.trim().replace(/\s+/g, '_').toLowerCase();
    if (!trimmed) return;
    const updated = { ...profile, handle: trimmed };
    setProfile(updated);
    await saveProfile(updated);
    setEditingHandle(false);
  };

  const bestScore = leaderboard.length > 0 ? leaderboard[0].score : 0;
  const myBest = leaderboard.find((e) => e.name === profile.name);

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
              <Text style={styles.avatarText}>{(profile.name[0] ?? 'C').toUpperCase()}</Text>
            </View>
          </LinearGradient>

          {/* Editable name */}
          {editingName ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.nameInput}
                value={draftName}
                onChangeText={setDraftName}
                maxLength={24}
                autoFocus
                onSubmitEditing={commitName}
                returnKeyType="done"
              />
              <Pressable onPress={commitName} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>Save</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setEditingName(true)} style={styles.editableField}>
              <Text style={styles.userName}>{profile.name}</Text>
              <Text style={styles.editHint}>✎ tap to edit</Text>
            </Pressable>
          )}

          {/* Editable handle */}
          {editingHandle ? (
            <View style={styles.editRow}>
              <TextInput
                style={[styles.nameInput, styles.handleInput]}
                value={draftHandle}
                onChangeText={setDraftHandle}
                maxLength={20}
                autoFocus
                onSubmitEditing={commitHandle}
                returnKeyType="done"
                autoCapitalize="none"
              />
              <Pressable onPress={commitHandle} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>Save</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setEditingHandle(true)} style={styles.editableField}>
              <Text style={styles.userSub}>@{profile.handle}</Text>
            </Pressable>
          )}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard value={String(objects.length)} label="Sounds" />
          <StatCard value={String(savedSessions.length)} label="Jams" />
          <StatCard value={myBest ? String(myBest.score) : '--'} label="Best Score" />
        </View>

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>GAME LEADERBOARD</Text>
            <View style={styles.settingsCard}>
              {leaderboard.map((e, i) => {
                const isMe = e.name === profile.name;
                return (
                  <React.Fragment key={i}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={[styles.lbRow, isMe && styles.lbRowMe]}>
                      <Text style={[styles.lbRank, i === 0 && { color: colors.warn }]}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </Text>
                      <View style={styles.lbInfo}>
                        <Text style={[styles.lbName, isMe && { color: colors.vibe }]} numberOfLines={1}>
                          {e.name}
                        </Text>
                        <Text style={styles.lbDate}>{e.date} · {e.combo}x combo</Text>
                      </View>
                      <Text style={styles.lbScore}>{e.score}</Text>
                    </View>
                  </React.Fragment>
                );
              })}
            </View>
          </>
        )}

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
          <SettingRow
            label="Music engine"
            sub={textureEngine().name || 'Stable Audio'}
          />
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
  userName: { ...type.title, fontSize: 22, color: colors.text },
  userSub: { ...type.body, color: colors.textDim },
  editableField: { alignItems: 'center', gap: 2 },
  editHint: { ...type.caption, fontSize: 9, color: colors.textFaint },
  editRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    width: '80%',
  },
  nameInput: {
    flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1.5,
    borderColor: colors.vibe, backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: spacing.md, ...type.body, color: colors.text,
    fontSize: 17, textAlign: 'center',
  },
  handleInput: { fontSize: 14, color: colors.textDim },
  saveBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.vibe,
  },
  saveBtnText: { ...type.caption, color: '#FFFFFF', fontWeight: '700' },
  lbRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  lbRowMe: { backgroundColor: 'rgba(10,132,255,0.08)' },
  lbRank: { ...type.caption, color: colors.textFaint, width: 28, textAlign: 'center' },
  lbInfo: { flex: 1, gap: 2 },
  lbName: { ...type.label, color: colors.text, fontSize: 14 },
  lbDate: { ...type.caption, color: colors.textFaint, fontSize: 10 },
  lbScore: {
    ...type.label, color: colors.warn, fontSize: 16,
    fontVariant: ['tabular-nums'],
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
