/**
 * g-lib — Utility library for G animation modules.
 *
 * Import in any animation module:
 *   import { createPool, textLayout, createPhysics, beatPulse }
 *     from 'https://cdn.jsdelivr.net/gh/prjctg/g-lib@1.2.0/index.js';
 */

// ── Object Pool ───────────────────────────────────────────────────────────────

/**
 * createPool(createFn, resetFn?) — reusable object pool.
 *
 * @param {() => any} createFn  Called when no free slot exists; returns a new item.
 * @param {(item) => void} [resetFn]  Called before reusing a released item.
 * @returns {{ get, release, releaseAll, active, wipe }}
 *
 * @example
 * const pool = createPool(
 *   () => G.svg('circle', { r: 20, fill: '#fff' }),
 *   el => el.setAttribute('opacity', '1'),
 * );
 * const el = pool.get();          // borrow
 * pool.release(el);               // return
 * pool.wipe(parentSvgElement);    // release all + detach from DOM
 */
export function createPool(createFn, resetFn) {
  const slots = [];
  return {
    get() {
      const slot = slots.find(s => !s.inUse);
      if (slot) {
        slot.inUse = true;
        resetFn?.(slot.item);
        return slot.item;
      }
      const item = createFn();
      slots.push({ item, inUse: true });
      return item;
    },
    release(item) {
      const slot = slots.find(s => s.item === item);
      if (slot) slot.inUse = false;
    },
    releaseAll() {
      slots.forEach(s => { s.inUse = false; });
    },
    active() {
      return slots.filter(s => s.inUse).map(s => s.item);
    },
    wipe(parent) {
      slots.forEach(({ item }) => {
        if (item && item.parentNode) item.parentNode.removeChild(item);
        else item?.remove?.();
      });
      slots.length = 0;
    },
  };
}

// ── Text Layout ───────────────────────────────────────────────────────────────

/**
 * textLayout(syls, measureFn, opts?) — measure and horizontally center syllables
 * grouped by line.
 *
 * @param {object[]}  syls       Flat SYL event array (from G.map(G.TYPE.SYL, …)).
 * @param {(text: string) => number} measureFn  Returns pixel width for a string.
 * @param {{ lineHeight?: number }} [opts]
 * @returns {Array<Array<{ syl, width, x, lineIndex }>>}  Outer = lines, inner = syls.
 *
 * @example
 * const ctx = G.context2d(1, 1, 1);
 * ctx.font = '24px sans-serif';
 * const layout = textLayout(
 *   G.map(G.TYPE.SYL, { channel: 0 }),
 *   text => ctx.measureText(text).width,
 *   { lineHeight: 40 },
 * );
 * layout.forEach((line, li) =>
 *   line.forEach(({ syl, x }) => place(syl.id, x, li * 40))
 * );
 */
export function textLayout(syls, measureFn, { lineHeight = 1 } = {}) {
  const lineMap = new Map();
  syls.forEach(syl => {
    if (syl.isSP) return;
    if (!lineMap.has(syl.lineId)) lineMap.set(syl.lineId, []);
    lineMap.get(syl.lineId).push(syl);
  });

  const lines = [...lineMap.values()];
  const totalLines = lines.length;

  return lines.map((lineSyls, li) => {
    const widths = lineSyls.map(s => measureFn(s.d || ''));
    const totalWidth = widths.reduce((a, b) => a + b, 0);
    const y = (-0.5 * (totalLines - 1) + li) * lineHeight;
    let x = -totalWidth / 2;
    return lineSyls.map((syl, i) => {
      const cx = x + widths[i] / 2;
      x += widths[i];
      return { syl, width: widths[i], x: cx, y, lineIndex: li };
    });
  });
}

// ── Physics ───────────────────────────────────────────────────────────────────

/**
 * createPhysics(opts?) — particle physics with gravity and velocity decay.
 *
 * @param {{ gravity?: number, friction?: number }} [opts]
 *   gravity: pixels/s² downward acceleration (default 200).
 *   friction: per-frame velocity multiplier in [0,1] (default 0.98).
 * @returns {{ decayIntegral, pos }}
 *
 * @example
 * const phys = createPhysics({ gravity: 300, friction: 0.97 });
 *
 * // Spawn a particle:
 * const p = { x0: cx, y0: cy, vx: (Math.random()-0.5)*200, vy: -150 };
 *
 * // In TICK (t = elapsed seconds since spawn):
 * const { x, y } = phys.pos(p, t);
 * el.setAttribute('transform', `translate(${x} ${y})`);
 */
export function createPhysics({ gravity = 200, friction = 0.98 } = {}) {
  const lnFriction = Math.log(friction);

  /**
   * Integral of friction^t from 0 to t — gives the effective displacement
   * multiplier when velocity decays exponentially.
   */
  const decayIntegral = t => (1 - Math.pow(friction, t)) / -lnFriction;

  return {
    decayIntegral,
    /**
     * pos(particle, t) — compute (x, y) at time t seconds after spawn.
     * particle must have: { x0, y0, vx, vy }
     */
    pos(particle, t) {
      const di = decayIntegral(t);
      return {
        x: particle.x0 + particle.vx * di,
        y: particle.y0 + particle.vy * di + 0.5 * gravity * t * t,
      };
    },
  };
}

// ── Beat Pulse ────────────────────────────────────────────────────────────────

/**
 * beatPulse(G, opts?) — returns a strength value that peaks at 1 on each beat
 * and decays linearly to 0 over `decay` milliseconds.
 *
 * Must be called inside the module's default() function (not inside INIT),
 * because it registers G.on(BEAT) and G.on(SEEK) handlers.
 *
 * @param {object} G      The G API object.
 * @param {{ decay?: number }} [opts]  decay: ms until strength reaches 0 (default 500).
 * @returns {{ get(timeMs: number): number }}
 *
 * @example
 * export default function(G, shadowRoot, config) {
 *   const pulse = beatPulse(G, { decay: 600 });
 *   G.on(G.TYPE.TICK, time => {
 *     const scale = 1 + 0.3 * pulse.get(time);
 *     el.setAttribute('transform', `scale(${scale})`);
 *   });
 * }
 */
export function beatPulse(G, { decay = 500 } = {}) {
  let lastBeatMs = -decay;
  G.on(G.TYPE.BEAT, beat => { lastBeatMs = beat.s; });
  G.on(G.TYPE.SEEK, () => { lastBeatMs = -decay; });
  return {
    get(timeMs) {
      return Math.max(0, 1 - (timeMs - lastBeatMs) / decay);
    },
  };
}

