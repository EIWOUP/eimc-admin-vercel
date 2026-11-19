// The Modes menu: one hero tile per mode, all built alike — a live miniature of what the mode draws, on the
// canvas the mode wears on the chart, over its name, a tag and what it shows, with the switch on the right.
// The golden volume profile sits on TradingView's black, order flow on ATAS's slate, smart money on the
// terminal's own navy, the liquidity heatmap on Bookmap's deep navy, and every colour is the one the chart
// draws with. Geometry is generated once from a fixed seed (a tile looks the same every time it opens) and
// CSS moves it.

const TAU = Math.PI * 2;
const GW = 344, GH = 86;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = (x) => +x.toFixed(1);
const f2 = (x) => +x.toFixed(2);
const MINUS = "−";

// The chart's own colour ramps (heatmap.js): [stop, r, g, b, alpha 0–255].
const RAMP_HEAT = [[0, 6, 14, 30, 0], [0.06, 14, 40, 84, 116], [0.16, 22, 84, 156, 196], [0.3, 32, 136, 210, 232],
  [0.45, 66, 192, 242, 244], [0.58, 168, 232, 250, 250], [0.68, 252, 238, 92, 253], [0.82, 255, 150, 36, 255],
  [0.93, 244, 62, 30, 255], [1, 226, 22, 34, 255]];
const RAMP_WALL = [[0, 28, 64, 124, 0], [0.14, 30, 70, 138, 92], [0.3, 38, 100, 178, 140], [0.4, 50, 126, 206, 170],
  [0.46, 72, 154, 230, 196], [0.5, 255, 204, 70, 236], [0.6, 255, 140, 36, 244], [0.76, 238, 58, 38, 250], [1, 204, 18, 34, 253]];
function ramp(R, v) {
  let i = 1;
  while (i < R.length - 1 && v > R[i][0]) i++;
  const a = R[i - 1], b = R[i], t = Math.min(1, Math.max(0, (v - a[0]) / (b[0] - a[0])));
  const c = [1, 2, 3, 4].map((k) => a[k] + (b[k] - a[k]) * t);
  return { fill: `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`, a: f2(c[3] / 255) };
}

// A TradingView candle; y grows downwards, so a close above the open has the smaller y.
const BULL = "#089981", BEAR = "#f23645";
function candle(x, yo, yc, yh, yl, w, cls = "", st = "") {
  const col = yc <= yo ? BULL : BEAR;
  return `<g class="${cls}"${st ? ` style="${st}"` : ""}><line x1="${f1(x)}" x2="${f1(x)}" y1="${f1(yh)}" y2="${f1(yl)}" stroke="${col}" stroke-width=".8"/>`
    + `<rect x="${f1(x - w / 2)}" y="${f1(Math.min(yo, yc))}" width="${w}" height="${f1(Math.max(0.8, Math.abs(yo - yc)))}" fill="${col}"/></g>`;
}

// The same candle as one HTML element, its body and wick two background layers: a replay of these runs on the
// compositor, where SVG elements' animations would cost the main thread every frame. Tile pixels; d its delay.
function hcandle(x, yo, yc, yh, yl, w, cls, d) {
  const top = Math.min(yo, yc), bh = Math.max(0.8, Math.abs(yo - yc));
  return `<i class="hc ${yc <= yo ? "u" : "n"} ${cls}" style="left:${f1(x - w / 2)}px;top:${f1(yh)}px;width:${w}px;height:${f1(Math.max(bh, yl - yh))}px;`
    + `--bt:${f1(top - yh)}px;--bh:${f1(bh)}px;--d:${d}s"></i>`;
}

// Text widths for the tiny labels (Inter / JetBrains Mono at ~6 px): close enough to size a plate or a pill.
const textW = (s, px) => [...s].reduce((w, ch) => w + px * (/[0-9]/.test(ch) ? 0.6 : /[.,·]/.test(ch) ? 0.3 : ch === " " ? 0.28 : /[A-Z]/.test(ch) ? 0.68 : 0.56), 0);

// ------------------------------------------------------------- golden volume profile
// A miniature of the mode: yesterday boxed in teal with its golden profile (value area bright), the POC line
// running on into today, LVN / HVN bands, and today's candles replaying into them — price slices through the
// LVN, stalls in the HVN, and falls back to the POC. Static geometry; CSS moves it.
function goldViz() {
  const r = rng(23);
  const top = 9, bot = 79, x0 = 8, x1 = 150, xe = 336, N = 26, rh = (bot - top) / N;
  const yOf = (u) => bot - u * (bot - top);
  const gs = (u, m, s) => Math.exp(-0.5 * ((u - m) / s) ** 2);
  const LV = [[10, 11], [19, 20]], HV = [15, 17];
  const vol = Array.from({ length: N }, (_, k) => {
    const u = (k + 0.5) / N;
    const v = gs(u, 0.21, 0.09) + 0.6 * gs(u, 0.62, 0.065) + 0.32 * gs(u, 0.89, 0.05) + 0.07 + r() * 0.05;
    return LV.some(([a, b]) => k >= a && k <= b) ? v * 0.28 : v;
  });
  const mx = Math.max(...vol), poc = vol.indexOf(mx);
  let a = poc, b = poc, left = vol.reduce((s, v) => s + v, 0) * 0.7 - mx;   // value area, TradingView's rule
  for (;;) {
    const up = b + 1 < N ? vol[b + 1] : -1, dn = a > 0 ? vol[a - 1] : -1, pick = Math.max(up, dn);
    if (pick < 0 || pick > left) break;
    left -= pick;
    if (up >= dn) b++; else a--;
  }
  let s = `<rect width="${GW}" height="${GH}" fill="#0f0f0f"/>`;
  for (let x = 50; x < GW; x += 50) s += `<line x1="${x}" x2="${x}" y1="0" y2="${GH}" stroke="#f2f2f2" stroke-opacity=".05"/>`;
  for (let y = 21; y < GH; y += 21) s += `<line x1="0" x2="${GW}" y1="${y}" y2="${y}" stroke="#f2f2f2" stroke-opacity=".05"/>`;
  s += `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bot - top}" fill="#23c3d7" fill-opacity=".08"/>`;
  const candle = (x, o, c, h, l, w, cls = "", st = "") => {
    const col = c >= o ? "#089981" : "#f23645";
    return `<g class="${cls}" ${st}><line x1="${f1(x)}" x2="${f1(x)}" y1="${f1(yOf(h))}" y2="${f1(yOf(l))}" stroke="${col}" stroke-width=".8"/>`
      + `<rect x="${f1(x - w / 2)}" y="${f1(yOf(Math.max(o, c)))}" width="${w}" height="${f1(Math.max(0.8, Math.abs(yOf(o) - yOf(c))))}" fill="${col}"/></g>`;
  };
  // yesterday: the sell-off from the high, then the afternoon's range at the POC (faint, under the profile)
  let u = 0.95, day = "";
  for (let k = 0; k < 30; k++) {
    const o = u;
    u = (k < 17 ? 0.95 - k * 0.045 : 0.21 + 0.06 * Math.sin(k * 1.4)) + (r() - 0.5) * 0.05;
    day += candle(x0 + 3 + k * 4.75, o, u, Math.max(o, u) + 0.015 + r() * 0.03, Math.min(o, u) - 0.015 - r() * 0.03, 2.2);
  }
  s += `<g opacity=".5">${day}</g>`;
  // the profile, over the candles as TradingView draws it
  let rows = "";
  for (let k = 0; k < N; k++) {
    const w = (64 * vol[k]) / mx, y = bot - (k + 1) * rh + 0.5, h = f1(rh - 0.7), up = w * (0.42 + r() * 0.24);
    const inner = k >= a && k <= b
      ? `<rect x="${x0}" y="${f1(y)}" width="${f1(up)}" height="${h}" fill="#ff9800" fill-opacity=".86"/><rect x="${f1(x0 + up)}" y="${f1(y)}" width="${f1(w - up)}" height="${h}" fill="#ff9800" fill-opacity=".16"/>`
      : `<rect x="${x0}" y="${f1(y)}" width="${f1(w)}" height="${h}" fill="#ff9800" fill-opacity=".36"/>`;
    rows += `<g class="gv-r" style="--d:${f1(-k * 0.13)}s;--g:${f1(k * 0.025)}s">${inner}</g>`;
  }
  s += rows;
  // zones carried to today's close, the POC line with its running glint, labels at the right end
  const band = (k0, k1, fill) => `<rect class="gv-z" x="${x0}" y="${f1(bot - (k1 + 1) * rh)}" width="${xe - x0}" height="${f1((k1 - k0 + 1) * rh)}" fill="${fill}"/>`;
  s += LV.map(([p, q]) => band(p, q, "rgba(255,183,77,.17)")).join("") + band(HV[0], HV[1], "rgba(100,181,246,.17)");
  const yp = bot - (poc + 0.5) * rh;
  s += `<rect x="${x0}" y="${f1(yp - 0.8)}" width="${xe - x0}" height="1.6" fill="#f59b0c" class="gv-poc"/>`
    + `<rect class="gv-glint" x="${x0}" y="${f1(yp - 1.6)}" width="30" height="3.2" fill="url(#gvGl)"/>`;
  // today: price opens at the POC, slices up through the LVN, stalls in the HVN, falls back through the LVN
  const path = [0.22, 0.25, 0.21, 0.27, 0.31, 0.36, 0.47, 0.57, 0.6, 0.64, 0.61, 0.65, 0.62, 0.6, 0.55, 0.44, 0.33, 0.27, 0.24, 0.26, 0.23, 0.28, 0.31, 0.29];
  let today = "";
  path.forEach((c, k) => {
    const o = k ? path[k - 1] : 0.2;
    today += candle(160 + k * 6.75, o, c, Math.max(o, c) + 0.02 + r() * 0.03, Math.min(o, c) - 0.02 - r() * 0.03, 3.4, "gv-c", `style="--d:${f1(k * 0.26)}s"`);
  });
  s += today;
  const lab = (k, t, c) => `<text class="gv-t" x="${xe - 3}" y="${f1(bot - (k + 0.5) * rh)}" fill="${c}">${t}</text>`;
  s += lab((LV[0][0] + LV[0][1]) / 2, "LVN", "#ffb74d") + lab((LV[1][0] + LV[1][1]) / 2, "LVN", "#ffb74d")
    + lab((HV[0] + HV[1]) / 2, "HVN", "#64b5f6") + lab(poc, "POC", "#f59b0c");
  return `<svg viewBox="0 0 ${GW} ${GH}" preserveAspectRatio="none"><defs><linearGradient id="gvGl">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff6dc" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient></defs>${s}</svg>`;
}

