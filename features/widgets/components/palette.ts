/**
 * Widget colours, in both themes.
 *
 * The widget cannot read the app's theme tokens: it renders in a headless
 * context, and `constants/design-tokens.ts` pulls in far more than a colour map.
 * So this is a deliberate, small copy of the values that matter, and the module
 * exists so the two widgets cannot drift from each other the way the third copy
 * of `GLASS_ML` was drifting from the first two.
 *
 * Both variants exist because `renderWidget` accepts `{ light, dark }` and the
 * launcher picks. Before this, every widget was dark regardless — which reads as
 * a deliberate design choice on a dark home screen and as a bug on a light one.
 */
export type HexColor = `#${string}`;

export type WidgetPalette = {
  bg: HexColor;
  card: HexColor;
  muted: HexColor;
  text: HexColor;
  tasks: HexColor;
  habits: HexColor;
  water: HexColor;
  /** Fill behind a completed habit's tick. */
  done: HexColor;
  onAccent: HexColor;
};

export const DARK: WidgetPalette = {
  bg: '#0f172a',
  card: '#1e293b',
  muted: '#94a3b8',
  text: '#f8fafc',
  tasks: '#818cf8',
  habits: '#34d399',
  water: '#38bdf8',
  done: '#34d399',
  onAccent: '#04211a',
};

/**
 * Not a naive inversion. The accents are darkened from their dark-theme values
 * because #34d399 on white is roughly 1.8:1 — legible as a dot, illegible as
 * text — while the same hue at #059669 clears 4.5:1.
 */
export const LIGHT: WidgetPalette = {
  bg: '#ffffff',
  card: '#f1f5f9',
  muted: '#64748b',
  text: '#0f172a',
  tasks: '#4f46e5',
  habits: '#059669',
  water: '#0284c7',
  done: '#059669',
  onAccent: '#ffffff',
};
