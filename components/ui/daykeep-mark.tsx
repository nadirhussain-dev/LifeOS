import Svg, { G, Rect } from 'react-native-svg';

/**
 * The Daykeep mark.
 *
 * Six blades leaving a hexagonal opening — a shutter mid-turn. It is the only
 * mark in the set whose negative space does the work, which is what keeps it
 * legible at 48px in a settings row, and it reads as a lens on a life rather
 * than a letter in a box.
 *
 * The geometry matches `MARKS.aperture` in `scripts/make-brand-assets.mjs`
 * exactly: one blade authored upright, then placed six times at 60° intervals.
 * The generator rotates the sample point by -a; SVG rotates the shape by +a,
 * which is the same thing. The viewBox is the mark's measured ink bounding box
 * so it self-centres at any size.
 *
 * Keeping the two in step matters — the launcher icon, the native splash and
 * this component are the three places a user meets the brand, and a mark that
 * drifts between them reads as three different apps. That script also holds
 * eleven alternates; changing which one ships means updating both files.
 */

/** Blade in a 100-unit space: x 46→81, y 11→25.5, corner radius 5.5. */
const BLADE = { x: 46, y: 11, width: 35, height: 14.5, rx: 5.5 };
const ANGLES = [0, 60, 120, 180, 240, 300];

export function DaykeepMark({
  size = 40,
  color = '#ffffff',
  /** Kept for call-site compatibility. Aperture has no receded layer — every
   *  blade is solid — so a flat silhouette and the full mark are identical. */
  layered: _layered = true,
}: {
  size?: number;
  color?: string;
  layered?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="2.8 5.7 94.4 88.7" accessibilityRole="image">
      {ANGLES.map((angle) => (
        <G key={angle} transform={`rotate(${angle} 50 50)`}>
          <Rect {...BLADE} fill={color} />
        </G>
      ))}
    </Svg>
  );
}