// ---------------------------------------------------------------------- order flow
// The mode on its ATAS slate: resting orders as blue smudges per price row, the walls burning orange, the
// live DOM down the right edge, and the candles replaying with their big trades boxed — sellers absorb at the
// ask wall, buyers hold the bid wall, then lift the offer straight through the ask wall and retest it. Then the
// view zooms into the last candles, which open into footprints as the chart does zoomed in: sellers left of
// the wick, buyers right, the busiest price boxed, imbalances lit, each candle's delta glowing under its low.
const FT = 12;                                   // seconds per loop

// Resting size per price row as ATAS paints it: deeper blue for more, nothing for the noise, and the rows the
// price traded through eaten. eat(x) -> [y of the bar's high, y of its low] at x, or null.
function smudges(r, { y0, y1, pitch, cw, x1, eat }) {
  let s = "";
  const nc = Math.ceil(x1 / cw);
  for (let y = y0; y < y1; y += pitch) {
    const base = 0.3 + 0.7 * r() ** 1.4, f = 1 + Math.floor(r() * 3), ph = r() * TAU;
    let run = null;
    const flush = () => {
      if (run) s += `<rect x="${f1(run.x)}" y="${f1(y - pitch / 2 + 0.55)}" width="${f1(run.w)}" height="${f1(pitch - 1.1)}" fill="${run.fill}" fill-opacity="${run.a}"/>`;
      run = null;
    };
    for (let c = 0; c < nc; c++) {
      const x = c * cw;
      let v = base * (0.5 + 0.5 * Math.sin((TAU * f * c) / nc + ph)) + (r() - 0.5) * 0.42;
      const e = eat(x + cw / 2);
      if (e) {
        const d = Math.max(e[0] - y, y - e[1], 0);
        if (d < 5) v *= 0.05 + 0.95 * (d / 5) ** 2;
      }
      const L = v < 0.3 ? -1 : Math.min(3, Math.floor((v - 0.3) / 0.15));
      if (L < 0) { flush(); continue; }
      if (run && run.L === L) { run.w += cw; continue; }
      flush();
      const { fill, a } = ramp(RAMP_WALL, 0.17 + 0.095 * L);
      run = { x, w: cw, L, fill, a };
    }
    flush();
  }
  return s;
}

