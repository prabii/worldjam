import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { FEATHER_GLYPHS, MATERIAL_GLYPHS, type GlyphName } from './glyphNames';

export type { GlyphName };

interface Props {
  name: GlyphName;
  size?: number;
  color?: string;
}

/** Renders a named glyph from whichever family defines it. */
export function Glyph({ name, size = 20, color = '#FFFFFF' }: Props) {
  if (name in FEATHER_GLYPHS) {
    const icon = FEATHER_GLYPHS[name as keyof typeof FEATHER_GLYPHS];
    return <Feather name={icon as never} size={size} color={color} />;
  }
  const icon = MATERIAL_GLYPHS[name as keyof typeof MATERIAL_GLYPHS];
  return <MaterialCommunityIcons name={icon as never} size={size} color={color} />;
}
