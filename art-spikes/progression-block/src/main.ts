import * as THREE from "three";

import { createStage, VIEW } from "./scene/stage";
import { createLot, disposeLot, type Lot, type LotState } from "./city/lot";

/**
 * Spike entry point.
 *
 * Renders one Offer Forge lot at a fixed strategy camera and swaps its state.
 * There is no UI beyond a state switcher, and that hides under `?bare=1` so the
 * capture harness photographs nothing but the world.
 *
 * The render loop is frame-indexed rather than clock-driven: the harness calls
 * `__renderFrame(i)` and gets the same image for the same `i` every time, which
 * is what makes the screenshots and the video reproducible.
 */

const STATES: LotState[] = ["dormant", "rising", "healthy", "struggling"];
const SEED = 20260903;

const params = new URLSearchParams(location.search);
const bare = params.get("bare") === "1";
if (bare) document.body.dataset.bare = "1";

const mount = document.getElementById("stage")!;
const stage = createStage(mount);

let current: Lot | null = null;
let currentState: LotState = (params.get("state") as LotState) ?? "healthy";

function setState(state: LotState): void {
  if (current) {
    stage.scene.remove(current.group);
    disposeLot(current);
  }
  current = createLot({ seed: SEED, district: "offer-forge", archetype: "maker-block", state });
  stage.scene.add(current.group);
  currentState = state;
  renderButtons();
  // Stills use the authored framing exactly; only the video applies a sway.
  stage.camera.clearViewOffset();
  stage.camera.updateProjectionMatrix();
  stage.renderer.render(stage.scene, stage.camera);
}

// --------------------------------------------------------------- switcher UI
const switcher = document.getElementById("switcher")!;
function renderButtons(): void {
  switcher.replaceChildren(
    ...STATES.map((state) => {
      const button = document.createElement("button");
      button.textContent = state;
      button.setAttribute("aria-pressed", String(state === currentState));
      button.dataset.state = state;
      button.addEventListener("click", () => setState(state));
      return button;
    }),
  );
}

setState(currentState);

// ------------------------------------------------------------ capture hooks
type CaptureApi = {
  __ready: boolean;
  __states: LotState[];
  __setState: (state: LotState) => void;
  __renderFrame: (frame: number) => void;
  __info: () => { triangles: number; calls: number; instances: number; prototypes: number; textures: number; geometries: number };
  __silhouette: (on: boolean) => void;
};

let silhouetteMode = false;
const originalBackground = stage.scene.background;

const api: CaptureApi = {
  __ready: true,
  __states: STATES,
  __setState: (state) => setState(state),

  /**
   * Deterministic frame render.
   *
   * Frame index drives the whole cycle: which state is shown and how far into
   * its dwell we are. No Date.now(), so two runs produce identical footage.
   */
  __renderFrame: (frame) => {
    const FPS = 30;
    const DWELL = 3 * FPS; // 3s per state -> 12s for the cycle
    const index = Math.floor(frame / DWELL) % STATES.length;
    const wanted = STATES[index];
    if (wanted !== currentState) setState(wanted);

    // A slow orbital drift so the video has parallax without moving the
    // composition off its authored framing.
    const t = (frame % (DWELL * STATES.length)) / (DWELL * STATES.length);
    const sway = Math.sin(t * Math.PI * 2) * 0.6;
    stage.camera.position.x += 0;
    stage.camera.setViewOffset(VIEW.width, VIEW.height, sway * 6, 0, VIEW.width, VIEW.height);
    stage.camera.updateProjectionMatrix();

    stage.renderer.render(stage.scene, stage.camera);
  },

  __info: () => ({
    triangles: stage.renderer.info.render.triangles,
    calls: stage.renderer.info.render.calls,
    instances: current?.stats.instances ?? 0,
    prototypes: current?.stats.prototypes ?? 0,
    textures: stage.renderer.info.memory.textures,
    geometries: stage.renderer.info.memory.geometries,
  }),

  /**
   * Flat-black render of the lot's architecture against white.
   *
   * Ground, creek and neighbours are hidden: with them in, every pixel is black
   * and the test proves nothing. What is left is the thing that has to be
   * recognisable as a shape — the street unit, the vent stack, the gantry and
   * whatever the workshop currently is.
   */
  __silhouette: (on) => {
    silhouetteMode = on;
    const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const context = ["ground", "creek", "neighbours"];

    for (const child of current?.group.children ?? []) {
      const isContext = context.some((name) => child.name.startsWith(name));
      const isProps = child.name.startsWith("props");
      child.visible = on ? !isContext && !isProps : true;
    }

    stage.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh && !(child as THREE.InstancedMesh).isInstancedMesh) return;
      const record = mesh as unknown as { __mat?: THREE.Material | THREE.Material[] };
      if (on) {
        if (!record.__mat) record.__mat = mesh.material;
        mesh.material = black;
      } else if (record.__mat) {
        mesh.material = record.__mat;
        delete record.__mat;
      }
    });

    stage.scene.background = on ? new THREE.Color(0xffffff) : originalBackground;
    stage.scene.fog = on ? null : new THREE.Fog(new THREE.Color("#cfe0ef"), 150, 320);
    stage.renderer.render(stage.scene, stage.camera);
  },
};

Object.assign(window, api);

// Idle render loop for interactive use only; capture calls __renderFrame itself.
if (!bare) {
  let raf = 0;
  const tick = () => {
    if (!silhouetteMode) stage.renderer.render(stage.scene, stage.camera);
    raf = requestAnimationFrame(tick);
  };
  tick();
  window.addEventListener("beforeunload", () => cancelAnimationFrame(raf));
}

window.addEventListener("resize", () => {
  // Fixed proof resolution; only scale the element so the canvas stays 1440x900.
  const scale = Math.min(window.innerWidth / VIEW.width, window.innerHeight / VIEW.height, 1);
  stage.renderer.domElement.style.width = `${VIEW.width * scale}px`;
  stage.renderer.domElement.style.height = `${VIEW.height * scale}px`;
});
window.dispatchEvent(new Event("resize"));