function flowViz() {
  const r = rng(41);
  const top = 8, bot = 78, yOf = (u) => bot - u * (bot - top);
  // [open, high, low, close] as fractions of the price range
  const K = [[0.5, 0.58, 0.47, 0.55], [0.55, 0.6, 0.49, 0.52], [0.52, 0.62, 0.5, 0.6], [0.6, 0.69, 0.58, 0.66], [0.66, 0.735, 0.64, 0.7],
    [0.7, 0.74, 0.6, 0.62], [0.62, 0.64, 0.52, 0.55], [0.55, 0.57, 0.42, 0.44], [0.44, 0.46, 0.3, 0.33], [0.33, 0.35, 0.225, 0.27],
    [0.27, 0.38, 0.23, 0.36], [0.36, 0.47, 0.34, 0.45], [0.45, 0.58, 0.44, 0.56], [0.56, 0.68, 0.54, 0.66], [0.66, 0.86, 0.64, 0.84],
    [0.84, 0.87, 0.77, 0.8], [0.8, 0.82, 0.735, 0.76], [0.76, 0.85, 0.75, 0.83], [0.83, 0.9, 0.81, 0.88], [0.88, 0.92, 0.84, 0.86],
    [0.86, 0.93, 0.85, 0.91], [0.91, 0.96, 0.89, 0.94]];
  const N = K.length, X = (k) => 12 + 12.2 * k, BRK = 14;
  const yA = yOf(0.74), yB = yOf(0.22), xEnd = X(N - 1) + 6, DOMX = 300;
  const dOf = (k) => f1(0.3 + 0.15 * k);
  // the zoom: scene A through M lands its last candles across the tile, the last one where it was
  const SX = 3.4, TX = X(N - 1) * (1 - SX), SY = 49 / (yOf(0.735) - yOf(0.96)), TY = 9 - SY * yOf(0.96);
  const mx = (x) => SX * x + TX, my = (y) => SY * y + TY;
  const barAt = (k) => (k >= 0 && k < N ? [yOf(K[k][1]), yOf(K[k][2])] : null);

  // ---- scene A, zoomed out. Each scene is the book behind (static: its blur is drawn once) and what moves in
  // front of it; the zoom and the cross-fade move whole layers, so they cost the compositor only.
  const lvA = smudges(r, { y0: 3, y1: 84, pitch: 3.5, cw: 4, x1: xEnd, eat: (x) => barAt(Math.round((x - 12) / 12.2)) });
  const wall = (y, x0, x1, fill) => `<rect x="${f1(x0)}" y="${f1(y - 1.1)}" width="${f1(x1 - x0)}" height="2.2" fill="${fill}"/>`;
  const askC = ramp(RAMP_WALL, 0.64).fill, bidC = ramp(RAMP_WALL, 0.53).fill;
  const walls = wall(yA, 0, X(BRK), "url(#fvAsk)") + wall(yB, 0, xEnd, bidC);
  // the live book's biggest ask and bid as lines across the pane; the last price, dotted
  const yAsk = yOf(0.99), yLast = yOf(K[N - 1][3]);
  const lines = (ya, yb, yl) => `<rect x="0" y="${f1(ya - 0.5)}" width="${DOMX}" height="1" fill="#f0a032" opacity=".9"/><rect x="0" y="${f1(yb - 0.5)}" width="${DOMX}" height="1" fill="#e8414f" opacity=".9"/>`
    + `<line x1="0" x2="${DOMX}" y1="${f1(yl)}" y2="${f1(yl)}" stroke="${BULL}" stroke-width=".8" stroke-dasharray="1 2" opacity=".8"/>`;
  const book = (id, lv, w) => `<defs><g id="${id}">${lv}</g></defs><use href="#${id}" filter="url(#fvSm)"/><use href="#${id}" opacity=".85"/>`
    + `<g filter="url(#fvGw)" opacity=".7">${w}</g>${w}`;
  const bgA = book("fvLa", lvA, walls) + lines(yAsk, yB, yLast);
  // the candles and their big trades replay in HTML; the break flares white-hot where buyers burn through the wall
  let fgA = "";
  K.forEach(([o, h, l, c], k) => { fgA += hcandle(X(k), yOf(o), yOf(c), yOf(h), yOf(l), 5.4, "fv-c", dOf(k)); });
  // big trades: [candle, price, size, buyers?]
  const BIG = [[5, 0.735, "2.4K", 0], [9, 0.24, "1.8K", 1], [11, 0.41, "960", 1], [14, 0.745, "3.6K", 1], [16, 0.75, "1.2K", 1], [19, 0.885, "740", 0]];
  for (const [k, u, t, buy] of BIG) {
    const w = Math.max(13, textW(t, 6) + 6);
    fgA += `<b class="fv-p ${buy ? "u" : "n"}" style="left:${f1(X(k) - w / 2)}px;top:${f1(yOf(u) - 4.5)}px;width:${f1(w)}px;--d:${dOf(k)}s">${t}</b>`;
  }
  fgA += `<i class="fv-f" style="left:${f1(X(BRK))}px;top:${f1(yA)}px;--d:${dOf(BRK)}s"></i>`;

  // ---- scene B, zoomed in: the candles open into footprints
  const lvB = smudges(r, { y0: 1.8, y1: 86, pitch: 3.6, cw: 5, x1: mx(xEnd), eat: (x) => barAt(Math.round(((x - TX) / SX - 12) / 12.2))?.map(my) ?? null });
  const yAskB = my(yAsk), yFlip = my(yA), yLastB = my(yLast);
  const bgB = book("fvLb", lvB, wall(yFlip, 0, mx(X(BRK)), askC)) + lines(yAskB, yFlip, yLastB);
  const colW = Math.floor(SX * 12.2 * 0.84), half = Math.floor((colW - 5) / 2), RH = 4;
  const T0 = 6.45;                                  // footprints fill, candle by candle, once the zoom has landed
  let fp = "", pocs = "", hollow = "", glow = "", digits = "";
  for (let k = 15; k < N; k++) {
    const [o, h, l, c] = K[k], up = c >= o, col = up ? BULL : BEAR;
    const xc = Math.round(mx(X(k))), xl = xc - colW / 2;
    const yh = my(yOf(h)), yl = my(yOf(l)), yo = my(yOf(o)), yc = my(yOf(c));
    const m0 = Math.floor(yh / RH), m1 = Math.floor(yl / RH), rows = [];
    const poc = Math.round(m0 + (m1 - m0) * (0.3 + r() * 0.4));
    for (let m = m0; m <= m1; m++) {
      const tot = Math.exp(-0.5 * ((m - poc) / Math.max(1.2, (m1 - m0) * 0.32)) ** 2) + 0.16 + r() * 0.22;
      const sh = Math.min(0.92, Math.max(0.08, (up ? 0.6 : 0.4) + (r() - 0.5) * 0.46));
      rows.push({ m, b: Math.round(tot * sh * 90), s: Math.round(tot * (1 - sh) * 90) });
    }
    const maxSide = Math.max(1, ...rows.map((x) => Math.max(x.b, x.s)));
    let busiest = rows[0];
    for (const x of rows) if (x.b + x.s > busiest.b + busiest.s) busiest = x;
    const vb = rows.reduce((t, x) => t + x.b, 0), vs = rows.reduce((t, x) => t + x.s, 0);
    // a dark plate under the rows, then the rows: sellers left of the wick, buyers right, imbalances lit
    fp += `<rect x="${f1(xl)}" y="${f1(m0 * RH)}" width="${colW}" height="${f1((m1 - m0 + 1) * RH)}" fill="rgba(9,12,19,.74)"/>`;
    const act = Math.sqrt((vb + vs) / 900), aBar = f2(Math.min(0.82, 0.42 + 0.4 * act));
    let sells = "", buys = "";
    rows.forEach((x, j) => {
      const below = rows[j + 1], above = rows[j - 1];
      const bImb = x.b > 0 && x.b >= 3 * (below ? below.s : 0) && x.b >= 0.15 * maxSide;
      const sImb = x.s > 0 && x.s >= 3 * (above ? above.b : 0) && x.s >= 0.15 * maxSide;
      const wb = x.b ? Math.max(2, (x.b / maxSide) * half) : 0, ws = x.s ? Math.max(2, (x.s / maxSide) * half) : 0;
      const y = f1(x.m * RH + 0.25), hh = RH - 0.5;
      if (ws) sells += `<rect x="${f1(xc - 1 - ws)}" y="${y}" width="${f1(ws)}" height="${hh}" fill="${sImb ? "rgba(255,72,104,.96)" : `rgba(226,52,78,${aBar})`}"/>`;
      if (wb) buys += `<rect x="${f1(xc + 2)}" y="${y}" width="${f1(wb)}" height="${hh}" fill="${bImb ? "rgba(38,232,160,.96)" : `rgba(22,178,128,${aBar})`}"/>`;
    });
    fp += `<g class="fv-g" style="--d:${f2(T0 + (k - 15) * 0.12)}s;transform-origin:${xc + 0.5}px 0">${sells}${buys}</g>`;   // grows out of its wick
    pocs += `<rect x="${f1(xl + 0.5)}" y="${f1(busiest.m * RH - 0.3)}" width="${colW - 1}" height="${f1(RH + 0.6)}"/>`;
    // the candle itself, hollow, its wick running on through the body
    const bt = Math.min(yo, yc), bb = Math.max(yo, yc);
    hollow += `<g stroke="${col}"><line x1="${xc + 0.5}" x2="${xc + 0.5}" y1="${f1(yh)}" y2="${f1(bt)}" stroke-width="1"/><line x1="${xc + 0.5}" x2="${xc + 0.5}" y1="${f1(bb)}" y2="${f1(yl)}" stroke-width="1"/>`
      + `<line x1="${xc + 0.5}" x2="${xc + 0.5}" y1="${f1(bt)}" y2="${f1(bb)}" stroke-width="1" stroke-opacity=".4"/>`
      + `<rect x="${f1(xl + 0.6)}" y="${f1(bt + 0.6)}" width="${f1(colW - 1.2)}" height="${f1(Math.max(0.6, bb - bt - 1.2))}" fill="none" stroke-width="1.05"/></g>`;
    // its delta under the low, a clear gap below it: bare glowing digits, green when the buyers won
    const d = vb - vs, fs = 6.6, ty = Math.min(yl + Math.round(fs * 1.3) + fs / 2, GH - fs / 2 - 1);
    const txt = `${d > 0 ? "+" : d < 0 ? MINUS : ""}${Math.abs(d).toLocaleString("en-IN")}`, at = `x="${xc + 0.5}" y="${f1(ty)}"`;
    glow += `<text ${at} fill="${d >= 0 ? "#12e88f" : "#ff2e50"}">${txt}</text>`;
    digits += `<text ${at} fill="${d >= 0 ? "#6bffc4" : "#ff8a9b"}">${txt}</text>`;
  }
  const late = (t) => `style="--d:${f2(T0 + t)}s"`;
  const fgB = `${fp}<g class="fv-poc" ${late(0.85)} fill="none" stroke="#f5b841" stroke-width=".7" stroke-opacity=".78">${pocs}</g>${hollow}`
    + `<g class="fv-d" ${late(1)} filter="url(#fvDg)">${glow}</g><g class="fv-d" ${late(1)}>${digits}</g>`;

  // ---- the live DOM on the right edge, one per scene: pinned (it never zooms), its bars HTML so that their
  // breathing runs on the compositor; the totals bar under it, as ATAS shows it
  const dom = (pitch, y0, yLastD, big) => {
    const g = ["", "", ""];
    let i = 0, tb = 0, ta = 0;
    for (let y = y0; y < GH - 11; y += pitch) {
      const ask = y < yLastD, near = Math.abs(y - yLastD) < pitch * 2.2;
      let q = 0.12 + r() * 0.42 + (near ? 0.18 : 0);
      for (const [yb, qb] of big) if (Math.abs(y - yb) < pitch / 2) q = qb;
      const w = Math.max(1.5, q ** 0.6 * (GW - DOMX - 3));
      if (ask) ta += q; else tb += q;
      g[i++ % 3] += `<i class="${ask ? "a" : "b"}" style="top:${f1(y - 1.1)}px;width:${f1(w)}px"></i>`;
    }
    const wd = GW - DOMX - 2, wb = f1((wd * tb) / (tb + ta));
    const s = g.map((x, k) => `<span class="fv-dg" style="--d:${f1(-k * 0.57)}s">${x}</span>`).join("");
    return `<span class="fv-dom">${s}<svg class="fv-tot" viewBox="0 0 ${wd} 7" width="${wd}" height="7"><rect width="${wb}" height="7" fill="rgba(34,96,72,.9)"/>`
      + `<rect x="${wb}" width="${f1(wd - wb)}" height="7" fill="rgba(120,34,48,.9)"/><text class="fv-tt" x="2" y="3.7" fill="rgba(190,240,215,.9)">${Math.round(tb * 9)}K</text>`
      + `<text class="fv-tt e" x="${wd - 2}" y="3.7" fill="rgba(255,200,208,.9)">${Math.round(ta * 9)}K</text></svg></span>`;
  };
  const domA = dom(3.5, 3, yLast, [[yAsk, 0.86], [yB, 1]]);
  const domB = dom(3.6, 1.8, yLastB, [[yAskB, 0.8], [yFlip, 1]]);

  const M = `matrix(${f2(SX)},0,0,${f2(SY)},${f1(TX)},${f1(TY)})`, Mi = `matrix(${f2(1 / SX)},0,0,${f2(1 / SY)},${f1(-TX / SX)},${f1(-TY / SY)})`;
  const kf = `@keyframes fvZa{0%,46%{transform:none;animation-timing-function:cubic-bezier(.55,0,.35,1)}53%,92%{transform:${M}}92.5%,100%{transform:none}}`
    + `@keyframes fvZb{0%,46%{transform:${Mi};animation-timing-function:cubic-bezier(.55,0,.35,1)}53%,100%{transform:none}}`;
  const layer = (cls, body, defs = "") => `<svg class="${cls}" viewBox="0 0 ${DOMX} ${GH}" width="${DOMX}" height="${GH}">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;
  const bgDefs = `<filter id="fvSm" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="1.6 1.1"/></filter>`
    + `<filter id="fvGw" x="-5%" y="-200%" width="110%" height="500%"><feGaussianBlur stdDeviation="2.2"/></filter>`
    + `<linearGradient id="fvAsk" x1="0" x2="1"><stop offset="0" stop-color="${askC}"/><stop offset=".72" stop-color="${ramp(RAMP_WALL, 0.7).fill}"/><stop offset="1" stop-color="#ff3b26"/></linearGradient>`;
  const halo = `<filter id="fvDg" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur in="SourceGraphic" stdDeviation="2.3" result="a"/>`
    + `<feGaussianBlur in="SourceGraphic" stdDeviation=".7" result="b"/><feMerge><feMergeNode in="a"/><feMergeNode in="b"/></feMerge></filter>`;
  const html = `<span class="fv-a"><span class="fv-za">${layer("fv-bg", bgA, bgDefs)}${fgA}</span>${domA}</span>`
    + `<span class="fv-b"><span class="fv-zb">${layer("fv-bg", bgB)}${layer("fv-fg", fgB, halo)}</span>${domB}</span>`;
  return { html, kf };
}

// --------------------------------------------------------------------- smart money
// The mode on the terminal's navy, in the chart's smart-money colours: a downtrend (lower highs, a bearish
// BOS) runs into equal lows with the crowd's stops resting under them, sweeps them into a higher-timeframe
// demand zone, and reverses — the bullish CHoCH, the demand order block and the fair-value gap it leaves, the
// higher low back in the gap, the bullish BOS — and the trade plan projected past the last candle: entry,
// stop and first target. Each mark arrives with the candle that confirms it.
function smcViz() {
  const yOf = (u) => 14 + (0.86 - u) * 105.5;
  const K = [[0.78, 0.85, 0.76, 0.82], [0.82, 0.86, 0.74, 0.76], [0.76, 0.78, 0.68, 0.7], [0.7, 0.72, 0.6, 0.62], [0.62, 0.64, 0.55, 0.58],
    [0.58, 0.66, 0.57, 0.64], [0.64, 0.71, 0.62, 0.69], [0.69, 0.7, 0.6, 0.62], [0.62, 0.63, 0.51, 0.53], [0.53, 0.55, 0.44, 0.47],
    [0.47, 0.49, 0.4, 0.42], [0.42, 0.5, 0.41, 0.47], [0.47, 0.53, 0.45, 0.5], [0.5, 0.51, 0.43, 0.45], [0.45, 0.47, 0.405, 0.42],
    [0.42, 0.45, 0.31, 0.43], [0.43, 0.54, 0.42, 0.52], [0.52, 0.62, 0.51, 0.6], [0.6, 0.66, 0.59, 0.64], [0.64, 0.67, 0.6, 0.62],
    [0.62, 0.63, 0.55, 0.56], [0.56, 0.57, 0.49, 0.51], [0.51, 0.53, 0.47, 0.5], [0.5, 0.58, 0.49, 0.57], [0.57, 0.64, 0.56, 0.63],
    [0.63, 0.71, 0.62, 0.7], [0.7, 0.76, 0.69, 0.74], [0.74, 0.77, 0.7, 0.72], [0.72, 0.77, 0.71, 0.75], [0.75, 0.8, 0.74, 0.79]];
  const N = K.length, X = (k) => 10 + 9.2 * k, xR = X(N - 1) + 4;
  const dk = (k) => f2(0.15 + 0.19 * k), dPlan = f2(0.15 + 0.19 * (N - 1) + 0.35);
  const tint = (hex, al) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${al})`;
  const C = { bosUp: "#089981", bosDn: "#f23645", swUp: "#3fd5ad", swDn: "#ff7a86", demand: "#4c7dff", fvg: "#22d3ee", liq: "#f5b841",
    entry: "#4c7dff", tp: "#089981", sl: "#f23645", htf: "#b39dff", shSell: "#ff5c9a", zoneRes: "#f23645" };
  // Layers, back to front: what stands still (the canvas, the higher-timeframe and resistance zones) drawn once;
  // the zones that arrive under the candles; the candles (HTML, replaying on the compositor); the structure, the
  // liquidity and the plan over them. Every mark arrives with the candle that confirms it, one group per candle.
  const under = {}, over = {};
  const add = (layer, cls, d, svg) => { const key = `${cls}|${d}`; layer[key] = (layer[key] || "") + svg; };
  const groups = (layer) => Object.entries(layer).map(([key, svg]) => { const [cls, d] = key.split("|"); return `<g class="${cls}" style="--d:${d}s">${svg}</g>`; }).join("");
  let bg = "";
  // the canvas: the chart's own gradient and faint grid
  for (let x = 57; x < GW; x += 57) bg += `<line x1="${x}" x2="${x}" y1="0" y2="${GH}" stroke="#fff" stroke-opacity=".035"/>`;
  for (let y = 21.5; y < GH; y += 21.5) bg += `<line x1="0" x2="${GW}" y1="${y}" y2="${y}" stroke="#fff" stroke-opacity=".045"/>`;
  // a higher-timeframe demand zone across the whole chart, dashed, as the chart draws HTF zones
  const hz0 = yOf(0.355), hz1 = yOf(0.3);
  bg += `<rect x="-1" y="${f1(hz0)}" width="${GW + 2}" height="${f1(hz1 - hz0)}" fill="${tint(C.htf, 0.07)}" stroke="${tint(C.htf, 0.6)}" stroke-width=".6" stroke-dasharray="3 2.4"/>`
    + `<text class="sm-pt" x="6" y="${f1((hz0 + hz1) / 2 + 0.2)}" fill="${tint(C.htf, 0.95)}">1H  DEMAND</text>`;
  // the resistance zone the downtrend came from: the chart's gradient box with its edges, carried to the right edge
  const rz0 = yOf(0.845), rz1 = yOf(0.8);
  bg += `<rect x="${f1(X(0) - 2.3)}" y="${f1(rz0)}" width="${f1(GW - X(0) + 2.3)}" height="${f1(rz1 - rz0)}" fill="url(#smRz)"/>`
    + `<path d="M${f1(X(0) - 2.3)} ${f1(rz0 + 0.3)}H${GW}M${f1(X(0) - 2.3)} ${f1(rz1 - 0.3)}H${GW}" stroke="${tint(C.zoneRes, 0.55)}" stroke-width=".6"/>`;
  // the stops resting under the equal lows (sell-side liquidity), until the sweep takes them
  add(under, "sm-l", dk(14), `<rect x="${f1(X(10) - 2.3)}" y="${f1(yOf(0.4))}" width="${f1(X(15) - X(10) + 2.3)}" height="${f1(yOf(0.365) - yOf(0.4))}" fill="url(#smSh)"/>`);
  // the demand order block and the fair-value gap with its 50 % line, to the right edge of the candles
  const box = (k, u0, u1, rgb, fillA, strokeA, dash, accent) => `<rect x="${f1(X(k) - 2.3)}" y="${f1(yOf(u1))}" width="${f1(xR - X(k) + 2.3)}" height="${f1(yOf(u0) - yOf(u1))}"`
    + ` fill="${tint(rgb, fillA)}" stroke="${tint(rgb, strokeA)}" stroke-width=".7"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`
    + (accent ? `<rect x="${f1(X(k) - 2.3)}" y="${f1(yOf(u1))}" width="1.4" height="${f1(yOf(u0) - yOf(u1))}" fill="${tint(rgb, 0.95)}"/>` : "");
  add(under, "sm-l", dk(17), box(14, 0.405, 0.47, C.demand, 0.15, 0.5, "", true) + box(16, 0.45, 0.51, C.fvg, 0.09, 0.3, "1.4 1.8", false)
    + `<line x1="${f1(X(16) - 2.3)}" x2="${f1(xR)}" y1="${f1(yOf(0.48))}" y2="${f1(yOf(0.48))}" stroke="${tint(C.fvg, 0.45)}" stroke-width=".6" stroke-dasharray=".7 1.8"/>`);
  // the trade plan, projected past the last candle: risk red, reward green, the entry zone in blue
  const px0 = xR + 3, eT = 0.62, eB = 0.58, mid = (eT + eB) / 2, slU = 0.46, t1 = 0.9, rr = ((t1 - mid) / (mid - slU)).toFixed(1);
  add(under, "sm-t", dPlan, `<rect x="${f1(px0)}" y="${f1(yOf(mid))}" width="${f1(GW - px0)}" height="${f1(yOf(slU) - yOf(mid))}" fill="${tint(C.sl, 0.12)}"/>`
    + `<rect x="${f1(px0)}" y="${f1(yOf(t1))}" width="${f1(GW - px0)}" height="${f1(yOf(mid) - yOf(t1))}" fill="${tint(C.tp, 0.12)}"/>`
    + `<rect x="${f1(px0)}" y="${f1(yOf(eT))}" width="${f1(GW - px0)}" height="${f1(yOf(eB) - yOf(eT))}" fill="${tint(C.entry, 0.18)}" stroke="${tint(C.entry, 0.85)}" stroke-width=".6" stroke-dasharray="2.4 1.8"/>`
    + `<rect x="${f1(px0)}" y="${f1(yOf(slU) - 0.6)}" width="${f1(GW - px0)}" height="1.2" fill="${C.sl}"/>`
    + `<rect x="${f1(px0)}" y="${f1(yOf(t1) - 0.6)}" width="${f1(GW - px0)}" height="1.2" fill="${C.tp}"/>`);
  // the candles
  let candles = "";
  K.forEach(([o, h, l, c], k) => { candles += hcandle(X(k), yOf(o), yOf(c), yOf(h), yOf(l), 4.8, "sm-c", dk(k)); });
  // structure: breaks of structure dashed, the change of character solid and bold, a soft glow under each line
  const brk = (k0, k1, u, col, kind, above) => {
    const y = yOf(u), x0 = X(k0), x1 = X(k1), choch = kind === "CHoCH";
    const at = `x1="${f1(x0)}" x2="${f1(x1)}" y1="${f1(y)}" y2="${f1(y)}" stroke="${col}"${choch ? "" : ' stroke-dasharray="3 2.4"'}`;
    add(over, "sm-l", dk(k1), `<line ${at} stroke-width="${choch ? 3.4 : 2.6}" stroke-opacity=".22"/><line ${at} stroke-width="${choch ? 1.2 : 0.8}"/>`);
    add(over, "sm-t", dk(k1), `<text class="${choch ? "b" : ""}" x="${f1((x0 + x1) / 2)}" y="${f1(above ? y - 4 : y + 5)}" fill="${col}">${kind}</text>`);
  };
  brk(4, 8, 0.55, C.bosDn, "BOS", false);
  brk(12, 17, 0.53, C.bosUp, "CHoCH", true);
  brk(19, 25, 0.67, C.bosUp, "BOS", true);
  // liquidity: the equal lows, then the sweep that takes them
  add(over, "sm-l", dk(14), `<line x1="${f1(X(10))}" x2="${f1(X(15))}" y1="${f1(yOf(0.4))}" y2="${f1(yOf(0.4))}" stroke="${tint(C.liq, 0.8)}" stroke-width=".7" stroke-dasharray="1.2 1.6"/>`);
  add(over, "sm-t", dk(14), `<text class="s" x="${f1(X(12.4))}" y="${f1(yOf(0.4) + 4.6)}" fill="${tint(C.liq, 0.95)}">EQL</text>`);
  const sx = X(15), sy = yOf(0.4);
  const xd = `M${f1(sx - 2.2)} ${f1(sy - 2.2)}L${f1(sx + 2.2)} ${f1(sy + 2.2)}M${f1(sx + 2.2)} ${f1(sy - 2.2)}L${f1(sx - 2.2)} ${f1(sy + 2.2)}`;
  add(over, "sm-x", dk(15), `<path d="${xd}" stroke="${C.liq}" stroke-width="3.4" stroke-opacity=".3" stroke-linecap="round"/><path d="${xd}" stroke="${C.liq}" stroke-width="1.1" stroke-linecap="round"/>`);
  add(over, "sm-t", dk(15), `<text class="s" x="${f1(sx + 1)}" y="${f1(yOf(0.31) + 5.4)}" fill="${C.liq}">SWEEP</text>`);
  // swing labels, each once the swing is confirmed
  const sw = (k, t, up, conf) => {
    const hi = t === "HH" || t === "LH", y = hi ? yOf(K[k][1]) - 3.8 : yOf(K[k][2]) + 4.8;
    add(over, "sm-t", dk(conf), `<text x="${f1(X(k))}" y="${f1(y)}" fill="${up ? C.swUp : C.swDn}">${t}</text>`);
  };
  sw(4, "LL", false, 6); sw(6, "LH", false, 8); sw(12, "LH", false, 14); sw(19, "HH", true, 21); sw(22, "HL", true, 24);
  // zone tags: the app's dark pills with a coloured rim
  const tag = (x, y, t, rgb) => {
    const w = textW(t, 5.4) + 5.4;
    return `<rect x="${f1(x)}" y="${f1(y - 3.9)}" width="${f1(w)}" height="7.8" rx="1.6" fill="rgba(9,12,19,.9)" stroke="${tint(rgb, 0.55)}" stroke-width=".6"/>`
      + `<text class="p" x="${f1(x + 2.7)}" y="${f1(y + 0.2)}" fill="${rgb}">${t}</text>`;
  };
  add(over, "sm-t", dk(17), tag(X(16.4), yOf(0.405) + 6.4, "DEMAND OB", C.demand) + tag(X(26.4), yOf(0.51) - 6, "FVG", C.fvg));
  // price pills on the right edge, as the chart shows them: the zone's, then the plan's
  const pill = (u, t, bg) => {
    const w = textW(t, 5.4) + 5.6, y = yOf(u);
    return `<rect x="${f1(GW - 2 - w)}" y="${f1(y - 4)}" width="${f1(w)}" height="8" rx="1.6" fill="${bg}"/><text class="sm-pt" x="${f1(GW - 2 - w + 2.8)}" y="${f1(y + 0.2)}" fill="#fff">${t}</text>`;
  };
  bg += pill(0.8225, "R  3×", tint(C.zoneRes, 0.92));
  add(over, "sm-p", dPlan, pill(t1 + 0.012, `T1 ${rr}R`, C.tp) + pill(mid + 0.012, "LONG", tint(C.entry, 0.95)) + pill(slU - 0.022, "SL", C.sl));
  const svg = (cls, defs, body) => `<svg class="${cls}" viewBox="0 0 ${GW} ${GH}" preserveAspectRatio="none">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;
  return svg("sm-bgl", `<linearGradient id="smBg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0b0f17"/><stop offset="1" stop-color="#06080d"/></linearGradient>`
      + `<linearGradient id="smRz"><stop offset="0" stop-color="${tint(C.zoneRes, 0.015)}"/><stop offset="1" stop-color="${tint(C.zoneRes, 0.17)}"/></linearGradient>`,
    `<rect width="${GW}" height="${GH}" fill="url(#smBg)"/>${bg}`)
    + svg("sm-ul", `<linearGradient id="smSh"><stop offset="0" stop-color="${tint(C.shSell, 0.03)}"/><stop offset="1" stop-color="${tint(C.shSell, 0.3)}"/></linearGradient>`, groups(under))
    + `<span class="sm-cl">${candles}</span>` + svg("sm-ol", "", groups(over));
}

// ------------------------------------------------------------------ liquidity heatmap
// The mode on Bookmap's navy: the order book over time as glowing bands — deep blue for a little, cyan and
// white for more, the walls burning yellow → orange → red with Bookmap's halo — eaten where the price line
// (green rising, red falling) trades through, the 3-D trade bubbles riding it, the volume bars along the
// bottom, the live book running past "now" into the DOM's spiky mountains. It scrolls like the live chart.
const HP = 312, NOWX = 278, HT = 16;             // scroll period (px), the "now" edge, seconds per period

function heatViz() {
  const r = rng(13);
  const py = (x) => 44 + 15 * Math.sin((TAU * x) / HP + 1) + 7 * Math.sin((TAU * 3 * x) / HP + 2) + 2.6 * Math.sin((TAU * 7 * x) / HP + 0.5);
  const pitch = 3.2, nc = 78, cw = HP / nc;
  // ---- the book: per price row a slowly breathing size, a few walls that stand for a while, eaten by price
  const rowsY = [];
  for (let y = 1.6; y < GH; y += pitch) rowsY.push(y);
  const WALLS = { 4: [8, 50, 0.97], 7: [40, 74, 0.86], 19: [0, 34, 0.92], 23: [50, 78, 0.8], 12: [62, 78, 0.74] };
  let heat = "", hot = "";
  rowsY.forEach((y, i) => {
    const near = Math.abs(y - 44) < 24, base = (0.14 + 0.4 * r() ** 1.5) * (near ? 1.15 : 0.72), f = 1 + Math.floor(r() * 3), ph = r() * TAU;
    const w = WALLS[i];
    let run = null;
    const flush = () => {
      if (!run) return;
      const x = f1(run.x), wd = f1(run.w);
      if (run.v >= 0.6) {                       // a wall: red core, then yellow, then a cyan-blue rim
        const o = ramp(RAMP_HEAT, run.v * 0.42), m = ramp(RAMP_HEAT, run.v * 0.7), c = ramp(RAMP_HEAT, run.v);
        hot += `<rect x="${x}" y="${f1(y - pitch * 0.85)}" width="${wd}" height="${f1(pitch * 1.7)}" fill="${o.fill}" fill-opacity="${o.a}"/>`
          + `<rect x="${x}" y="${f1(y - pitch * 0.5)}" width="${wd}" height="${f1(pitch)}" fill="${m.fill}"/>`
          + `<rect x="${x}" y="${f1(y - pitch * 0.24)}" width="${wd}" height="${f1(pitch * 0.48)}" fill="${c.fill}"/>`;
      } else {
        const c = ramp(RAMP_HEAT, run.v);
        heat += `<rect x="${x}" y="${f1(y - pitch / 2 + 0.35)}" width="${wd}" height="${f1(pitch - 0.7)}" fill="${c.fill}" fill-opacity="${c.a}"/>`;
      }
      run = null;
    };
    for (let c = 0; c < nc; c++) {
      const x = c * cw;
      let v = base * (0.55 + 0.45 * Math.sin((TAU * f * c) / nc + ph)) + (r() - 0.5) * 0.12;
      if (w && c >= w[0] && c < w[1]) v = w[2] * (0.9 + 0.1 * Math.sin(c * 0.9));
      const dd = Math.abs(y - py(x + cw / 2));
      if (dd < 4.6) v *= 0.04 + 0.96 * (dd / 4.6) ** 2;   // the price ate what rested where it traded
      const q = v < 0.1 ? -1 : Math.round(v / 0.05) * 0.05;
      if (q < 0) { flush(); continue; }
      if (run && run.q === q) { run.w += cw; continue; }
      flush();
      run = { x, w: cw, q, v: q };
    }
    flush();
  });
  let grid = "";
  for (let x = 26; x < HP; x += 52) grid += `<line x1="${x}" x2="${x}" y1="0" y2="${GH}" stroke="rgba(170,185,210,.16)" stroke-dasharray="2 2"/>`;
  const twice = (s) => `<g>${s}</g><g transform="translate(${HP} 0)">${s}</g>`;
  const heatSvg = `<svg width="${HP * 2}" height="${GH}" viewBox="0 0 ${HP * 2} ${GH}"><defs>
    <filter id="hmBl" x="-2%" y="-10%" width="104%" height="120%"><feGaussianBlur stdDeviation="2.3 1.6" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="hmHot" x="-2%" y="-60%" width="104%" height="220%"><feGaussianBlur stdDeviation="2.6 1.8" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${twice(grid)}<g filter="url(#hmBl)">${twice(heat)}</g><g filter="url(#hmHot)">${twice(hot)}</g></svg>`;

  // ---- the price line, its bubbles and the volume bars (history only: clipped at "now")
  let line = "", seg = [], dir = 0;
  const pushSeg = () => {
    if (seg.length > 1) line += `<polyline points="${seg.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ")}" fill="none" stroke="${dir < 0 ? "#36e39a" : "#ff4d6d"}" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round"/>`;
  };
  for (let x = 0; x <= HP; x += 2) {
    const y = py(x), dy = py(x + 2) - y, nd = dy < 0 ? -1 : 1;
    if (dir && nd !== dir) { seg.push([x, y]); pushSeg(); seg = [[x, y]]; } else seg.push([x, y]);
    dir = nd;
  }
  pushSeg();
  let bubs = "", vol = "";
  const caps = [0.18, 0.34, 0.5, 0.66, 0.82];
  const spots = [];
  for (let x = 7; x < HP; x += 13 + r() * 6) spots.push(x);
  const qs = spots.map(() => r() ** 1.8);
  spots.forEach((x, k) => {
    const q = qs[k], rad = 2.1 + 4.6 * Math.sqrt(q), y = py(x), rising = py(x + 3) < py(x - 3);
    const fb = Math.min(0.9, Math.max(0.1, (rising ? 0.66 : 0.34) + (r() - 0.5) * 0.3));
    const ci = caps.reduce((bi, c, i) => (Math.abs(c - fb) < Math.abs(caps[bi] - fb) ? i : bi), 0);
    bubs += `<g transform="translate(${f1(x)} ${f1(y)})"><circle r="${f1(rad)}" fill="url(#hbR)"/><circle r="${f1(rad)}" fill="url(#hbG)" clip-path="url(#hbC${ci})"/>`
      + `<circle r="${f1(rad)}" fill="url(#hbH)"/><circle r="${f1(rad)}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width=".6"/></g>`;
  });
  // volume per bubble bucket: solid green / red bars, the biggest sizes printed on top
  const VB = 12, nb = HP / VB, vq = [];
  for (let c = 0; c < nb; c++) {
    let q = 0.12 + r() * 0.3;
    spots.forEach((x, k) => { if (x >= c * VB && x < (c + 1) * VB) q += qs[k] * 0.9; });
    vq.push(q);
  }
  const vmax = Math.max(...vq), labelled = vq.map((q, i) => [q, i]).sort((x, y) => y[0] - x[0]).slice(0, 3).map(([, i]) => i);
  vq.forEach((q, c) => {
    const h = Math.max(1.5, (q / vmax) * 13), x = c * VB + 1, up = py(c * VB + VB) < py(c * VB);
    vol += `<rect x="${x}" y="${f1(GH - 1 - h)}" width="${VB - 2}" height="${f1(h)}" fill="url(#hv${up ? "U" : "D"})"/>`
      + `<rect x="${x}" y="${f1(GH - 1 - h)}" width="${VB - 2}" height=".8" fill="${up ? "rgba(170,255,215,.55)" : "rgba(255,170,185,.55)"}"/>`;
    if (labelled.includes(c)) {
      const t = `${(q * 0.74).toFixed(1)}K`, tx = x + (VB - 2) / 2, ty = GH - 2.4 - h;
      vol += `<text class="hm-vt" x="${f1(tx + 0.5)}" y="${f1(ty + 0.5)}" fill="rgba(0,0,0,.6)">${t}</text><text class="hm-vt" x="${f1(tx)}" y="${f1(ty)}" fill="#e9eef8">${t}</text>`;
    }
  });
  const capDefs = caps.map((c, i) => `<clipPath id="hbC${i}" clipPathUnits="objectBoundingBox"><path d="M0 0H1V${f2(c - 0.06)}Q.5 ${f2(c + 0.11)} 0 ${f2(c - 0.06)}Z"/></clipPath>`).join("");
  const priceSvg = `<svg width="${HP * 2}" height="${GH}" viewBox="0 0 ${HP * 2} ${GH}"><defs>
    <radialGradient id="hbR" cx=".34" cy=".31" r=".72" fx=".34" fy=".31"><stop offset="0" stop-color="#ff9aa8"/><stop offset=".55" stop-color="#e3264b"/><stop offset="1" stop-color="#6e0b1f"/></radialGradient>
    <radialGradient id="hbG" cx=".34" cy=".31" r=".72" fx=".34" fy=".31"><stop offset="0" stop-color="#b4ffd9"/><stop offset=".55" stop-color="#19bf78"/><stop offset="1" stop-color="#0a5a37"/></radialGradient>
    <radialGradient id="hbH" cx=".31" cy=".27" r=".3"><stop offset="0" stop-color="#fff" stop-opacity=".65"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="hvU" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3fd393"/><stop offset="1" stop-color="#1d8a5c"/></linearGradient>
    <linearGradient id="hvD" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ef4466"/><stop offset="1" stop-color="#a3203d"/></linearGradient>
    ${capDefs}</defs>${twice(vol + line + bubs)}</svg>`;

  // ---- the DOM's mountains: asks pink-red above the price, bids green below; it rides with the price
  let asks = [], bids = [];
  for (let y = -GH; y <= GH; y += pitch) {
    if (Math.abs(y) < 1) continue;
    let q = 0.1 + r() * 0.5 * Math.min(1, Math.abs(y) / 30 + 0.35);
    if (r() > 0.9) q = 0.75 + r() * 0.25;
    (y < 0 ? asks : bids).push([y, q]);
  }
  const DW = GW - 312;
  // each side its own HTML layer, so their breathing runs on the compositor
  const mountain = (lv, rgb, edge, side) => {
    const pts = lv.map(([y, q]) => `${f1(DW - Math.max(1, q ** 0.6 * DW))},${f1(y + GH)}`);
    const y0 = lv[0][0] + GH, y1 = lv[lv.length - 1][0] + GH;
    return `<span class="hm-m ${side}"><svg width="${DW}" height="${GH * 2}" viewBox="0 0 ${DW} ${GH * 2}"><defs><linearGradient id="hd${side}" x1="0" x2="1">`
      + `<stop offset="0" stop-color="rgba(${rgb},.55)"/><stop offset="1" stop-color="rgba(${rgb},.98)"/></linearGradient></defs>`
      + `<path d="M${DW} ${f1(y0)}L${pts.join("L")}L${DW} ${f1(y1)}Z" fill="url(#hd${side})" stroke="${edge}" stroke-width=".7"/></svg></span>`;
  };
  asks = asks.sort((p, q) => p[0] - q[0]);
  bids = bids.sort((p, q) => p[0] - q[0]);
  const domSvg = mountain(asks, "240,36,96", "rgba(255,120,160,.9)", "a") + mountain(bids, "28,186,126", "rgba(110,240,190,.9)", "b");

  // the riding dot and the DOM follow the price at the "now" edge through one scroll period
  const steps = 64;
  let kf = "";
  for (let i = 0; i <= steps; i++) kf += `${f1((i / steps) * 100)}%{transform:translateY(${f1(py((NOWX + (i / steps) * HP) % HP))}px)}`;
  const html = `<span class="hm-heat"><span class="hm-strip">${heatSvg}</span></span>`
    + `<span class="hm-price"><span class="hm-strip">${priceSvg}</span></span>`
    + `<span class="hm-now"></span><span class="hm-dom"><span class="hm-domr">${domSvg}</span></span>`
    + `<span class="hm-ride"><i></i></span>`;
  return { html, kf: `@keyframes hmRide{${kf}}` };
}

