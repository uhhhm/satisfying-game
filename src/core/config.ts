// Every feel parameter lives here so the debug panel can tune it live.
export const CFG = {
  // Tile pop
  tileK: 260, // spring stiffness for tile hop
  tileC: 11, // damping
  tilePopImpulse: 3.2, // upward velocity on bloom
  tileStageImpulse: 1.6,
  tileSquash: 0.12, // xz squash relative to velocity
  colorK: 60,
  colorC: 11,

  // Decor
  decorK: 210,
  decorC: 13,
  decorStagger: 0.055,
  windSway: 1,

  // Rain / moisture
  rainRadius: 1.75,
  rainRadiusMax: 2.7,
  chargeTime: 3.5, // seconds to reach max radius while holding
  rainRate: 1.25, // moisture/sec at centre
  livingRateMul: 0.55, // slower growth after a tile is alive
  magnetBoost: 1.8, // extra rate for tiles that are > 60% wet
  spreadRate: 0.018, // living tiles slowly wet dry neighbours
  stage2: 2.2,
  stage3: 3.8,
  regionAutoComplete: 0.84,
  dropsPerSec: 140,

  // Cloud
  cloudK: 55,
  cloudC: 10.5,
  puffK: 90,
  puffC: 9,
  cloudHeight: 4.2,

  // Camera
  camKick: 0.06,
  camFollow: 0.28,
  fov: 26,

  // Particles
  petalCount: 14,
  sparkleCount: 10,
  splashCount: 2,

  // Post
  tiltShift: 1,
  tiltBand: 0.16,
  grain: 0.035,
  vignette: 0.32,

  // Audio
  masterVol: 0.8,
  musicVol: 0.7,
  sfxVol: 0.85,
  ambVol: 0.7,

  // Debug
  timeScale: 1,
  showFps: false,
};
export type Config = typeof CFG;