// ── Field Kernels ─────────────────────────────────────────────────────────────
//
// Grid operators for modules that simulate or paint a scalar field on a canvas.
// All of them take a flat typed array in row-major order with an explicit
// `width`/`height`, treat the grid as a TORUS (wrap-around at every edge) unless
// noted, and are DOM-free so they can be unit-tested in node.

/**
 * boxBlur(src, width, height, radius, passes?, scratch?) — separable wrap-around
 * box blur, in place.
 *
 * Three passes of a box approximate a Gaussian closely enough for anything that
 * is about to be thresholded, at a fraction of the cost of a real kernel.
 *
 * @param {Float32Array} src  Modified in place, and returned.
 * @param {number} radius     Half-width of the box, in cells.
 * @param {number} [passes]   Repeats (default 2).
 * @param {Float32Array} [scratch]  Reused intermediate of at least width*height.
 * @returns {Float32Array} `src`.
 */
export function boxBlur(src, width, height, radius, passes = 2, scratch) {
  const n = width * height;
  let a = src;
  let b = scratch && scratch.length >= n ? scratch : new Float32Array(n);
  const w = 2 * radius + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let d = -radius; d <= radius; d++) {
          let xx = x + d;
          if (xx < 0) xx += width;
          else if (xx >= width) xx -= width;
          sum += a[row + xx];
        }
        b[row + x] = sum / w;
      }
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let d = -radius; d <= radius; d++) {
          let yy = y + d;
          if (yy < 0) yy += height;
          else if (yy >= height) yy -= height;
          sum += b[yy * width + x];
        }
        a[y * width + x] = sum / w;
      }
    }
  }
  return a;
}

/**
 * bandPassNoise(width, height, rng, opts?) — noise with energy at ONE wavelength
 * and almost none anywhere else, as a difference of Gaussians.
 *
 * Useful wherever a pattern of a particular scale is wanted immediately: a
 * reaction-diffusion field seeded with it lands on its attractor in a hundred
 * steps instead of a couple of thousand, and any effect that needs "texture of
 * about this size" gets it in one pass.
 *
 * @param {() => number} rng  Seeded generator, e.g. `G.randGen(7)`.
 * @param {{ inner?: number, outer?: number, passes?: number }} [opts]
 *   The two blur radii, in cells; the wavelength sits between them.
 * @returns {Float32Array} Signed values centred on 0 — threshold at 0 for a mask.
 *
 * @example
 * const band = bandPassNoise(gw, gh, G.randGen(7), { inner: 1, outer: 3 });
 * for (let i = 0; i < band.length; i++) mask[i] = band[i] > 0 ? 1 : 0;
 */
export function bandPassNoise(width, height, rng, options = {}) {
  const { inner = 1, outer = 3, passes = 2 } = options;
  const n = width * height;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = rng() - 0.5;
  const b = Float32Array.from(a);
  const scratch = new Float32Array(n);
  boxBlur(a, width, height, inner, passes, scratch);
  boxBlur(b, width, height, outer, passes, scratch);
  for (let i = 0; i < n; i++) a[i] -= b[i];
  return a;
}

/**
 * upsample(coarse, cw, ch, cell, out, width, height) — bilinear expansion of a
 * coarse lattice onto a full grid.
 *
 * The lattice is expected to carry one EXTRA point in each direction beyond what
 * `cell` strictly needs, so the interpolation never runs off its own top-right
 * corner (see `makeModulation`, which sizes it that way).
 *
 * @returns {Float32Array} `out`.
 */
export function upsample(coarse, cw, ch, cell, out, width, height) {
  const inv = 1 / cell;
  for (let y = 0; y < height; y++) {
    const gy = y * inv;
    let gy0 = gy | 0;
    if (gy0 > ch - 2) gy0 = ch - 2;
    const fy = gy - gy0;
    const r0 = gy0 * cw;
    const r1 = r0 + cw;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const gx = x * inv;
      let gx0 = gx | 0;
      if (gx0 > cw - 2) gx0 = cw - 2;
      const fx = gx - gx0;
      const a = coarse[r0 + gx0];
      const b = coarse[r0 + gx0 + 1];
      const c = coarse[r1 + gx0];
      const d = coarse[r1 + gx0 + 1];
      out[row + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return out;
}

/**
 * thinMask(mask, width, height) — Zhang-Suen thinning to a 1-cell-wide,
 * 8-connected medial axis.
 *
 * This is what makes a glyph effect FONT-AGNOSTIC: whatever weight the typeface
 * draws a stem at, and however much a Han glyph's own strokes vary within one
 * character, what survives is a weightless skeleton that can be re-dilated to
 * whatever thickness the effect wants (see `edt`). Border cells count as
 * background, so a mask that runs to the edge of the grid loses its outermost
 * ring.
 *
 * @param {Uint8Array} mask  Non-zero = set. Not modified.
 * @returns {Uint8Array} A new array.
 *
 * @example
 * const skeleton = thinMask(glyphMask, gw, gh);
 * const dist = edt(skeleton, gw, gh);
 * for (let i = 0; i < dist.length; i++) stroke[i] = dist[i] <= radius ? 1 : 0;
 */
export function thinMask(mask, width, height) {
  const out = Uint8Array.from(mask);
  const doomed = [];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (let sub = 0; sub < 2; sub++) {
      doomed.length = 0;
      for (let y = 1; y < height - 1; y++) {
        const row = y * width;
        const up = row - width;
        const dn = row + width;
        for (let x = 1; x < width - 1; x++) {
          const i = row + x;
          if (!out[i]) continue;
          const p2 = out[up + x];
          const p3 = out[up + x + 1];
          const p4 = out[i + 1];
          const p5 = out[dn + x + 1];
          const p6 = out[dn + x];
          const p7 = out[dn + x - 1];
          const p8 = out[i - 1];
          const p9 = out[up + x - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          // A(p): 0->1 transitions around the ring; exactly one means removing this
          // cell cannot disconnect its neighbourhood.
          let a = 0;
          if (!p2 && p3) a++;
          if (!p3 && p4) a++;
          if (!p4 && p5) a++;
          if (!p5 && p6) a++;
          if (!p6 && p7) a++;
          if (!p7 && p8) a++;
          if (!p8 && p9) a++;
          if (!p9 && p2) a++;
          if (a !== 1) continue;
          if (sub === 0) {
            if (p2 * p4 * p6) continue;
            if (p4 * p6 * p8) continue;
          } else {
            if (p2 * p4 * p8) continue;
            if (p2 * p6 * p8) continue;
          }
          doomed.push(i);
        }
      }
      for (let k = 0; k < doomed.length; k++) out[doomed[k]] = 0;
      if (doomed.length) changed = true;
    }
  }
  return out;
}

const EDT_INF = 1e20;

/** Felzenszwalb 1-D squared distance transform of a sampled function. */
function edt1d(f, d, vtx, z, n) {
  let k = 0;
  vtx[0] = 0;
  z[0] = -EDT_INF;
  z[1] = EDT_INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[vtx[k]] + vtx[k] * vtx[k])) / (2 * q - 2 * vtx[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[vtx[k]] + vtx[k] * vtx[k])) / (2 * q - 2 * vtx[k]);
    }
    k++;
    vtx[k] = q;
    z[k] = s;
    z[k + 1] = EDT_INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - vtx[k];
    d[q] = dq * dq + f[vtx[k]];
  }
}

