import React from 'react';
import Svg, { Path, Circle, Rect, Line, G } from 'react-native-svg';
import type { ObjectCategory } from '@/types';

interface Props {
  category: ObjectCategory;
  size?: number;
  color: string;
}

/**
 * Per-object glyphs, as shown on the cards in the mockups.
 *
 * Drawn as inline SVG rather than an icon font or emoji: emoji render with
 * their own fixed colours and differ across devices, and these need to take
 * the object's assigned accent colour so a card reads as one unit.
 *
 * Strokes are geometric and low-detail on purpose — at 20-28px on a card, a
 * more literal drawing turns to mud.
 */
export function ObjectIcon({ category, size = 22, color }: Props) {
  const sw = 1.6;
  const common = {
    stroke: color,
    strokeWidth: sw,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {renderGlyph(category, common, color)}
    </Svg>
  );
}

function renderGlyph(
  category: ObjectCategory,
  s: Record<string, unknown>,
  color: string,
) {
  switch (category) {
    case 'cup':
      return (
        <G>
          <Path d="M5 8h11v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z" {...s} />
          <Path d="M16 10h2.5a2.5 2.5 0 0 1 0 5H16" {...s} />
        </G>
      );

    case 'table':
      return (
        <G>
          <Line x1="3" y1="9" x2="21" y2="9" {...s} />
          <Line x1="6" y1="9" x2="6" y2="19" {...s} />
          <Line x1="18" y1="9" x2="18" y2="19" {...s} />
        </G>
      );

    case 'bottle':
      return (
        <G>
          <Path d="M10 3h4v3l1.5 2.5A4 4 0 0 1 16 11v8a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-8a4 4 0 0 1 .5-2.5L10 6V3z" {...s} />
          <Line x1="8" y1="13" x2="16" y2="13" {...s} />
        </G>
      );

    case 'keys':
      return (
        <G>
          <Circle cx="8" cy="8" r="3.5" {...s} />
          <Path d="M10.5 10.5L19 19" {...s} />
          <Path d="M16 16l2-2M18.5 18.5l1.5-1.5" {...s} />
        </G>
      );

    case 'glass':
      return (
        <G>
          <Path d="M7 4h10l-1.5 15a1.5 1.5 0 0 1-1.5 1h-4a1.5 1.5 0 0 1-1.5-1L7 4z" {...s} />
          <Line x1="7.6" y1="10" x2="16.4" y2="10" {...s} />
        </G>
      );

    case 'box':
      return (
        <G>
          <Path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" {...s} />
          <Path d="M3 7l9 4 9-4M12 11v10" {...s} />
        </G>
      );

    case 'book':
      return (
        <G>
          <Path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4z" {...s} />
          <Line x1="8" y1="4" x2="8" y2="20" {...s} />
        </G>
      );

    case 'phone':
      return (
        <G>
          <Rect x="7" y="2" width="10" height="20" rx="2.5" {...s} />
          <Line x1="10.5" y1="18.5" x2="13.5" y2="18.5" {...s} />
        </G>
      );

    case 'plant':
      return (
        <G>
          <Path d="M12 20v-7" {...s} />
          <Path d="M12 13c0-3-2-5-5-5 0 3 2 5 5 5z" {...s} />
          <Path d="M12 13c0-3 2-5 5-5 0 3-2 5-5 5z" {...s} />
          <Path d="M9 20h6" {...s} />
        </G>
      );

    case 'laptop':
      return (
        <G>
          <Path d="M5 5h14v10H5z" {...s} />
          <Path d="M3 18h18l-1.5-3h-15L3 18z" {...s} />
        </G>
      );

    case 'clap':
      return (
        <G>
          <Path d="M8 12V6a1.5 1.5 0 0 1 3 0v5" {...s} />
          <Path d="M11 11V5a1.5 1.5 0 0 1 3 0v6" {...s} />
          <Path d="M14 11V7a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a5 5 0 0 1-5-5v-3a1.5 1.5 0 0 1 3 0" {...s} />
        </G>
      );

    case 'voice':
      return (
        <G>
          <Rect x="9" y="2" width="6" height="12" rx="3" {...s} />
          <Path d="M5 11a7 7 0 0 0 14 0" {...s} />
          <Line x1="12" y1="18" x2="12" y2="22" {...s} />
        </G>
      );

    default:
      // Unknown objects get a generic waveform mark rather than a blank space.
      return (
        <G>
          <Circle cx="12" cy="12" r="8.5" {...s} />
          <Path d="M8 12h1.5l1.5-3 2 6 1.5-3H16" {...s} />
        </G>
      );
  }
}
