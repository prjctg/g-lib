import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThreeStage, disposeObject3D, loadFaceApi, tinyFaceOptions, FACE_API_BASE } from '../src/index.js';

const tex = () => ({ isTexture: true, disposed: 0, dispose() { this.disposed++; } });
const res = () => ({ disposed: 0, dispose() { this.disposed++; } });
const mesh = (geometry, material) => ({ geometry, material });
const tree = (...kids) => ({ traverse(fn) { kids.forEach(fn); } });

function fakeTHREE() {
  const log = { renderers: [] };
  class WebGLRenderer {
    constructor(p) {
      this.params = p;
      this.domElement = p.canvas || { parentNode: null };
      this.pr = null; this.size = null; this.lost = 0; this.disposed = 0; this.drawn = 0;
      log.renderers.push(this);
    }
    setPixelRatio(v) { this.pr = v; }
    setSize(w, h, s) { this.size = [w, h, s]; }
    render() { this.drawn++; }
    dispose() { this.disposed++; }
    forceContextLoss() { this.lost++; }
  }
  class Scene { traverse(fn) { (this.kids || []).forEach(fn); } }
  class PerspectiveCamera {
    constructor(fov, aspect, near, far) { Object.assign(this, { fov, aspect, near, far, updated: 0 }); }
    updateProjectionMatrix() { this.updated++; }
  }
  return { WebGLRenderer, Scene, PerspectiveCamera, log };
}

const makeG = (w = 800, h = 400) => {
  const children = [];
  const root = {
    appendChild(el) { el.parentNode = root; children.push(el); },
    removeChild(el) { el.parentNode = null; children.splice(children.indexOf(el), 1); },
  };
  return { root, children, rect: { width: w, height: h }, clientRect() { return this.rect; } };
};

test('disposeObject3D frees geometry, materials and their textures once', () => {
  const g = res(), m = res(), t = tex();
  m.map = t;
  const sm = res(); sm.uniforms = { u: { value: tex() } };
  disposeObject3D(tree(mesh(g, m), mesh(res(), [m, sm])));
  assert.equal(g.disposed, 1);
  assert.equal(t.disposed, 1);
  assert.equal(sm.uniforms.u.value.disposed, 1);
  assert.equal(sm.disposed, 1);
  disposeObject3D(null); // no throw
});

test('createThreeStage sizes, clamps dpr, and disposes everything once', () => {
  const THREE = fakeTHREE();
  const G = makeG(801.4, 400);
  globalThis.devicePixelRatio = 3;
  const s = createThreeStage(THREE, G, { fov: 60, maxDpr: 2 });
  assert.equal(G.children.length, 1);
  assert.equal(s.renderer.pr, 2);
  assert.deepEqual(s.renderer.size, [801, 400, false]);
  assert.equal(s.camera.fov, 60);
  assert.ok(Math.abs(s.camera.aspect - 801 / 400) < 1e-9);

  G.rect = { width: 0, height: 0 };
  assert.equal(s.resize(), null);

  const m = res();
  s.scene.kids = [mesh(res(), m)];
  s.render();
  assert.equal(s.renderer.drawn, 1);
  s.dispose(); s.dispose();
  assert.equal(m.disposed, 1);
  assert.equal(s.renderer.disposed, 1);
  assert.equal(s.renderer.lost, 1);
  assert.equal(G.children.length, 0);
  delete globalThis.devicePixelRatio;
});

test('createThreeStage with a supplied canvas leaves it attached', () => {
  const THREE = fakeTHREE();
  const G = makeG();
  const canvas = { parentNode: 'host' };
  const s = createThreeStage(THREE, G, { canvas, alpha: false });
  assert.equal(s.renderer.params.alpha, false);
  assert.equal(G.children.length, 0);
  s.dispose();
  assert.equal(canvas.parentNode, 'host');
});

test('loadFaceApi shares one load per base and retries after failure', async () => {
  let imports = 0;
  const loaded = [];
  const net = (n) => ({ loadFromUri: async (u) => { loaded.push([n, u]); } });
  const faceapi = { nets: { tinyFaceDetector: net('d'), faceLandmark68TinyNet: net('l') },
    TinyFaceDetectorOptions: class { constructor(o) { this.o = o; } } };
  const importer = async (url) => { imports++; assert.equal(url, 'https://x/y/dist/face-api.esm.js'); return faceapi; };
  const [a, b] = await Promise.all([loadFaceApi({ base: 'https://x/y', importer }), loadFaceApi({ base: 'https://x/y', importer })]);
  assert.equal(a, faceapi); assert.equal(b, faceapi);
  assert.equal(imports, 1);
  assert.deepEqual(loaded.map((l) => l[1]), ['https://x/y/model', 'https://x/y/model']);
  assert.deepEqual(tinyFaceOptions(faceapi, 160).o, { inputSize: 160 });
  assert.deepEqual(tinyFaceOptions(faceapi, 160, 0.4).o, { inputSize: 160, scoreThreshold: 0.4 });

  let n = 0;
  const flaky = async () => { if (n++ === 0) throw new Error('net'); return faceapi; };
  await assert.rejects(loadFaceApi({ base: 'https://flaky', importer: flaky }));
  assert.equal(await loadFaceApi({ base: 'https://flaky', importer: flaky }), faceapi);
  assert.ok(FACE_API_BASE.includes('face-api@1.7.15'));
});
