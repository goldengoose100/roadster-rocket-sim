# Roadster Rocket Sim

An unofficial, fan-made 3D physics sim of the new Tesla Roadster (revealed Oct 15, 2026) and its
cold-gas thruster package, as a Windows desktop app. Not affiliated with Tesla or SpaceX.

## Download

Get the latest Windows zip from this repository's **Releases** page (or from whoever shared it with you).
Unzip it, open the folder and double-click **Roadster Rocket Sim.exe**. If Windows shows
"Windows protected your PC", click **More info → Run anyway** (the app isn't code-signed).

## Updates

From v1.1.0 on, the app updates itself. On launch it checks `updates/latest.json` in this repository;
if there is a newer version it offers to install it (about 1 MB). Downloads are checked against a
SHA-256 fingerprint, and if a new version fails to start the app rolls back to the last working one.
You can also check manually from the pause menu (P).

## How to play

| Key | Driving | Flying (Rocket trim) |
| --- | --- | --- |
| W / ↑ | Accelerate | Tilt forward |
| S / ↓ | Brake, then reverse | Tilt back |
| A D / ← → | Steer | Turn |
| Shift | Rocket boost | Boost forward |
| Space | | Lift off / climb |
| C | | Descend / soft landing |
| Q / E | | Barrel roll left / right (hold to slide) |
| X | Handbrake / drift | |
| F | Fan suction: Auto, Max, Off | |
| G | | Flight assist on / manual |
| Click or B | Fire rocket (after picking up a launcher) | same |
| R | Reset car upright | same |
| V | Camera: chase, far, cockpit, cinematic, orbit | |
| M | Big map (click to teleport) | |
| 1-9 | Teleport to zones | |
| Backspace | Rebuild everything you destroyed | |
| H / P / N | Controls / pause menu / sound | |
| F11 | Fullscreen | |

Let go of every key while flying and the assist hovers in place.

## Map

1. **Air Station HQ**: spawn; park on the glowing AIR pad to refill.
2. **Drag Strip**: 0-60 mph and 1/4 mile are timed automatically.
3. **Demo Ramp 170°**: the reveal stunt; flip and hover down at the top.
4. **Loop of Death**: follow the yellow line at 50+ mph.
5. **Wall Ride**: ride the vertical wall with fan suction.
6. **Jump Park**: jump 6 cars and a Semi, or the 13 m mega ramp.
7. **Flight Canyon**: 10 rings and mesa landing pads.
8. **Weapons Range**: rocket launchers and destructible buildings.
9. **Dunes**: off-road sand.

## Specs used

From coverage of the reveal: 10 cold-gas thrusters, 80+ kN rear thrust, 600 L / ~250 kg of air,
4,700 kg fan downforce, 0-60 mph under 0.59 s (Rocket), under 0.9 s (Thrust), under 1.6 s (Performance),
230+ mph. Curb weight, lift-thruster force and motor power aren't published, so those are estimates
(`src/config.js`).

## Building

```
npm install
npm run build:offline          # desktop/app/index.html (the game, fully offline)
node tools/package.mjs         # Windows app + zip in desktop/out/
node tools/release.mjs "notes" # writes updates/game-<version>.html + updates/latest.json
```

Tests: `node tools/physics-test.mjs`, `node tools/steer-test.mjs`, `node tools/hack-physics-test.mjs`,
`OFFLINE=1 node tools/play-test.mjs out/` (Playwright), `xvfb-run node tools/updater-test.mjs out/`
(needs `node tools/package.mjs --linux` first).
