# Petrichor

*a little rain goes a long way*

You are a small raincloud with a face, drifting over a grey, parched archipelago. Hold to rain.
Soaked hex tiles darken, tremble, then **pop** into meadow, forest, marsh and blossom, and every
pop is a note in a song you're writing without trying. Over a few hours the islands fill with
rivers, villages that build themselves, sheep, birds, butterflies and fireflies, while the sky
clears from overcast ash to warm dusk.

There's no fail state, no timer and no score. It is made to be played one-handed while you listen
to something else.

See [`DESIGN.md`](DESIGN.md) for the pitches, the reasoning behind the pick, and the full design doc.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open the printed URL (usually http://localhost:5173). For a production build:

```bash
npm run build
```

```bash
npm run preview
```

It needs a browser with WebGL2 and Web Audio (any recent Chrome, Edge, Firefox or Safari).

## Controls

| | Mouse / trackpad | Touch |
|---|---|---|
| Rain | hold left button | hold one finger |
| Move the cloud | move the pointer | drag |
| Plant a tree / splash a tile / boop a sheep / collect | click | tap |
| Turn the camera | right-drag (or shift-drag) | two-finger twist / drag |
| Zoom | wheel | pinch |

Keys: **Z** zen mode (hides UI; the camera drifts slowly) · **P** photo mode · **J** journal ·
**M** mute · **`** tuning panel · **Esc** close panels · **Space** take a photo (in photo mode).

Settings include *rain without holding* (for one-handed or trackpad play) and *lighter graphics*
(no shadows or MSAA, lower resolution, for older laptops). Progress autosaves to `localStorage`.
**Start over** in settings wipes it.

## What's in it

**The core action**: hold to rain.
- The cloud follows on springs. Each puff lags at its own stiffness, so it stretches with speed and
  wobbles back together. It swells the longer you hold, widening the rain. Release after a long
  stroke and a small rainbow arcs behind it.
- A dry tile shows cracked earth. Rain darkens it, the cracks heal, it trembles when nearly full,
  and then it pops. You get a squash-and-stretch hop, a colour bloom with a flash, neighbours
  nudged, grass and flowers springing out in a stagger, a petal and leaf burst, sparkles, a tiny
  camera nod, a soft *thup* and a quantized note.
- Keep raining on living tiles and they deepen: grass, then flowers, shrubs and mushrooms, then trees.
- Forgiving input: the rain disc is wide, nearly-soaked tiles soak faster, and a resting cursor
  lets the rain drift toward the tile closest to finishing. Each bloom gives its wet neighbours a
  sip, so soaked areas finish in chain reactions. A tap gives a concentrated splash.

**Groves and landmarks.** Each island is split into groves. When a grove reaches 84%, the rest
blooms by itself in a wave (no hunting for the last tile). Then a ripple rolls across the island,
the music swells, and a landmark assembles itself piece by piece, one rising note per piece:
cottages with chimney smoke, windmills, lantern shrines, standing stones, a great tree with a
swing, wells, a lighthouse whose beam turns at night, a pier with a bobbing boat, pagodas.

**The long arc.**

| Island | Teaches |
|---|---|
| Hearthmeadow | rain, growth |
| Wildwood | **seeds**: tap a living tile to plant a tree (the cloud sprouts a leaf) |
| Mirrormere | **springs**: rain on a glowing stone and a river runs down the terraces to the sea, blooming both banks as it goes |
| Lanternfell | **dusk**: night falls as you restore it. Flowers glow, fireflies rise, lanterns light |

Each restored island raises the next one out of the sea, and gives you a **little cloud** that
trails behind like a duckling and rains where you rain (up to four). After Lanternfell the days
start to turn on their own, and the archipelago keeps growing outward with new procedural islands.

**Discoveries.** Twelve hidden **wonders** (a sleeping fox, a lost kite, a fairy ring, an old owl, a
white stag, a heron, a glass float, a river turtle, a stone lantern, a moon lily, a shrine bell…)
appear when you bloom the right tile. Tap them to keep them in the **journal**. Rare **golden
flowers** appear on lush tiles. Sheep go *mbaa* and jump when tapped.

**Sound.** Everything is synthesized live with Web Audio. There are no audio files.
- Generative score in D major pentatonic over an 8-chord progression at 72 bpm: a detuned,
  tape-wobbled pad, a sub drone (after your first grove), sparse generative celesta whose density
  follows your activity, and a harp figure (after your first island). Your notes are quantized in
  pitch (a stepwise random-walk melody biased to chord tones and terrain height) and in time
  (the next 16th), so they can't sound wrong.
- SFX: rain is layered band-passed pink noise that follows intensity, plus individual droplet
  *plips* (falling on soil, rising "bloops" on water). Blooms are a soft *thup* with a bubble pop
  and a leaf rustle, and the timbre varies by biome: marimba, kalimba, glass, celesta, harp. You
  also get woody *toks*, splashes, whooshes, a rumble as land rises, formant-synthesized sheep and
  a camera shutter.
- The ambience changes with the world. Sea swell and wind at first; the wind fades as life
  returns. Birdsong rises with vitality, frogs appear near ponds, river gurgle follows the number
  of rivers, and crickets come at night.

**Look.** Soft low-poly dioramas on terraced hex columns. A single finishing pass applies
tilt-shift (the focus band follows the cloud), a saturation and warmth grade that rises with
world vitality, a vignette and grain. You also get an overcast sky that clears as the world
recovers, a time-of-day palette with stars, a translucent sea that shows submerged islands as
hints, lapping foam and sea ripples, and wind-swayed vegetation.

## Photo mode, zen and tuning

- **Photo mode (P):** frees the camera (left-drag to orbit), hides the UI, adds focus, blur and
  time-of-day sliders and four filters (soft, film, dream, mono), and saves a PNG.
- **Zen mode (Z):** hides everything and lets the camera drift in a slow orbit.
- **Tuning panel (` or `?debug`):** live sliders for tile, decor and cloud spring stiffness and
  damping, impulses, decor stagger, wind, rain radius, charge, soak rate, magnetism, life spread,
  grove auto-finish threshold, drop rate, camera kick, follow and FOV, particle counts, tilt-shift,
  grain, vignette, volumes and time scale. It also has shortcuts (bloom island, finish grove,
  unlock next island, lush everything) and an fps/particle readout.

## Code tour

```
src/
  core/      config (all tunables), springs/noise/rng, hex math, shared shader patches
  audio/     engine (buses, reverb, instrument voices), generative music, sfx + ambience
  world/     island generation, island rendering + tile springs, instanced decor, models,
             landmarks, creatures, wonders, sky/sea/lighting
  fx/        particles, rain, post-processing
  game/      game orchestration + progression, cloud(s), camera rig, input, save
  ui/        DOM UI (title, HUD, journal, settings, photo bar) and the tuning panel
```

Every animated value is a damped spring (sub-stepped at 240 Hz, so it's stable at any frame rate)
or an overshoot curve. There are no linear tweens. Tiles, decor and creatures are instanced, so a
fully grown archipelago stays at a few dozen draw calls. Resolution adapts if the frame rate dips.
