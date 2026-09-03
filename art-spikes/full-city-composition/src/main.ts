import * as THREE from "three";

import { buildCity, disposeCity, type City } from "./city/city";
import { applySurfaceDetail } from "./scene/materials";
import { CITY_FOCUS, CITY_FRUSTUM, VIEW, createStage } from "./scene/stage";

/**
 * Full-city composition spike.
 *
 * Builds one contiguous waterfront city once, then moves a fixed-angle camera
 * between framings. Nothing is fetched, nothing is loaded from disk: all
 * geometry is authored in code and all textures are drawn into canvases at boot.
 */

const params = new URLSearchParams(location.search);
const bare = params.has("bare");
if (bare) document.body.dataset.bare = "1";

const mount = document.getElementById("stage")!;
const stage = createStage(mount);
applySurfaceDetail();

/** Camera framings. The angle is fixed; only focus and zoom change. */
export const FRAMINGS = {
  city: { focus: CITY_FOCUS.clone(), height: CITY_FRUSTUM, label: "Whop City" },
  commerce: { focus: new THREE.Vector3(6, 10, -50), height: 60, label: "Commerce Core" },
  forge: { focus: new THREE.Vector3(-46, 5, -10), height: 52, label: "Offer Forge" },
  creator: { focus: new THREE.Vector3(20, 4, 8), height: 62, label: "Creator Quarter" },
} as const;

export type FramingKey = keyof typeof FRAMINGS;
const ORDER: FramingKey[] = ["city", "commerce", "forge", "creator"];

const city: City = buildCity();
stage.scene.add(city.group);

let framing: FramingKey = "city";
let zoomBias = 1;

function applyFraming(key: FramingKey, t = 1): void {
  const f = FRAMINGS[key];
  stage.frame(f.focus, f.height * zoomBias);
  city.update(t);
}

applyFraming("city", 0);

// --------------------------------------------------------------- shell wiring
const jump = document.getElementById("jump");
if (jump) {
  for (const key of ORDER) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = FRAMINGS[key].label;
    button.setAttribute("aria-pressed", String(key === framing));
    button.addEventListener("click", () => {
      framing = key;
      zoomBias = 1;
      applyFraming(key, clock);
      for (const other of jump.querySelectorAll("button")) {
        other.setAttribute("aria-pressed", String(other === button));
      }
    });
    jump.appendChild(button);
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("#controls button")) {
  button.addEventListener("click", () => {
    const action = button.dataset.cam;
    if (action === "in") zoomBias = Math.max(0.45, zoomBias - 0.15);
    else if (action === "out") zoomBias = Math.min(1.6, zoomBias + 0.15);
    else zoomBias = 1;
    applyFraming(framing, clock);
  });
}

// ------------------------------------------------------------- interactive loop
let clock = 0;
const timer = new THREE.Clock();

function loop(): void {
  clock += timer.getDelta();
  city.update(clock);
  stage.renderer.render(stage.scene, stage.camera);
  requestAnimationFrame(loop);
}

function fit(): void {
  const w = Math.min(window.innerWidth, VIEW.width);
  stage.resize(w, Math.round((w * VIEW.height) / VIEW.width));
}

if (!params.has("capture")) {
  window.addEventListener("resize", fit);
  fit();
  loop();
} else {
  stage.renderer.render(stage.scene, stage.camera);
}

// ------------------------------------------------------------- capture hooks
declare global {
  interface Window {
    __ready: boolean;
    __framings: string[];
    __frame: (key: string, t?: number, zoom?: number) => void;
    __renderFrame: (t: number) => void;
    __flyTo: (key: string, t: number, progress: number, from: string) => void;
    __silhouette: (on: boolean) => void;
    __scene: THREE.Scene;
    __info: () => Record<string, number>;
  }
}

/** One instance for the process, so toggling silhouette mode allocates nothing. */
const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
const originalBackground = stage.scene.background;
const originalFog = stage.scene.fog;
let silhouette = false;

Object.assign(window, {
  __ready: true,
  __framings: ORDER,

  __frame: (key: string, t = 6, zoom = 1) => {
    framing = (key in FRAMINGS ? key : "city") as FramingKey;
    zoomBias = zoom;
    clock = t;
    applyFraming(framing, t);
    stage.renderer.render(stage.scene, stage.camera);
  },

  __renderFrame: (t: number) => {
    clock = t;
    city.update(t);
    stage.renderer.render(stage.scene, stage.camera);
  },

  /**
   * Deterministic fly between two framings. `progress` is 0..1 and is eased, so
   * the recording is reproducible frame for frame rather than time-dependent.
   */
  __flyTo: (key: string, t: number, progress: number, from: string) => {
    const a = FRAMINGS[(from in FRAMINGS ? from : "city") as FramingKey];
    const b = FRAMINGS[(key in FRAMINGS ? key : "city") as FramingKey];
    const e = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    const focus = a.focus.clone().lerp(b.focus, e);
    const height = THREE.MathUtils.lerp(a.height, b.height, e);
    clock = t;
    stage.frame(focus, height);
    city.update(t);
    stage.renderer.render(stage.scene, stage.camera);
  },

  __silhouette: (on: boolean) => {
    silhouette = on;
    stage.scene.background = on ? new THREE.Color("#ffffff") : originalBackground;
    stage.scene.fog = on ? null : originalFog;
    city.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.InstancedMesh)) return;
      const named = child.parent?.name ?? "";
      // Context drops out; only the authored architecture is silhouetted.
      const isContext = named === "city-ground" || named === "surroundings" || named === "props";
      if (isContext) {
        child.visible = !on;
        return;
      }
      if (on) {
        child.userData.material ??= child.material;
        child.material = black;
      } else if (child.userData.material) {
        child.material = child.userData.material;
      }
    });
    stage.renderer.render(stage.scene, stage.camera);
  },

  __info: () => {
    const info = stage.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      parcels: city.stats.parcels,
      propInstances: city.stats.instances,
      silhouette: silhouette ? 1 : 0,
    };
  },
});

// Diagnostics only.
Object.assign(window, { __scene: stage.scene });

export { city, disposeCity, stage };
