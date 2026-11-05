# g-lib

Utility library for G animation modules. Published via jsDelivr CDN from this repo.

## Usage

```js
import { createPool, textLayout, createPhysics, beatPulse }
  from 'https://cdn.jsdelivr.net/gh/prjctg/g-lib@1/index.js';
```

Pin to an exact tag (`@1.2.0`) — never import from `@main`, and not a floating `@1`/`@1.2` either (a helper added later may be missing from the copy you resolve).

> **Testing a module that imports this.** Node's ESM loader rejects `https:`
> specifiers, so an anim module's unit test cannot import its shipped JS as-is.
> prjctg-ui rewrites the specifier to an installed copy — see `anims/gLibShim.js`
> there, and the note in `docs/anim-module-authoring.md`.

---

## API

### `createPool(createFn, resetFn?)`

Reusable object pool — avoids repeated DOM allocation for particle-heavy animations.

```js
const pool = createPool(
  () => G.svg('circle', { r: 20, fill: '#fff' }),  // called when no free slot
  el => el.setAttribute('opacity', '1'),            // called before reuse
);

const el = pool.get();        // borrow (creates or reuses)
pool.release(el);             // return to pool
pool.releaseAll();            // release everything (no DOM removal)
pool.active();                // → array of currently borrowed items
pool.wipe(parentEl);          // release all + detach from DOM
```

---

### `textLayout(syls, measureFn, opts?)`

