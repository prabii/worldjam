import featherMap from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json';
import materialMap from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';
import { FEATHER_GLYPHS, MATERIAL_GLYPHS } from '@/components/ui/glyphNames';

/**
 * A misspelled icon name does not throw — it renders an empty box, on device,
 * in the middle of a demo. This is the only place that catches it.
 */
describe('glyph names', () => {
  it('every Feather glyph exists in the font', () => {
    const missing = Object.entries(FEATHER_GLYPHS)
      .filter(([, icon]) => !(icon in featherMap))
      .map(([key, icon]) => `${key} -> ${icon}`);
    expect(missing).toEqual([]);
  });

  it('every Material glyph exists in the font', () => {
    const missing = Object.entries(MATERIAL_GLYPHS)
      .filter(([, icon]) => !(icon in materialMap))
      .map(([key, icon]) => `${key} -> ${icon}`);
    expect(missing).toEqual([]);
  });

  it('no name is defined in both families', () => {
    const overlap = Object.keys(FEATHER_GLYPHS).filter(
      (k) => k in MATERIAL_GLYPHS,
    );
    expect(overlap).toEqual([]);
  });
});
