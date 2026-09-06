import * as THREE from "three";
import { useEffect, useRef } from "react";

import type { DistrictId, PublicCityProjection } from "../city/projection";
import { buildLots, buildTerrain, type Lots, type Terrain } from "../render/city/city";
import { createWorks, type MarkerKind, type Works } from "../render/city/works";
import { plotSite } from "../game/plots";
import { applySurfaceDetail } from "../render/scene/materials";
import { SUPERSAMPLE_DEFAULT, createStage } from "../render/scene/stage";
import { FRAMING_ORDER, framingFor, type FramingKey } from "./framings";

/**
 * The city viewport.
 *
 * Owns the WebGL context for the life of the page: the stage is created once,
 * and a change of projection rebuilds the world inside it rather than tearing
 * down the renderer. That is the operation the leak check hammers, so the old
 * city's GPU resources have to go back on every rebuild while the shared
 * palette and prop textures survive being reused.
 *
 * The camera angle is fixed at the approved three-quarter framing. Selecting a
 * district glides the focus and the zoom; nothing rotates.
 */

type Props = {
  projection: PublicCityProjection;
  framing: FramingKey;
  /** 1 is the framing's own height; below 1 is closer. */
  zoom: number;
  /**
   * What the player has done in each district. Drawn as a separate mark beside
   * the condition, never instead of it.
   */
  /** Level per building id: what the business has earned and the player took. */
  levels: Readonly<Record<string, number>>;
  /**
   * Which plots are asking for attention, and why. Drawn in the world above
   * the roofline rather than as HTML over the canvas, so the bubbles cannot
   * lag the camera.
   */
  markers: Readonly<Record<string, MarkerKind>>;
  selected: string | null;
  onSelectPlot: (plotId: string) => void;
  /** A district was picked in the world. The shell decides what that means. */
  onSelectDistrict: (districtId: DistrictId) => void;
  /** WebGL could not start. The shell swaps in the readable fallback. */
  onUnavailable: () => void;
};

/** Eased so a scripted fly-through is reproducible frame for frame. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

/** How fast the camera settles on a new framing, in inverse seconds. */
/**
 * How far the camera may roam.
 *
 * The world is an island. These are its shoulders, so a player who flings the
 * camera never ends up staring at empty water wondering where the city went.
 */
const PAN_BOUNDS = { minX: -150, maxX: 150, minZ: -170, maxZ: 120 };
/** Zoom stops. Close enough to read a shopfront, wide enough to see the island. */
const MIN_FRUSTUM = 26;
const MAX_FRUSTUM = 220;

const GLIDE_RATE = 3.2;

/**
 * Render scale.
 *
 * Read from the URL only so the capture harness can pin it; the default is the
 * supersampling factor the aliasing work settled on. Guarded because this
 * component's module is also loaded during server rendering.
 */
function supersampleFromLocation(): number {
  if (typeof location === "undefined") return SUPERSAMPLE_DEFAULT;
  const requested = Number(new URLSearchParams(location.search).get("ss"));
  return Number.isFinite(requested) && requested > 0 ? requested : SUPERSAMPLE_DEFAULT;
}

/** Whether to drive an animation loop, or render single frames on demand. */
function isCaptureMode(): boolean {
  return typeof location !== "undefined" && new URLSearchParams(location.search).has("capture");
}

/**
 * Whether pixels will be read back out of the canvas.
 *
 * Only the capture harness does that, and preserving the drawing buffer to
 * allow it denies the browser the fast swap path, so every presented frame
 * costs a full copy. Off outside capture, where nothing needs it.
 */
function needsReadback(): boolean {
  return isCaptureMode();
}

