import * as THREE from "three";

/**
 * Camera, light and atmosphere.
 *
 * The camera is deliberately fixed. This is an eagle-view strategy framing, so
 * the composition is authored once and everything in the block is placed to
 * read from exactly this angle — the same reason a game locks its build camera.
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
const CAM_DISTANCE = 150;
/** Vertical world units visible. Tuned so the block fills the 1440x900 frame. */
const FRUSTUM_HEIGHT = Number(new URLSearchParams(location.search).get("fh") ?? 34);

export type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  sun: THREE.DirectionalLight;
  focus: THREE.Vector3;
  resize: (width: number, height: number) => void;
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
  scene.environmentIntensity = 0.85;
  scene.background = sky;
  pmrem.dispose();

  // Distance haze. Deliberately weak and starting well past the lot — it exists
  // to separate the far skyline from the block, not to tint the subject.
  scene.fog = new THREE.Fog(new THREE.Color("#cfe0ef"), 150, 320);

  // Aimed at the middle of the lot rather than the world origin, so the block
  // sits centre-frame with the street below it and the water behind.
  const focus = new THREE.Vector3(-1.2, 3.4, -3.4);

  const aspect = VIEW.width / VIEW.height;
  const halfH = FRUSTUM_HEIGHT / 2;
  const halfW = halfH * aspect;
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 400);
  placeOnSphere(camera, CAM_AZIMUTH, CAM_ELEVATION, CAM_DISTANCE);
  camera.position.add(focus);
  camera.lookAt(focus);
  camera.updateProjectionMatrix();

  // ------------------------------------------------------------------ sun
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.1);
  placeOnSphere(sun, SUN_AZIMUTH, SUN_ELEVATION, SUN_DISTANCE);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  const shadowExtent = 34;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 2.1;
  sun.target.position.copy(focus);
  scene.add(sun);
  scene.add(sun.target);

  // Sky fill and warm ground bounce, so shadowed faces keep their colour.
  const hemi = new THREE.HemisphereLight(0xbcd8f5, 0xb59a72, 0.9);
  scene.add(hemi);

  // A cool rim from behind separates the roofline from the sky.
  const rim = new THREE.DirectionalLight(0xcfe2ff, 0.55);
  rim.position.set(-24, 14, -22);
  scene.add(rim);

  function resize(width: number, height: number) {
    const a = width / height;
    camera.left = -halfH * a;
    camera.right = halfH * a;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  return { renderer, scene, camera, sun, focus, resize };
}
