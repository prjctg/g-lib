# g-lib

Utility library for G animation modules. Published via jsDelivr CDN from this repo.

## Usage

```js
import { createPool, textLayout, createPhysics, beatPulse }
  from 'https://cdn.jsdelivr.net/gh/prjctg/g-lib@1/index.js';
```

Pin to a specific tag (`@1`, `@1.0.0`) — never import from `@main`.

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

Measures and horizontally centers syllables grouped by composite LINE id.

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

## Versioning

Tag releases as `v1.0.0`, `v1.1.0`, etc. jsDelivr serves the latest within a major via `@1`.