// ------------------------------------------------------------------------- tiles
// Each mode's tile and the header over it, in the menu's order (store.js MODES).
export const TILES = {
  gvp: { cls: "gold", viz: "gv-viz", head: "Volume profile", em: "previous day → next day", ic: "gv-ic",
    tag: "TradingView-exact", desc: "Previous day's 1-min profile · POC · HVN & LVN zones carried to the next day's close", mc: "#ffb74d", mc2: "#ff9800" },
  oflow: { cls: "flow", viz: "fv-viz", head: "Footprint & delta", em: "NIFTY + options · every trade", ic: "fl-ic",
    tag: "ATAS-style", desc: "Walls · big trades · live DOM · every candle's delta — zoom in for footprints", mc: "#22d3ee", mc2: "#7c6cff" },
  smc: { cls: "smc", viz: "sm-viz", head: "Market structure", em: "swings → liquidity → plan", ic: "sm-ic",
    tag: "ICT-style", desc: "BOS & CHoCH · order blocks · fair-value gaps · liquidity sweeps · stop hunts · trade plan", mc: "#c084fc", mc2: "#f472b6" },
  heat: { cls: "heat", viz: "hm-viz", head: "Resting liquidity", em: "NIFTY + options · book over time", ic: "ht-ic",
    tag: "Bookmap-style", desc: "Resting orders over time behind the candles · trade bubbles · live DOM", mc: "#ffa630", mc2: "#ff5e3a" },
};

