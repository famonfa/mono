/**
 * The project's agents as the landing's monkey: one vine per agent session, the monkey climbing while
 * it works and hanging still, looking at you, when it's waiting for you. Working subagents are smaller
 * monkeys further down the same vine. One WebGL context draws them all.
 * The monkey is the one from apps/relay/landing/monkey.js, rebuilt so several can share a scene.
 */
import {
  AmbientLight, CatmullRomCurve3, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh,
  MeshStandardMaterial, OrthographicCamera, Quaternion, Scene, Shape, ShapeGeometry, SphereGeometry, TorusGeometry,
  TubeGeometry, Vector3, WebGLRenderer,
} from "three";

const UNIT = 58; // pixels per world unit
const MAX_SUBS = 2;

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

const sphere = new SphereGeometry(1, 24, 18);
const limb = new CylinderGeometry(1, 1, 1, 10, 1);
limb.translate(0, 0.5, 0); // pivot at the base so it can be stretched from a joint to a target

function leafGeometry() {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.12, 0.08, 0.2, 0.28, 0, 0.52);
  s.bezierCurveTo(-0.2, 0.28, -0.12, 0.08, 0, 0);
  return new ShapeGeometry(s, 10);
}
const leafGeo = leafGeometry();

function ball(material, r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new Mesh(sphere, material);
  m.scale.set(r * sx, r * sy, r * sz);
  m.position.set(x, y, z);
  return m;
}

const UP = new Vector3(0, 1, 0);
const tmp = new Vector3();
const q = new Quaternion();
const v = (x, y, z) => new Vector3(x, y, z);

function makeMonkey() {
  const monkey = new Group();
  const body = new Group();
  monkey.add(body);
  body.add(ball(FUR, 0.42, 0, 0, 0, 0.95, 1.15, 0.85));
  body.add(ball(FACE, 0.3, 0.02, -0.05, 0.2, 0.85, 1.05, 0.55));

  const head = new Group();
  head.position.set(0, 0.62, 0.05);
  body.add(head);
  head.add(ball(FUR, 0.4, 0, 0, 0, 1.08, 0.98, 0.98));
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
    head.add(ball(BLACK, 0.014, 0.035 * side, -0.07, 0.43));
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

  const makeLimb = (radius, endRadius) => {
    const arm = new Mesh(limb, FUR);
    const end = ball(FACE, endRadius, 0, 0, 0, 1, 0.9, 0.9);
    const joint = ball(FUR, radius);
    monkey.add(arm, end, joint);
    return { arm, end, joint, radius };
  };
  const arms = [makeLimb(0.075, 0.1), makeLimb(0.075, 0.1)];
  const legs = [makeLimb(0.085, 0.11), makeLimb(0.085, 0.11)];
  const tail = new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(), new Vector3(0, -0.1, 0)]), 8, 0.05), FUR_DARK);
  monkey.add(tail);

  return { monkey, body, head, eyes, arms, legs, tail, blink: Math.random() * 3, look: new Vector3(), seed: Math.random() * 10 };
}

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

function curlTail(m, t, swing) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    const a = -1.2 + k * 3.6 + Math.sin(t * 1.6 - k * 2) * 0.25 + swing * k;
    const r = 0.75 * (1 - k * 0.6);
    pts.push(new Vector3(0.22 + Math.sin(a) * r * k * 1.4, -0.35 - k * 0.9 + Math.cos(a) * r * k * 0.5, -0.2 - k * 0.15));
  }
  m.tail.geometry.dispose();
  m.tail.geometry = new TubeGeometry(new CatmullRomCurve3(pts), 24, 0.045, 6);
}

/**
 * Poses one monkey on its vine. Working: hands alternate down the vine. Waiting: one hand holds on,
 * the other waves now and then, and it looks out at you.
 */
function poseMonkey(m, { x, y, scale, working, t, dt, vineX }) {
  const phase = working ? t * 3.2 + m.seed : m.seed;
  m.monkey.scale.setScalar(scale);
  m.monkey.position.set(x - 0.32 * scale, y, -0.3);
  m.monkey.rotation.z = Math.sin(phase) * (working ? 0.06 : 0.02) + Math.sin(t * 0.8 + m.seed) * 0.03;
  m.body.rotation.y = 0.35 + Math.sin(phase * 0.5) * 0.08;
  m.body.position.y = working ? Math.abs(Math.sin(phase)) * 0.05 : 0;
  m.monkey.updateMatrixWorld();
  const local = (wx, wy) => m.monkey.worldToLocal(v(wx, wy, 0.12));
  const wave = working ? 0 : Math.max(0, Math.sin(t * 0.7 + m.seed)) ** 6;
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    const shoulder = v(0.3 * s, 0.32 + m.body.position.y, 0.05);
    const reach = (working ? 0.95 + 0.28 * Math.sin(phase + i * Math.PI) : 1.05 - i * 0.15) * scale;
    let hand = local(vineX(y + reach), y + reach);
    if (i === 0 && wave > 0.01) hand = hand.lerp(v(-0.95, 1.05 + Math.sin(t * 9) * 0.06, 0.25 + Math.sin(t * 9) * 0.12), wave);
    placeLimb(m.arms[i], shoulder, hand);
    const hip = v(0.2 * s, -0.42 + m.body.position.y, 0);
    const grip = (working ? 0.55 + 0.25 * Math.sin(phase + i * Math.PI + 0.6) : 0.6) * scale;
    const foot = i === 1 ? local(vineX(y - grip), y - grip) : v(-0.25 + Math.sin(t * 2.2 + m.seed) * 0.05, -1.05 + (working ? Math.sin(phase) * 0.12 : 0), 0.1);
    placeLimb(m.legs[i], hip, foot);
  }
  const target = working ? v(-0.15, -0.55, 0) : v(-0.3, 0.05, 0);
  m.look.lerp(target, Math.min(dt * 4, 1));
  m.head.rotation.set(-m.look.y, m.look.x - 0.15, -m.look.x * 0.15 + Math.sin(t * 1.1 + m.seed) * 0.03);
  m.blink -= dt;
  if (m.blink < -0.12) m.blink = 2 + Math.random() * 3;
  for (const eye of m.eyes) eye.scale.y = m.blink < 0 ? 0.15 : 1;
  curlTail(m, t, Math.sin(phase * 0.5) * 0.2);
}