/**
 * edt(seed, width, height) — EXACT Euclidean distance from every cell to the
 * nearest set cell of `seed`, by Felzenszwalb's two-pass algorithm. Linear in
 * the number of cells, and exact rather than the usual chamfer approximation.
 *
 * Thresholding the result is the general way to dilate a mask by a real-valued
 * radius: outlines, glows, clearance rings, and re-inflating a skeleton back to
 * a chosen stroke width.
 *
 * Unlike the blurs above this does NOT wrap — the grid has hard edges.
 *
 * @param {Uint8Array|Int8Array} seed  Non-zero = a source cell (distance 0).
 * @returns {Float32Array} Distances in cells.
 */
export function edt(seed, width, height) {
  const n = width * height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = seed[i] ? 0 : EDT_INF;
  const m = Math.max(width, height);
  const f = new Float32Array(m);
  const d = new Float32Array(m);
  const vtx = new Int32Array(m);
  const z = new Float32Array(m + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = out[y * width + x];
    edt1d(f, d, vtx, z, height);
    for (let y = 0; y < height; y++) out[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = out[row + x];
    edt1d(f, d, vtx, z, width);
    for (let x = 0; x < width; x++) out[row + x] = Math.sqrt(d[x]);
  }
  return out;
}

// ── Motion ────────────────────────────────────────────────────────────────────
//
// A settled field is usually a FIXED POINT: a reaction-diffusion attractor, a
// finished noise texture, a solved layout. Nothing moves again on its own. These
// two are the motions to put on top of it — a flow that drifts the picture, and a
// modulation that makes it change in place — and both are pure functions of a
// playback time in ms, so a seek is deterministic rather than replayed.
//
// Both are low-frequency fields evaluated on a COARSE lattice and bilinearly
// upsampled. Anything that stirs a patterned field has to have a far longer
// wavelength than the pattern does, or it stops reading as that pattern at all;
// evaluating the trigonometry per cell would then cost more than the thing being
// stirred. On a lattice, with a basis separable in x and y, it is a couple of
// hundred `sin` a frame whatever the viewer size.

const MOTION_DEFAULTS = {
  flowScale: 0.9,
  flowPeriodMs: 9000,
  flowOctaves: 3,
  flowCell: 8,
  modScale: 0.55,
  modPeriodMs: 9000,
  modOctaves: 2,
  modCell: 8,
};

/**
 * The harmonic terms shared by both motions. Harmonics are INTEGER multiples of
 * the grid, so the field is periodic on the same torus the kernels above wrap on
 * and nothing shears across the seam. Each term drifts in time at its own rate
 * and direction, which is what turns a static interference pattern into a flow.
 *
 * `falloff` is how fast the octaves fade. It is 1 for a scalar field, where the
 * term IS the amplitude, and 2 for a flow, where the velocity is a derivative and
 * so carries a factor of the harmonic — at falloff 1 every octave would
 * contribute equally to the velocity and the fine ones would shear the transported
 * field apart.
 */
function harmonics(width, height, rng, spec) {
  const base = Math.max(1, Math.round(1 / Math.max(0.05, spec.scale)));
  const w0 = (2 * Math.PI) / Math.max(1, spec.periodMs);
  const terms = [];
  for (let k = 0; k < Math.max(1, Math.round(spec.octaves)); k++) {
    const h = base << k;
    terms.push({
      a: 1 / (1 << (spec.falloff * k)),
      // h and h+1 rather than h and h: equal harmonics make a checkerboard.
      ax: (2 * Math.PI * h) / width,
      ay: (2 * Math.PI * (h + 1)) / height,
      px: rng() * Math.PI * 2,
      py: rng() * Math.PI * 2,
      wx: w0 * (k + 1) * (0.6 + 0.8 * rng()) * (rng() < 0.5 ? -1 : 1),
      wy: w0 * (k + 1) * (0.6 + 0.8 * rng()) * (rng() < 0.5 ? -1 : 1),
      sx: null,
      cx: null,
      sy: null,
      cy: null,
    });
  }
  return terms;
}

/** Lattice size for a grid dimension: one extra point so bilinear never runs off. */
function lattice(size, cell) {
  return Math.max(2, Math.ceil(size / cell) + 1);
}

/**
 * Per-column and per-row sin/cos of every term at time `t`. This is the
 * separability trick: a term is sin(x-part) * sin(y-part), so the lattice costs
 * cw + ch trig calls instead of cw * ch.
 */
function evalTerms(terms, cw, ch, cell, t) {
  for (let k = 0; k < terms.length; k++) {
    const q = terms[k];
    if (!q.sx || q.sx.length !== cw || q.sy.length !== ch) {
      q.sx = new Float32Array(cw);
      q.cx = new Float32Array(cw);
      q.sy = new Float32Array(ch);
      q.cy = new Float32Array(ch);
    }
    const phx = q.wx * t + q.px;
    for (let gx = 0; gx < cw; gx++) {
      const a = q.ax * gx * cell + phx;
      q.sx[gx] = Math.sin(a);
      q.cx[gx] = Math.cos(a);
    }
    const phy = q.wy * t + q.py;
    for (let gy = 0; gy < ch; gy++) {
      const a = q.ay * gy * cell + phy;
      q.sy[gy] = Math.sin(a);
      q.cy[gy] = Math.cos(a);
    }
  }
}

/**
 * makeFlow(width, height, rng, opts?) — a slow, DIVERGENCE-FREE flow.
 *
 * Velocity is the curl of a stream function, so the field it transports is
 * neither compressed nor stretched: the picture drifts and warps as a sheet
 * without its features getting thinner anywhere, which a hand-written velocity
 * field would not guarantee. `sample(t)` refreshes the lattice for playback time
 * `t` in ms and normalises it, so `amount` in `warpPair` is a displacement in
 * CELLS rather than a function of how many octaves happen to line up this frame.
 *
 * @param {() => number} rng  Seeded generator. Give the flow and the modulation
 *   SEPARATE seeds, or the two motions beat against each other and the field
 *   pulses instead of wandering.
 * @param {{ flowScale?, flowPeriodMs?, flowOctaves?, flowCell? }} [opts]
 * @returns {{ cell, cw, ch, vx, vy, sample(t) }}  Pass the whole object to `warpPair`.
 *
 * @example
 * const flow = makeFlow(gw, gh, G.randGen(seed + 101), { flowPeriodMs: 9000 });
 * G.on(G.TYPE.TICK, time => {
 *   flow.sample(time);
 *   warpPair(src, null, dst, null, gw, gh, flow, 4);  // 4 cells of displacement
 * });
 */
export function makeFlow(width, height, rng, options = {}) {
  const o = { ...MOTION_DEFAULTS, ...options };
  const cell = Math.max(2, Math.round(o.flowCell));
  const cw = lattice(width, cell);
  const ch = lattice(height, cell);
  const vx = new Float32Array(cw * ch);
  const vy = new Float32Array(cw * ch);
  const terms = harmonics(width, height, rng, {
    falloff: 2,
    octaves: o.flowOctaves,
    scale: o.flowScale,
    periodMs: o.flowPeriodMs,
  });
  return {
    cell,
    cw,
    ch,
    vx,
    vy,
    sample(t) {
      evalTerms(terms, cw, ch, cell, t);
      let max = 0;
      for (let gy = 0; gy < ch; gy++) {
        const row = gy * cw;
        for (let gx = 0; gx < cw; gx++) {
          let ux = 0;
          let uy = 0;
          for (let k = 0; k < terms.length; k++) {
            const q = terms[k];
            // (d psi / dy, -d psi / dx)
            ux += q.a * q.ay * q.sx[gx] * q.cy[gy];
            uy -= q.a * q.ax * q.cx[gx] * q.sy[gy];
          }
          vx[row + gx] = ux;
          vy[row + gx] = uy;
          const m = ux * ux + uy * uy;
          if (m > max) max = m;
        }
      }
      const s = max > 1e-12 ? 1 / Math.sqrt(max) : 0;
      for (let i = 0; i < vx.length; i++) {
        vx[i] *= s;
        vy[i] *= s;
      }
      return this;
    },
  };
}

/**
 * makeModulation(width, height, rng, opts?) — the other motion: a slowly drifting
 * scalar in [-1, 1] over the whole grid, to be added to whatever parameter the
 * effect is most sensitive to.
 *
 * Where a flow gives MOTION, this gives LIFE: the change happens in place, so it
 * reads as the pattern living rather than as the pattern moving. In a
 * reaction-diffusion field nudging `feed`/`kill` by a thousandth is the
 * difference between a stripe growing and a stripe dying — ends creep, lines
 * pinch off, gaps close over — and the same trick drives a brightness, a density
 * or a hue field.
 *
 * Keep the amplitude small. The budget is not the point at which the effect
 * breaks, it is UNIFORMITY: a modulation deep enough to be obvious is also deep
 * enough that one part of the grid no longer matches another, which the eye finds
 * before it finds the motion.
 *
 * `sample(t)` returns the full-grid array (also available as `.mod`), so a caller
 * that only needs it every few frames can skip the O(cells) expansion.
 *
 * @param {{ modScale?, modPeriodMs?, modOctaves?, modCell? }} [opts]
 * @returns {{ cell, cw, ch, coarse, mod, sample(t) }}
 */
export function makeModulation(width, height, rng, options = {}) {
  const o = { ...MOTION_DEFAULTS, ...options };
  const cell = Math.max(2, Math.round(o.modCell));
  const cw = lattice(width, cell);
  const ch = lattice(height, cell);
  const coarse = new Float32Array(cw * ch);
  const mod = new Float32Array(width * height);
  const terms = harmonics(width, height, rng, {
    falloff: 1,
    octaves: o.modOctaves,
    scale: o.modScale,
    periodMs: o.modPeriodMs,
  });
  let norm = 0;
  for (let k = 0; k < terms.length; k++) norm += terms[k].a;
  const inv = norm > 0 ? 1 / norm : 0;
  return {
    cell,
    cw,
    ch,
    coarse,
    mod,
    sample(t) {
      evalTerms(terms, cw, ch, cell, t);
      for (let gy = 0; gy < ch; gy++) {
        const row = gy * cw;
        for (let gx = 0; gx < cw; gx++) {
          let s = 0;
          for (let k = 0; k < terms.length; k++) {
            const q = terms[k];
            s += q.a * q.sx[gx] * q.sy[gy];
          }
          coarse[row + gx] = s * inv;
        }
      }
      return upsample(coarse, cw, ch, cell, mod, width, height);
    },
  };
}

/**
 * warpPair(u, v, un, vn, width, height, flow, amount) — resample a pair of fields
 * through a flow: every output cell reads the input where the displacement says
 * its contents came from, wrap-around bilinear.
 *
 * Run this on the way to the SCREEN, never on the simulation itself. Advecting a
 * field means resampling it every frame, and bilinear resampling IS numerical
 * diffusion — in a reaction-diffusion system it lands straight in the diffusion
 * coefficients, and since Turing wavelength goes as their square root, even a
 * twentieth of a cell per frame walks the pattern's band width up by half again.
 * Warping the output moves the same picture and changes no number, costs one
 * resample instead of one per simulation step, and — because anything drawn into
 * the field goes through the identical warp — keeps every feature exactly as
 * thick as it was.
 *
 * @param {Float32Array} u   Source field.
 * @param {Float32Array|null} v  Optional second field warped by the same
 *   displacement; pass null to skip it, which is worth doing whenever it is
 *   uniformly zero.
 * @param {Float32Array} un  Destination for `u`.
 * @param {Float32Array|null} vn  Destination for `v`.
 * @param {object} flow      A `makeFlow` result, already `sample`d for this frame.
 * @param {number} amount    Displacement in cells. 0 copies straight through.
 */
export function warpPair(u, v, un, vn, width, height, flow, amount) {
  if (!amount) {
    un.set(u);
    if (v) vn.set(v);
    return;
  }
  const { cell, cw, ch, vx, vy } = flow;
  const inv = 1 / cell;
  // The lattice column each grid column falls in, and how far into it. Constant
  // down the whole grid, so it is worth lifting out of the row loop entirely.
  const col = new Int32Array(width);
  const colF = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const gx = x * inv;
    let gx0 = gx | 0;
    if (gx0 > cw - 2) gx0 = cw - 2;
    col[x] = gx0;
    colF[x] = gx - gx0;
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const gy = y * inv;
    let gy0 = gy | 0;
    if (gy0 > ch - 2) gy0 = ch - 2;
    const fy = gy - gy0;
    const r0 = gy0 * cw;
    const r1 = r0 + cw;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const fx = colF[x];
      const w00 = (1 - fx) * (1 - fy);
      const w01 = fx * (1 - fy);
      const w10 = (1 - fx) * fy;
      const w11 = fx * fy;
      const i0 = r0 + col[x];
      const i1 = r1 + col[x];
      const dx =
        (vx[i0] * w00 + vx[i0 + 1] * w01 + vx[i1] * w10 + vx[i1 + 1] * w11) * amount;
      const dy =
        (vy[i0] * w00 + vy[i0 + 1] * w01 + vy[i1] * w10 + vy[i1 + 1] * w11) * amount;
      let sx = x - dx;
      let sy = y - dy;
      sx -= Math.floor(sx / width) * width;
      sy -= Math.floor(sy / height) * height;
      const x0 = sx | 0;
      const y0 = sy | 0;
      const tx = sx - x0;
      const ty = sy - y0;
      const x1 = x0 + 1 >= width ? 0 : x0 + 1;
      const y1 = y0 + 1 >= height ? 0 : y0 + 1;
      const ra = y0 * width;
      const rb = y1 * width;
      const q00 = ra + x0;
      const q01 = ra + x1;
      const q10 = rb + x0;
      const q11 = rb + x1;
      const p00 = (1 - tx) * (1 - ty);
      const p01 = tx * (1 - ty);
      const p10 = (1 - tx) * ty;
      const p11 = tx * ty;
      un[i] = u[q00] * p00 + u[q01] * p01 + u[q10] * p10 + u[q11] * p11;
      if (v) vn[i] = v[q00] * p00 + v[q01] * p01 + v[q10] * p10 + v[q11] * p11;
    }
  }
}

