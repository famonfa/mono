/**
 * The landing's mascot: a monkey that climbs down a vine as the page scrolls.
 * Built from primitives (no model files). Bundled to public/monkey.js with `npm run build:landing -w @mono/relay`.
 */
import {
  AmbientLight, CatmullRomCurve3, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh,
  MeshStandardMaterial, OrthographicCamera, Quaternion, Scene, Shape, ShapeGeometry, SphereGeometry, TorusGeometry,
  TubeGeometry, Vector3, WebGLRenderer,
} from "three";

const canvas = document.getElementById("monkey");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new Scene();
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
camera.position.set(0, 0, 10);

scene.add(new HemisphereLight(0xfff4e0, 0x1a2e05, 1.1));
scene.add(new AmbientLight(0xffffff, 0.25));
const key = new DirectionalLight(0xffffff, 2.2);
key.position.set(-3, 4, 6);
scene.add(key);
const rim = new DirectionalLight(0x84cc16, 2.4);
rim.position.set(4, 1, -4);
scene.add(rim);

const mat = (color, roughness = 0.75) => new MeshStandardMaterial({ color: new Color(color), roughness });
const FUR = mat("#8b5a2b");
const FUR_DARK = mat("#6b4220");
const FACE = mat("#f0c9a0", 0.6);
const EAR_IN = mat("#d99b72");
const BLACK = mat("#120c08", 0.3);
const WHITE = mat("#ffffff", 0.2);
const VINE = mat("#4d7c0f", 0.85);
const LEAF = [mat("#65a30d", 0.6), mat("#84cc16", 0.55), mat("#4d7c0f", 0.65)];
for (const leaf of LEAF) leaf.side = DoubleSide;

const sphere = new SphereGeometry(1, 32, 24);
const limb = new CylinderGeometry(1, 1, 1, 12, 1);
limb.translate(0, 0.5, 0); // pivot at the base so it can be stretched from a joint to a target

function ball(material, r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new Mesh(sphere, material);
  m.scale.set(r * sx, r * sy, r * sz);
  m.position.set(x, y, z);
  return m;
}

// ── Monkey ────────────────────────────────────────────────────────────────────
const monkey = new Group();
scene.add(monkey);

const body = new Group();
monkey.add(body);
body.add(ball(FUR, 0.42, 0, 0, 0, 0.95, 1.15, 0.85));
body.add(ball(FACE, 0.3, 0.02, -0.05, 0.2, 0.85, 1.05, 0.55)); // belly

const head = new Group();
head.position.set(0, 0.62, 0.05);
body.add(head);
head.add(ball(FUR, 0.4, 0, 0, 0, 1.08, 0.98, 0.98));
// Face: two eye patches merging into a wide muzzle, like the app icon.
head.add(ball(FACE, 0.15, -0.12, 0.06, 0.28, 1, 1.15, 0.6));
head.add(ball(FACE, 0.15, 0.12, 0.06, 0.28, 1, 1.15, 0.6));
head.add(ball(FACE, 0.24, 0, -0.13, 0.27, 1.1, 0.72, 0.65));
const eyes = [];
for (const side of [-1, 1]) {
  const eye = new Group();
  eye.position.set(0.12 * side, 0.07, 0.37);
  eye.add(ball(BLACK, 0.055));
  eye.add(ball(WHITE, 0.016, 0.018, 0.022, 0.045));
  head.add(eye);
  eyes.push(eye);
  head.add(ball(BLACK, 0.014, 0.035 * side, -0.07, 0.43)); // nostrils
  const ear = new Group();
  ear.position.set(0.41 * side, 0.03, -0.02);
  ear.add(ball(FUR, 0.15, 0, 0, 0, 1, 1, 0.5));
  ear.add(ball(EAR_IN, 0.1, 0.02 * side, 0, 0.05, 1, 1, 0.35));
  head.add(ear);
}
const mouth = new Mesh(new TorusGeometry(0.075, 0.012, 8, 24, Math.PI * 0.8), BLACK);
mouth.rotation.z = Math.PI * 1.1;
mouth.position.set(0, -0.15, 0.405);
head.add(mouth);

