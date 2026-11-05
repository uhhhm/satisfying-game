# Petrichor — Design Doc

## 1. Three pitches

**A. Petrichor.** You are a small raincloud drifting over a grey, parched archipelago. Hold to rain.
Soaked hex tiles darken, then *pop* into meadow, forest, marsh and blossom. Every bloom is a note in
a song you're writing without trying. Over a session the islands fill with rivers, villages that
build themselves, sheep, birds, fireflies, and the sky warms from ash-grey to dusk-gold.

**B. Kintsugi Harbor.** Mend shattered pottery with gold. Shards drift on a dark pond; drag them close
and they magnetise into place with a gold seam and a ceramic *tink*. Finished bowls fill with
candle-light and float out to a harbor that slowly glows up across one long night.

**C. Loomlight.** A giant loom of pegs over a valley. Draw threads between pegs; each pass tightens
the weave, and the fabric becomes quilted terrain: fields, lakes, roads. Colour patterns become
melodies; complete a panel and the quilt unrolls into a new hillside.

## 2. The pick: Petrichor

Petrichor has the highest ceiling for "satisfying" because:

- **Its core action is continuous, but the payoff is discrete.** Holding rain is effortless and
  works one-handed, half-listening. Under that continuous stroke, tiles hit their threshold one at a
  time: *pop, pop-pop, pop*. That's the PowerWash principle: steady, calm input punctuated by small
  completions. You can do it 10,000 times because you never have to aim hard. The cloud is soft and
  wide, and nearly-done tiles pull the rain toward them.
- **It writes music.** Each pop is a quantized note on the current chord, so a sweeping stroke
  plays an arpeggio. Players feel musical without trying.
- **It has natural chain reactions.** Regions that are nearly done finish themselves in a wave.
  Springs send rivers down to the sea and bloom every tile they pass. A finished island ripples.
- **The long arc is legible.** The world goes from grey to green. You can always look back at a
  finished island and see that you did that.

Kintsugi has a better single "click" but a shorter arc, and its puzzle-ish matching asks for
precision. Loomlight is elegant but abstract: harder to love at a glance, harder to make cosy.

## 3. Core loop (seconds)

1. Move the pointer: the cloud follows with a spring. It lags, leans into motion and stretches with speed.
2. Hold: rain falls in a soft disc. Drops splash, the soil under the rain darkens, and the cloud
   slowly swells the longer you hold (a bigger radius rewards long, lazy strokes).
3. A tile reaches 100% moisture: the cap **pops** (squash and stretch, overshoot). Its colour blooms
   from grey to its biome, grass and flowers spring out in a stagger, petals burst, the camera
   twitches gently and a note plays.
4. Keep raining on living tiles and they grow deeper: grass, then flowers, shrubs and reeds, then
   trees and big blossoms.
5. Release after a long stroke: a little rainbow arcs behind the cloud.

## 4. Mid loop (minutes)

- Each island is split into **groves** (regions) of about 10–16 tiles. When a grove reaches ~85%,
  the rest blooms by itself in a wave (no hunting for the last tile). Then a ripple rolls across
  it, its colours saturate, the music swells, and a **landmark assembles piece by piece** (cottage,
  windmill, lantern shrine, standing stones, great tree, well, lighthouse).
- Life arrives with completion: butterflies over flowers, sheep on meadows (tap them), birds over
  groves, fish jumping in ponds.

## 5. Long arc (hours)

| Island | Name | Biome emphasis | New verb / deepening |
|---|---|---|---|
| 1 | Hearthmeadow | meadow, beach | Rain. Growth stages. |
| 2 | Wildwood | forest, mushrooms | **Seeds**: tap a living tile to plant a tree. The cloud wears a leaf. |
| 3 | Mirrormere | lakes, marsh | **Springs**: rain on a glowing stone; a river runs to the sea and blooms everything it passes. |
| 4 | Lanternfell | blossom highlands, dusk | **Night**: the sky turns to dusk. Blooms glow and release fireflies, and shrines light up. |
| ∞ | The Archipelago | everything | Free play, a slow day/night cycle, all verbs. Endless new islands, including four new kinds of shore (autumn, frost, ember, oasis). |

Finishing an island raises the next one out of the sea in the distance, and the camera glides over.
Each island has three **Wonders** (a sleeping fox, a fairy ring, an old bell…). Most arrive with a
kinship (section 5a); a few stay hidden under a random tile as lucky finds. Tap them to keep them in your **Journal**. Rare **golden flowers** show up on
lush tiles; tapping one plays a glittering run and counts toward the journal.