let built = null;
function viz(k) {
  if (!built) {
    const flow = flowViz(), heat = heatViz();
    built = { gvp: goldViz(), oflow: flow.html, smc: smcViz(), heat: heat.html };
    const st = document.createElement("style");
    st.id = "md-kf";
    st.textContent = flow.kf + heat.kf;
    document.head.appendChild(st);
  }
  return built[k];
}

const ICONS = {
  "gv-ic": "<i></i><i></i><i></i><i></i>",
  "fl-ic": "<i></i><i></i><i></i><i></i>",
  "sm-ic": `<svg viewBox="0 0 12 12"><path class="z" d="M1 3.2 3.6 7.4 5.6 5.2 8.1 10 11 4.6"/><path class="k" d="M.8 5.2H7"/></svg>`,
  "ht-ic": "<i></i><i></i><i></i><i></i>",
};

// The header over a tile: what the family is, and its reach.
export function modeHead(k) {
  const t = TILES[k];
  return `<div class="mm-hh ${t.cls}"><span class="${t.ic}">${ICONS[t.ic]}</span><b>${t.head}</b><em>${t.em}</em></div>`;
}

// A tile's state — live: the mode is on; idle: the chart's timeframe has nothing for the mode to draw (daily or
// longer); na: the chart open isn't recorded — the depth modes exist for NIFTY and the heat recorder's options.
const chipOf = ({ live, idle, na }) => (na ? "Not recorded" : idle ? "Intraday only" : live ? "<i></i>On chart" : "Off");
const tipOf = ({ idle, na }) => (na ? "Recorded for NIFTY and the options in the Option Chain's heat recorder (Alt+O)"
  : idle ? "Draws on intraday timeframes (1m – 4H)" : "");

