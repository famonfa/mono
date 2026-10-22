/** npm package people install on their Mac. */
const PACKAGE = process.env.MONO_PACKAGE ?? "@famonfa/mono";

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const FEATURES = [
  ["Tableros que se escriben solos", "Con el skill /workspace, tus agentes documentan cada tarea como story map, flujo antes/después, testeo y mapa técnico. Lo entendés en 30 segundos y lo editás arrastrando."],
  ["Tus agentes, en vivo", "Todas las sesiones de Claude Code de tu Mac en un lugar: qué están haciendo, qué tocaron y cuáles terminaron sin que las vieras."],
  ["Seguí desde el celu", "Retomá una sesión, aprobá un permiso o mandá el próximo pedido desde cualquier navegador o desde la app."],
  ["Tu código no sale de tu Mac", "Los agentes corren en tu máquina, con tu Claude Code y tus repos. El relay solo pasa mensajes entre tu Mac y vos."],
];

/** Public front door of the relay: what Mono is, how to get in, how to install it. */
export function landingPage({ relay }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0b0b0d" />
<title>Mono · tus agentes de Claude Code, a la vista</title>
<meta name="description" content="Mono convierte el trabajo de tus agentes de Claude Code en tableros que se entienden de un vistazo. Corre en tu Mac y lo seguís desde el celu." />
<meta property="og:title" content="Mono · tus agentes de Claude Code, a la vista" />
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
  <a class="link" href="#como">Cómo funciona</a>
  <a class="link" href="#instalar">Instalar</a>
  <a class="btn small primary" href="/_mono/login">Entrar</a>
</div></nav>

<header class="hero"><div class="wrap">
  <span class="eyebrow"><i></i> Por invitación</span>
  <h1>Tus agentes de Claude Code, <span>a la vista.</span></h1>
  <p class="lead">Mono convierte lo que hacen tus agentes en tableros que entendés de un vistazo. Corre en tu Mac, con tu Claude Code, y lo seguís desde el celu.</p>
  <div class="ctas">
    <a class="btn primary" href="/_mono/login">Entrar con Google</a>
    <a class="btn ghost" href="#instalar">Cómo instalarlo</a>
  </div>
  <div class="shot">
    <img class="desktop" src="/_mono/static/app-board.jpg" alt="Mono en la Mac: el flujo de pago de una tarea, antes y después" width="1200" height="750" />
    <img class="phone" src="/_mono/static/app-mobile.jpg" alt="Mono en el celular: el resumen de la tarea" loading="lazy" />
  </div>
</div></header>

<section id="como"><div class="wrap">
  <h2>Ver el trabajo, no leer la conversación.</h2>
  <p class="sub">Los agentes trabajan horas; vos necesitás saber en un minuto qué cambió, qué se probó y qué falta.</p>
  <div class="grid">
    ${FEATURES.map(([title, text]) => `<div class="card"><h3>${escape(title)}</h3><p>${escape(text)}</p></div>`).join("")}
  </div>
</div></section>

<section id="instalar"><div class="wrap">
  <h2>Listo en tres pasos.</h2>
  <p class="sub">Necesitás una Mac con <a href="https://docs.claude.com/en/docs/claude-code/setup">Claude Code</a> y una invitación.</p>
  <div class="steps">
    <div class="step"><h3>Instalá Mono</h3><p>En la terminal de tu Mac.</p><pre>npm i -g ${escape(PACKAGE)}
mono service install</pre></div>
    <div class="step"><h3>Conectá tu Mac</h3><p>Se abre el navegador: entrás con Google y aprobás el código.</p><pre>mono connect</pre></div>
    <div class="step"><h3>Usalo donde estés</h3><p>En la Mac con <code>mono</code>, o desde cualquier navegador en:</p><pre>${escape(relay.replace(/^https?:\/\//, ""))}</pre></div>
  </div>

  <div class="final">
    <h2>¿Tenés invitación?</h2>
    <p>Entrá con la cuenta de Google a la que te llegó. Si no tenés, pedísela a quien te pasó este link.</p>
    <a class="btn primary" href="/_mono/login">Entrar con Google</a>
  </div>
</div></section>

<footer><div class="wrap">Mono 🐒 · tus agentes corren en tu máquina · <a href="/_mono/privacidad">Privacidad</a></div></footer>
</body>
</html>`;
}
