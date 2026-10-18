# Roadster Rocket Sim: notes for Claude

Three.js game (src/) bundled into one HTML file and shipped as an Electron app for Windows (desktop/).
The owner is not a programmer: explain plainly, confirm plans before big changes, and test before shipping.

## Rules from the owner
- The web artifact version is frozen. Only republish it if the owner explicitly asks.
- The mod menu's access code must never appear in the repo: not in code, tests, commits or docs.
  `src/hacks.js` stores only its SHA-256. `tools/hack-test.mjs` reads it from the `HACK_CODE` env var;
  ask the owner for it if you need to run that test.
- The Good Luck menu's code (key 0, added in 2.3) follows the same rule: `src/luck.js` stores only its SHA-256,
  `tools/luck-test.mjs` reads it from the `LUCK_CODE` env var (or `LUCK_UNLOCK=1` skips the prompt).
- Keep gameplay identical between versions unless a change was asked for.

## Shipping a game update (what installed apps receive)
1. Make the change in `src/` (or `tools/template.html` for page markup/CSS).
2. Bump `version` in the root `package.json` (patch or minor).
3. Run the tests (see README "Building"). The browser suites need `OFFLINE=1`.
4. `node tools/release.mjs "Short note the player will read" "Another note"`
   writes `updates/game-<version>.html` and `updates/latest.json`.
5. Commit and push to `main`. Installed apps offer the update on their next launch.

Only bump `desktop/package.json` (the app shell) when `desktop/main.cjs` or `desktop/preload.cjs`
changes. Shell changes need a full re-download: set `minShellForUpdates` in desktop/package.json to the
new shell version so older apps are told to download the new zip (`node tools/package.mjs`).