## 5a. The living layer: kinships and visitors

Rain-and-bloom is the core, but on its own it asks no decisions. The living layer adds reasons to
choose *where* to rain and plant, under four guardrails:

1. **Additive only.** Nothing decays, nothing is lost, there are no wrong moves, resources, meters
   or timers.
2. **Rain alone still finishes every island.** The layer unlocks wonders, creatures, music and
   landmark touches, never progress. (Check: a bot that only rains still restores the archipelago
   at the same pace.)
3. **No new inputs or text.** Still hold, tap and move. Wishes are pictograms in the world.
4. **A feedback budget.** Kinship moments are quieter than a bloom, reuse the same vocabulary
   (pop, sparkle, quantized notes), and queue so two never land on the same beat.

**Kinships** are adjacency rules read off the board (beehive, fern hollow, thicket, reed bed,
cottage garden, lantern tree), one of each per grove. Growth stages 2 and 3 become ingredients, and
seeds become a paintbrush: what a tap plants depends on the spot (willows by water, blossom by
shrines). **Visitors** appear after a grove is done, with a recipe in a thought bubble. Fulfil it
and they move in and the grove's landmark flourishes; ignore them and nothing happens. Tapping a
visitor makes the tiles that could answer it shimmer, which is the only "hint" in the system.

## 5b. Endless mode

The archipelago never runs out, but it should never feel like a treadmill either:

- **Identity per island, not per number.** Each theme is one data entry (`world/themes.ts`): palette,
  plants, landmarks, sky tint, musical key, ambience and drifting motes. Themes rotate without
  repeating back to back; islands grow slowly up to Lanternfell's size.
- **Same verbs, new textures.** No new mechanics arrive in endless mode. Rain, seeds, springs,
  kinships and visitors all carry over, and each theme recolours them (palms by the water on an
  oasis, gardens around an igloo).
- **Small, finite collections.** Ten far-island wonders, tied to themes and kinships, so there's
  always something to look for and nothing to grind.
- **Bounded cost.** Only the authored islands and the four newest far islands stay loaded; older
  ones settle into the journal. Draw calls, memory and the save stay flat however far you go.

## 6. Art direction

- Soft low-poly dioramas on hex columns with tiny gaps between tiles, so each tile reads as an object.
- Palette: dry state is warm ash (#b8afa3) with umber soil sides. The living palette is sage, moss,
  butter, blush, lavender and sea-glass. Nothing is fully saturated.
- A global grade adds saturation and warmth with progress, so the whole world, sky included, comes alive.
- Tilt-shift blur (focus band follows the cloud), vignette, film grain, gentle fog, soft shadows.
- The camera uses a narrow FOV from high up, for the miniature look.

## 7. Sound direction

- **Music**: generative, in D major pentatonic over a slow I–vi–IV–V-ish progression
  (Dmaj9 / Bm11 / Gmaj7 / A6sus) at 72 bpm. Layers: pad (always), sub drone (after first grove),
  generative celesta (density follows player activity), and soft chord swells on completion. Player
  notes are quantized in **pitch** (chord tones, a stepwise random-walk melody) and in **time**
  (next 16th note), so they can't sound wrong.
- **SFX**: rain is band-passed noise with intensity following the cloud. Droplet *plips* are tiny
  pitch-dropping sines. Bloom is a soft *thup* plus a pitched mallet whose timbre varies per biome
  (marimba, kalimba, glass bell, celesta). There are woody seed *toks*, river gurgles and a chime
  arpeggio on completion.
- **Ambience** changes with the world: wind and sea at the start, birdsong rising with life,
  frogs near water, crickets at dusk.

## 8. Feel rules

- No linear tweens. Every animated value is a damped spring (stiffness/damping tunable live) or a
  hand-tuned overshoot curve.
- Every action is layered: pop + particles + camera + sound.
- Forgiving input: a wide rain disc, a magnet toward nearly-complete tiles, grove auto-completion,
  and taps that snap to the nearest tile centre.
- Procedural variation: pitch, timbre, decor placement, petal colours, cloud wobble and pop
  strength all jitter per event.

## 9. UI

Almost none. A small grove/island progress flower in the corner and five quiet icon buttons
(journal, photo, zen, sound, settings) that fade out when idle. No text tutorials: a pulsing drop
under the first tile and a ghost hand teach "hold". Keys: `Z` zen, `P` photo, `J` journal, `M` mute,
`` ` `` debug panel.