// ── Canvas & Text Plumbing ────────────────────────────────────────────────────

/**
 * layoutWord(texts, opts) — fit one word's syllables into a box at the LARGEST
 * type that fits, over 1..`maxRows` rows.
 *
 * Row count is chosen by maximising the resulting size, which gets both cases
 * right without a special rule: a short word is height-bound so one row wins, a
 * long one is width-bound so two rows win.
 *
 * The sibling of `textLayout`, and they answer different questions. `textLayout`
 * places syllables of a whole LINE at a size you have already chosen; this one
 * places syllables of a single WORD and chooses the size for you.
 *
 * @param {string[]} texts  One per syllable, in order.
 * @param {object} opts
 *   `gw`,`gh` — the box. `fillW` (0.78), `fillH` (0.5) — fraction of it to use.
 *   `maxRows` (2), `lineGap` (1.16) — line height as a multiple of ascent+descent.
 *   `measure(text, fontSize) -> { width, ascent, descent }` — injected, so the
 *   whole layout is testable without a canvas.
 * @returns {{ fontSize, rows, spans } | null}  `rows[r] = { spans, baselineY }`;
 *   `spans` is flat and sorted by syllable index, so a span's position in it IS
 *   that index. Each span is `{ index, text, x0, x1, y0, y1 }`.
 *
 * @example
 * const measure = (text, size) => {
 *   ctx.font = '600 ' + size + 'px sans-serif';
 *   const m = ctx.measureText(text);
 *   return { width: m.width,
 *            ascent: m.actualBoundingBoxAscent || size * 0.75,
 *            descent: m.actualBoundingBoxDescent || size * 0.25 };
 * };
 * const layout = layoutWord(syls.map(s => s.d), { gw, gh, maxRows: 2, measure });
 * ctx.font = '600 ' + layout.fontSize + 'px sans-serif';
 * layout.rows.forEach(row =>
 *   row.spans.forEach(sp => ctx.fillText(sp.text, sp.x0, row.baselineY)));
 */
