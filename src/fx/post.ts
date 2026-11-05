// Post: render → tone map → tilt-shift + grade + vignette + grain in one pass.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: 0.5 },
    uBand: { value: 0.16 },
    uAmount: { value: 1 },
    uSat: { value: 1 },
    uWarm: { value: 0 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.03 },
    uTime: { value: 0 },
    uFilter: { value: 0 },
    uFlash: { value: 0 },
    uExposure: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uFocus, uBand, uAmount, uSat, uWarm, uVignette, uGrain, uTime, uFilter, uFlash, uExposure;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      float dy = abs(vUv.y - uFocus);
      float b = smoothstep(uBand, uBand + 0.38, dy) * uAmount;
      vec2 px = 1.0 / uRes;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (b > 0.01) {
        vec3 acc = col;
        float wsum = 1.0;
        float rad = b * 7.0;
        for (int i = 0; i < 16; i++) {
          float fi = float(i);
          float r = sqrt((fi + 0.5) / 16.0) * rad;
          float a = fi * 2.39996;
          vec2 o = vec2(cos(a), sin(a)) * r * px;
          vec3 s = texture2D(tDiffuse, vUv + o).rgb;
          float w = 1.0 + dot(s, vec3(0.3)) * 0.6; // slight bokeh bias toward highlights
          acc += s * w;
          wsum += w;
        }
        col = acc / wsum;
      }
      col *= uExposure;
      // grade
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col += vec3(0.035, 0.012, -0.03) * uWarm;
      // filters (photo mode)
      if (uFilter > 0.5 && uFilter < 1.5) { // warm film
        col = mix(col, col * vec3(1.08, 0.98, 0.86) + vec3(0.03, 0.02, 0.0), 0.8);
        col = mix(vec3(l), col, 0.9);
      } else if (uFilter > 1.5 && uFilter < 2.5) { // dreamy
        col = mix(col, col * vec3(0.92, 0.98, 1.08) + 0.06, 0.8);
      } else if (uFilter > 2.5) { // soft mono
        float m = dot(col, vec3(0.3, 0.59, 0.11));
        col = vec3(m) * vec3(1.03, 1.0, 0.95);
      }
      // soft lift of shadows (pastel)
      col = col * 0.96 + 0.025;
      // vignette
      vec2 q = vUv - 0.5;
      float v = 1.0 - dot(q, q) * uVignette * 2.2;
      col *= v;
      col += uFlash;
      // grain
      float g = hash(vUv * uRes + fract(uTime) * 100.0) - 0.5;
      col += g * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  composer: EffectComposer;
  finish: ShaderPass;
  constructor(public renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples = 4) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
  }
  get u() {
    return this.finish.uniforms;
  }
  setSize(w: number, h: number, pr: number) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.u.uRes.value.set(w * pr, h * pr);
  }
  render() {
    this.composer.render();
  }
}
