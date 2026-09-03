import * as THREE from "three";

import { createStage, VIEW } from "./scene/stage";
import { applySurfaceDetail } from "./scene/materials";
import { createLot, disposeLot, type Lot, type LotState } from "./city/lot";

/**
 * Spike entry point.
 *
 * Renders one Offer Forge lot at a fixed strategy camera and swaps its state.
 * The camera never moves — not in the stills and not in the video — so any
 * motion you see in the recording is the world moving, not a drifting lens.
 *
 * The render loop is frame-indexed rather than clock-driven: the harness calls
 * `__renderFrame(i)` and gets the same image for the same `i` every time.
 */

const STATES: LotState[] = ["dormant", "rising", "healthy", "struggling"];
const SEED = 20260903;
const FPS = 30;
const DWELL_SECONDS = 3;

const params = new URLSearchParams(location.search);
const bare = params.get("bare") === "1";
if (bare) document.body.dataset.bare = "1";

const mount = document.getElementById("stage")!;
const stage = createStage(mount);

// Procedural maps are generated into canvases, so this runs after the document
// exists but before the first lot is built.
applySurfaceDetail();

let current: Lot | null = null;
let currentState: LotState = (params.get("state") as LotState) ?? "healthy";

/** Time the stills are posed at: far enough in that actors are mid-action. */
const STILL_T = 1.6;

function setState(state: LotState): void {
  if (current) {
    stage.scene.remove(current.group);
    disposeLot(current);
  }
  current = createLot({ seed: SEED, district: "offer-forge", archetype: "maker-block", state });
  stage.scene.add(current.group);
  currentState = state;
  renderButtons();
  current.update(STILL_T);
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
let silhouetteMode = false;
const originalBackground = stage.scene.background;

const api = {
  __ready: true,
  __states: STATES,
  __setState: (state: LotState) => setState(state),

  /** The authored framing, posed mid-action. Used for the four stills. */
  __renderStill: () => {
    current?.update(STILL_T);
    stage.renderer.render(stage.scene, stage.camera);
  },

  /**
   * Deterministic frame render.
   *
   * Frame index drives which state is shown and how far into its dwell we are.
   * No Date.now() anywhere, so two runs produce identical footage.
   */
  __renderFrame: (frame: number) => {
    const dwellFrames = DWELL_SECONDS * FPS;
    const index = Math.floor(frame / dwellFrames) % STATES.length;
    const wanted = STATES[index];
    if (wanted !== currentState) setState(wanted);

    // Seconds since this state appeared. Actors animate against this, so the
    // motion restarts cleanly at each state change and stays reproducible.
    const t = (frame % dwellFrames) / FPS;
    current?.update(t);
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
   * Ground, creek, neighbours and props are hidden: with them in, every pixel
   * is black and the test proves nothing.
   */
  __silhouette: (on: boolean) => {
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
(window as unknown as Record<string, unknown>).__scene = stage.scene;

// Interactive loop. Capture drives frames itself and never enters here.
if (!bare) {
  let raf = 0;
  const start = performance.now();
  const tick = () => {
    if (!silhouetteMode) {
      current?.update((performance.now() - start) / 1000);
      stage.renderer.render(stage.scene, stage.camera);
    }
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
