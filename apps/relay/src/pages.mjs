const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function layout(title, body) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0f0f10" />
<title>${escape(title)} · Mono</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐒</text></svg>" />
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --panel: #fff; --text: #111; --muted: #6b6b6b; --border: #e5e5e5; --accent: #4d7c0f; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f0f10; --panel: #18181a; --text: #ededed; --muted: #9a9a9a; --border: #2a2a2d; --accent: #84cc16; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: var(--bg); color: var(--text);
    font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  main { width: 100%; max-width: 380px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 28px 24px; }
  .logo { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 11px; background: linear-gradient(135deg, #3f6212, #65a30d); font-size: 24px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p { margin: 0 0 18px; color: var(--muted); }
  code { font: 600 18px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; color: var(--text); }
  .btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 44px; border-radius: 10px; border: 1px solid var(--border);
    background: var(--text); color: var(--bg); font: 600 15px -apple-system, BlinkMacSystemFont, system-ui, sans-serif; text-decoration: none; cursor: pointer; }
  .btn.secondary { background: transparent; color: var(--text); }
  .hosts { display: grid; gap: 8px; margin-bottom: 18px; }
  .host { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; }
  .host b { display: block; }
  .host small { color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); display: inline-block; margin-right: 6px; }
  .host .btn { width: auto; height: 34px; padding: 0 14px; }
  .foot { margin-top: 18px; font-size: 13px; color: var(--muted); text-align: center; }
  .foot a { color: inherit; }
  form { margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 22px 0 8px; }
  input { width: 100%; height: 44px; border-radius: 10px; border: 1px solid var(--border); background: transparent; color: inherit; padding: 0 12px; font: inherit; }
  form.invite, form.dev { display: grid; gap: 8px; }
  form.dev { margin-top: 18px; }
  pre { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-all; }
  ol.steps { padding-left: 20px; color: var(--muted); }
  ol.steps li { margin-bottom: 10px; }
  ol.steps a, p a { color: var(--text); }
  details { margin-bottom: 8px; color: var(--muted); }
  summary { cursor: pointer; margin-bottom: 8px; }
  .error { color: #ef4444; }
  ol.steps small, p small { display: block; font-size: 12.5px; }
  main { max-width: 420px; }
</style>
</head>
<body><main><div class="logo">🐒</div>${body}</main></body>
</html>`;
}

const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

/** npm package invitees install on their Mac. */
const PACKAGE = process.env.MONO_PACKAGE ?? "@famonfa/mono";

const devLogin = (next) => `<form class="dev" method="get" action="/_mono/auth/dev"><input type="hidden" name="next" value="${escape(next)}" />
  <input name="email" type="email" placeholder="email (modo desarrollo)" required /><button class="btn secondary">Entrar sin Google</button></form>`;

/**
 * Google refuses sign-in inside embedded web views, so inside the mobile app the button goes back to
 * the app's local page, which opens the login in the system browser and returns with a deep link.
 */
export function loginPage({ next, dev, app, ios }) {
  const googleHref = app ? `${ios ? "capacitor://localhost" : "https://localhost"}/#login` : `/_mono/auth/google?next=${encodeURIComponent(next)}`;
  return layout(
    "Entrar",
    `<h1>Mono</h1>
    <p>Entrá con Google para usar tus agentes de Claude Code desde cualquier lado.</p>
    <a class="btn" href="${escape(googleHref)}">${GOOGLE_G} Continuar con Google</a>
    ${dev ? devLogin(next) : ""}`,
  );
}

export function invitePage({ invite, dev }) {
  const used = Boolean(invite.accepted_at);
  return layout(
    "Invitación",
    `<h1>Te invitaron a Mono</h1>
    <p>${escape(invite.invited_by)} te invitó. Entrá con la cuenta de Google <b>${escape(invite.email)}</b>.</p>
    <a class="btn" href="/_mono/auth/google?next=%2F_mono%2Fhosts">${GOOGLE_G} Continuar con Google</a>
    ${used ? `<p class="foot">Esta invitación ya se usó: si sos vos, entrá igual.</p>` : ""}
    ${dev ? devLogin("/_mono/hosts") : ""}`,
  );
}

const installSteps = (relay) => `<ol class="steps">
  <li>Tené <a href="https://docs.claude.com/en/docs/claude-code/setup">Claude Code</a> instalado y logueado en tu Mac.</li>
  <li>En la terminal de esa Mac, conectala (queda corriendo en segundo plano):<pre>npx ${escape(PACKAGE)} connect</pre></li>
  <li>Se abre el navegador: aprobá el código con Google y volvé acá.</li>
</ol>
<p><small>Para abrir Mono en la Mac: <code>npx ${escape(PACKAGE)}</code></small></p>`;

