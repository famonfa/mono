const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
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
  form.dev { display: grid; gap: 8px; }
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

/** npm package people install on their Mac. */
const PACKAGE = process.env.MONO_PACKAGE ?? "@famonfa/mono";

const devLogin = (next) => `<form class="dev" method="get" action="/_mono/auth/dev"><input type="hidden" name="next" value="${escape(next)}" />
  <input name="email" type="email" placeholder="Email (dev mode)" required /><button class="btn secondary">Sign in without Google</button></form>`;

/**
 * Google refuses sign-in inside embedded web views, so inside the mobile app the button goes back to
 * the app's local page, which opens the login in the system browser and returns with a deep link.
 */
export function loginPage({ next, dev, app, ios }) {
  const googleHref = app ? `${ios ? "capacitor://localhost" : "https://localhost"}/#login` : `/_mono/auth/google?next=${encodeURIComponent(next)}`;
  return layout(
    "Sign in",
    `<h1>Mono</h1>
    <a class="btn" href="${escape(googleHref)}">${GOOGLE_G} Continue with Google</a>
    ${dev ? devLogin(next) : ""}`,
  );
}

export function invitePage({ invite, dev }) {
  const used = Boolean(invite.accepted_at);
  return layout(
    "Invite",
    `<h1>You're invited to Mono</h1>
    <p>From ${escape(invite.invited_by)}. Sign in with the Google account <b>${escape(invite.email)}</b>.</p>
    <a class="btn" href="/_mono/auth/google?next=%2F_mono%2Fhosts">${GOOGLE_G} Continue with Google</a>
    ${used ? `<p class="foot">This invite was already used. If it was yours, sign in anyway.</p>` : ""}
    ${dev ? devLogin("/_mono/hosts") : ""}`,
  );
}

const installSteps = (relay) => `<ol class="steps">
  <li>Install <a href="https://docs.claude.com/en/docs/claude-code/setup">Claude Code</a> on your Mac and sign in.</li>
  <li>Install the app from Terminal:<pre>npx ${escape(PACKAGE)}</pre></li>
  <li>In the app: <b>Mono → Connect phone…</b>, approve the code with Google, then come back here.</li>
</ol>`;

export function hostsPage({ email, hosts, current, admin, relay }) {
  const list = hosts.length
    ? `<div class="hosts">${hosts
        .map(
          (h) => `<div class="host"><div><b><span class="dot"></span>${escape(h.name)}</b><small>${h.id === current ? "Selected" : "Connected"}</small></div>
          <form method="post" action="/_mono/hosts/select"><input type="hidden" name="hostId" value="${escape(h.id)}" /><button class="btn">Open</button></form></div>`,
        )
        .join("")}</div><details><summary>Connect another Mac</summary>${installSteps(relay)}</details>`
    : `<p>No Macs connected yet.</p>${installSteps(relay)}`;
  return layout("Your Macs", `<h1>Your Macs</h1>${list}<p class="foot">${escape(email)} · ${admin ? `<a href="/_mono/admin">Members</a> · ` : ""}<a href="/_mono/logout">Sign out</a></p>`);
}

export function adminPage({ email, admins, users, blocked, online, notice }) {
  const row = (main, sub, action) => `<div class="host"><div><b>${main}</b><small>${sub}</small></div>${action ?? ""}</div>`;
  const button = (route, value, label) =>
    `<form method="post" action="/_mono/admin/${route}"><input type="hidden" name="email" value="${escape(value)}" /><button class="btn secondary">${label}</button></form>`;
  const machines = (e) => (online[e] ? `${online[e]} Mac${online[e] > 1 ? "s" : ""} connected` : "no Macs connected");
  return layout(
    "Members",
    `<h1>Members</h1>
    ${notice?.error ? `<p class="error">${escape(notice.error)}</p>` : ""}
    <p>Anyone can sign in with Google. Block an account to lock it out.</p>
    <div class="hosts">
      ${admins.map((a) => row(escape(a), `admin · ${machines(a)}`)).join("")}
      ${users.map((u) => row(escape(u.email), `${u.invited_by ? `invited by ${escape(u.invited_by)} · ` : ""}${machines(u.email)}`, button("block", u.email, "Block"))).join("")}
    </div>
    ${
      blocked.length
        ? `<h2>Blocked</h2><div class="hosts">${blocked.map((b) => row(escape(b.email), `by ${escape(b.blocked_by ?? "?")}`, button("unblock", b.email, "Unblock"))).join("")}</div>`
        : ""
    }
    <p class="foot"><a href="/_mono/hosts">Back</a> · ${escape(email)}</p>`,
  );
}

export function pairPage({ code, name, email }) {
  return layout(
    "Connect Mac",
    `<h1>Connect “${escape(name)}”?</h1>
    <p>Check that the terminal shows this code:</p>
    <p><code>${escape(code)}</code></p>
    <p>It will be linked to ${escape(email)}.</p>
    <form method="post" action="/_mono/pair/approve"><input type="hidden" name="code" value="${escape(code)}" /><button class="btn">Connect</button></form>`,
  );
}

export function privacyPage() {
  return layout(
    "Privacy",
    `<h1>Privacy</h1>
    <p>Mono uses your Google account only to identify you: it stores your email to grant access and link your Macs. It doesn't request or store any other Google data.</p>
    <p>Your agents, code and tasks stay on your Mac. The relay passes messages between your Mac and your browser while you use them, and doesn't store them.</p>
    <p>To delete your account, email monsegurfacundo@gmail.com.</p>
    <a class="btn secondary" href="/">Back</a>`,
  );
}

export function messagePage(title, text, action) {
  return layout(title, `<h1>${escape(title)}</h1><p>${escape(text)}</p>${action ? `<a class="btn secondary" href="${escape(action.href)}">${escape(action.label)}</a>` : ""}`);
}
