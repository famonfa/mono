// Mobile shell: Mono itself is served by the relay; this page only handles the relay URL and Google login.
// Google blocks sign-in inside web views, so login happens in the system browser and comes back
// through the com.famonfa.mono:// deep link with a one-time code the relay trades for a session.
const plugin = (name) => window.Capacitor?.Plugins?.[name] ?? window.Capacitor?.registerPlugin?.(name);
const App = plugin("App");
const Browser = plugin("Browser");
const Preferences = plugin("Preferences");

const $ = (id) => document.getElementById(id);

async function savedRelay() {
  return (await Preferences.get({ key: "relay" })).value;
}

async function login(relay) {
  await Preferences.set({ key: "relay", value: relay });
  $("status").textContent = "Entrá con Google en la ventana que se abrió.";
  await Browser.open({ url: `${relay}/_mono/mobile/done`, presentationStyle: "popover" });
}

async function handleDeepLink(url) {
  const link = new URL(url);
  const code = link.searchParams.get("code");
  if (link.host !== "auth" || !code) return;
  await Browser.close().catch(() => {});
  const relay = await savedRelay();
  if (relay) location.href = `${relay}/_mono/mobile/exchange?code=${encodeURIComponent(code)}`;
}

function showSetup(relay) {
  $("status").textContent = "Pegá la URL de tu relay de Mono.";
  $("setup").hidden = false;
  if (relay) $("relay").value = relay;
}

async function start() {
  App.addListener("appUrlOpen", ({ url }) => handleDeepLink(url));
  const launch = await App.getLaunchUrl();
  if (launch?.url) return handleDeepLink(launch.url);

  const relay = await savedRelay();
  // The relay's login page links back here (#login) because it can't open the system browser itself.
  if (location.hash === "#login" && relay) return login(relay);
  if (relay && location.hash !== "#setup") return (location.href = relay);
  showSetup(relay);
}

$("setup").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    login(new URL($("relay").value.trim()).origin);
  } catch {
    $("error").textContent = "Esa URL no es válida.";
  }
});

start().catch((error) => ($("error").textContent = error.message));
