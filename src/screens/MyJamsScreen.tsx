import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BOTTOM_NAV_CLEARANCE } from '@/components/ui/BottomNav';
import * as Haptics from 'expo-haptics';
import { Logo } from '@/components/ui/Logo';
import { Glyph, type GlyphName } from '@/components/ui/Glyph';
import { MiniWaveform } from '@/components/MiniWaveform';
import { useSession } from '@/state/sessionStore';
import { colors } from '@/theme';
import { gradients } from '@/theme/gradients';
import type { SessionSummary } from '@/state/sessionStorage';

interface Props {
  onBack: () => void;
  onOpen: (id: string) => void;
  onNewJam: () => void;
}

type Filter = 'all' | 'compositions' | 'samples' | 'favorites' | 'trash';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'compositions', label: 'Compositions' },
  { key: 'samples', label: 'Samples' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'trash', label: 'Trash' },
];

/**
 * My Jams — everything the user has saved.
 *
 * The stat tiles and list are computed from real saved sessions. Where the
 * mockup shows counts the app cannot know yet (exports, favourites), the tile
 * shows the real number, which is often zero — an invented "24 Total Jams"
 * would be the one thing on this screen that is a lie.
 */
export function MyJamsScreen({ onBack, onOpen, onNewJam }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const sessions = useSession((s) => s.savedSessions);
  const removeSession = useSession((s) => s.removeSession);
  const refreshSessions = useSession((s) => s.refreshSessions);

  // Saved jams live on disk, so the list has to be re-read on entry — a jam
  // saved from the studio would otherwise not appear until a restart.
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (filter === 'favorites' && !favorites.has(s.id)) return false;
      // Trash is not implemented as storage, so it is honestly empty rather
      // than showing live sessions under a heading that implies deletion.
      if (filter === 'trash') return false;
      if (filter === 'samples' && s.objectCount > 1) return false;
      if (filter === 'compositions' && s.objectCount <= 1) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q);
    });
  }, [sessions, query, filter, favorites]);

  const totalSeconds = sessions.reduce((a, s) => a + s.durationSeconds, 0);

  const toggleFavorite = (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 6 }]}>
      {/* ---- Header ---- */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Glyph name="back" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Logo size="small" tagline="studio" glyph={false} />
        </View>
        <View style={styles.iconBtn}>
          <Glyph name="user" size={20} color={colors.textDim} />
        </View>
      </View>

      {/* ---- Search ---- */}
      <View style={styles.searchWrap}>
        <Glyph name="search" size={18} color={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your jams..."
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          accessibilityLabel="Search your jams"
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Glyph name="close" size={16} color={colors.textDim} />
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + BOTTOM_NAV_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Title ---- */}
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text style={styles.title}>My Jams</Text>
            <Text style={styles.subtitle}>All your sounds, in one place.</Text>
          </View>
          <Pressable
            onPress={onNewJam}
            accessibilityRole="button"
            accessibilityLabel="Start a new jam"
          >
            <LinearGradient
              colors={gradients.brandShort}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.newJam}
            >
              <Glyph name="plus" size={18} color="#FFFFFF" />
              <Text style={styles.newJamText}>New Jam</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* ---- Filters ---- */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Pressable
                key={f.key}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setFilter(f.key);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${f.label} filter`}
                accessibilityState={{ selected: active }}
              >
                {active ? (
                  <LinearGradient
                    colors={['#7C3AED', '#A855F7']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.filterChip}
                  >
                    <Text style={[styles.filterText, styles.filterTextActive]}>
                      {f.label}
                    </Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.filterChip, styles.filterChipIdle]}>
                    <Text style={styles.filterText}>{f.label}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ---- Stats ---- */}
        <View style={styles.statRow}>
          <Stat icon="music" tint="#60A5FA" value={`${sessions.length}`} label="Total Jams" />
          <Stat icon="heart" tint="#F472B6" value={`${favorites.size}`} label="Favorites" />
          <Stat
            icon="layers"
            tint="#A78BFA"
            value={`${sessions.reduce((a, s) => a + s.objectCount, 0)}`}
            label="Objects"
          />
          <Stat
            icon="clock"
            tint="#34D399"
            value={formatTotal(totalSeconds)}
            label="Total Time"
          />
        </View>

        {/* ---- List ---- */}
        {visible.length === 0 ? (
          <View style={styles.empty}>
            <Glyph name="library" size={38} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>
              {sessions.length === 0
                ? 'No jams saved yet'
                : filter === 'trash'
                  ? 'Trash is empty'
                  : 'Nothing matches that'}
            </Text>
            <Text style={styles.emptyBody}>
              {sessions.length === 0
                ? 'Record a few objects, generate a jam, and save it — it will show up here.'
                : 'Try a different filter or search.'}
            </Text>
          </View>
        ) : (
          visible.map((s) => (
            <JamRow
              key={s.id}
              session={s}
              favorite={favorites.has(s.id)}
              onOpen={() => onOpen(s.id)}
              onFavorite={() => toggleFavorite(s.id)}
              onDelete={() => void removeSession(s.id)}
            />
          ))
        )}

        {/* ---- Promo ---- */}
        <View style={styles.promo}>
          <LinearGradient
            colors={['rgba(30,58,138,0.7)', 'rgba(88,28,135,0.6)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.promoText}>
            Turn everyday sounds{'\n'}into something extraordinary.
          </Text>
          <Pressable
            onPress={onNewJam}
            accessibilityRole="button"
            accessibilityLabel="Create with AI"
          >
            <LinearGradient
              colors={gradients.brandShort}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.promoBtn}
            >
              <Text style={styles.promoBtnText}>Create with AI</Text>
              <Glyph name="forward" size={16} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>
        </View>

        <Text style={styles.motto}>&ldquo;Real Objects. Real Music.&rdquo;</Text>
      </ScrollView>
    </View>
  );
}

function Stat({
  icon,
  tint,
  value,
  label,
}: {
  icon: GlyphName;
  tint: string;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: tint + '22' }]}>
        <Glyph name={icon} size={18} color={tint} />
      </View>
      <View>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

function JamRow({
  session,
  favorite,
  onOpen,
  onFavorite,
  onDelete,
}: {
  session: SessionSummary;
  favorite: boolean;
  onOpen: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const tint = tintFor(session.id);

  return (
    <View style={[styles.row, { borderColor: tint + '44' }]}>
      <Pressable
        onPress={onOpen}
        style={styles.rowMain}
        accessibilityRole="button"
        accessibilityLabel={`Open ${session.name}`}
      >
        <View style={[styles.rowArt, { backgroundColor: tint + '26', borderColor: tint + '66' }]}>
          <Glyph name="waveform" size={24} color={tint} />
        </View>

        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {session.name}
          </Text>
          <View style={styles.rowTags}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{session.style ?? 'Jam'}</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagText}>
                {session.objectCount} object{session.objectCount === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
          <MiniWaveform seed={session.id} color={tint} />
        </View>

        <View style={styles.rowMeta}>
          <Text style={styles.rowDuration}>{formatClock(session.durationSeconds)}</Text>
          <Text style={styles.rowDate}>{formatDate(session.createdAt)}</Text>
        </View>
      </Pressable>

      <View style={styles.rowActions}>
        <Pressable
          onPress={onFavorite}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={favorite ? 'Remove from favorites' : 'Add to favorites'}
          accessibilityState={{ selected: favorite }}
        >
          <Glyph name="heart" size={20} color={favorite ? '#F472B6' : colors.textFaint} />
        </Pressable>

        <Pressable
          onPress={() => setMenu((v) => !v)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Options for ${session.name}`}
        >
          <Glyph name="more" size={20} color={colors.textDim} />
        </Pressable>

        <Pressable
          onPress={onOpen}
          style={[styles.rowPlay, { borderColor: tint }]}
          accessibilityRole="button"
          accessibilityLabel={`Play ${session.name}`}
        >
          <Glyph name="play" size={16} color="#FFFFFF" />
        </Pressable>
      </View>

      {menu && (
        <View style={styles.menu}>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setMenu(false);
              onDelete();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${session.name}`}
          >
            <Glyph name="trash" size={16} color={colors.danger} />
            <Text style={[styles.menuText, { color: colors.danger }]}>Delete</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Stable per-jam accent, hashed from the id so it survives restarts. */
function tintFor(id: string): string {
  const palette = ['#C084FC', '#38BDF8', '#F472B6', '#FBBF24', '#34D399', '#818CF8'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function formatTotal(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28,33,48,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.3)',
    backgroundColor: 'rgba(12,15,26,0.9)',
  },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text, padding: 0 },

  scroll: { paddingHorizontal: 16, gap: 16 },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleText: { flex: 1, gap: 3 },
  title: { fontSize: 34, fontWeight: '800', color: colors.text, letterSpacing: -0.9 },
  subtitle: { fontSize: 14.5, color: colors.textDim },
  newJam: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 13,
    paddingHorizontal: 19,
    borderRadius: 999,
  },
  newJamText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },

  filterRow: { gap: 9, paddingRight: 8 },
  filterChip: { paddingVertical: 11, paddingHorizontal: 21, borderRadius: 999 },
  filterChipIdle: { borderWidth: 1, borderColor: 'rgba(120,140,190,0.3)' },
  filterText: { fontSize: 14, fontWeight: '600', color: colors.textDim },
  filterTextActive: { color: '#FFFFFF', fontWeight: '700' },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  stat: {
    width: '48.4%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.24)',
    backgroundColor: 'rgba(12,15,26,0.9)',
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { fontSize: 21, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  statLabel: { fontSize: 12, color: colors.textDim, fontWeight: '500' },

  row: {
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: 'rgba(12,15,26,0.9)',
    padding: 12,
    gap: 10,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowArt: {
    width: 62,
    height: 62,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 5 },
  rowTitle: { fontSize: 16.5, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  rowTags: { flexDirection: 'row', gap: 6 },
  tag: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.32)',
  },
  tagText: { fontSize: 11, fontWeight: '600', color: colors.textDim },
  rowMeta: { alignItems: 'flex-end', gap: 4 },
  rowDuration: { fontSize: 13, fontWeight: '700', color: colors.text },
  rowDate: { fontSize: 11.5, color: colors.textFaint },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
  },
  rowPlay: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 10,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6 },
  menuText: { fontSize: 14, fontWeight: '600' },

  empty: {
    alignItems: 'center',
    gap: 9,
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyTitle: { fontSize: 16.5, fontWeight: '700', color: colors.text },
  emptyBody: { fontSize: 13.5, color: colors.textDim, textAlign: 'center', lineHeight: 20 },

  promo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.4)',
    overflow: 'hidden',
  },
  promoText: { flex: 1, fontSize: 15.5, fontWeight: '600', color: '#FFFFFF', lineHeight: 22 },
  promoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 999,
  },
  promoBtnText: { fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' },

  motto: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.textFaint,
    letterSpacing: 1.4,
    fontWeight: '500',
  },
});
