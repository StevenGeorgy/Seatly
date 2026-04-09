const { getDefaultConfig } = require("expo/metro-config");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;

/**
 * npm workspaces hoist `expo` to the monorepo root. `expo/AppEntry.js` imports `../../App`
 * relative to that package, which resolves to `<repo>/App` instead of `apps/mobile/App`.
 * Remap that single import to this app's entry component.
 */
const config = getDefaultConfig(projectRoot);

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath;
  const isAppEntry =
    origin &&
    (origin.endsWith(`${path.sep}expo${path.sep}AppEntry.js`) ||
      origin.replace(/\\/g, "/").endsWith("/expo/AppEntry.js"));

  if (isAppEntry && (moduleName === "../../App" || moduleName.endsWith("/App"))) {
    const candidates = ["App.tsx", "App.jsx", "App.ts", "App.js"];
    for (const name of candidates) {
      const filePath = path.join(projectRoot, name);
      if (fs.existsSync(filePath)) {
        return { type: "sourceFile", filePath };
      }
    }
  }

  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
