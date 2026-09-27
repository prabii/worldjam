import React from 'react';
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';

import { color as palette } from '../theme';

/**
 * WorldJam's own outline icon set (09_BRAND_ASSETS.md): 24-unit grid, ~2 px
 * stroke, neutral by default and tinted only for active states. Drawn here
 * rather than pulled from an icon font so the set stays small and consistent.
 */
export type IconName =
  | 'home' | 'jams' | 'studio' | 'settings' | 'capture' | 'mic' | 'camera' | 'hum'
  | 'play' | 'pause' | 'stop' | 'record' | 'search' | 'sort' | 'filter' | 'waveform'
  | 'lyrics' | 'ai' | 'save' | 'delete' | 'edit' | 'speaker' | 'repeat' | 'add'
  | 'back' | 'close' | 'check' | 'more' | 'video' | 'tap' | 'orbit' | 'pads' | 'send';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, color = palette.textSecondary, strokeWidth = 2 }: Props) {
  const s = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const f = { fill: color };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {glyph(name, s, f)}
    </Svg>
  );
}

type Stroke = { stroke: string; strokeWidth: number; strokeLinecap: 'round'; strokeLinejoin: 'round'; fill: string };
type Fill = { fill: string };

function glyph(name: IconName, s: Stroke, f: Fill): React.ReactNode {
  switch (name) {
    case 'home':
      return <><Path d="M4 11l8-7 8 7" {...s} /><Path d="M6 10v10h12V10" {...s} /></>;
    case 'jams':
      return <><Rect x="4" y="4" width="7" height="7" rx="2" {...s} /><Rect x="13" y="4" width="7" height="7" rx="2" {...s} /><Rect x="4" y="13" width="7" height="7" rx="2" {...s} /><Rect x="13" y="13" width="7" height="7" rx="2" {...s} /></>;
    case 'studio':
    case 'orbit':
      return <><Circle cx="12" cy="12" r="3.2" {...s} /><Path d="M3.5 12a8.5 4 -20 1 0 17 0a8.5 4 -20 1 0 -17 0" {...s} /><Circle cx="19.3" cy="8.4" r="1.3" {...f} /></>;
    case 'settings':
      return <><Circle cx="12" cy="12" r="3" {...s} /><Path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" {...s} /></>;
    case 'capture':
      return <><Circle cx="12" cy="12" r="8" {...s} /><Circle cx="12" cy="12" r="3.5" {...f} /></>;
    case 'mic':
      return <><Rect x="9" y="3" width="6" height="11" rx="3" {...s} /><Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" {...s} /></>;
    case 'camera':
    case 'video':
      return <><Rect x="3" y="6.5" width="13" height="11" rx="2.5" {...s} /><Path d="M16 10.5l5-3v9l-5-3" {...s} /></>;
    case 'hum':
      return <Path d="M3 12c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0 3 4 4.5 0" {...s} />;
    case 'play':
      return <Polygon points="8,5 19,12 8,19" {...f} />;
    case 'pause':
      return <><Rect x="6.5" y="5" width="4" height="14" rx="1.2" {...f} /><Rect x="13.5" y="5" width="4" height="14" rx="1.2" {...f} /></>;
    case 'stop':
      return <Rect x="6" y="6" width="12" height="12" rx="2.5" {...f} />;
    case 'record':
      return <Circle cx="12" cy="12" r="7" {...f} />;
    case 'search':
      return <><Circle cx="10.5" cy="10.5" r="6" {...s} /><Line x1="15" y1="15" x2="20" y2="20" {...s} /></>;
    case 'sort':
      return <><Path d="M7 5v14M4 16l3 3 3-3" {...s} /><Path d="M17 19V5M14 8l3-3 3 3" {...s} /></>;
    case 'filter':
      return <><Line x1="4" y1="7" x2="20" y2="7" {...s} /><Line x1="7" y1="12" x2="17" y2="12" {...s} /><Line x1="10" y1="17" x2="14" y2="17" {...s} /></>;
    case 'waveform':
      return <Path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" {...s} />;
    case 'lyrics':
      return <><Path d="M5 6h14M5 10h14M5 14h9" {...s} /><Path d="M17 14v5a1.5 1.5 0 1 1-1.5-1.5H17" {...s} /></>;
    case 'ai':
      return <><Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" {...s} /><Path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" {...f} /></>;
    case 'save':
      return <><Path d="M5 4h11l3 3v13H5z" {...s} /><Path d="M8 4v5h7V4M8 20v-6h8v6" {...s} /></>;
    case 'delete':
      return <><Path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" {...s} /></>;
    case 'edit':
      return <><Path d="M4 20h4l11-11-4-4L4 16z" {...s} /><Line x1="13" y1="7" x2="17" y2="11" {...s} /></>;
    case 'speaker':
      return <><Path d="M4 9.5h4l5-4v13l-5-4H4z" {...s} /><Path d="M16.5 9a4.5 4.5 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" {...s} /></>;
    case 'repeat':
      return <><Path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3" {...s} /><Path d="M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3" {...s} /></>;
    case 'add':
      return <><Line x1="12" y1="5" x2="12" y2="19" {...s} /><Line x1="5" y1="12" x2="19" y2="12" {...s} /></>;
    case 'back':
      return <Polyline points="15,5 8,12 15,19" {...s} />;
    case 'close':
      return <><Line x1="6" y1="6" x2="18" y2="18" {...s} /><Line x1="18" y1="6" x2="6" y2="18" {...s} /></>;
    case 'check':
      return <Polyline points="5,12.5 10,17 19,7" {...s} />;
    case 'more':
      return <><Circle cx="6" cy="12" r="1.5" {...f} /><Circle cx="12" cy="12" r="1.5" {...f} /><Circle cx="18" cy="12" r="1.5" {...f} /></>;
    case 'tap':
      return <><Circle cx="12" cy="12" r="3" {...f} /><Circle cx="12" cy="12" r="7" {...s} /><Path d="M12 2v2M12 20v2M2 12h2M20 12h2" {...s} /></>;
    case 'pads':
      return <><Rect x="4" y="4" width="7" height="7" rx="1.5" {...f} /><Rect x="13" y="4" width="7" height="7" rx="1.5" {...s} /><Rect x="4" y="13" width="7" height="7" rx="1.5" {...s} /><Rect x="13" y="13" width="7" height="7" rx="1.5" {...f} /></>;
    case 'send':
      return <><Path d="M4 12l16-8-6 16-2.5-6.5z" {...s} /></>;
  }
}
