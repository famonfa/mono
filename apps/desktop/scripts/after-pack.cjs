// electron-builder never copies node_modules folders through extraResources, so the bundled server's
// dependencies are added here, after packing and before the app is signed.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const from = path.join(__dirname, "..", "server-bundle", "node_modules");
  const to = path.join(app, "Contents", "Resources", "server", "node_modules");
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
};
