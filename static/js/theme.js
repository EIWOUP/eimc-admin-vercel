/**
 * The EIMC mark's palette — the single source of truth for every surface it appears on.
 *
 * The mark is drawn three different ways and they must agree exactly:
 *
 *   1. CSS      (app.css .mk-*)      the sheet that unfolds in 3D, in the top bar and the splash
 *   2. Canvas   (mark.js)            the heat bands, the price journey and the tip, drawn over it
 *   3. SVG      (logo.js faviconURL) the still version: browser tab, sign-in page, and the .ico
 *                                    that make_icon.py renders for the exe and the installer
 *
 * Before this file those three held their own copies of every colour, so changing the theme
 * meant changing it in three places and hoping. They are all driven from here now, and
 * `cssVars()` pushes the same values into custom properties so the stylesheet cannot drift
 * either.
 *
 * To restore the original blue/purple look, set THEME = V1 at the bottom.
 */

// ---------------------------------------------------------------- carbon + gold (current)
export const CARBON = {
  name: "carbon",

  // The sheet: carbon black, not pure black. A flat #000 looks like a hole punched in the
  // screen and kills the 3D fold; graphite keeps the facets readable as they turn.
  sheet: {
    a: "#1b1f24",          // lit corner
    b: "#141821",          // middle
    c: "#0e1116",          // shadowed corner
    lift: "rgba(255,255,255,.028)",  // the face catching the light as it folds
    dip: "rgba(0,0,0,.15)",          // the face turning away
    edge: "rgba(255,255,255,.10)",   // the lip along a folded edge
    back: "#0a0c10",                 // the underside of a flipping panel
    // The reverse of the right flap -- the one face that is turned towards you on the unfold's
    // first frame, before it swings over. It is the same sheet seen from behind, so it is
    // carbon too: when this still held the old theme's indigo, every boot opened with a blue
    // flash where the mark should have been black.
    bk: "#15191f",
  },

  // The chart grid, as a real terminal draws it: present but never competing with the price.
  grid: {
    line: "rgba(255,255,255,.075)",
    axis: "rgba(255,255,255,.115)", // the centre pair, very slightly stronger
    step: 8,                          // units in the 64-unit viewBox
    width: 0.4,
  },

  // The price journey, in gold. Five stops rather than one flat colour: a metal reads as metal
  // because its tone turns along the form, from a dark base through saturated gold to a near
  // white specular where the light catches it.
  gold: {
    deep: "#4a310a",       // the shadowed start of the stroke
    mid: "#b8841f",
    rich: "#f5c842",
    bright: "#ffeeb0",
    spec: "#fffae8",       // the highlight
    glow: "rgba(255,178,52,.30)",    // warm bloom around the stroke
    shadow: "rgba(0,0,0,.55)",       // the ink's own shadow on the sheet
    // The smudge: gold is not uniform. A faint, slightly offset darker pass under the stroke
    // and a broken highlight over it read as brushed metal rather than a coloured line.
    smudge: "rgba(120,82,20,.45)",
    sheen: "rgba(255,255,255,.55)",
  },

  // The liquidity heat stays red — it is the one thing on the mark that must read as danger.
  // Against carbon it no longer needs the purple floor the old sheet forced on it, so the
  // ramp starts in deep blood red and runs to white-hot.
  heat: [
    [0.00, 60, 0, 10, 0],
    [0.12, 120, 6, 14, 0.34],
    [0.30, 186, 18, 22, 0.70],
    [0.50, 232, 42, 30, 0.92],
    [0.68, 255, 104, 38, 0.97],
    [0.82, 255, 166, 58, 0.99],
    [0.93, 255, 226, 124, 1],
    [1.00, 255, 250, 230, 1],
  ],

  // The live tip. Mint, because on a chart green means bid — it is the one deliberate cool
  // note against all that warmth, and it is what the eye lands on last.
  tip: { core: "#ffffff", halo: "rgba(94,255,196,.55)", ring: [94, 255, 196] },

  ink: "#fff",             // kept for anything still drawing plain ink
};

// ------------------------------------------------------------------- the original (revert)
export const V1 = {
  name: "v1",
  sheet: {
    a: "#5d8cff", b: "#6a5bff", c: "#a44dff",
    lift: "rgba(255,255,255,.26)", dip: "rgba(12,4,64,.34)",
    edge: "rgba(255,255,255,.4)", back: "#0b0730", bk: "#2c2a7c",
  },
  grid: { line: "rgba(255,255,255,0)", axis: "rgba(255,255,255,0)", step: 8, width: 0 },
  gold: {
    deep: "#fff", mid: "#fff", rich: "#fff", bright: "#fff", spec: "#fff",
    glow: "rgba(110,232,255,.6)", shadow: "rgba(18,8,74,.55)",
    smudge: "rgba(255,255,255,0)", sheen: "rgba(255,255,255,0)",
  },
  heat: [
    [0, 120, 0, 60, 0], [0.12, 150, 10, 72, 0.3], [0.3, 212, 24, 60, 0.66], [0.5, 246, 52, 46, 0.9],
    [0.68, 255, 112, 42, 0.97], [0.82, 255, 172, 62, 0.99], [0.93, 255, 228, 128, 1], [1, 255, 250, 230, 1],
  ],
  tip: { core: "#ffffff", halo: "rgba(94,255,196,.45)", ring: [94, 255, 196] },
  ink: "#fff",
};

/** The theme in force. Switch to V1 to put the original blue/purple mark back everywhere. */
export const THEME = CARBON;

/**
 * Push the palette into CSS custom properties.
 *
 * app.css styles the folding sheet, and a stylesheet cannot import a JS module -- so the
 * values are written onto :root at startup instead. The stylesheet carries the same colours as
 * fallbacks so the mark still looks right for the instant before scripts run.
 */
export function cssVars(root = document.documentElement) {
  const t = THEME;
  const set = (k, v) => root.style.setProperty(k, v);
  set("--mk-sheet-a", t.sheet.a);
  set("--mk-sheet-b", t.sheet.b);
  set("--mk-sheet-c", t.sheet.c);
  set("--mk-lift", t.sheet.lift);
  set("--mk-dip", t.sheet.dip);
  set("--mk-edge", t.sheet.edge);
  set("--mk-back", t.sheet.back);
  set("--mk-bk", t.sheet.bk);
  set("--mk-grid", t.grid.line);
  set("--mk-grid-axis", t.grid.axis);
}

/** The grid as SVG markup, so the still mark and the animated one rule the same lines. */
export function gridSVG(from = 4, to = 60) {
  const { line, axis, step, width } = THEME.grid;
  if (!width) return "";
  let out = "";
  for (let v = from + step; v < to; v += step) {
    const mid = Math.abs(v - 32) < 0.001;
    const col = mid ? axis : line;
    out += `<path d="M${v} ${from}V${to}" stroke="${col}" stroke-width="${width}" fill="none"/>`;
    out += `<path d="M${from} ${v}H${to}" stroke="${col}" stroke-width="${width}" fill="none"/>`;
  }
  return out;
}
