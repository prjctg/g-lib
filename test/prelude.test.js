import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../src/index.js';

const close = (a, b, e = 1e-12) => assert.ok(Math.abs(a - b) <= e, `${a} !~ ${b}`);

// Verbatim copies of the legacy implementations in prjctg-ui's g-src.html (G.*),
// so parity is asserted against the thing the modules actually ran on.
const legacyEase = (t, type = 'inOut') => {
  t = Math.max(0, Math.min(1, t));
  if (type === 'in') return t * t;
  if (type === 'out') return t * (2 - t);
  if (type === 'cubic') return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
};
const legacyRng = (s = 1) => () => {
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  return (s >>> 0) / 0x100000000;
};

test('clamp matches G.clamp, including the lo > hi tie', () => {
  const legacy = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  for (const [v, lo, hi] of [[5, 0, 1], [-5, 0, 1], [0.5, 0, 1], [3, 2, 1], [NaN, 0, 1]]) {
    assert.ok(Object.is(g.clamp(v, lo, hi), legacy(v, lo, hi)));
  }
  assert.equal(g.clamp(3, 2, 1), 2);
});

test('lerp / prog / num', () => {
  assert.equal(g.lerp(10, 20, 0.25), 12.5);
  assert.equal(g.prog(5, 0, 10), 0.5);
  assert.equal(g.prog(-1, 0, 10), 0);
  assert.equal(g.prog(99, 0, 10), 1);
  assert.equal(g.prog(4, 5, 5), 0); // zero span is a step at b
  assert.equal(g.prog(5, 5, 5), 1);
  assert.equal(g.num('3', 0), 3);
  assert.equal(g.num('', 7), 7);
  assert.equal(g.num(NaN, 7), 7);
  assert.equal(g.num(null, 7), 7);
  assert.equal(g.num(50, 0, 0, 10), 10);
  assert.equal(g.num('x', 99, 0, 10), 99); // fallback is not clamped
});

test('ease: in/out/inOut/cubic are bit-compatible with G.ease', () => {
  for (const type of ['in', 'out', 'inOut', 'cubic', undefined, 'nonsense']) {
    for (let i = -2; i <= 22; i++) {
      const t = i / 20;
      assert.ok(Object.is(g.ease(t, type), legacyEase(t, type)), `${type} @ ${t}`);
    }
  }
});

test('ease family endpoints and monotonicity', () => {
  for (const type of ['in', 'out', 'inOut', 'cubic', 'smooth', 'smoother', 'expoIn', 'expoOut', 'bounceOut']) {
    close(g.ease(0, type), 0, 1e-3);
    close(g.ease(1, type), 1, 1e-12);
    if (type !== 'bounceOut') {
      let prev = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const v = g.ease(i / 100, type);
        assert.ok(v >= prev - 1e-12, `${type} not monotone at ${i}`);
        prev = v;
      }
    }
  }
  assert.equal(g.easeOutExpo(1), 1);
  assert.equal(g.easeInExpo(0), 0);
  assert.equal(g.smooth(0.5), 0.5);
  assert.equal(g.smoother(0.5), 0.5);
  close(g.easeOutBounce(1), 1);
  assert.ok(g.easeOutBounce(0.5) > 0.5 && g.easeOutBounce(0.5) < 1);
});

test('xorshift32 matches G.randGen stream; mulberry32 is stable and in range', () => {
  for (const seed of [1, 42, 12345, 0xdeadbeef | 0, -7]) {
    const a = g.xorshift32(seed);
    const b = legacyRng(seed);
    for (let i = 0; i < 50; i++) assert.equal(a(), b());
  }
  const m = g.mulberry32(1234);
  const first = [m(), m(), m()];
  const again = g.mulberry32(1234);
  assert.deepEqual([again(), again(), again()], first);
  // Parity with the copy shipped in domino-script@0.1 (verbatim), so replacing
  // it cannot change a seeded layout.
  const dominoRng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  for (const seed of [0, 1, 1234, 0xdeadbeef, -1]) {
    const x = g.mulberry32(seed);
    const y = dominoRng(seed);
    for (let i = 0; i < 50; i++) assert.equal(x(), y());
  }
  for (let i = 0; i < 1000; i++) {
    const v = m();
    assert.ok(v >= 0 && v < 1);
  }
});

