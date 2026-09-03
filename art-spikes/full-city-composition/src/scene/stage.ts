import * as THREE from "three";

/**
 * Camera, light and atmosphere.
 *
 * The camera angle is fixed; only the focus point and the frustum height move.
 * This is an eagle-view strategy framing, so the composition is authored once
 * and everything in the city is placed to read from exactly this angle — the
 * same reason a game locks its build camera. District framing is therefore a
 * dolly and a zoom, never an orbit, which keeps every authored silhouette
 * correct at every framing.
 *
 * Lighting is three layers: a warm low sun for long readable shadows, a sky
 * gradient environment map that fills the shaded sides so nothing goes muddy,
 * and a hemisphere term for the ground bounce that makes the coastal light feel
 * open rather than studio-lit.
 */

export const VIEW = { width: 1440, height: 900 } as const;

/** Sun azimuth/elevation chosen so the sawtooth roof self-shadows and the street reads. */
const SUN_AZIMUTH = THREE.MathUtils.degToRad(128);
const SUN_ELEVATION = THREE.MathUtils.degToRad(27);
const SUN_DISTANCE = 60;

/** Three-quarter strategy framing. */
const CAM_AZIMUTH = THREE.MathUtils.degToRad(45);
const CAM_ELEVATION = THREE.MathUtils.degToRad(31);
const CAM_DISTANCE = 220;
/** Vertical world units visible. Tuned so the city fills the 1440x900 frame. */
export const CITY_FRUSTUM = Number(new URLSearchParams(location.search).get("fh") ?? 95);
/** Where the default view is aimed. */
export const CITY_FOCUS = new THREE.Vector3(-2, 6, -28);

export type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  sun: THREE.DirectionalLight;
  focus: THREE.Vector3;
  resize: (width: number, height: number) => void;
  /** Dolly and zoom to a framing. The view angle never changes. */
  frame: (at: THREE.Vector3, frustumHeight: number) => void;
};

/**
 * Vertical sky gradient, used both as the visible backdrop and, through PMREM,
 * as the image-based fill light. Generated in a canvas so the spike downloads
 * nothing.
 */
function skyTexture(): THREE.DataTexture | THREE.CanvasTexture {
  const w = 8;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0.0, "#4f8fd6"); // zenith
  gradient.addColorStop(0.42, "#a8cdf0");
  gradient.addColorStop(0.56, "#e4eaf2"); // haze band at the horizon
  gradient.addColorStop(0.6, "#f6e5cd"); // warm coastal horizon
  gradient.addColorStop(0.75, "#c8b9a4"); // ground bounce
  gradient.addColorStop(1.0, "#8d8271");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function placeOnSphere(target: THREE.Object3D, azimuth: number, elevation: number, distance: number) {
  target.position.set(
    Math.cos(elevation) * Math.sin(azimuth) * distance,
    Math.sin(elevation) * distance,
    Math.cos(elevation) * Math.cos(azimuth) * distance,
  );
}

export function createStage(mount: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true, // capture harness reads pixels back
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(VIEW.width, VIEW.height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const sky = skyTexture();
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const environment = pmrem.fromEquirectangular(sky).texture;
  scene.environment = environment;
  scene.environmentIntensity = 1.15;
  scene.background = sky;
  pmrem.dispose();

  // Distance haze. Fog is measured from the camera, and an orthographic camera
  // parked 220 units back means the city itself already sits at ~200. The near
  // plane therefore has to start past the city, not past the origin, or the
  // subject gets hazed along with the horizon.
  scene.fog = new THREE.Fog(new THREE.Color("#d3e2f0"), 252, 350);

  // Aimed at the middle of the composition: the boulevard junction, with the
  // core behind it, the forge to the left and the quarter in the foreground.
  const focus = CITY_FOCUS.clone();

  let aspect = VIEW.width / VIEW.height;
  let halfH = CITY_FRUSTUM / 2;
  const camera = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 1, 700);
  placeOnSphere(camera, CAM_AZIMUTH, CAM_ELEVATION, CAM_DISTANCE);
  camera.position.add(focus);
  camera.lookAt(focus);
  camera.updateProjectionMatrix();

  // ------------------------------------------------------------------ sun
  // Dialled back from the first pass and paired with much stronger sky fill.
  // A hot key against weak ambient is what made shadows read as black cut-outs;
  // the sun now shapes the forms and the sky keeps the shadow side in colour.
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.5);
  placeOnSphere(sun, SUN_AZIMUTH, SUN_ELEVATION, SUN_DISTANCE);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 320;
  // Wide enough to cover the whole authored city at the default framing. At
  // 4096 that is roughly 5cm per texel, which still resolves a kerb.
  const shadowExtent = 105;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 4.2; // wider PCF kernel: soft edges, no hard cut line
  sun.target.position.copy(focus);
  scene.add(sun);
  scene.add(sun.target);

  // Sky fill and warm ground bounce, so shadowed faces keep their colour.
  const hemi = new THREE.HemisphereLight(0xbcd8f5, 0xc0a582, 1.45);
  scene.add(hemi);

  // A cool rim from behind separates the roofline from the sky.
  const rim = new THREE.DirectionalLight(0xcfe2ff, 0.55);
  rim.position.set(-24, 14, -22);
  scene.add(rim);

  const sunOffset = sun.position.clone();

  function applyFrustum() {
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  function resize(width: number, height: number) {
    aspect = width / height;
    applyFrustum();
    renderer.setSize(width, height);
  }

  /**
   * The shadow camera travels with the focus. Without this, framing a district
   * at the edge of the plan would walk the whole city out of the shadow map.
   */
  function frame(at: THREE.Vector3, frustumHeight: number) {
    focus.copy(at);
    halfH = frustumHeight / 2;
    placeOnSphere(camera, CAM_AZIMUTH, CAM_ELEVATION, CAM_DISTANCE);
    camera.position.add(focus);
    camera.lookAt(focus);
    applyFrustum();
    sun.position.copy(sunOffset).add(focus);
    sun.target.position.copy(focus);
    sun.target.updateMatrixWorld();
    const extent = Math.max(34, frustumHeight * 0.94);
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.updateProjectionMatrix();
  }

  return { renderer, scene, camera, sun, focus, resize, frame };
}
