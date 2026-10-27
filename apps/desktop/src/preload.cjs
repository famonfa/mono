const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("monoDesktop", {
  platform: process.platform,
  /** The newer version waiting to be installed, if any. */
  availableUpdate: () => ipcRenderer.invoke("mono:update"),
  onUpdate: (fn) => {
    const listener = (_event, version) => fn(version);
    ipcRenderer.on("mono:update", listener);
    return () => ipcRenderer.removeListener("mono:update", listener);
  },
  installUpdate: () => ipcRenderer.invoke("mono:install-update"),
  connectPhone: () => ipcRenderer.invoke("mono:connect-phone"),
  pickFolder: () => ipcRenderer.invoke("mono:pick-folder"),
  /** New Tab / Close Tab from the File menu; the page owns the tabs. */
  onTabCommand: (fn) => {
    const listener = (_event, command) => fn(command);
    ipcRenderer.on("mono:tab", listener);
    return () => ipcRenderer.removeListener("mono:tab", listener);
  },
});

// The window has no title bar: mark the page so its CSS leaves room for the traffic lights,
// and add a strip over the sidebar to drag the window from.
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("is-desktop");
  const drag = document.createElement("div");
  drag.className = "desktop-drag";
  document.body.appendChild(drag);
});