function makeVine(scene) {
  const tube = new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(), new Vector3(0, -1, 0)])), VINE);
  scene.add(tube);
  const leaves = Array.from({ length: 8 }, (_, i) => {
    const leaf = new Mesh(leafGeo, LEAF[i % LEAF.length]);
    leaf.userData = { at: i * 0.9 + Math.random() * 0.3, side: i % 2 ? 1 : -1, size: 0.45 + ((i * 37) % 10) / 25 };
    scene.add(leaf);
    return leaf;
  });
  return { tube, leaves, seed: Math.random() * 10, scroll: 0 };
}

export function createAgentStage(canvas) {
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

  let view = { hw: 1, hh: 1 };
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    view = { hw: w / UNIT / 2, hh: h / UNIT / 2 };
    Object.assign(camera, { left: -view.hw, right: view.hw, top: view.hh, bottom: -view.hh });
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  /** One rig (vine + main monkey + sub monkeys) per agent, kept by id so monkeys don't jump around on updates. */
  const rigs = new Map();
  let agents = [];

  const rigFor = (id) => {
    if (!rigs.has(id)) {
      const main = makeMonkey();
      scene.add(main.monkey);
      rigs.set(id, { vine: makeVine(scene), main, subs: [] });
    }
    return rigs.get(id);
  };

  const removeRig = (rig) => {
    scene.remove(rig.vine.tube, ...rig.vine.leaves, rig.main.monkey, ...rig.subs.map((s) => s.monkey));
    rig.vine.tube.geometry.dispose();
  };

  function drawVine(rig, x, t, dt, working) {
    const { tube, leaves, seed } = rig.vine;
    // Leaves drift up while the agent works, so its monkey reads as climbing down.
    if (working && !still) rig.vine.scroll += dt * 0.6;
    const vineX = (y) => {
      const depth = Math.min(Math.max((view.hh + 1 - y) / (view.hh * 2 + 2), 0), 1);
      return x + Math.sin(t * 0.7 + seed + depth * 2.5) * 0.08 * depth;
    };
    const pts = Array.from({ length: 10 }, (_, i) => {
      const y = view.hh + 1 - (i / 9) * (view.hh * 2 + 2);
      return new Vector3(vineX(y), y, 0);
    });
    tube.geometry.dispose();
    tube.geometry = new TubeGeometry(new CatmullRomCurve3(pts), 40, 0.06, 6);
    const loop = leaves.length * 0.9;
    for (const leaf of leaves) {
      const { at, side, size } = leaf.userData;
      const y = view.hh + 1 - ((((at - rig.vine.scroll) % loop) + loop) % loop);
      leaf.position.set(vineX(y), y, 0.02);
      leaf.scale.setScalar(size * 0.6);
      leaf.rotation.set(0, side * 0.5, side * (1.2 + Math.sin(t * 1.3 + at) * 0.08));
    }
    return vineX;
  }

  let last = performance.now();
  let raf = 0;
  function frame(now) {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    const t = still ? 0 : now / 1000;
    const n = agents.length;
    agents.forEach((agent, i) => {
      const rig = rigFor(agent.id);
      const x = -view.hw + ((i + 0.5) / n) * view.hw * 2 + 0.2;
      const working = agent.status === "working";
      const vineX = drawVine(rig, x, t, dt, working);
      const mainY = view.hh - 1.35;
      poseMonkey(rig.main, { x, y: mainY, scale: 0.8, working, t, dt, vineX });
      const subs = agent.subs.slice(0, MAX_SUBS);
      while (rig.subs.length < subs.length) {
        const m = makeMonkey();
        scene.add(m.monkey);
        rig.subs.push(m);
      }
      while (rig.subs.length > subs.length) scene.remove(rig.subs.pop().monkey);
      subs.forEach((sub, j) => {
        poseMonkey(rig.subs[j], { x: x + (j % 2 ? 0.05 : -0.05), y: mainY - 1.4 - j * 0.85, scale: 0.42, working: sub.status === "working", t: t + j, dt, vineX });
      });
    });
    renderer.render(scene, camera);
    if (!still && n > 0 && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  document.addEventListener("visibilitychange", kick);

  return {
    /** `list`: [{ id, status, subs: [{ status }] }] in the order their cards are laid out. */
    setAgents(list) {
      const ids = new Set(list.map((a) => a.id));
      for (const [id, rig] of rigs) {
        if (!ids.has(id)) {
          removeRig(rig);
          rigs.delete(id);
        }
      }
      agents = list;
      kick();
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", kick);
      for (const rig of rigs.values()) removeRig(rig);
      renderer.dispose();
    },
  };
}
