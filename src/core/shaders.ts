// Global uniforms + material patches shared across the scene.
import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uCloud: { value: new THREE.Vector4(0, 0, 2, 0) }, // x, z, radius, rain amount
  uNight: { value: 0 },
  uGlow: { value: 0 }, // bloom glow at night for flowers
};

/** Adds wind sway to an (instanced) material using the `aSway` attribute. */
export function patchSway(mat: THREE.Material, glowAttr = false) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uWind = U.uWind;
    sh.uniforms.uNight = U.uNight;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aSway;
         uniform float uTime;
         uniform float uWind;
         ${glowAttr ? 'varying float vGlowY;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vec3 ip = vec3(0.0);
           #ifdef USE_INSTANCING
             ip = instanceMatrix[3].xyz;
           #endif
           float ph = ip.x * 0.63 + ip.z * 0.41;
           float gust = 0.6 + 0.4 * sin(uTime * 0.35 + ip.x * 0.08);
           float sx = sin(uTime * 1.9 + ph) * 0.6 + sin(uTime * 3.7 + ph * 1.7) * 0.25;
           float sz = cos(uTime * 1.6 + ph * 1.3) * 0.45;
           transformed.x += sx * aSway * uWind * gust;
           transformed.z += sz * aSway * uWind * gust;
         }
         ${glowAttr ? 'vGlowY = position.y;' : ''}`,
      );
    if (glowAttr) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uNight;\nvarying float vGlowY;`)
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           totalEmissiveRadiance += diffuseColor.rgb * uNight * 0.9 * smoothstep(0.12, 0.24, vGlowY);`,
        );
    }
  };
}

/** Terrain cap material: soft cloud-shadow decal that hugs every terrace. */
export function patchCap(mat: THREE.Material) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCloud = U.uCloud;
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nattribute float aDry;\nvarying float vDry;\nvarying float vTop;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vec4 wp = vec4(transformed, 1.0);
           #ifdef USE_INSTANCING
             wp = instanceMatrix * wp;
           #endif
           vWPos = (modelMatrix * wp).xyz;
           vDry = aDry;
           vTop = step(0.95, normal.y);
         }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying float vDry;
        varying float vTop;
        uniform vec4 uCloud;
        uniform float uTime;
        vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        float cracks(vec2 p) {
          vec2 n = floor(p), f = fract(p);
          float d1 = 8.0, d2 = 8.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = h22(n + g);
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          return sqrt(d2) - sqrt(d1);
        }`)
      .replace(
        '#include <opaque_fragment>',
        `{
           // parched, cracked earth on dry tiles — it heals as the tile blooms
           float cr = cracks(vWPos.xz * 2.6);
           float line = 1.0 - smoothstep(0.02, 0.09, cr);
           float fine = 1.0 - smoothstep(0.01, 0.05, cracks(vWPos.xz * 6.0 + 3.7));
           outgoingLight *= 1.0 - (line * 0.22 + fine * 0.1) * vDry * vTop;
           float d = length(vWPos.xz - uCloud.xy);
           float r = uCloud.z;
           float sh = (1.0 - smoothstep(r * 0.35, r * 1.05, d));
           float ring = smoothstep(r * 0.82, r * 0.98, d) * (1.0 - smoothstep(r * 0.98, r * 1.1, d));
           outgoingLight *= 1.0 - sh * (0.1 + 0.12 * uCloud.w);
           outgoingLight += vec3(0.9, 0.95, 1.0) * ring * 0.05 * (0.4 + uCloud.w);
         }
         #include <opaque_fragment>`,
      );
  };
}

/** Water discs (ponds, rivers): shimmering highlights. */
export function patchWater(mat: THREE.Material) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uNight = U.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vec4 wp = vec4(transformed, 1.0);
           #ifdef USE_INSTANCING
             wp = instanceMatrix * wp;
           #endif
           vWPos = (modelMatrix * wp).xyz;
         }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\nuniform float uNight;`)
      .replace(
        '#include <opaque_fragment>',
        `{
           vec2 p = vWPos.xz * 2.2;
           float w = sin(p.x + uTime * 1.3) * sin(p.y * 1.3 - uTime * 1.1) + sin((p.x + p.y) * 0.7 + uTime * 0.8);
           float hl = smoothstep(1.15, 1.5, w);
           outgoingLight += vec3(1.0) * hl * (0.22 - uNight * 0.1);
           outgoingLight += vec3(0.3, 0.5, 0.7) * uNight * 0.08;
         }
         #include <opaque_fragment>`,
      );
  };
}
