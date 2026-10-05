// Local development entrypoint.
//
// OpenCode resolves a local plugin directory by its root `index.ts`/`index.js`,
// so this file lets the repository directory itself be used as the plugin path
// in `opencode.jsonc` without a build step. Published packages use the bundled
// `dist/index.js` entry declared in package.json.
export { default } from "./src/index.js"