Measures and horizontally centers syllables grouped by composite LINE id, **at a
size you have already chosen**. For a single word at the largest size that fits a
box, see [`layoutWord`](#layoutwordtexts-opts).

```js
const ctx = G.context2d(1, 1, 1);
ctx.font = '24px sans-serif';

const layout = textLayout(
  G.map(G.TYPE.SYL, { channel: 0 }),
  text => ctx.measureText(text).width,
  { lineHeight: 40 },
);

// layout: Array<Array<{ syl, width, x, y, lineIndex }>>
layout.forEach(line =>
  line.forEach(({ syl, x, y }) => place(syl.id, x, y))
);
```

Options: `lineHeight` (default `1`) — vertical distance between lines.

---

### `createPhysics(opts?)`

Particle physics with exponential velocity decay (friction) + gravity.

```js
const phys = createPhysics({ gravity: 200, friction: 0.98 });

// Spawn: particle needs { x0, y0, vx, vy }
const p = { x0: cx, y0: cy, vx: (Math.random() - 0.5) * 200, vy: -150 };
const spawnMs = syl.s;

// In TICK:
const t = (time - spawnMs) / 1000; // seconds
const { x, y } = phys.pos(p, t);
el.setAttribute('transform', `translate(${x} ${y})`);
```

Also exposes `phys.decayIntegral(t)` for manual calculations.

---

### `beatPulse(G, opts?)`

Strength signal that peaks at `1` on each beat and decays to `0` over `decay` ms.
**Must be called inside `default()`** (not inside `TYPE.INIT`).

```js
export default function(G, shadowRoot, config) {
  const pulse = beatPulse(G, { decay: 600 });

  G.on(G.TYPE.TICK, time => {
    const s = 1 + 0.3 * pulse.get(time);
    logo.setAttribute('transform', `scale(${s})`);
  });
}
```

---

## Field Kernels

Grid operators for modules that simulate or paint a scalar field on a canvas. All
take a flat typed array in row-major order with an explicit `width`/`height`, and
treat the grid as a **torus** (wrap-around at every edge) except `edt`.

### `boxBlur(src, width, height, radius, passes?, scratch?)`

Separable wrap-around box blur, **in place** (`src` is modified and returned).
Three passes approximate a Gaussian closely enough for anything about to be
thresholded, far more cheaply than a real kernel.

### `bandPassNoise(width, height, rng, opts?)`

Noise with energy at *one* wavelength and almost none anywhere else, as a
difference of Gaussians. Returns signed values centred on 0 — threshold at 0 for a
mask.

```js
const band = bandPassNoise(gw, gh, G.randGen(7), { inner: 1, outer: 3 });
for (let i = 0; i < band.length; i++) mask[i] = band[i] > 0 ? 1 : 0;
```

Options: `inner` (1), `outer` (3) — the two blur radii in cells; the wavelength
sits between them. `passes` (2).

### `upsample(coarse, cw, ch, cell, out, width, height)`

Bilinear expansion of a coarse lattice onto a full grid. The lattice needs one
extra point in each direction beyond what `cell` strictly requires, so the
interpolation never runs off its top-right corner.

### `thinMask(mask, width, height)`

Zhang–Suen thinning to a 1-cell-wide, 8-connected medial axis. This is what makes
a glyph effect **font-agnostic**: whatever weight the typeface draws a stem at, and
however much a Han glyph's strokes vary within one character, what survives is a
weightless skeleton you can re-dilate to any thickness. Border cells count as
background. Returns a new `Uint8Array`.

### `edt(seed, width, height)`

**Exact** Euclidean distance from every cell to the nearest set cell of `seed`, by
Felzenszwalb's two-pass algorithm — linear in the cell count, and exact rather than
the usual chamfer approximation. Unlike the blurs, this does *not* wrap.

Thresholding the result is the general way to dilate a mask by a real-valued
radius: outlines, glows, clearance rings, and re-inflating a skeleton to a chosen
stroke width.

```js
const skeleton = thinMask(glyphMask, gw, gh);
const dist = edt(skeleton, gw, gh);
for (let i = 0; i < dist.length; i++) stroke[i] = dist[i] <= radius ? 1 : 0;
```

---

## Motion

A settled field is usually a **fixed point** — a reaction-diffusion attractor, a
finished noise texture, a solved layout — and nothing moves again on its own.
These are the two motions to put on top of it. Both are pure functions of a
playback time in ms, so a seek is deterministic rather than replayed.

Give them **separate seeds**, or the two beat against each other and the field
pulses instead of wandering.

### `makeFlow(width, height, rng, opts?)`

A slow, **divergence-free** flow. Velocity is the curl of a stream function, so
what it transports is neither compressed nor stretched: the picture drifts and
warps as a sheet without its features thinning anywhere, which a hand-written
velocity field would not guarantee.

`sample(t)` refreshes and normalises the lattice for playback time `t`, so
`amount` in `warpPair` is a displacement in **cells**.

```js
const flow = makeFlow(gw, gh, G.randGen(seed + 101), { flowPeriodMs: 9000 });
G.on(G.TYPE.TICK, time => {
  flow.sample(time);
  warpPair(src, null, dst, null, gw, gh, flow, 4);  // 4 cells of displacement
});
```

Options: `flowScale` (0.9), `flowPeriodMs` (9000), `flowOctaves` (3),
`flowCell` (8 — the lattice spacing).

### `makeModulation(width, height, rng, opts?)`

A slowly drifting scalar in `[-1, 1]` over the whole grid, to add to whatever
parameter the effect is most sensitive to. Where a flow gives **motion**, this
gives **life**: the change happens in place, so it reads as the pattern living
rather than moving.

Keep the amplitude small. The budget is not the point at which the effect breaks,
it is **uniformity** — a modulation deep enough to be obvious is also deep enough
that one part of the grid stops matching another, which the eye finds before it
finds the motion.

`sample(t)` returns the full-grid array (also on `.mod`), so a caller that only
needs it every few frames can skip the `O(cells)` expansion.

Options: `modScale` (0.55), `modPeriodMs` (9000), `modOctaves` (2), `modCell` (8).

### `warpPair(u, v, un, vn, width, height, flow, amount)`

Resample a pair of fields through a flow: every output cell reads the input where
the displacement says its contents came from, wrap-around bilinear. `v`/`vn` are
optional — pass `null` to skip a second field, worth doing whenever it is
uniformly zero.

> **Run this on the way to the screen, never on the simulation itself.** Advecting
> a field means resampling it every frame, and bilinear resampling *is* numerical
> diffusion — in a reaction-diffusion system it lands straight in the diffusion
> coefficients, and since Turing wavelength goes as their square root, even a
> twentieth of a cell per frame walks the pattern's band width up by half again.
> Warping the output moves the same picture and changes no number, costs one
> resample instead of one per step, and — because anything drawn into the field
> goes through the identical warp — keeps every feature exactly as thick as it was.

---

## Canvas & Text

### `layoutWord(texts, opts)`

Fit one word's syllables into a box at the **largest type that fits**, over
1..`maxRows` rows. Row count is chosen by maximising the resulting size, which gets
both cases right without a special rule: a short word is height-bound so one row
wins, a long one is width-bound so two rows win.

The sibling of [`textLayout`](#textlayoutsyls-measurefn-opts), answering a
different question — that one places a whole LINE at a size you chose, this places
a single WORD and chooses the size for you.

```js
const measure = (text, size) => {
  ctx.font = '600 ' + size + 'px sans-serif';
  const m = ctx.measureText(text);
  return { width: m.width,
           ascent:  m.actualBoundingBoxAscent  || size * 0.75,
           descent: m.actualBoundingBoxDescent || size * 0.25 };
};

const layout = layoutWord(syls.map(s => s.d), { gw, gh, maxRows: 2, measure });
ctx.font = '600 ' + layout.fontSize + 'px sans-serif';
layout.rows.forEach(row =>
  row.spans.forEach(sp => ctx.fillText(sp.text, sp.x0, row.baselineY)));
```

Options: `gw`/`gh` (the box), `fillW` (0.78) / `fillH` (0.5) — fraction of it to
use, `maxRows` (2), `lineGap` (1.16), and `measure` — injected, so the whole layout
is testable without a canvas.

Returns `{ fontSize, rows, spans }` or `null`. `spans` is flat and sorted by
syllable index, so a span's position in it **is** that index.

### `fitCanvas(G, canvas, opts?)`

The sizing boilerplate every canvas module opens with, in one call. Returns
`{ w, h, dpr, changed }` (CSS pixels) — or `null` when the container has no size
yet, which is how a module skips a frame before layout.

Setting a canvas's `width`/`height` **clears** it, so treat `changed` as "rebuild
and repaint". `dpr` is capped (`maxDpr`, default 2) because past that the extra
pixels cost real frame time and buy nothing the eye can find.

```js
function ensureSized() {
  const fit = fitCanvas(G, canvas, { minSize: 8 });
  if (!fit) return false;               // container has no size yet
  if (built && !fit.changed) return true;
  rebuild(fit.w, fit.h, fit.dpr);
  return true;
}
G.on(G.TYPE.RESIZE, () => { if (ensureSized()) render(); });
```

### `cssColors(el, spec, probeCtx)`

Read a module's palette from **resolved CSS custom properties**, so a canvas module
follows the light/dark theme the way an SVG one does.

Colours belong in CSS rather than in `config` because a theme flip fires no event
and changes no config — the properties simply resolve to something else. So this
polls, cheaply, re-resolving to RGB only when the strings actually differ. Call
`read()` about once a second, not every frame.

```js
const probe = G.context2d(1, 1, 1, { willReadFrequently: true });
const palette = cssColors(canvas, {
  '--field-bg':  '#f2efe6',
  '--field-ink': '#141414',
}, probe);
palette.read();

G.on(G.TYPE.TICK, () => {
  if (++ticks >= 30) { ticks = 0; palette.read(); }
  const [r, g, b] = palette.rgb['--field-ink'];
});
```

`spec` maps property name → fallback colour (a leading `--` is optional). Returns
`{ rgb, read() }`; `rgb` is keyed by the same names and **mutated in place**, so a
renderer can hold one reference and never re-read it. `read()` returns whether
anything changed. Each entry is `[r, g, b, a]` with `a` in 0..1.

### `toRgba(ctx, color, fallback)`

Resolve any CSS colour string to `[r, g, b, a]` by painting one pixel of a 1×1
scratch context and reading it back. What `cssColors` is built on.

The fallback is assigned to `fillStyle` *first* on purpose: assigning an invalid
colour is a no-op, so a property that resolved to nothing leaves the fallback in
place rather than painting whatever was there before.

---

### `fitCanvas` pixel budget (1.2.0)

`fitCanvas(G, canvas, { maxPixels })` lowers `dpr` (never below 1) until
`bw * bh <= maxPixels`. `w`/`h` stay CSS pixels, so layout maths is unaffected.
`maxPixels` defaults to `Infinity`, so 1.1.0 callers are unchanged.

## Math prelude (1.2.0)

Pure and DOM-free, so they work at module scope and in node unit tests, which the
runtime-only `G` cannot (`G` exists only inside a module's default function).
The legacy `G.clamp/lerp/ease/randGen` are frozen; these are their successors and
are **bit-compatible** where noted (tests assert it).

| Export | Notes |
| --- | --- |
| `num(v, d, lo?, hi?)` | finite number (numeric strings accepted) else `d`; optional clamp |
| `clamp(v, lo, hi)` | identical to `G.clamp`; `lo > hi` returns `lo` |
| `lerp(a, b, t)` | unclamped |
| `prog(t, a, b)` | 0..1 progress through `[a, b]`; zero span is a step at `b` |
| `smooth(t)`, `smoother(t)` | cubic / quintic smoothstep, input clamped |
| `easeOutExpo`, `easeInExpo`, `easeOutBounce` | exact 0 and 1 at the ends |
| `ease(t, type = 'inOut')` | `in`/`out`/`inOut`/`cubic` identical to `G.ease`; adds `smooth`, `smoother`, `expoIn`, `expoOut`, `bounceOut` |
| `mulberry32(seed)` | same stream as the 8 hand-rolled copies |
| `xorshift32(seed = 1)` | same stream as `G.randGen`; seed 0 is a fixed point |
| `hash32(...ints)`, `hash01(...ints)` | uint32 / [0,1). **Not** value-compatible with modules' other local hashes — see below |

> **`hash32` caveat.** The modules carry at least four different hash constants.
> `hash32` is the `mercury-type` form. A module whose output is seeded by its own
> hash will change look if swapped, so migrate only where that is acceptable.

## Colour & time (1.2.0)

- `parseHex(h)` — `#rgb`/`#rrggbb` to `[r,g,b]`; unparseable gives `[128,128,128]`.
- `luminance([r,g,b])`, `contrast(a, b)` — WCAG relative luminance and contrast ratio (1..21).
- `lastAtOrBefore(arr, t, key?)` — binary search, last index with value `<= t`, else `-1`.
- `applyCase(text, 'upper' | 'lower')` — anything else returns the text unchanged.
- `groupWords(syls)` — words as `{ wordId, lineId, s, e, text, syls, index }`; skips `isSP`.
- `springAt(ms, zeta, wn)`, `makeSpring(zeta, wn, eps?)`, `spr(ms, preset)` — closed-form damped spring; `spr` is exactly `1` past the preset's horizon `hz`, so it ends cleanly and a seek is exact.

## Text metrics (1.2.0)

### `measure(ctx, text, size, opts?)`

Returns `{ width, ascent, descent }` from a 2D context. `opts`: `font` (assigned to
`ctx.font` first; omit if already set), `ascent` / `descent` (fallback ratios of
`size`, default `0.75` / `0.25`).

About ten local copies existed and they differed in three ways. The canonical choice:

1. **Fallback ratios** were 0.70–0.76 (ascent) and 0.20–0.25 (descent) → median
   `0.75` / `0.25`, overridable. A module that needs its old numbers passes them.
2. **Missing vs zero.** Most copies used `||`, so a real `0` descent (`"ox"`, no
   descenders) was replaced by a fallback and the box grew. Ascent `0` is a
   metrics failure for any non-empty text, so it falls back; descent `0` is a real
   answer, so it does not. Only non-finite or negative descent falls back.
3. **Who sets the font.** Optional via `opts.font`.

Not folded in (different contracts, keep local): `einstein-ring` (normalised by
100 and memoised), `manga-panel-*` (adds halo and ink overhang), `mograph-voxel` /
`truchet-type` (cell-grid ink bounds), and `G.measureText`-based wrappers.

### `rasterizeGlyph(ctx, text, fontFamily, opts?)` / `sampleCoverage(data, cx, cy, opts?)`

`rasterizeGlyph` fits `text` to a square `size × size` context (default 100,
`padding` 0.82, `weight` 700) and returns the RGBA bytes, or `null` for empty
text. `sampleCoverage` averages a disc of `radius` (2.6) around a point: `steps`
(5), `alpha` threshold (96), `size` must match. Defaults reproduce
`circle-wipe`/`halftone-triangles`/`honeycomb-wipe`; `ripple-rings` uses
`padding: 0.8, radius: 2.4`.

## three.js & face-api setup (1.3.0)

g-lib never imports three.js: pass in the `THREE` namespace the module imported (version chosen from prjctg-ui's `anims/cdnPins.json`).

### `createThreeStage(THREE, G, opts?)`
Renderer + camera + scene sized to `G.clientRect()`, pixel ratio clamped to `maxDpr` (default 2). Options: `canvas`, `alpha` (true), `antialias` (true), `maxDpr`, `fov` (55), `near`, `far`, `renderer` (extra `WebGLRenderer` params). Returns `{ renderer, camera, scene, resize, render, dispose }`; `resize()` returns `{ w, h, dpr }` or `null` while the container has no size. `dispose()` frees every geometry/material/texture in the scene, the renderer and the GL context, and detaches a canvas it created. Wire it to `G.TYPE.UNINIT`.

### `disposeObject3D(root)`
Frees geometries, materials and the textures they hold. Idempotent; accepts `null`.

### `loadFaceApi({ base?, nets? })` / `tinyFaceOptions(faceapi, inputSize?, scoreThreshold?)` / `FACE_API_BASE`
Dynamic-imports `@vladmandic/face-api` (pinned in `FACE_API_BASE`), loads the tiny detector and tiny 68-point landmark nets once per page and returns `faceapi`. A failed load is evicted so the next call retries. Keep your own try/catch and fallback.

## Versioning

Tag releases as `v1.0.0`, `v1.1.0`, etc. jsDelivr serves the latest within a major via `@1`.

Run `npm test` (node's built-in runner, no extra dependency) and `npm run build` after editing `src/index.js` — `index.js` is the generated,
minified bundle jsDelivr actually serves, and is never hand-edited.
