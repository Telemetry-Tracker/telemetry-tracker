# Expo/EAS + Hermes source-map feasibility test (2026-10-09, offline, no TT repo writes)
Pipeline (mirrors RN release build): esbuild minify (stand-in for Metro) -> build/index.android.bundle + .packager.map
-> hermesc 0.12 `-emit-binary -O -output-source-map` -> .hbc + .hbc.map
-> metro-source-map composeSourceMaps (what react-native/scripts/compose-source-maps.js does) -> build/index.android.bundle.map
-> run bytecode with Hermes 0.12 CLI as device/index.android.bundle -> real Hermes Error.stack (stack-android.txt)
-> tt-symbolicate.mjs = verbatim pure functions of apps/api/src/lib/stack-symbolicate.ts (develop @ 51e1d9d).
Run: node run.mjs  (output in results.txt)
Not tested: Metro itself, a real RN/Expo app on device, EAS Build/Update, the live upload API, the dashboard.

Repository regression inputs are selected from the attached offline reproduction.
`new.composed.map` was generated with metro-source-map 0.87.1 composeSourceMaps
from [index.android.bundle.packager.map, new.hbc.map]. The newer map describes
a different bytecode layout; it must not be used with the old CLI stack offsets.