export function modeTile(k, name, st = {}) {
  const t = TILES[k], tip = tipOf(st);
  return `<button class="md-tile hero ${t.cls} ${st.live ? "on" : ""} ${st.ignite ? "ignite" : ""} ${st.idle ? "idle" : ""} ${st.na ? "na" : ""}" data-mode="${k}" style="--mc:${t.mc};--mc2:${t.mc2}"${tip ? ` title="${tip}"` : ""}>
    <span class="md-in">
      <span class="md-viz hv ${t.viz}">${viz(k)}<span class="md-crt"></span>
        <span class="md-chip">${chipOf(st)}</span></span>
      <span class="hv-low">
        <span class="md-body"><span class="md-name">${name}</span><span class="md-tag">${t.tag}</span><span class="md-desc">${t.desc}</span></span>
        <span class="md-foot"><span class="md-sw"><i></i></span></span>
      </span>
      <span class="md-shine"></span><span class="md-flash"></span>
    </span>
  </button>`;
}

// Bring a tile already in the menu to a new state without rebuilding it, so its animations run on. ignite replays
// the switch-on flare.
export function setTileState(el, st) {
  el.classList.toggle("on", !!st.live);
  el.classList.toggle("idle", !!st.idle);
  el.classList.toggle("na", !!st.na);
  if (st.ignite) {
    el.classList.remove("ignite");
    void el.offsetWidth;                  // restart the flare
    el.classList.add("ignite");
  } else if (!st.live) el.classList.remove("ignite");
  const chip = el.querySelector(".md-chip"), html = chipOf(st);
  if (chip.innerHTML !== html) chip.innerHTML = html;
  const tip = tipOf(st);
  if (tip) el.title = tip;
  else el.removeAttribute("title");
}