test('hash32 is deterministic, order-sensitive and uint32', () => {
  assert.equal(g.hash32(1, 2, 3), g.hash32(1, 2, 3));
  assert.notEqual(g.hash32(1, 2, 3), g.hash32(3, 2, 1));
  assert.notEqual(g.hash32(1), g.hash32(2));
  const h = g.hash32(-5, 1e9);
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  assert.ok(g.hash01(9, 9) >= 0 && g.hash01(9, 9) < 1);
});

test('colour: parseHex, luminance, contrast', () => {
  assert.deepEqual(g.parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(g.parseHex('FF8000'), [255, 128, 0]);
  assert.deepEqual(g.parseHex('#12'), [128, 128, 128]);
  assert.deepEqual(g.parseHex('zzzzzz'), [128, 128, 128]);
  close(g.luminance([255, 255, 255]), 1);
  close(g.luminance([0, 0, 0]), 0);
  close(g.contrast([0, 0, 0], [255, 255, 255]), 21, 1e-9);
  close(g.contrast([255, 255, 255], [0, 0, 0]), 21, 1e-9);
  close(g.contrast([10, 20, 30], [10, 20, 30]), 1);
});

test('lastAtOrBefore, applyCase', () => {
  assert.equal(g.lastAtOrBefore([], 5), -1);
  assert.equal(g.lastAtOrBefore([1, 3, 5], 0), -1);
  assert.equal(g.lastAtOrBefore([1, 3, 5], 3), 1);
  assert.equal(g.lastAtOrBefore([1, 3, 5], 4), 1);
  assert.equal(g.lastAtOrBefore([1, 3, 5], 99), 2);
  assert.equal(g.lastAtOrBefore([{ s: 1 }, { s: 3 }], 2, 's'), 0);
  assert.equal(g.applyCase('aB', 'upper'), 'AB');
  assert.equal(g.applyCase('aB', 'lower'), 'ab');
  assert.equal(g.applyCase('aB', 'keep'), 'aB');
});

test('groupWords', () => {
  const words = g.groupWords([
    { wordId: 1, lineId: 0, s: 0, e: 10, d: 'he' },
    { wordId: 1, lineId: 0, s: 10, e: 30, d: 'llo' },
    { wordId: 2, lineId: 0, s: 40, e: 50, d: 'x', isSP: true },
    { wordId: 2, lineId: 0, s: 50, e: 60, d: 'yo' },
    { wordId: 2, lineId: 1, s: 70, e: 80, d: 'yo' }, // same wordId, new line
  ]);
  assert.equal(words.length, 3);
  assert.equal(words[0].text, 'hello');
  assert.equal(words[0].s, 0);
  assert.equal(words[0].e, 30);
  assert.deepEqual(words.map((w) => w.index), [0, 1, 2]);
  assert.deepEqual(g.groupWords(null), []);
});

test('measure: ratios, 0 ascent vs 0 descent, font option', () => {
  const ctx = (m) => ({ font: '', measureText: () => m });
  assert.deepEqual(g.measure(ctx({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 3 }), 'x', 10), {
    width: 10, ascent: 8, descent: 3,
  });
  // missing -> size * ratio
  assert.deepEqual(g.measure(ctx({ width: 10 }), 'x', 100), { width: 10, ascent: 75, descent: 25 });
  // ascent 0 is a failure; descent 0 is real
  assert.deepEqual(g.measure(ctx({ width: 1, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }), 'x', 100), {
    width: 1, ascent: 75, descent: 0,
  });
  assert.equal(g.measure(ctx({ width: 1 }), 'x', 100, { ascent: 0.72, descent: 0.22 }).ascent, 72);
  const c = ctx({ width: 1 });
  g.measure(c, 'x', 10, { font: '600 10px serif' });
  assert.equal(c.font, '600 10px serif');
});

test('rasterizeGlyph / sampleCoverage over a fake ctx', () => {
  const size = 10;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < 5; x++) data[(y * size + x) * 4 + 3] = 255;
  assert.equal(g.sampleCoverage(data, 1, 5, { size, radius: 1 }), 1);
  assert.equal(g.sampleCoverage(data, 8, 5, { size, radius: 1 }), 0);
  const mid = g.sampleCoverage(data, 4.5, 5, { size, radius: 2 });
  assert.ok(mid > 0 && mid < 1);
  assert.equal(g.sampleCoverage(data, -50, -50, { size }), 0);

  const calls = [];
  const ctx = {
    clearRect: (...a) => calls.push(['clear', ...a]),
    measureText: () => ({ width: 50, actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 0 }),
    fillText: (...a) => calls.push(['fill', ...a]),
    getImageData: () => ({ data }),
    set font(v) { calls.push(['font', v]); },
  };
  assert.equal(g.rasterizeGlyph(ctx, '', 'serif', { size }), null);
  assert.equal(g.rasterizeGlyph(ctx, 'A', 'serif', { size }), data);
  assert.ok(calls.some((c) => c[0] === 'fill' && c[1] === 'A' && c[2] === 5));
});