export function hostsPage({ email, hosts, current, admin, relay }) {
  const list = hosts.length
    ? `<div class="hosts">${hosts
        .map(
          (h) => `<div class="host"><div><b><span class="dot"></span>${escape(h.name)}</b><small>${h.id === current ? "Seleccionada" : "Conectada"}</small></div>
          <form method="post" action="/_mono/hosts/select"><input type="hidden" name="hostId" value="${escape(h.id)}" /><button class="btn">Abrir</button></form></div>`,
        )
        .join("")}</div><details><summary>Conectar otra Mac</summary>${installSteps(relay)}</details>`
    : `<p>Todavía no conectaste ninguna Mac. Mono corre los agentes en tu máquina:</p>${installSteps(relay)}`;
  return layout("Tus máquinas", `<h1>Tus máquinas</h1>${list}<p class="foot">${escape(email)} · ${admin ? `<a href="/_mono/admin">Invitar gente</a> · ` : ""}<a href="/_mono/logout">Salir</a></p>`);
}

export function adminPage({ email, admins, users, invites, online, notice, relay }) {
  const row = (main, sub, action) => `<div class="host"><div><b>${main}</b><small>${sub}</small></div>${action ?? ""}</div>`;
  const button = (route, name, value, label) =>
    `<form method="post" action="/_mono/admin/${route}"><input type="hidden" name="${name}" value="${escape(value)}" /><button class="btn secondary">${label}</button></form>`;
  const machines = (e) => (online[e] ? `${online[e]} Mac${online[e] > 1 ? "s" : ""} conectada${online[e] > 1 ? "s" : ""}` : "sin Macs conectadas");
  return layout(
    "Invitar",
    `<h1>Invitar a Mono</h1>
    ${notice?.error ? `<p class="error">${escape(notice.error)}</p>` : ""}
    ${notice?.link ? `<p>Mandale este link a ${escape(notice.email)}:</p><pre class="copy">${escape(notice.link)}</pre>` : ""}
    <form class="invite" method="post" action="/_mono/admin/invite"><input name="email" type="email" placeholder="email de Google" required /><button class="btn">Invitar</button></form>
    <h2>Con acceso</h2>
    <div class="hosts">
      ${admins.map((a) => row(escape(a), `admin · ${machines(a)}`)).join("")}
      ${users.map((u) => row(escape(u.email), `invitado por ${escape(u.invited_by ?? "?")} · ${machines(u.email)}`, button("remove", "email", u.email, "Quitar"))).join("")}
    </div>
    ${
      invites.length
        ? `<h2>Pendientes</h2><div class="hosts">${invites
            .map((i) => row(escape(i.email), `<a href="${escape(`${relay}/_mono/invite/${i.token}`)}">link de invitación</a>`, button("revoke", "token", i.token, "Cancelar")))
            .join("")}</div>`
        : ""
    }
    <p class="foot"><a href="/_mono/hosts">Volver</a> · ${escape(email)}</p>`,
  );
}

export function pairPage({ code, name, email }) {
  return layout(
    "Conectar máquina",
    `<h1>¿Conectar “${escape(name)}”?</h1>
    <p>Confirmá que la terminal muestra este código:</p>
    <p><code>${escape(code)}</code></p>
    <p>Vas a poder usar sus agentes de Claude Code desde cualquier lado con ${escape(email)}.</p>
    <form method="post" action="/_mono/pair/approve"><input type="hidden" name="code" value="${escape(code)}" /><button class="btn">Conectar</button></form>`,
  );
}

export function privacyPage() {
  return layout(
    "Privacidad",
    `<h1>Privacidad</h1>
    <p>Mono usa tu cuenta de Google solo para saber quién sos: guarda tu email para darte acceso y vincular tus máquinas. No pide ni guarda ningún otro dato de Google.</p>
    <p>Tus agentes, tu código y tus tareas viven en tu propia Mac. El relay solo pasa mensajes entre tu Mac y tu navegador mientras los usás, y no los guarda.</p>
    <p>Si querés que borremos tu cuenta, pedíselo a quien te invitó o escribí a monsegurfacundo@gmail.com.</p>
    <a class="btn secondary" href="/">Volver</a>`,
  );
}

export function messagePage(title, text, action) {
  return layout(title, `<h1>${escape(title)}</h1><p>${escape(text)}</p>${action ? `<a class="btn secondary" href="${escape(action.href)}">${escape(action.label)}</a>` : ""}`);
}
