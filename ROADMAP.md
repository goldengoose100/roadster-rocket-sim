# Roadmap

Each session builds one block, tests it (existing suites + new tests), and ships it through the updater
(`node tools/release.mjs "notes"`, then push). Keep existing gameplay identical unless asked. See CLAUDE.md.

## Session 1: Garage + credits (done in 2.0.0)
- Showroom with a spinning turntable, opened from the start screen and the pause menu
- 5 upgrades with 3 levels each: motor, tires, fan, thrust, air tank (real effect on physics + live stats)
- Cosmetics: paint, wheel styles, rear wing, underglow, thruster smoke color
- 3 saved builds
- Credits earned from 0-60 runs, jumps, rings, flips, stunts and destruction (saved locally)

## Session 2: Races + stunts + missions
- 4 checkpoint tracks (2 driving, 2 flying), countdown lights, split times, medals
- Ghost car replaying your best run
- Stunt score: barrel rolls, wall rides, loops, big air, flips; combo multiplier, clean-landing bonus
- About 20 missions paying credits (land on all 4 mesas, flatten the fortress in 30 s, 200 m on the loop ceiling, 20 s airborne on real air...)

## Session 3: New maps
- Map picker on the start screen
- The Moon: 0.17 g, craters, Earth in the sky, air lasts ~6x longer
- Neon city at night: streets, tunnels, rooftop ramps, parking garages to wall-ride, glowing signs, wet roads

## Session 4: Weapons
- Weapon wheel on Tab, ammo crates around the map
- Railgun (pierces buildings), grapple hook, mines, tractor beam (lift and throw debris), EMP (drops drones, stalls cars),
  orbital laser, black-hole bomb (pulls in debris, then blasts it out)

## Session 5: NPCs + wanted level
- Traffic on the roads (cars, Semis) that swerve, honk and crash
- HQ crew that waves you in to refuel; spectators at ramps that cheer
- Rival AI Roadsters for races and stunt duels
- Wanted level from destruction: drones, then armored trucks, then a gunship

## Session 6: Mega destruction
- Skyscraper that collapses floor by floor; dam that floods the canyon; bridge; fuel depot chain reaction
- The giant rocket on the launch pad can be blown up (or launched)
- Glass that shatters, walls that crack before falling, lingering smoke and fire
- Damage counter ($ of destruction)

## Session 7: New vehicles
- Cybertruck (heavy, tough, smashes things) and Rocket Semi (tows a trailer, giant thrusters), each with its own physics

## Session 8: Physics 2.0 (2.0.0: tires, soft-body crashes + HQ repair, aero + slipstream + wind, gas physics, shockwaves; fracture, ropes and water/mud still to do)
- Tire model: heat, wear, pressure; grip changes with temperature; visible smoke and wear
- Soft-body crashes: panels crumple at the impact point, wheels can break off, frame bends; repair at HQ
- Aerodynamics: downforce/lift vs angle and speed, slipstream behind cars, wind gusts
- Gas physics: tank pressure and temperature drop as air expands, thrust fades realistically, per-thruster valve lag
- Fracture destruction: concrete splits along crack shapes, steel bends, glass shards, wood splinters
- Ropes and joints: real rope for the grapple, tow chains, trailer hitch, swinging wrecking balls
- Water and mud: buoyancy, splashes, hydroplaning in the flooded canyon, mud that grabs wheels
- Shockwaves that travel at the speed of sound, knocking things over and breaking glass as they pass

## Later ideas
- Ride the rocket to orbit and drop onto the Moon map
- Weather: sandstorms, rain, lightning, tornadoes that pick up cars
- Instant replay of the last 20 s with a cinematic camera
- Boss fight: drone mothership over the canyon
- Sumo arena: knock rival Roadsters off a floating platform
- Generated synthwave radio that reacts to speed
- Online multiplayer (hardest; do last)