/** A limb drawn as a stretched cylinder from `from` to `to`, with a ball at the end (hand or foot). */
function makeLimb(radius, endRadius, endMaterial) {
  const arm = new Mesh(limb, FUR);
  const end = ball(endMaterial, endRadius, 0, 0, 0, 1, 0.9, 0.9);
  const joint = ball(FUR, radius);
  monkey.add(arm, end, joint);
  return { arm, end, joint, radius };
}
const arms = [makeLimb(0.075, 0.1, FACE), makeLimb(0.075, 0.1, FACE)];
const legs = [makeLimb(0.085, 0.11, FACE), makeLimb(0.085, 0.11, FACE)];

const UP = new Vector3(0, 1, 0);
const tmp = new Vector3();
const q = new Quaternion();
function placeLimb(l, from, to) {
  tmp.subVectors(to, from);
  const length = Math.max(tmp.length(), 0.01);
  q.setFromUnitVectors(UP, tmp.normalize());
  l.arm.position.copy(from);
  l.arm.quaternion.copy(q);
  l.arm.scale.set(l.radius, length, l.radius);
  l.joint.position.copy(from);
  l.end.position.copy(to);
}

// Tail: a tube whose curl is rebuilt as it swings.
const tail = new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(), new Vector3(0, -0.1, 0)]), 8, 0.05), FUR_DARK);
monkey.add(tail);
function curlTail(t, swing) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    const a = -1.2 + k * 3.6 + Math.sin(t * 1.6 - k * 2) * 0.25 + swing * k;
    const r = 0.75 * (1 - k * 0.6);
    pts.push(new Vector3(0.22 + Math.sin(a) * r * k * 1.4, -0.35 - k * 0.9 + Math.cos(a) * r * k * 0.5, -0.2 - k * 0.15));
  }
  tail.geometry.dispose();
  tail.geometry = new TubeGeometry(new CatmullRomCurve3(pts), 40, 0.045, 8);
}

// ── Vine ──────────────────────────────────────────────────────────────────────
const vine = new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(), new Vector3(0, -1, 0)])), VINE);
scene.add(vine);

function leafGeometry() {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.12, 0.08, 0.2, 0.28, 0, 0.52);
  s.bezierCurveTo(-0.2, 0.28, -0.12, 0.08, 0, 0);
  return new ShapeGeometry(s, 10);
}
const leafGeo = leafGeometry();
const leaves = Array.from({ length: 26 }, (_, i) => {
  const leaf = new Mesh(leafGeo, LEAF[i % LEAF.length]);
  leaf.userData = { at: i * 1.17, side: i % 2 ? 1 : -1, size: 0.55 + ((i * 37) % 10) / 20 };
  scene.add(leaf);
  return leaf;
});

// ── Layout and state ──────────────────────────────────────────────────────────
let view = { w: 1, h: 1, unit: 60, top: 1, bottom: -1, x: 0 };
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  const unit = innerWidth < 1180 ? 100 : 62; // pixels per world unit: a smaller monkey on narrow screens
  const hw = w / unit / 2;
  const hh = h / unit / 2;
  Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh });
  camera.updateProjectionMatrix();
  view = { w, h, unit, top: hh, bottom: -hh, x: hw * 0.25 };
}
resize();
addEventListener("resize", resize);

const progress = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  return max > 0 ? Math.min(Math.max(scrollY / max, 0), 1) : 0;
};

const state = { y: null, vel: 0, sway: 0, swayVel: 0, climb: 0, lastScroll: scrollY, idle: 0, look: new Vector3(), blink: 0, wave: 0 };
const pointer = { x: 0, y: 0 };
addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
});

/** The vine's x at height y: hangs from above the viewport and bends with the sway, more toward the bottom. */
function vineX(y, t) {
  const depth = Math.min(Math.max((view.top + 1 - y) / (view.top - view.bottom + 2), 0), 1);
  return view.x + state.sway * depth * depth * 1.6 + Math.sin(t * 0.7 + depth * 2.5) * 0.05 * depth;
}

const pts = Array.from({ length: 14 }, () => new Vector3());
function drawVine(t, scrolled) {
  const span = view.top - view.bottom + 2;
  for (let i = 0; i < pts.length; i++) {
    const y = view.top + 1 - (i / (pts.length - 1)) * span;
    pts[i].set(vineX(y, t), y, 0);
  }
  vine.geometry.dispose();
  vine.geometry = new TubeGeometry(new CatmullRomCurve3(pts), 90, 0.06, 8);
  // Leaves drift up a little as you scroll down, so the descent reads as movement.
  for (const leaf of leaves) {
    const { at, side, size } = leaf.userData;
    const loop = leaves.length * 1.17;
    const y = view.top + 1 - ((((at - scrolled * 0.004) % loop) + loop) % loop);
    leaf.position.set(vineX(y, t), y, 0.02);
    leaf.scale.setScalar(size * 0.6);
    leaf.rotation.set(0, side * 0.5, side * (1.2 + Math.sin(t * 1.3 + at) * 0.08));
  }
}

