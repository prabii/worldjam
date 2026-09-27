import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { accentGradient, color, font, radius, space, touch } from '../theme';
import { Icon, type IconName } from './Icon';

/**
 * Keyboard height in dp. Android 15+ draws edge-to-edge, so the window no
 * longer resizes for the keyboard — screens pad themselves with this instead.
 */
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return h;
}

/** Full-height screen on the V2 background, with safe-area top padding. */
export function Screen({
  children,
  scroll = false,
  padded = true,
  bottomInset = 0,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Extra bottom space, e.g. for the tab bar. */
  bottomInset?: number;
}) {
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: insets.top + space.md, paddingHorizontal: padded ? space.lg : 0 };
  if (scroll) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[pad, { paddingBottom: insets.bottom + bottomInset + space.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.screen, pad, { paddingBottom: insets.bottom + bottomInset }]}>{children}</View>;
}

/** Title row with optional back button and trailing actions. */
export function Header({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      {onBack && <IconButton icon="back" label="Back" onPress={onBack} />}
      <View style={{ flex: 1 }}>
        <Text style={font.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={[font.caption, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  kind = 'secondary',
  icon,
  disabled,
  busy,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const inactive = disabled || busy;
  const tint = kind === 'primary' ? color.bg : kind === 'danger' ? color.error : color.text;
  const body = (
    <View style={styles.buttonInner}>
      {busy ? <ActivityIndicator color={tint} /> : icon ? <Icon name={icon} size={20} color={tint} /> : null}
      <Text style={[styles.buttonLabel, { color: tint }]}>{label}</Text>
    </View>
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      style={({ pressed }) => [
        styles.button,
        kind === 'secondary' && styles.buttonSecondary,
        kind === 'danger' && styles.buttonDanger,
        inactive && { opacity: 0.45 },
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {kind === 'primary' ? (
        <LinearGradient colors={[...accentGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradientFill}>
          {body}
        </LinearGradient>
      ) : (
        body
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  active,
  size = 22,
  tint,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  size?: number;
  tint?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, active && styles.iconButtonActive, pressed && { opacity: 0.6 }, disabled && { opacity: 0.3 }]}
    >
      <Icon name={icon} size={size} color={tint ?? (active ? color.text : color.textSecondary)} />
    </Pressable>
  );
}

/** Toggleable pill. Selection is shown by outline + weight, never colour alone. */
export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {icon && <Icon name={icon} size={16} color={selected ? color.text : color.textMuted} />}
      <Text style={[font.label, selected && { color: color.text, fontWeight: '600' }]}>{label}</Text>
      {selected && <Icon name="check" size={14} color={color.cyan} />}
    </Pressable>
  );
}

/** Two-to-four option switch with a sliding surface, for mode choices. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; icon?: IconName }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && styles.segmentOn]}
          >
            {o.icon && <Icon name={o.icon} size={18} color={on ? color.text : color.textMuted} />}
            <Text style={[font.label, on && { color: color.text, fontWeight: '600' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  style,
  ...props
}: TextInputProps & { label: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: space.sm }, style]}>
      <Text style={font.label}>{label}</Text>
      <TextInput
        placeholderTextColor={color.textMuted}
        selectionColor={color.violet}
        accessibilityLabel={label}
        {...props}
        style={[styles.input, props.multiline && { minHeight: 96, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

/** Bottom sheet over a scrim. Android Back closes it. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: (kb > 0 ? kb : insets.bottom) + space.xl, maxHeight: '92%' }]}>
          <View style={styles.grabber} />
          {title ? (
            <Text style={[font.heading, { marginBottom: space.lg }]} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={28} color={color.textMuted} />
      </View>
      <Text style={[font.heading, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[font.body, { textAlign: 'center' }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={font.heading} accessibilityRole="header">
        {title}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.lg, minHeight: touch },
  button: { minHeight: 52, borderRadius: radius.round, overflow: 'hidden', justifyContent: 'center' },
  buttonSecondary: { backgroundColor: color.elevated, borderWidth: 1, borderColor: color.line },
  buttonDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.error },
  gradientFill: { flex: 1, justifyContent: 'center', minHeight: 52 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.xl },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  iconButton: { width: touch, height: touch, borderRadius: radius.round, alignItems: 'center', justifyContent: 'center' },
  iconButtonActive: { backgroundColor: color.elevated },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.round,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  chipSelected: { borderColor: color.violet, backgroundColor: color.elevated },
  segmented: { flexDirection: 'row', backgroundColor: color.surface, borderRadius: radius.round, padding: 4, borderWidth: 1, borderColor: color.line },
  segment: { flex: 1, minHeight: 44, borderRadius: radius.round, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: color.elevated, borderWidth: 1, borderColor: color.line },
  input: {
    minHeight: touch + 4,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    color: color.text,
    fontSize: 16,
  },
  scrim: { flex: 1, backgroundColor: color.scrim },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderColor: color.line,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: color.line, marginBottom: space.lg },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxxl, paddingHorizontal: space.xl },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.md },
});
