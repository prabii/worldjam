import { textureEngine } from '@/audio/engine';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { ModelStatus } from '@/ai/modelLoader';
import { describeFeel } from '@/audio/groove';
import type { ArrangementPlan } from '@/types';
import { GradientButton } from './ui/GradientButton';
import { gradients } from '@/theme/gradients';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  status: ModelStatus;
  plan: ArrangementPlan | null;
  bpm: number;
  lastPlanInfo: string | null;
  arranging: boolean;
  canArrange: boolean;
  onArrange: () => void;
  onLoadModel: () => void;
  texture: {
    on: boolean;
    status: 'idle' | 'unavailable' | 'generating' | 'ready' | 'error';
    info: string | null;
    onToggle: (on: boolean) => void;
    onRegenerate: () => void;
  };
}

/**
 * The studio's "director's desk": which brain is arranging, what it decided,
 * and the one button that turns captured sounds into a track.
 *
 * Making the model visible is deliberate. "On-device Gemma" is the claim the
 * whole pitch rests on, so the card shows it working — its state, how long it
 * took to load, and whether the last plan came from it or from the rules.
 */
export function GemmaCard({
  status,
  plan,
  bpm,
  lastPlanInfo,
  arranging,
  canArrange,
  onArrange,
  onLoadModel,
  texture,
}: Props) {
  const pill = pillFor(status);
  const detail = detailFor(status);
  const canLoad = status.state === 'idle' || status.state === 'absent' || status.state === 'error';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <LinearGradient
          colors={gradients.brandShort}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.logo}
        >
          <Text style={styles.logoText}>✦</Text>
        </LinearGradient>

        <View style={styles.titles}>
          <Text style={styles.title}>Gemma 4 · Music director</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            On-device · nothing leaves this phone
          </Text>
        </View>

        <View style={[styles.pill, { borderColor: pill.color, backgroundColor: `${pill.color}22` }]}>
          {pill.spinning ? (
            <ActivityIndicator size="small" color={pill.color} style={styles.pillSpinner} />
          ) : (
            <View style={[styles.pillDot, { backgroundColor: pill.color }]} />
          )}
          <Text style={[styles.pillText, { color: pill.color }]}>{pill.label}</Text>
        </View>
      </View>

      <Text style={styles.detail} numberOfLines={2}>
        {detail}
      </Text>

      {plan && (
        <View style={styles.decision}>
          <Text style={styles.decisionLabel}>LAST TAKE</Text>
          <View style={styles.chips}>
            <Chip text={plan.style} color={colors.vibe} />
            <Chip text={describeFeel(plan.style, bpm, plan.bars)} color={colors.ai} />
          </View>
          {lastPlanInfo && (
            <Text style={styles.planInfo} numberOfLines={2}>
              {plan.source === 'gemma' ? '✦ ' : '⚙ '}
              {lastPlanInfo}
            </Text>
          )}
        </View>
      )}

      <TextureRow {...texture} hasPlan={plan != null} />

      <GradientButton
        label={plan ? 'Re-arrange' : 'Turn it into music'}
        trailing="✦"
        busy={arranging}
        busyLabel={status.state === 'ready' ? 'Gemma is arranging…' : 'Arranging…'}
        disabled={!canArrange}
        onPress={onArrange}
        shape="rounded"
        accessibilityLabel={plan ? 'Re-arrange the track' : 'Turn your sounds into music'}
      />
      {!canArrange && !arranging && (
        <Text style={styles.hint}>Capture at least one object first.</Text>
      )}

      {canLoad && (
        <Pressable
          onPress={onLoadModel}
          accessibilityRole="button"
          accessibilityLabel={status.state === 'error' ? 'Retry loading Gemma' : 'Load Gemma'}
          style={styles.load}
        >
          <Text style={styles.loadText}>
            {status.state === 'error' ? '↻ Retry loading Gemma' : '⇣ Load Gemma model'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The Stable Audio texture: Gemma writes the description, the phone makes the
 * sound. Status is shown plainly, including why it cannot run, so a missing
 * model file is a sentence on screen rather than a silent no-op.
 */
function TextureRow({
  on,
  status,
  info,
  onToggle,
  onRegenerate,
  hasPlan,
}: Props['texture'] & { hasPlan: boolean }) {
  const line =
    !on
      ? 'Off'
      : status === 'generating'
        ? `Generating on-device… ${info ?? ''}`
        : status === 'ready'
          ? `Playing: ${info ?? ''}`
          : status === 'unavailable'
            ? `Unavailable: ${info ?? ''}`
            : status === 'error'
              ? `Failed: ${info ?? ''}`
              : hasPlan
                ? 'Waiting for an arrangement'
                : 'Arrange a track and Gemma picks a texture';
  const tone =
    status === 'ready' ? colors.live : status === 'error' || status === 'unavailable' ? colors.warn : colors.ai;

  return (
    <View style={styles.texture}>
      <View style={styles.textureHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.textureTitle}>AI music layer</Text>
          <Text style={styles.textureBy}>
            {textureEngine().name || 'Stable Audio'} · on-device · Stability AI
          </Text>
        </View>
        {on && status === 'generating' && <ActivityIndicator size="small" color={colors.ai} />}
        <Switch
          value={on}
          onValueChange={onToggle}
          trackColor={{ false: colors.surfaceRaised, true: colors.ai }}
          thumbColor={on ? '#FFFFFF' : '#9CA3AF'}
          accessibilityLabel="AI texture layer"
        />
      </View>
      <Text style={[styles.textureLine, { color: on ? tone : colors.textFaint }]} numberOfLines={2}>
        {line}
      </Text>
      {on && status === 'ready' && (
        <Pressable onPress={onRegenerate} accessibilityRole="button" style={styles.textureRedo}>
          <Text style={styles.textureRedoText}>↻ New texture</Text>
        </Pressable>
      )}
    </View>
  );
}

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.chip, { borderColor: `${color}66`, backgroundColor: `${color}1A` }]}>
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function pillFor(s: ModelStatus): { label: string; color: string; spinning: boolean } {
  switch (s.state) {
    case 'ready':
      return { label: 'Ready', color: colors.live, spinning: false };
    case 'loading':
      return { label: 'Loading', color: colors.ai, spinning: true };
    case 'searching':
      return { label: 'Finding', color: colors.ai, spinning: true };
    case 'absent':
      return { label: 'Rules', color: colors.warn, spinning: false };
    case 'error':
      return { label: 'Error', color: colors.danger, spinning: false };
    default:
      return { label: 'Off', color: colors.textFaint, spinning: false };
  }
}

function detailFor(s: ModelStatus): string {
  switch (s.state) {
    case 'ready': {
      const file = s.path.split('/').pop() ?? s.path;
      return `${file} · ${(s.sizeMb / 1024).toFixed(1)} GB · loaded in ${(s.loadMs / 1000).toFixed(1)}s`;
    }
    case 'loading':
      return `Loading ${(s.sizeMb / 1024).toFixed(1)} GB into memory. The rule-based director plays meanwhile.`;
    case 'searching':
      return 'Looking for the model file…';
    case 'absent':
      return 'Model file not found. The rule-based director is arranging instead.';
    case 'error':
      return s.message;
    default:
      return 'Model not loaded yet.';
  }
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.35)',
    backgroundColor: 'rgba(24, 20, 38, 0.92)',
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { ...type.title, fontSize: 18, color: '#FFFFFF' },
  titles: { flex: 1 },
  title: { ...type.label, fontSize: 15, color: colors.text },
  subtitle: { ...type.caption, color: colors.textFaint, marginTop: 2 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillSpinner: { transform: [{ scale: 0.7 }], width: 12, height: 12 },
  pillText: { ...type.caption, fontSize: 11, fontWeight: '700' },

  detail: { ...type.caption, color: colors.textDim },

  decision: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  decisionLabel: { ...type.caption, fontSize: 10, letterSpacing: 1.5, color: colors.textFaint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { ...type.caption, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  planInfo: { ...type.caption, color: colors.textDim },

  hint: { ...type.caption, color: colors.textFaint, textAlign: 'center' },

  texture: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.25)',
    backgroundColor: 'rgba(167,139,250,0.06)',
  },
  textureHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  textureTitle: { ...type.label, fontSize: 14, color: colors.text },
  textureBy: { ...type.caption, fontSize: 10, color: colors.textFaint, marginTop: 1 },
  textureLine: { ...type.caption },
  textureRedo: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ai,
    marginTop: 2,
  },
  textureRedoText: { ...type.caption, fontWeight: '700', color: colors.ai },

  load: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ai,
    backgroundColor: colors.aiDim,
    alignItems: 'center',
  },
  loadText: { ...type.label, color: colors.ai },
});