const v = (x, y, z) => new Vector3(x, y, z);
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  const t = now / 1000;

  // Where the monkey should hang: from just under the nav at the top to near the bottom at the end of the page.
  const p = progress();
  const target = view.top - 1.9 - p * (view.top - view.bottom - 3.4);
  if (state.y === null) state.y = target;
  const prevY = state.y;
  state.y += (target - state.y) * (still ? 1 : 1 - Math.exp(-dt * 6));
  const moved = state.y - prevY;
  state.climb += Math.abs(moved) * 3.2;

  // Scrolling kicks the vine sideways; a spring brings it back.
  const scrollDelta = scrollY - state.lastScroll;
  state.lastScroll = scrollY;
  state.idle = Math.abs(scrollDelta) > 0.5 ? 0 : state.idle + dt;
  if (!still) {
    state.swayVel += Math.max(Math.min(scrollDelta * 0.0025, 0.08), -0.08);
    state.swayVel += (-state.sway * 14 - state.swayVel * 3.2) * dt;
    state.sway += state.swayVel * dt * 4;
  }

  const y = state.y;
  const x = vineX(y, t);
  const phase = state.climb;
  const moving = Math.min(Math.abs(moved) / dt / 2.5, 1);

  // Body hangs left of the vine, tilting with the sway.
  monkey.position.set(x - 0.32, y, -0.3);
  monkey.rotation.z = -state.sway * 0.35 + Math.sin(phase) * 0.06;
  body.rotation.y = 0.35 + Math.sin(phase * 0.5) * 0.08;
  body.position.y = Math.abs(Math.sin(phase)) * 0.05;

  // Hands alternate up the vine as it climbs down; at the end of the page the outer hand lets go to wave.
  state.wave += ((p > 0.985 ? 1 : 0) - state.wave) * Math.min(dt * 4, 1);
  monkey.updateMatrixWorld();
  const local = (wx, wy) => monkey.worldToLocal(v(wx, wy, 0.12));
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    const shoulder = v(0.3 * s, 0.32 + body.position.y, 0.05);
    const reach = 0.95 + 0.28 * Math.sin(phase + i * Math.PI);
    let hand = local(vineX(y + reach, t), y + reach);
    if (i === 0 && state.wave > 0.01) {
      const waveHand = v(-0.95, 1.05 + Math.sin(t * 9) * 0.06, 0.25 + Math.sin(t * 9) * 0.12);
      hand = hand.lerp(waveHand, state.wave);
    }
    placeLimb(arms[i], shoulder, hand);
    const hip = v(0.2 * s, -0.42 + body.position.y, 0);
    const grip = 0.55 + 0.25 * Math.sin(phase + i * Math.PI + 0.6);
    const foot = i === 1 ? local(vineX(y - grip, t), y - grip) : v(-0.25 + Math.sin(t * 2.2) * 0.05 * (1 - moving), -1.05 + Math.sin(phase) * 0.12, 0.1);
    placeLimb(legs[i], hip, foot);
  }

  // Looks down while climbing, at your pointer when you stop, at you when it waves.
  const lookPointer = v(pointer.x * 0.6 - 0.25, pointer.y * 0.35, 0);
  const lookDown = v(-0.15, -0.55, 0);
  state.look.lerp(state.wave > 0.5 ? v(-0.3, 0.05, 0) : state.idle > 0.6 ? lookPointer : lookDown, Math.min(dt * 5, 1));
  head.rotation.set(-state.look.y, state.look.x - 0.15, -state.look.x * 0.15 + Math.sin(t * 1.1) * 0.03);

  // Blink every few seconds.
  state.blink -= dt;
  if (state.blink < -0.12) state.blink = 2 + Math.random() * 3;
  const lid = state.blink < 0 ? 0.15 : 1;
  for (const eye of eyes) eye.scale.y = lid;

  curlTail(t, state.sway * 2 + Math.sin(phase * 0.5) * 0.2);
  drawVine(t, scrollY);
  renderer.render(scene, camera);
  if (!still || moved !== 0) requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
if (still) addEventListener("scroll", () => requestAnimationFrame(frame), { passive: true });
canvas.classList.add("ready");
