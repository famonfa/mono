const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("monoDesktop", { platform: process.platform });

// The window has no title bar: mark the page so its CSS leaves room for the traffic lights,
// and add a strip over the sidebar to drag the window from.
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("is-desktop");
  const drag = document.createElement("div");
  drag.className = "desktop-drag";
  document.body.appendChild(drag);
});
