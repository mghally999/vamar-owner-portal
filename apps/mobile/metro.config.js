// Metro config for a pnpm monorepo: watch the workspace root and resolve hoisted packages.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
// Native build output churns thousands of files; keep the watcher away from it.
config.resolver.blockList = [
  /apps[\/]mobile[\/]android[\/].*/,
  /apps[\/]mobile[\/]ios[\/].*/,
  /[\/].gradle[\/].*/,
  /[\/].cxx[\/].*/,
];

module.exports = config;

// The shared workspace packages are written as TypeScript ESM with explicit `./x.js` specifiers
// (so that Node/tsx and bundlers agree). Metro resolves those back to the .ts/.tsx source.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (/^\.{1,2}\//.test(moduleName) && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName.replace(/\.js$/, ''), platform);
    } catch {
      // fall through to the normal resolution (a real .js file)
    }
  }
  return resolve(context, moduleName, platform);
};