export function layoutWord(texts, options) {
  const {
    gw,
    gh,
    fillW = 0.78,
    fillH = 0.5,
    maxRows = 2,
    lineGap = 1.16,
    measure,
  } = options;
  const budgetW = gw * fillW;
  const budgetH = gh * fillH;
  const REF = 100;
  const refW = texts.map(t => measure(t, REF).width);
  const refM = measure(texts.join(''), REF);
  const refLine = (refM.ascent + refM.descent) * lineGap;

  let best = null;
  const rowMax = Math.max(1, Math.min(maxRows, texts.length));
  for (let rows = 1; rows <= rowMax; rows++) {
    const split = splitRows(refW, rows);
    const widest = rowWidest(split, refW);
    if (widest <= 0) continue;
    const size = Math.min((budgetW / widest) * REF, (budgetH / (refLine * rows)) * REF);
    if (!best || size > best.size) best = { size, split, rows };
  }
  if (!best) return null;

  // Metrics are not linear in font size, so re-measure at the chosen size and take
  // one corrective pass if the real advances overflow the width budget.
  let size = Math.max(6, best.size);
  let widths = texts.map(t => measure(t, size).width);
  let widest = rowWidest(best.split, widths);
  if (widest > budgetW && widest > 0) {
    size = Math.max(6, (size * budgetW) / widest);
    widths = texts.map(t => measure(t, size).width);
    widest = rowWidest(best.split, widths);
  }

  const m = measure(texts.join(''), size);
  const line = (m.ascent + m.descent) * lineGap;
  const blockH = line * best.rows;
  const top = gh / 2 - blockH / 2;
  const rows = best.split.map((run, r) => {
    let sum = 0;
    for (const i of run) sum += widths[i];
    let x = gw / 2 - sum / 2;
    const baselineY = top + line * r + line / lineGap - m.descent;
    const y0 = baselineY - m.ascent;
    const y1 = baselineY + m.descent;
    const spans = run.map(i => {
      const span = { index: i, text: texts[i], x0: x, x1: x + widths[i], y0, y1 };
      x += widths[i];
      return span;
    });
    return { spans, baselineY };
  });
  const spans = rows.flatMap(r => r.spans).sort((a, b) => a.index - b.index);
  return { fontSize: size, rows, spans };
}

