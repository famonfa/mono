/** npm package people install on their Mac. */
const PACKAGE = process.env.MONO_PACKAGE ?? "@famonfa/mono";

/** Copies the install command from the hero (and any other [data-copy] block). */
const COPY_SCRIPT = `<script>
for (const block of document.querySelectorAll("[data-copy]")) {
  block.addEventListener("click", async () => {
    await navigator.clipboard.writeText(block.dataset.copy);
    block.classList.add("copied");
    setTimeout(() => block.classList.remove("copied"), 1500);
  });
}
</script>`;

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const FEATURES = [
  ["Boards that write themselves", "With the /workspace skill, agents document each task as a story map, before/after flow, test plan and technical map. Drag to edit."],
  ["Live sessions", "Every Claude Code session on your Mac in one place: what it's doing, what it touched, what finished while you were away."],
  ["From your phone", "Resume a session, approve a permission or send the next prompt from any browser or the mobile app."],
  ["Your code stays on your Mac", "Agents run on your machine with your Claude Code and your repos. The relay only passes messages."],
];

/** Public front door of the relay: what Mono is, how to get in, how to install it. */
export function landingPage({ relay }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0b0b0d" />
<title>Mono · Your Claude Code agents, at a glance</title>
<meta name="description" content="Mono turns your Claude Code agents' work into boards you can read at a glance. Runs on your Mac, works from your phone." />
<meta property="og:title" content="Mono · Your Claude Code agents, at a glance" />
<meta property="og:image" content="${escape(relay)}/_mono/static/app-board.jpg" />
<link rel="icon" href="/_mono/static/icon.png" />
<style>
  :root { --bg: #0b0b0d; --panel: #141417; --border: rgb(255 255 255 / 0.08); --text: #ededef; --muted: #9b9ba3; --accent: #84cc16; --accent-2: #65a30d; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  .wrap { width: min(1120px, 100% - 40px); margin: 0 auto; }

  nav { position: sticky; top: 0; z-index: 10; backdrop-filter: blur(14px); background: rgb(11 11 13 / 0.72); border-bottom: 1px solid var(--border); }
  nav .wrap { display: flex; align-items: center; gap: 12px; height: 60px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 650; text-decoration: none; }
  .brand img { width: 26px; height: 26px; }
  nav .spacer { flex: 1; }
  nav a.link { color: var(--muted); text-decoration: none; font-size: 14px; }
  nav a.link:hover { color: var(--text); }

  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: 44px; padding: 0 20px; border-radius: 11px; font-weight: 600; font-size: 15px; text-decoration: none; border: 1px solid var(--border); transition: transform 0.15s ease, background 0.15s ease; }
  .btn:hover { transform: translateY(-1px); }
  .btn.primary { background: var(--text); color: var(--bg); border-color: transparent; }
  .btn.ghost { background: rgb(255 255 255 / 0.04); }
  .btn.small { height: 36px; padding: 0 14px; font-size: 14px; border-radius: 9px; }

  header.hero { position: relative; padding: 96px 0 40px; text-align: center; overflow: hidden; }
  header.hero::before { content: ""; position: absolute; inset: -40% 10% auto; height: 620px; background: radial-gradient(closest-side, rgb(132 204 22 / 0.18), transparent); pointer-events: none; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); font-size: 13px; background: rgb(255 255 255 / 0.03); }
  .eyebrow i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px var(--accent); }
  h1 { position: relative; margin: 22px auto 18px; max-width: 820px; font-size: clamp(40px, 7vw, 76px); line-height: 1.02; letter-spacing: -0.035em; font-weight: 700; }
  h1 span { background: linear-gradient(120deg, #d9f99d, var(--accent) 45%, #4d7c0f); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .lead { position: relative; margin: 0 auto 32px; max-width: 620px; color: var(--muted); font-size: clamp(17px, 2.2vw, 19px); }
  .ctas { position: relative; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }

  .shot { position: relative; margin: 64px auto 0; max-width: 1080px; }
  .shot .desktop { display: block; width: 100%; height: auto; border-radius: 14px; border: 1px solid var(--border); box-shadow: 0 40px 120px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.02); }
  .shot .phone { position: absolute; right: -14px; bottom: -40px; width: 22%; height: auto; min-width: 150px; border-radius: 28px; border: 6px solid #1c1c20; box-shadow: 0 30px 80px rgb(0 0 0 / 0.7); }

  section { padding: 110px 0 0; }
  h2 { font-size: clamp(28px, 4vw, 40px); letter-spacing: -0.025em; line-height: 1.1; margin: 0 0 14px; }
  .sub { color: var(--muted); max-width: 560px; margin: 0 0 40px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .card { padding: 26px; border-radius: 16px; background: var(--panel); border: 1px solid var(--border); }
  .card h3 { margin: 0 0 8px; font-size: 18px; letter-spacing: -0.01em; }
  .card p { margin: 0; color: var(--muted); font-size: 15px; }

  .steps { counter-reset: step; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .step { position: relative; padding: 26px; border-radius: 16px; border: 1px solid var(--border); background: linear-gradient(180deg, rgb(255 255 255 / 0.03), transparent); }
  .step::before { counter-increment: step; content: counter(step); display: grid; place-items: center; width: 28px; height: 28px; margin-bottom: 16px; border-radius: 8px; background: rgb(132 204 22 / 0.14); color: var(--accent); font-weight: 700; font-size: 14px; }
  .step h3 { margin: 0 0 6px; font-size: 17px; }
  .step p { margin: 0 0 14px; color: var(--muted); font-size: 15px; }
  header.hero::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background-image: linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px); background-size: 56px 56px; mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, #000, transparent); }
  header.hero { isolation: isolate; }
  .btn.big { height: 52px; padding: 0 26px; font-size: 16px; border-radius: 13px; }
  .install { display: inline-flex; align-items: center; gap: 12px; height: 52px; padding: 0 18px; border-radius: 13px; border: 1px solid rgb(255 255 255 / 0.14); background: #121215; color: var(--text); cursor: pointer; font: inherit; transition: border-color 0.15s ease; }
  .install:hover { border-color: rgb(132 204 22 / 0.5); }
  .install .prompt { color: var(--accent); font: 600 15px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .install code { font: 15px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .install .copy-hint, .install .copied-hint { margin-left: 6px; padding: 3px 8px; border-radius: 6px; background: rgb(255 255 255 / 0.07); color: var(--muted); font-size: 12px; }
  .install .copied-hint, .install.copied .copy-hint { display: none; }
  .install.copied .copied-hint { display: inline; color: var(--accent); }
  .hero-alt { position: relative; margin: 18px 0 0; color: var(--muted); font-size: 14px; }
  .hero-alt code, .alt code { color: var(--text); font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 7px; border-radius: 6px; background: rgb(255 255 255 / 0.06); }
  .alt { margin: 18px 0 0; color: var(--muted); font-size: 14px; }
  pre { margin: 0; padding: 12px 14px; border-radius: 10px; background: #0f0f12; border: 1px solid var(--border); font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d4d4d8; white-space: pre-wrap; word-break: break-all; }
  pre .c { color: #6b6b74; }

  .final { margin: 110px 0 0; padding: 56px 28px; border-radius: 22px; text-align: center; border: 1px solid var(--border); background: radial-gradient(120% 140% at 50% 0%, rgb(132 204 22 / 0.13), transparent 60%), var(--panel); }
  .final p { color: var(--muted); margin: 0 auto 26px; max-width: 480px; }
  footer { padding: 48px 0 56px; color: var(--muted); font-size: 14px; text-align: center; }

  @media (max-width: 820px) {
    nav a.link { display: none; }
    header.hero { padding-top: 64px; }
    .grid, .steps { grid-template-columns: 1fr; }
    .shot .phone { right: 8px; bottom: -28px; width: 30%; border-width: 4px; border-radius: 18px; }
    section { padding-top: 80px; }
  }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } .btn { transition: none; } }
</style>
</head>
<body>
<nav><div class="wrap">
  <a class="brand" href="/"><img src="/_mono/static/icon.png" alt="" /> Mono</a>
  <span class="spacer"></span>
  <a class="link" href="#como">How it works</a>
  <a class="link" href="#instalar">Install</a>
  <a class="btn small primary" href="/_mono/login">Sign in</a>
</div></nav>

<header class="hero"><div class="wrap">
  <span class="eyebrow"><i></i> Free for Mac</span>
  <h1>Your Claude Code agents, <span>at a glance.</span></h1>
  <p class="lead">Mono turns your agents' work into boards you can read in seconds. It runs on your Mac, with your Claude Code.</p>
  <div class="ctas">
    <button class="install" data-copy="npx ${escape(PACKAGE)}">
      <span class="prompt">$</span> <code>npx ${escape(PACKAGE)}</code>
      <span class="copy-hint">Copy</span><span class="copied-hint">Copied</span>
    </button>
    <a class="btn ghost big" href="/_mono/login">Sign in with Google</a>
  </div>
  <p class="hero-alt">Run it in Terminal on your Mac. It installs and opens the desktop app.</p>
  <div class="shot">
    <img class="desktop" src="/_mono/static/app-board.jpg" alt="Mono on Mac: a task's checkout flow, before and after" width="1200" height="750" />
    <img class="phone" src="/_mono/static/app-mobile.jpg" alt="Mono on iPhone: task summary" loading="lazy" />
  </div>
</div></header>

<section id="como"><div class="wrap">
  <h2>See the work, not the transcript.</h2>
  <p class="sub">Agents run for hours. Know in a minute what changed, what was tested and what's left.</p>
  <div class="grid">
    ${FEATURES.map(([title, text]) => `<div class="card"><h3>${escape(title)}</h3><p>${escape(text)}</p></div>`).join("")}
  </div>
</div></section>

<section id="instalar"><div class="wrap">
  <h2>Three steps.</h2>
  <p class="sub">Requires a Mac with <a href="https://docs.claude.com/en/docs/claude-code/setup">Claude Code</a> and <a href="https://nodejs.org">Node.js</a> 22+.</p>
  <div class="steps">
    <div class="step"><h3>Install</h3><p>In Terminal. Installs the desktop app to Applications and opens it.</p><pre>npx ${escape(PACKAGE)}</pre></div>
    <div class="step"><h3>Connect your Mac</h3><p>In the app: <b>Mono → Connect phone…</b> Sign in with Google and approve the code. Mono keeps running in the background.</p></div>
    <div class="step"><h3>Use it anywhere</h3><p>From your phone or any browser:</p><pre>${escape(relay.replace(/^https?:\/\//, ""))}</pre></div>
  </div>

  <div class="final">
    <h2>Already installed?</h2>
    <p>Sign in with Google to open your Macs from your phone or any browser.</p>
    <a class="btn primary" href="/_mono/login">Sign in with Google</a>
  </div>
</div></section>

${COPY_SCRIPT}
<footer><div class="wrap">Mono 🐒 · <a href="/_mono/privacidad">Privacy</a></div></footer>
</body>
</html>`;
}
