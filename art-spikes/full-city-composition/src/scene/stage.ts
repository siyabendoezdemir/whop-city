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

/**
 * The shadow volume. Fixed in world space, once, and never touched again.
 *
 * It used to be rebuilt on every camera move: the sun rode along with the
 * focus and the orthographic bounds were rescaled to the frustum height. Both
 * remap every texel in the shadow map to a different patch of world on every
 * frame, so during a dolly or a zoom the entire shadow pattern re-quantises and
 * the whole city shimmers. A shadow map has to be welded to the world, not to
 * the camera.
 *
 * The extent is sized from the union of the ground footprints of all four
 * framings. Light-space X is a horizontal axis, so raising a point does not
 * change it, and every caster stands on ground inside that footprint — height
 * only costs light-space Y, which is the smaller of the two axes anyway. The
 * measured requirement is 106 x 64; this is square at 118 so the texels stay
 * isotropic and the PCF kernel does not smear along one axis.
 *
 * 236 world units across a 4096 map is 5.8cm per texel, against 4.4cm at the
 * old default framing. That is the price of the fix, and it is the right trade:
 * slightly coarser shadows everywhere beats correct shadows that crawl.
 */
const SHADOW_ANCHOR = new THREE.Vector3(-8, 26, -29);
const SHADOW_EXTENT = 118;
/** How far back along the sun axis the shadow camera sits. */
const SHADOW_DISTANCE = 280;
const SHADOW_NEAR = 40;
const SHADOW_FAR = 560;

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

function onSphere(azimuth: number, elevation: number, distance: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth) * distance,
    Math.sin(elevation) * distance,
    Math.cos(elevation) * Math.cos(azimuth) * distance,
  );
}

function placeOnSphere(target: THREE.Object3D, azimuth: number, elevation: number, distance: number) {
  target.position.copy(onSphere(azimuth, elevation, distance));
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

  // World-fixed, because it is the sun. The direction is unchanged from before
  // — the light is simply anchored to a point in the city and pushed far enough
  // back along its own axis that the whole world sits inside the depth range.
  const sunAxis = onSphere(SUN_AZIMUTH, SUN_ELEVATION, 1);
  sun.position.copy(SHADOW_ANCHOR).addScaledVector(sunAxis, SHADOW_DISTANCE);
  sun.target.position.copy(SHADOW_ANCHOR);

  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = SHADOW_NEAR;
  sun.shadow.camera.far = SHADOW_FAR;
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.bias = -0.0012;
  // Scaled with the texel: the fixed volume has coarser texels than the old
  // zoomed-in dynamic one, and too small a normal bias shows as acne on the
  // sunlit roof pitches.
  sun.shadow.normalBias = 0.09;
  sun.shadow.radius = 4.2; // wider PCF kernel: soft edges, no hard cut line
  scene.add(sun);
  scene.add(sun.target);
  sun.target.updateMatrixWorld();
  sun.shadow.camera.updateProjectionMatrix();
  // Nothing below is allowed to touch any of the above again.

  // Sky fill and warm ground bounce, so shadowed faces keep their colour.
  const hemi = new THREE.HemisphereLight(0xbcd8f5, 0xc0a582, 1.45);
  scene.add(hemi);

  // A cool rim from behind separates the roofline from the sky.
  const rim = new THREE.DirectionalLight(0xcfe2ff, 0.55);
  rim.position.set(-24, 14, -22);
  scene.add(rim);

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
   * Dolly and zoom to a framing.
   *
   * This moves the render camera and nothing else. The sun and its shadow
   * camera are deliberately absent: they are world-fixed, and reaching in here
   * to nudge them is what made the shadows swim.
   */
  function frame(at: THREE.Vector3, frustumHeight: number) {
    focus.copy(at);
    halfH = frustumHeight / 2;
    placeOnSphere(camera, CAM_AZIMUTH, CAM_ELEVATION, CAM_DISTANCE);
    camera.position.add(focus);
    camera.lookAt(focus);
    applyFrustum();
  }

  return { renderer, scene, camera, sun, focus, resize, frame };
}
