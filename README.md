# Liebherr LTM Mobile Crane — 3D Game

A browser-based 3D mobile-crane simulator built with Three.js. You operate a
Liebherr-style LTM telescopic mobile crane on a construction yard: deploy the
outriggers, slew the superstructure, luff and telescope the boom, hoist the
hook, pick up cargo and deliver it to the glowing target zone — without
overloading the crane.

## Run it

Open `index.html` in any modern browser (double-click works — everything is
vendored locally, no internet or server needed):

```
crane-game/
├── index.html          # entry point
├── css/style.css       # HUD styling
└── js/
    ├── game.js         # game logic (crane, physics, missions, HUD, audio)
    └── vendor/         # three.js r147 + OrbitControls (local, offline)
```

## Controls

| Key | Action |
| --- | --- |
| `Q` / `E` | Slew superstructure left / right |
| `W` / `S` | Boom up / down (luff) |
| `R` / `F` | Telescope boom out / in |
| `Z` / `X` | Hoist cable in / out |
| `SPACE` | Grab / drop load |
| `O` | Outriggers down / up |
| `C` | Camera: orbit → cab → hook |
| `SHIFT` | Fast movement |
| `H` | Toggle help |
| `M` | Mute / unmute |
| Mouse | Orbit / zoom / pan (orbit cam) |

## Gameplay

- Cargo spawns on a marked **pad** (A/B/C). Pick it up with `SPACE` when the
  hook is close, then deliver it into the pulsing colored **zone**.
- Faster deliveries score more; chaining deliveries within 30 s builds a
  combo multiplier (up to ×3). Best score is saved in `localStorage`.
- **Load chart**: capacity depends on outriggers (down = much higher), boom
  extension, boom angle and load radius. Lifting beyond capacity triggers an
  overload warning and the load is auto-released after ~2.5 s. The HUD load
  readout turns red when overloaded.
- The hook swings on a real pendulum physics model (gravity + rope constraint),
  so swing the load gently.
- 3 camera modes, engine/hydraulics WebAudio sound, day scene with shadows,
  fog, trees, city backdrop and animated HUD.

## Tech

- Three.js r147 (vendored, UMD build — runs from `file://`)
- Pendulum hook: semi-implicit Euler with distance-constraint rope, substeps
- Telescopic boom: 5 kinematic sections that slide as `tele` goes 0→100 %
- No build step, no dependencies beyond the vendored files