test('spring: closed form, branches meet, horizon is exact', () => {
  assert.equal(g.springAt(0, 0.5, 20), 0);
  assert.equal(g.springAt(-5, 0.5, 20), 0);
  for (const z of [0.3, 0.9999, 1, 1.0001, 2]) close(g.springAt(5000, z, 20), 1, 1e-6);
  // continuity across the critical-damping branch switch
  close(g.springAt(100, 0.99995, 20), g.springAt(100, 1.00005, 20), 1e-3);
  // underdamped overshoots, overdamped does not
  assert.ok(Math.max(...Array.from({ length: 200 }, (_, i) => g.springAt(i * 10, 0.3, 20))) > 1.2);
  assert.ok(Math.max(...Array.from({ length: 200 }, (_, i) => g.springAt(i * 10, 2, 20))) <= 1);
  const S = g.makeSpring(0.36, 30);
  assert.ok(S.hz > 0);
  assert.equal(g.spr(S.hz, S), 1);
  assert.equal(g.spr(S.hz + 1, S), 1);
  assert.equal(g.spr(-1, S), 0);
  close(g.spr(S.hz - 1, S), 1, 1e-3); // horizon is where it becomes indistinguishable
});

test('fitCanvas: maxPixels lowers dpr but never below 1; css size unchanged', () => {
  globalThis.devicePixelRatio = 3;
  const G = { clientRect: () => ({ width: 1000, height: 500 }) };
  const run = (opts) => {
    const canvas = { width: 0, height: 0 };
    return [g.fitCanvas(G, canvas, opts), canvas];
  };
  let [fit, cv] = run({});
  assert.equal(fit.dpr, 2);
  assert.equal(cv.width, 2000);
  [fit, cv] = run({ maxPixels: 1_000_000 }); // 500k css px -> dpr = sqrt(2)
  close(fit.dpr, Math.SQRT2, 1e-9);
  assert.ok(cv.width * cv.height <= 1_000_000 * 1.01);
  assert.equal(fit.w, 1000);
  [fit] = run({ maxPixels: 10 }); // budget below css size: floor at 1
  assert.equal(fit.dpr, 1);
  [fit] = run({ maxPixels: 100_000_000 });
  assert.equal(fit.dpr, 2);
  delete globalThis.devicePixelRatio;
});