function rowWidest(split, widths) {
  let widest = 0;
  for (const run of split) {
    let sum = 0;
    for (const i of run) sum += widths[i];
    if (sum > widest) widest = sum;
  }
  return widest;
}

/** Contiguous split into `rows` runs, minimising the widest run. */
function splitRows(widths, rows) {
  const n = widths.length;
  if (rows <= 1) return [range(0, n)];
  if (rows >= n) return widths.map((_, i) => [i]);
  // Only 1 and 2 rows are ever asked for in practice; a linear scan over the single
  // cut point is exact for 2 and a good greedy for more.
  let bestCut = 1;
  let bestScore = Infinity;
  const total = widths.reduce((a, b) => a + b, 0);
  let left = 0;
  for (let cut = 1; cut < n; cut++) {
    left += widths[cut - 1];
    const score = Math.max(left, total - left);
    if (score < bestScore) {
      bestScore = score;
      bestCut = cut;
    }
  }
  const head = [range(0, bestCut)];
  const tail = splitRows(widths.slice(bestCut), rows - 1).map(run =>
    run.map(i => i + bestCut),
  );
  return head.concat(tail);
}

function range(a, b) {
  const out = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/**
 * fitCanvas(G, canvas, opts?) — size a canvas's backing store to its container
 * and the device pixel ratio.
 *
 * The boilerplate every canvas module opens with, in one call. `dpr` is capped
 * (default 2) because past that the extra pixels cost real frame time and buy
 * nothing the eye can find.
 *
 * @param {HTMLCanvasElement} canvas  Its `width`/`height` are set when they change,
 *   which also CLEARS it — so treat a `changed` result as "rebuild and repaint".
 * @param {{ maxDpr?: number, minSize?: number, maxPixels?: number }} [opts]
 *   `minSize` (1) — return null below this, for a container not laid out yet.
 *   `maxPixels` (Infinity) — backing-store pixel budget (`bw * bh`). When the
 *   dpr-scaled store would exceed it, `dpr` is lowered (never below 1) until it
 *   fits; the CSS size `w`/`h` is unchanged, so layout maths stays in CSS pixels.
 * @returns {{ w, h, dpr, changed } | null}  `w`/`h` are CSS pixels.
 *
 * @example
 * function ensureSized() {
 *   const fit = fitCanvas(G, canvas, { minSize: 8 });
 *   if (!fit) return false;          // container has no size yet
 *   if (built && !fit.changed) return true;
 *   rebuild(fit.w, fit.h, fit.dpr);
 *   return true;
 * }
 * G.on(G.TYPE.RESIZE, () => { if (ensureSized()) render(); });
 */
export function fitCanvas(G, canvas, { maxDpr = 2, minSize = 1, maxPixels = Infinity } = {}) {
  const rect = G.clientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (w < minSize || h < minSize) return null;
  let dpr = Math.min(
    maxDpr,
    (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1,
  );
  if (w * h * dpr * dpr > maxPixels) {
    dpr = Math.max(1, Math.sqrt(maxPixels / (w * h)));
  }
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  const changed = canvas.width !== bw || canvas.height !== bh;
  if (changed) {
    canvas.width = bw;
    canvas.height = bh;
  }
  return { w, h, dpr, changed };
}

/**
 * toRgba(ctx, color, fallback) — resolve any CSS colour string to `[r, g, b, a]`,
 * with a byte a in 0..1, by painting one pixel and reading it back.
 *
 * The fallback is assigned to `fillStyle` FIRST on purpose: assigning an invalid
 * colour to `fillStyle` is a no-op, so a custom property that resolved to nothing
 * leaves the fallback in place rather than painting whatever was there before.
 *
 * @param {CanvasRenderingContext2D} ctx  A 1x1 scratch context, ideally created
 *   with `{ willReadFrequently: true }`.
 */
export function toRgba(ctx, color, fallback) {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = fallback;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
}

/**
 * cssColors(el, spec, probeCtx) — read a module's palette from RESOLVED CSS custom
 * properties, so a canvas module follows the light/dark theme the way an SVG one
 * does.
 *
 * Colours belong in CSS rather than in `config` because a theme flip fires no
 * event and changes no config: the properties simply resolve to something else.
 * So this polls — cheaply, and only re-resolving to RGB when the strings actually
 * differ. Call `read()` every second or so, not every frame.
 *
 * @param {Element} el  The element the properties are resolved against.
 * @param {Object<string, string>} spec  Property name → fallback colour, e.g.
 *   `{ '--field-ink': '#141414' }`. Keys may omit the leading `--`.
 * @param {CanvasRenderingContext2D} probeCtx  1x1 scratch context (see `toRgba`).
 * @returns {{ rgb: Object<string, number[]>, read(): boolean }}  `rgb` is keyed by
 *   the same names and MUTATED IN PLACE by `read()`, which returns whether
 *   anything changed — so a renderer can hold a reference to it and never re-read.
 *
 * @example
 * const probe = G.context2d(1, 1, 1, { willReadFrequently: true });
 * const palette = cssColors(canvas, {
 *   '--field-bg':  '#f2efe6',
 *   '--field-ink': '#141414',
 * }, probe);
 * palette.read();
 * // ...in TICK, every 30th frame:
 * if (++ticks >= 30) { ticks = 0; palette.read(); }
 * const [r, g, b] = palette.rgb['--field-ink'];
 */
export function cssColors(el, spec, probeCtx) {
  const keys = Object.keys(spec);
  const props = keys.map(k => (k.startsWith('--') ? k : '--' + k));
  // Allocated once and written THROUGH on every read, never replaced — that is
  // what lets a renderer hoist `palette.rgb['--ink']` out of its frame loop and
  // still follow a theme flip.
  const rgb = {};
  keys.forEach(k => {
    rgb[k] = [0, 0, 0, 1];
  });
  let last = null;
  const read = () => {
    const cs = getComputedStyle(el);
    const raw = props.map(
      (p, i) => (cs.getPropertyValue(p) || '').trim() || spec[keys[i]],
    );
    const key = raw.join('|');
    if (key === last) return false;
    last = key;
    keys.forEach((k, i) => {
      const c = toRgba(probeCtx, raw[i], spec[k]);
      const slot = rgb[k];
      slot[0] = c[0];
      slot[1] = c[1];
      slot[2] = c[2];
      slot[3] = c[3];
    });
    return true;
  };
  return { rgb, read };
}

// ── Math prelude ──────────────────────────────────────────────────────────────
// Pure, DOM-free, and importable at module scope — so unit tests in node can use
// them, which `G` (only alive inside the default function) cannot offer.

/**
 * num(v, d, lo?, hi?) — a finite number from `v`, else the fallback `d`.
 * Accepts numeric strings (config values arrive stringly); an empty string is
 * not a number. With `lo`/`hi` the result is clamped — the fallback `d` is
 * returned as-is, unclamped.
 */
export function num(v, d, lo = -Infinity, hi = Infinity) {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? Math.min(Math.max(x, lo), hi) : d;
}

/**
 * clamp(v, lo, hi) — bit-compatible with the legacy `G.clamp`. When `lo > hi`
 * the result is `lo` (the max is applied last), not an exception.
 */
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** lerp(a, b, t) — unclamped linear interpolation. */
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * prog(t, a, b) — 0..1 progress of `t` through [a, b]. A zero or negative span
 * is a step: 0 before `b`, 1 from `b` on.
 */
export const prog = (t, a, b) => (b > a ? clamp((t - a) / (b - a), 0, 1) : t >= b ? 1 : 0);

/** smooth(t) — cubic smoothstep, input clamped to 0..1. */
export const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

/** smoother(t) — quintic smootherstep (zero 1st and 2nd derivative at both ends). */
export const smoother = (t) => {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** easeOutExpo(t) — fast start, long tail. Exactly 0 at 0 and 1 at 1. */
export const easeOutExpo = (t) => {
  t = clamp(t, 0, 1);
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
};

/** easeInExpo(t) — long wind-up, fast finish. Exactly 0 at 0 and 1 at 1. */
export const easeInExpo = (t) => {
  t = clamp(t, 0, 1);
  return t <= 0 ? 0 : Math.pow(2, 10 * t - 10);
};

/** easeOutBounce(t) — the classic four-segment bounce, landing exactly on 1. */
export const easeOutBounce = (t) => {
  t = clamp(t, 0, 1);
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

/**
 * ease(t, type = 'inOut') — one entry point for the ease family.
 *
 * `'in' | 'out' | 'inOut' | 'cubic'` are bit-compatible with the legacy
 * `G.ease` (so `'inOut'` is the QUAD in-out and `'cubic'` the cubic in-out).
 * Added: `'smooth'`, `'smoother'`, `'expoIn'`, `'expoOut'`, `'bounceOut'`.
 * An unknown type falls back to `'inOut'`, as `G.ease` does.
 */
export function ease(t, type = 'inOut') {
  t = clamp(t, 0, 1);
  switch (type) {
    case 'in': return t * t;
    case 'out': return t * (2 - t);
    case 'cubic': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'smooth': return smooth(t);
    case 'smoother': return smoother(t);
    case 'expoIn': return easeInExpo(t);
    case 'expoOut': return easeOutExpo(t);
    case 'bounceOut': return easeOutBounce(t);
    default: return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
}

// ── Random & hashing ──────────────────────────────────────────────────────────

/**
 * mulberry32(seed) — seeded PRNG returning floats in [0, 1). Identical to the
 * eight hand-rolled copies it replaces, so a seed gives the same stream.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * xorshift32(seed = 1) — the pure twin of the legacy `G.randGen`: the same
 * stream for the same seed. Note a seed of 0 is a fixed point (always 0); pass
 * a non-zero seed, as `G.randGen` callers must.
 */
export function xorshift32(seed = 1) {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

/**
 * hash32(...ints) — mixes any number of integers into one well-distributed
 * uint32. Pure function of its arguments, so a seek replays identically.
 *
 * NOTE: the modules' local hashes use several different constants; this is the
 * `mercury-type` form. It is NOT value-compatible with the others — migrate a
 * module only if its output may change, or keep its local hash.
 */
export function hash32(...xs) {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** hash01(...ints) — `hash32` scaled into [0, 1). */
export const hash01 = (...xs) => hash32(...xs) / 4294967296;

// ── Colour ────────────────────────────────────────────────────────────────────

/**
 * parseHex(h) — `#rgb` / `#rrggbb` (the `#` optional; anything past 6 digits is
 * ignored) to `[r, g, b]` bytes. Anything unparseable is mid-grey `[128,128,128]`.
 */
export function parseHex(h) {
  let s = String(h).trim().replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s.slice(0, 6), 16);
  if (!Number.isFinite(n) || s.length < 6) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** luminance([r, g, b]) — WCAG relative luminance, 0..1, from 0..255 channels. */
export function luminance(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** contrast(a, b) — WCAG contrast ratio of two `[r, g, b]` colours, 1..21. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ── Time & text ───────────────────────────────────────────────────────────────

/**
 * lastAtOrBefore(arr, t, key?) — index of the LAST element whose value (or
 * `element[key]`) is `<= t` in an array sorted ascending; -1 if none. Binary
 * search, so it is the right way to ask "which word is on screen at `t`" after
 * a seek.
 */
export function lastAtOrBefore(arr, t, key) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = key ? arr[mid][key] : arr[mid];
    if (v <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** applyCase(text, mode) — `'upper'` / `'lower'`; any other mode leaves text as is. */
export function applyCase(text, mode) {
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'lower') return text.toLowerCase();
  return text;
}

/**
 * groupWords(syls) — fold a flat syllable list into words. A word is a run of
 * syllables sharing `wordId` AND `lineId`; spacer syllables (`isSP`) are
 * skipped. Each word is `{ wordId, lineId, s, e, text, syls, index }`, where
 * `s`/`e` span its syllables and `text` is their `d` concatenated.
 */
export function groupWords(syls) {
  const out = [];
  let cur = null;
  (syls || []).forEach((syl) => {
    if (!syl || syl.isSP) return;
    if (!cur || cur.wordId !== syl.wordId || cur.lineId !== syl.lineId) {
      cur = { wordId: syl.wordId, lineId: syl.lineId, s: syl.s, e: syl.e, text: '', syls: [], index: out.length };
      out.push(cur);
    }
    cur.syls.push(syl);
    cur.text += syl.d || '';
    if (syl.s < cur.s) cur.s = syl.s;
    if (syl.e > cur.e) cur.e = syl.e;
  });
  return out;
}

/**
 * measure(ctx, text, size, opts?) — canvas text metrics with sane fallbacks:
 * `{ width, ascent, descent }` in the same px as `size`.
 *
 * Canonical choice among the ~10 copies that existed. They differed in (a) the
 * fallback ratios (0.70–0.76 ascent, 0.20–0.25 descent), (b) whether a reported
 * 0 counts as missing (`||`) or only NaN/undefined does, and (c) whether the
 * font was set inside. Decisions:
 *  - `ascent` falls back when missing, non-finite OR 0 — a 0 ascent is a metrics
 *    failure for any non-empty text, and 0 collapses a layout box;
 *  - `descent` falls back only when missing/non-finite/negative — 0 is a real
 *    answer for text without descenders ("ox");
 *  - defaults 0.75 / 0.25 (the median), overridable per call.
 * Set `opts.font` to have it assigned to `ctx.font` first; omit it when the
 * caller has already set the font.
 *
 * @param {{ font?: string, ascent?: number, descent?: number }} [opts]
 */
export function measure(ctx, text, size, { font, ascent = 0.75, descent = 0.25 } = {}) {
  if (font) ctx.font = font;
  const m = ctx.measureText(text);
  const a = m.actualBoundingBoxAscent;
  const d = m.actualBoundingBoxDescent;
  return {
    width: m.width,
    ascent: Number.isFinite(a) && a > 0 ? a : size * ascent,
    descent: Number.isFinite(d) && d >= 0 ? d : size * descent,
  };
}

/**
 * rasterizeGlyph(ctx, text, fontFamily, opts?) — draw `text` centred and
 * scaled to fill a square coverage canvas, and return its RGBA bytes (or `null`
 * for empty text). `ctx` must be a `size × size` 2D context (use
 * `G.context2d(size, size, 1, { willReadFrequently: true })`).
 *
 * @param {{ size?: number, padding?: number, weight?: number|string }} [opts]
 *   `size` (100) — canvas edge; `padding` (0.82) — the glyph occupies at most
 *   this fraction of the edge; `weight` (700).
 */
export function rasterizeGlyph(ctx, text, fontFamily, { size = 100, padding = 0.82, weight = 700 } = {}) {
  ctx.clearRect(0, 0, size, size);
  if (!text) return null;
  const REF = 100;
  ctx.font = `${weight} ${REF}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let m = ctx.measureText(text);
  const refW = m.width;
  const refH = (m.actualBoundingBoxAscent || REF * 0.7) + (m.actualBoundingBoxDescent || REF * 0.2);
  const maxDim = size * padding;
  const scale = Math.min(maxDim / Math.max(refW, 1), maxDim / Math.max(refH, 1));
  const fontSize = Math.max(4, REF * scale);
  ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
  m = ctx.measureText(text);
  const asc = m.actualBoundingBoxAscent || fontSize * 0.7;
  const desc = m.actualBoundingBoxDescent || fontSize * 0.2;
  ctx.fillStyle = '#fff';
  ctx.fillText(text, size / 2, size / 2 + (asc - desc) / 2);
  return ctx.getImageData(0, 0, size, size).data;
}

/**
 * sampleCoverage(data, cx, cy, opts?) — fraction (0..1) of a small disc around
 * (cx, cy) that lies inside the glyph drawn by `rasterizeGlyph`.
 *
 * @param {{ size?: number, radius?: number, steps?: number, alpha?: number }} [opts]
 *   `size` (100) must match the raster; `radius` (2.6) is the disc radius in
 *   raster px; `steps` (5) the sub-grid resolution; `alpha` (96) the 0..255
 *   alpha above which a pixel counts as inside.
 */
export function sampleCoverage(data, cx, cy, { size = 100, radius = 2.6, steps = 5, alpha = 96 } = {}) {
  let hit = 0;
  let total = 0;
  const step = (2 * radius) / steps;
  for (let oy = -radius; oy <= radius; oy += step) {
    for (let ox = -radius; ox <= radius; ox += step) {
      if (ox * ox + oy * oy > radius * radius) continue;
      const px = Math.round(cx + ox);
      const py = Math.round(cy + oy);
      if (px < 0 || px >= size || py < 0 || py >= size) continue;
      total++;
      if (data[(py * size + px) * 4 + 3] > alpha) hit++;
    }
  }
  return total ? hit / total : 0;
}

// ── Spring ────────────────────────────────────────────────────────────────────

/**
 * springAt(ms, zeta, wn) — step response of a damped spring, 0 at the trigger
 * heading to 1 (damping ratio `zeta`, natural frequency `wn` rad/s). A closed
 * form of three branches (under/critical/over-damped), so it is a pure function
 * of time and a seek is exact. `ms <= 0` is 0.
 */
export function springAt(ms, zeta, wn) {
  if (!(ms > 0)) return 0;
  const t = ms / 1000;
  if (Math.abs(zeta - 1) < 1e-4) return 1 - Math.exp(-wn * t) * (1 + wn * t);
  if (zeta < 1) {
    const a = zeta * wn;
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t));
  }
  const q = wn * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * wn + q;
  const r2 = -zeta * wn - q;
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/**
 * makeSpring(zeta, wn, eps = 2e-4) — a preset `{ z, wn, hz }` with an exact
 * horizon `hz` (ms) past which `spr` returns exactly 1, where the closed-form
 * envelope falls below `eps`.
 */
export function makeSpring(zeta, wn, eps = 2e-4) {
  const a = Math.min(zeta, 1) * wn;
  const k = zeta < 1 ? 1 / Math.sqrt(1 - zeta * zeta) : 1 + wn;
  return { z: zeta, wn, hz: (Math.log(k / eps) / a) * 1000 };
}

/** spr(ms, preset) — `springAt` for a `makeSpring` preset, exactly 1 past its horizon. */
export const spr = (ms, S) => (!(ms > 0) ? 0 : ms >= S.hz ? 1 : springAt(ms, S.z, S.wn));
