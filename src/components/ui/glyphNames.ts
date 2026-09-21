/**
 * The icon vocabulary, named for what it means in WorldJam rather than for the
 * glyph it happens to use.
 *
 * Indirection on purpose: the mockups are drawn in one thin-line style, and
 * Feather is that style. Where Feather has no equivalent — a cube, a knob, a
 * waveform — the fallback is Material Community's outline variant, whose
 * stroke weight is the closest match. Screens name the meaning, so swapping a
 * glyph later is one edit here instead of a search across every screen.
 */
export const FEATHER_GLYPHS = {
  back: 'arrow-left',
  forward: 'arrow-right',
  flash: 'zap',
  flip: 'refresh-cw',
  gallery: 'image',
  play: 'play',
  pause: 'pause',
  next: 'skip-forward',
  prev: 'skip-back',
  shuffle: 'shuffle',
  repeat: 'repeat',
  plus: 'plus',
  more: 'more-vertical',
  heart: 'heart',
  bell: 'bell',
  edit: 'edit-2',
  user: 'user',
  calendar: 'calendar',
  clock: 'clock',
  file: 'file',
  share: 'share-2',
  download: 'download',
  upload: 'upload',
  expand: 'maximize-2',
  grid: 'grid',
  search: 'search',
  settings: 'settings',
  compass: 'compass',
  home: 'home',
  trash: 'trash-2',
  check: 'check',
  close: 'x',
  chevronDown: 'chevron-down',
  chevronRight: 'chevron-right',
  layers: 'layers',
  mic: 'mic',
  music: 'music',
  video: 'film',
  volume: 'volume-2',
  filter: 'sliders',
  target: 'crosshair',
  scan: 'maximize',
  list: 'list',
  star: 'star',
  leaf: 'feather',
} as const;

export const MATERIAL_GLYPHS = {
  cube: 'cube-outline',
  waveform: 'waveform',
  sparkle: 'auto-fix',
  knob: 'tune-variant',
  ar: 'axis-arrow',
  cup: 'coffee-outline',
  piano: 'piano',
  library: 'music-box-multiple-outline',
  equalizer: 'equalizer-outline',
  metronome: 'metronome',
  plant: 'sprout-outline',
  export: 'export-variant',
  wand: 'star-four-points-outline',
} as const;

export type GlyphName = keyof typeof FEATHER_GLYPHS | keyof typeof MATERIAL_GLYPHS;