export function CityCanvas({
  projection,
  framing,
  zoom,
  levels,
  markers,
  selected,
  onSelectPlot,
  onSelectDistrict,
  onUnavailable,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<ReturnType<typeof createStage> | null>(null);
  const terrainRef = useRef<Terrain | null>(null);
  const lotsRef = useRef<Lots | null>(null);

  const worksRef = useRef<Works | null>(null);
  // Held in a ref so the pointer handler, which is installed once, always
  // calls the current one.
  const onSelectPlotRef = useRef(onSelectPlot);
  onSelectPlotRef.current = onSelectPlot;
  // Kept in refs so the animation loop reads the current value without being
  // torn down and restarted on every camera change.
  const viewRef = useRef({ framing, zoom });
  viewRef.current = { framing, zoom };
  // Same reason: the pick handler is installed once and must see current props.
  const selectRef = useRef(onSelectDistrict);
  selectRef.current = onSelectDistrict;
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  // --------------------------------------------------------------- the stage
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let stage: ReturnType<typeof createStage>;
    try {
      stage = createStage(mount, {
        supersample: supersampleFromLocation(),
        preserveDrawingBuffer: needsReadback(),
      });
    } catch {
      // No WebGL, a lost context at construction, or a blocked canvas. The
      // shell has a readable version of the same briefing; hand over to it
      // rather than leaving a blank rectangle where the city should be.
      unavailableRef.current();
      return;
    }
    applySurfaceDetail();
    stageRef.current = stage;

    let clock = 0;
    let raf = 0;
    const timer = new THREE.Clock();

    /**
     * The camera glides.
     *
     * Selecting a district should feel like arriving somewhere, so the focus
     * and the zoom are eased toward the new framing over a beat rather than
     * cutting. Held in the loop's own state, not in React's: a tween that
     * re-rendered the component sixty times a second would rebuild the shell
     * for no reason.
     */
    const held = { focus: new THREE.Vector3(), height: 0 };
    {
      const initial = framingFor(viewRef.current.framing);
      held.focus.set(...initial.focus);
      held.height = initial.height * viewRef.current.zoom;
    }

    /**
     * Where the camera is going.
     *
     * Two ways to set it. Picking a district sets a framing and the camera
     * flies there; dragging or scrolling sets this directly and takes over,
     * because a city you cannot move around is a diorama, not a game. Whoever
     * moved it last wins, and the glide eases toward it either way so both
     * feel like the same camera.
     */
    const want = { focus: held.focus.clone(), height: held.height, free: false };

    let lastZoom = viewRef.current.zoom;
    let lastFraming: string = viewRef.current.framing;

    const glide = (dt: number) => {
      const { framing: key, zoom: bias } = viewRef.current;

      // Choosing a district takes the camera back: you asked to go somewhere,
      // so it flies there even if you had dragged away.
      if (key !== lastFraming) {
        lastFraming = key;
        want.free = false;
      }
      // The zoom buttons drive the same camera the wheel does, so they keep
      // working after a drag instead of quietly doing nothing.
      if (bias !== lastZoom) {
        if (want.free) {
          want.height = THREE.MathUtils.clamp((want.height * bias) / lastZoom, MIN_FRUSTUM, MAX_FRUSTUM);
        }
        lastZoom = bias;
      }

      if (!want.free) {
        const target = framingFor(key);
        want.focus.set(...target.focus);
        want.height = target.height * bias;
      }
      // Exponential approach, framerate-independent. Roughly nine tenths of the
      // way there in three quarters of a second.
      coast(dt);
      const k = 1 - Math.exp(-dt * GLIDE_RATE);
      // Zoom is always eased; position is eased only when flying somewhere,
      // because a drag has already put it exactly where the hand wants it.
      if (!want.free || down.size === 0) held.focus.lerp(want.focus, k);
      held.height += (want.height - held.height) * k;
      stage.frame(held.focus, held.height);
    };

    // ------------------------------------------------------- flying around
    // The camera looks down the 45 degrees the art was composed at and never
    // rotates, so dragging is two fixed directions on the ground: screen right
    // is one, screen up is the other. Clash of Clans does the same — the angle
    // is the art, the position is the player's.
    //
    // Both are read off the camera's own matrix rather than reconstructed from
    // the azimuth. Reconstructing them is how the vertical axis ended up
    // inverted: the hand-written "up" was the negative of the camera's, so
    // dragging down pulled the city up.
    stage.camera.updateMatrixWorld();
    const camRight = new THREE.Vector3().setFromMatrixColumn(stage.camera.matrixWorld, 0).setY(0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(stage.camera.matrixWorld, 1).setY(0);

    /**
     * How far the ground has to move to move the picture by one unit.
     *
     * The camera looks down at the ground, so a metre travelled north is not a
     * metre up the screen — it is `sin(elevation)` of one, about a half at this
     * angle. Ignoring that made a vertical drag move the world at half the
     * speed of the hand while a horizontal drag tracked it exactly, which is
     * the "sluggish, fighting me" feeling that has nothing to do with speed
     * settings: the ground was simply not staying under the cursor.
     */
    const perRight = 1 / Math.max(0.2, camRight.length());
    const perUp = 1 / Math.max(0.2, camUp.length());
    const groundRight = camRight.clone().normalize();
    const groundUp = camUp.clone().normalize();

    /** Keep the city on screen: you may roam the promontory, not the void. */
    const clampFocus = (focus: THREE.Vector3) => {
      focus.x = THREE.MathUtils.clamp(focus.x, PAN_BOUNDS.minX, PAN_BOUNDS.maxX);
      focus.z = THREE.MathUtils.clamp(focus.z, PAN_BOUNDS.minZ, PAN_BOUNDS.maxZ);
      return focus;
    };

    const takeOver = () => {
      if (want.free) return;
      // Start from where the camera actually is, so grabbing it mid-flight
      // does not snap.
      want.focus.copy(held.focus);
      want.height = held.height;
      want.free = true;
    };

    /** Pixels per second, carried after the pointer lifts. */
    const drift = { x: 0, z: 0 };

    const panBy = (dxPixels: number, dyPixels: number) => {
      takeOver();
      // One screen pixel is this many world units at the current zoom.
      const perPixel = held.height / Math.max(1, stage.renderer.domElement.clientHeight);
      const before = want.focus.clone();
      // Grab, not push: the ground under the cursor stays under the cursor, so
      // the camera moves opposite to the hand on both axes.
      want.focus.addScaledVector(groundRight, -dxPixels * perPixel * perRight);
      want.focus.addScaledVector(groundUp, dyPixels * perPixel * perUp);
      clampFocus(want.focus);
      // Direct, not eased: the ground has to stay under the cursor. Easing here
      // is what made dragging feel like pulling the city on a rubber band.
      held.focus.copy(want.focus);
      drift.x = want.focus.x - before.x;
      drift.z = want.focus.z - before.z;
    };

    /** Let go and the city keeps sliding, then settles. */
    const coast = (dt: number) => {
      if (!want.free) return;
      if (Math.abs(drift.x) < 0.004 && Math.abs(drift.z) < 0.004) return;
      if (down.size > 0) return;
      want.focus.x += drift.x;
      want.focus.z += drift.z;
      clampFocus(want.focus);
      held.focus.copy(want.focus);
      const decay = Math.exp(-dt * 5.2);
      drift.x *= decay;
      drift.z *= decay;
    };

    const zoomBy = (factor: number) => {
      takeOver();
      want.height = THREE.MathUtils.clamp(want.height * factor, MIN_FRUSTUM, MAX_FRUSTUM);
    };

    // `down` is declared below the handlers that read it, so the pan helpers
    // above see it through the closure rather than at definition time.

    /**
     * Fit the authored aspect into whatever space there is.
     *
     * The composition is authored for 1440x900 and every framing is tuned to
     * it, so the canvas keeps that ratio and is letterboxed rather than
     * stretched or cropped. Scaling to the smaller of the two axes is what
     * makes the city fill the frame on a viewport of any shape.
     */
    const fit = () => {
      // Fill whatever box the shell gives us. The stage keeps the authored
      // frustum *height* and widens or grows it to match the aspect, so a
      // 21:9 monitor sees more city rather than two black bars, and nothing is
      // ever stretched. Letterboxing to 1440x900 is what left a wide desktop
      // with a small picture in the middle of a black field.
      stage.resize(
        Math.max(320, Math.round(mount.clientWidth || window.innerWidth)),
        Math.max(200, Math.round(mount.clientHeight || window.innerHeight)),
      );
    };

    const loop = () => {
      const dt = timer.getDelta();
      clock += dt;
      glide(dt);
      terrainRef.current?.update(clock);
      lotsRef.current?.update(clock);
      worksRef.current?.update(clock);
      stage.renderer.render(stage.scene, stage.camera);
      raf = requestAnimationFrame(loop);
    };

    // ------------------------------------------------------- picking
    // A district is selected by clicking its marker in the world. The raycast
    // runs against the markers only: the city is one merged mesh per material,
    // so hit-testing the architecture would tell us which *material* was
    // clicked, not which district.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pressedAt: { x: number; y: number } | null = null;

    /**
     * What is under the pointer. Pure.
     *
     * It used to select the plot it found, and the hover handler calls it to
     * decide the cursor — so moving the mouse across a building selected it
     * and flew the camera there. A hit test answers a question; it does not
     * act on the answer.
     */
    type Hit = { kind: "plot"; id: string } | { kind: "district"; id: DistrictId };

    const pickAt = (event: PointerEvent): Hit | null => {
      const rect = stage.renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, stage.camera);
      // Plots are the finer target and win ties: clicking a building the
      // player put up should open that building, not the district around it.
      const plotHits = worksRef.current
        ? raycaster.intersectObjects(worksRef.current.picks, false)
        : [];
      if (plotHits.length > 0) {
        const plotId = plotHits[0].object.userData.plotId as string | undefined;
        if (plotId) return { kind: "plot", id: plotId };
      }

      return null;
    };

    // Pointers currently down, so one finger can drag and two can pinch.
    const down = new Map<number, { x: number; y: number }>();
    let pinchGap = 0;
    let dragged = 0;

    const canvas = stage.renderer.domElement;

    const onPointerDown = (event: PointerEvent) => {
      down.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (down.size === 1) {
        pressedAt = { x: event.clientX, y: event.clientY };
        dragged = 0;
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
      } else if (down.size === 2) {
        const [a, b] = [...down.values()];
        pinchGap = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const wasDragging = dragged;
      down.delete(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = "grab";

      // A click that travelled was someone moving the city, not choosing
      // something in it.
      const start = pressedAt;
      pressedAt = null;
      if (!start || down.size > 0) return;
      if (wasDragging > 6) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;

      // Selection happens here, on a click that did not travel — never in the
      // hover handler.
      const hit = pickAt(event);
      if (hit?.kind === "plot") onSelectPlotRef.current(hit.id);
      else if (hit?.kind === "district") selectRef.current(hit.id);
    };

    const onPointerMove = (event: PointerEvent) => {
      const previous = down.get(event.pointerId);

      if (previous && down.size === 2) {
        // Pinch: the gap between the two fingers is the zoom.
        down.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const [a, b] = [...down.values()];
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchGap > 0 && gap > 0) zoomBy(pinchGap / gap);
        pinchGap = gap;
        dragged += 10;
        return;
      }

      if (previous && event.buttons === 0) {
        // The button came up somewhere we never heard about. Let go.
        down.delete(event.pointerId);
        canvas.style.cursor = "grab";
        return;
      }

      if (previous) {
        const dx = event.clientX - previous.x;
        const dy = event.clientY - previous.y;
        down.set(event.pointerId, { x: event.clientX, y: event.clientY });
        dragged += Math.hypot(dx, dy);
        // A small wobble on the way to a click should not move the city.
        if (dragged > 4) panBy(dx, dy);
        return;
      }

      canvas.style.cursor = pickAt(event) ? "pointer" : "grab";
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Trackpads report small pixel deltas and mice report large ones, so the
      // step is capped rather than proportional — otherwise one mouse notch
      // crosses the whole zoom range.
      const step = Math.sign(event.deltaY) * Math.min(0.3, Math.abs(event.deltaY) / 280);
      zoomBy(1 + step);
    };

    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    window.addEventListener("resize", fit);
    fit();

    // ------------------------------------------------------- capture hooks
    // Used by the capture harness and the browser tests. Not a product API,
    // and nothing here reaches the server or carries business data.
    const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const originalBackground = stage.scene.background;
    const originalFog = stage.scene.fog;

    /** World point to CSS pixels on the canvas. Null in, null out. */
    const project = (world: THREE.Vector3 | null) => {
      if (!world) return null;
      const rect = stage.renderer.domElement.getBoundingClientRect();
      const at = world.clone().project(stage.camera);
      return {
        x: rect.left + ((at.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - at.y) / 2) * rect.height,
      };
    };

    const renderAt = (focus: THREE.Vector3, height: number, t: number) => {
      clock = t;
      stage.frame(focus, height);
      terrainRef.current?.update(t);
      lotsRef.current?.update(t);
      worksRef.current?.update(t);
      stage.renderer.render(stage.scene, stage.camera);
    };

    Object.assign(window, {
      __city: {
        ready: true,
        framings: FRAMING_ORDER,

        frame: (key: string, t = 6, bias = 1) => {
          const f = framingFor(key);
          renderAt(new THREE.Vector3(...f.focus), f.height * bias, t);
        },

        frameAt: (focus: [number, number, number], height: number, t: number) =>
          renderAt(new THREE.Vector3(...focus), height, t),

        flyTo: (to: string, from: string, progress: number, t: number) => {
          const a = framingFor(from);
          const b = framingFor(to);
          const e = ease(progress);
          const focus = new THREE.Vector3(...a.focus).lerp(new THREE.Vector3(...b.focus), e);
          renderAt(focus, THREE.MathUtils.lerp(a.height, b.height, e), t);
        },

        renderFrame: (t: number) => {
          clock = t;
          terrainRef.current?.update(t);
          lotsRef.current?.update(t);
          stage.renderer.render(stage.scene, stage.camera);
        },

        framingTable: () =>
          FRAMING_ORDER.map((key) => ({
            key,
            focus: framingFor(key).focus as unknown as [number, number, number],
            height: framingFor(key).height,
            right: new THREE.Vector3()
              .setFromMatrixColumn(stage.camera.matrixWorld, 0)
              .toArray() as [number, number, number],
            up: new THREE.Vector3().setFromMatrixColumn(stage.camera.matrixWorld, 1).toArray() as [
              number,
              number,
              number,
            ],
          })),

        /**
         * Everything that decides where the shadow map lands in the world. If
         * any of it changes while the camera moves, every texel remaps to a
         * different world position and the whole map shimmers.
         */
        /**
         * Where a district's marker is on screen, in CSS pixels.
         *
        /**
         * Where a plot's marker floats, on screen, in CSS pixels.
         *
         * Rides the measured roofline, so a building growing a storey moves
         * this up the screen. That is what makes it a usable assertion for
         * "the building actually got taller".
         */
        plotPoint: (plotId: string) => project(worksRef.current?.anchor(plotId) ?? null),

        /**
         * Where a plot's ground sits on screen. What to click to select it.
         *
         * Separate from `plotPoint` because they diverge by most of a tower on
         * a grown plot, and a click aimed at the roof of one building lands on
         * the ground of the one behind it.
         */
        plotGround: (plotId: string) => {
          const site = plotSite(plotId);
          return project(new THREE.Vector3(site.x, 1, site.z));
        },

        shadowRig: () => {
          const c = stage.sun.shadow.camera;
          return [
            stage.sun.position.x,
            stage.sun.position.y,
            stage.sun.position.z,
            stage.sun.target.position.x,
            stage.sun.target.position.y,
            stage.sun.target.position.z,
            c.left,
            c.right,
            c.top,
            c.bottom,
            c.near,
            c.far,
          ];
        },

        silhouette: (on: boolean) => {
          stage.scene.background = on ? new THREE.Color("#ffffff") : originalBackground;
          stage.scene.fog = on ? null : originalFog;
          for (const half of [terrainRef.current?.group, lotsRef.current?.group]) half?.traverse((child) => {
            if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.InstancedMesh)) return;
            const named = child.parent?.name ?? "";
            const isContext =
              named === "city-ground" ||
              named === "parcel-ground" ||
              named === "surroundings" ||
              named === "props" ||
              child.parent?.parent?.name === "actors";
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

        /**
         * Every moving thing on the terrain, where it is right now.
         *
         * Exists so a test can step the clock and check that nothing teleports.
         * Traffic used to run a modulo along a single street and switch itself
         * off inside the bridge gap, and "does the car vanish" is not a
         * question a screenshot can answer.
         */
        actors: (t?: number) => {
          // Steps the world without drawing it. Continuity is a property of the
          // motion, not of the pixels, and software-rendering a supersampled
          // city a thousand times to find that out takes minutes.
          if (t !== undefined) terrainRef.current?.update(t);
          return (terrainRef.current?.group.getObjectByName("actors")?.children ?? []).map(
            (child) => ({
              name: child.name,
              visible: child.visible,
              x: child.position.x,
              y: child.position.y,
              z: child.position.z,
            }),
          );
        },

        info: () => {
          const info = stage.renderer.info;
          return {
            drawCalls: info.render.calls,
            triangles: info.render.triangles,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            parcels: lotsRef.current?.stats.parcels ?? 0,
            propInstances: lotsRef.current?.stats.instances ?? 0,
          };
        },

        scene: stage.scene,
      },
    });

    if (!isCaptureMode()) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", fit);
      delete (window as { __city?: unknown }).__city;
      if (worksRef.current) {
        stage.scene.remove(worksRef.current.group);
        worksRef.current.dispose();
        worksRef.current = null;
      }
      black.dispose();
      stage.renderer.dispose();
      mount.removeChild(stage.renderer.domElement);
      stageRef.current = null;
    };
  }, []);

  // ------------------------------------------------------------- the terrain
  // Everything that does not depend on what the player built: the ground, the
  // roads, both bays, the surrounding massing, the traffic. It is most of the
  // geometry in the scene and it is built once. The seed is the only thing
  // that could change it, and the seed is stable per business.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const terrain = buildTerrain(projection.seed);
    terrainRef.current = terrain;
    stage.scene.add(terrain.group);
    terrain.update(0);

    return () => {
      stage.scene.remove(terrain.group);
      terrain.dispose();
      terrainRef.current = null;
    };
  }, [projection.seed]);

  // ----------------------------------------------------------------- the lots
  // The eleven plots and everything standing on them. Rebuilt when a level
  // moves, which is a fraction of the work rebuilding the world used to be.
  const planKey = JSON.stringify(levels);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const lots = buildLots(projection.seed, levels);
    lotsRef.current = lots;
    stage.scene.add(lots.group);

    // The works stand outside both halves: a rebuild must not take the markers
    // and pick targets with it.
    if (!worksRef.current) {
      const works = createWorks(Object.keys(levels), stage.camera);
      worksRef.current = works;
      stage.scene.add(works.group);
    }
    worksRef.current?.apply({ tops: lots.tops, markers, selected });

    const f = framingFor(viewRef.current.framing);
    stage.frame(new THREE.Vector3(...f.focus), f.height * viewRef.current.zoom);
    lots.update(0);
    stage.renderer.render(stage.scene, stage.camera);

    return () => {
      stage.scene.remove(lots.group);
      lots.dispose();
      lotsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection.seed, planKey]);

  // ------------------------------------------------- markers follow the state
  // Cheap, and runs whenever the game state moves: a marker appearing is one
  // instance matrix, not a city.
  const markerKey = JSON.stringify(markers);
  useEffect(() => {
    const stage = stageRef.current;
    const works = worksRef.current;
    const lots = lotsRef.current;
    if (!stage || !works || !lots) return;
    works.apply({ tops: lots.tops, markers, selected });
    if (isCaptureMode()) {
      works.update(0);
      stage.renderer.render(stage.scene, stage.camera);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerKey, selected]);


  // On a phone the dossier is a sheet over the lower two thirds, so the framing
  // is pushed up into the part of the screen that is still the city.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const narrow = (stage.renderer.domElement.clientWidth || 0) < 780;
    stage.setBias(narrow && framing !== "city" ? 0.24 : 0);
    if (isCaptureMode()) stage.renderer.render(stage.scene, stage.camera);
  }, [framing]);

  // ------------------------------------------------------- camera, on demand
  // In capture mode there is no loop, so a framing change has to draw itself.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !isCaptureMode()) return;
    const f = framingFor(framing);
    stage.frame(new THREE.Vector3(...f.focus), f.height * zoom);
    terrainRef.current?.update(0);
    lotsRef.current?.update(0);
    stage.renderer.render(stage.scene, stage.camera);
  }, [framing, zoom]);

  return <div ref={mountRef} className="city-canvas" aria-hidden="true" />;
}
