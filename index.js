/**
 * g-lib — Utility library for G animation modules.
 *
 * Import in any animation module:
 *   import { createPool, textLayout, createPhysics, beatPulse }
 *     from 'https://cdn.jsdelivr.net/gh/prjctg/g-lib@1/index.js';
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
