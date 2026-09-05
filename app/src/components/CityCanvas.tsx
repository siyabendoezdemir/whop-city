import * as THREE from "three";
import { useEffect, useRef } from "react";

import type { DistrictId, PublicCityProjection } from "../city/projection";
import { buildCity, disposeCity, type City } from "../render/city/city";
import { createWorks, type Works } from "../render/city/works";
import { levelPlan } from "../game/plots";
import { applySurfaceDetail } from "../render/scene/materials";
import { SUPERSAMPLE_DEFAULT, VIEW, createStage } from "../render/scene/stage";
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
const PAN_BOUNDS = { minX: -90, maxX: 90, minZ: -100, maxZ: 60 };
/** Zoom stops. Close enough to read a shopfront, wide enough to see the island. */
const MIN_FRUSTUM = 34;
const MAX_FRUSTUM = 150;

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
  selected,
  onSelectPlot,
  onSelectDistrict,
  onUnavailable,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<ReturnType<typeof createStage> | null>(null);
  const cityRef = useRef<City | null>(null);

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
      const k = 1 - Math.exp(-dt * GLIDE_RATE);
      held.focus.lerp(want.focus, k);
      held.height += (want.height - held.height) * k;
      stage.frame(held.focus, held.height);
    };

    // ------------------------------------------------------- flying around
    // The camera looks down the 45 degrees the art was composed at and never
    // rotates, so dragging is two fixed directions on the ground: screen right
    // is one, screen up is the other. Clash of Clans does the same — the angle
    // is the art, the position is the player's.
    const groundRight = new THREE.Vector3(
      Math.cos(THREE.MathUtils.degToRad(45)),
      0,
      -Math.sin(THREE.MathUtils.degToRad(45)),
    ).normalize();
    const groundUp = new THREE.Vector3(-groundRight.z, 0, groundRight.x).normalize();

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

    const panBy = (dxPixels: number, dyPixels: number) => {
      takeOver();
      // One screen pixel is this many world units at the current zoom.
      const perPixel = held.height / Math.max(1, stage.renderer.domElement.clientHeight);
      want.focus.addScaledVector(groundRight, -dxPixels * perPixel);
      want.focus.addScaledVector(groundUp, dyPixels * perPixel);
      clampFocus(want.focus);
    };

    const zoomBy = (factor: number) => {
      takeOver();
      want.height = THREE.MathUtils.clamp(want.height * factor, MIN_FRUSTUM, MAX_FRUSTUM);
    };

    /**
     * Fit the authored aspect into whatever space there is.
     *
     * The composition is authored for 1440x900 and every framing is tuned to
     * it, so the canvas keeps that ratio and is letterboxed rather than
     * stretched or cropped. Scaling to the smaller of the two axes is what
     * makes the city fill the frame on a viewport of any shape.
     */
    const fit = () => {
      const availableWidth = mount.clientWidth || window.innerWidth;
      const availableHeight = mount.clientHeight || window.innerHeight;
      // Fill the window rather than letterboxing into it. The stage holds the
      // authored composition and grows the frustum vertically when the window
      // is narrower than it was authored for, so nothing is cropped and no
      // black bars appear.
      const scale = Math.min(availableWidth / VIEW.width, availableHeight / VIEW.height);
      const fitsWide = availableWidth / availableHeight >= VIEW.width / VIEW.height;
      stage.resize(
        Math.max(320, Math.round(fitsWide ? VIEW.width * scale : availableWidth)),
        Math.max(200, Math.round(fitsWide ? VIEW.height * scale : availableHeight)),
      );

    };

    const loop = () => {
      const dt = timer.getDelta();
      clock += dt;
      glide(dt);
      cityRef.current?.update(clock);
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

    const pick = (event: PointerEvent): DistrictId | null => {
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
        if (plotId) {
          onSelectPlotRef.current(plotId);
          return null;
        }
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
      const districtId = pick(event);
      if (districtId) selectRef.current(districtId);
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

      if (previous) {
        const dx = event.clientX - previous.x;
        const dy = event.clientY - previous.y;
        down.set(event.pointerId, { x: event.clientX, y: event.clientY });
        dragged += Math.hypot(dx, dy);
        // A small wobble on the way to a click should not move the city.
        if (dragged > 4) panBy(dx, dy);
        return;
      }

      canvas.style.cursor = pick(event) ? "pointer" : "grab";
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Trackpads report small pixel deltas and mice report large ones, so the
      // step is capped rather than proportional — otherwise one mouse notch
      // crosses the whole zoom range.
      const step = Math.sign(event.deltaY) * Math.min(0.16, Math.abs(event.deltaY) / 600);
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

    const renderAt = (focus: THREE.Vector3, height: number, t: number) => {
      clock = t;
      stage.frame(focus, height);
      cityRef.current?.update(t);
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
          cityRef.current?.update(t);
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
        /** Where a plot is on screen, in CSS pixels. For tests and captures. */
        plotPoint: (plotId: string) => {
          const world = worksRef.current?.anchor(plotId);
          if (!world) return null;
          const rect = stage.renderer.domElement.getBoundingClientRect();
          world.project(stage.camera);
          return {
            x: rect.left + ((world.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - world.y) / 2) * rect.height,
          };
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
          cityRef.current?.group.traverse((child) => {
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

        info: () => {
          const info = stage.renderer.info;
          return {
            drawCalls: info.render.calls,
            triangles: info.render.triangles,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            parcels: cityRef.current?.stats.parcels ?? 0,
            propInstances: cityRef.current?.stats.instances ?? 0,
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

  // ---------------------------------------------------------- the world itself
  // Rebuilt whenever the projection changes, which is the only thing that
  // changes it. Serialised as the dependency so an identical projection
  // arriving as a new object does not throw the city away and build it again.
  const projectionKey = JSON.stringify(projection);
  // Only levels and trades change the architecture. A tick changes lamps, and
  // lamps are the works layer, which never triggers a rebuild.
  const planKey = JSON.stringify(levels);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    if (cityRef.current) {
      stage.scene.remove(cityRef.current.group);
      disposeCity(cityRef.current);
    }

    const city = buildCity(projection, levelPlan(levels));
    cityRef.current = city;
    stage.scene.add(city.group);

    // The works stand outside the city group: a rebuild must not take the
    // player's lamps and pick targets with it.
    if (!worksRef.current) {
      const works = createWorks(Object.keys(levels));
      worksRef.current = works;
      stage.scene.add(works.group);
    }
    worksRef.current?.apply(levels, selected);

    const f = framingFor(viewRef.current.framing);
    stage.frame(new THREE.Vector3(...f.focus), f.height * viewRef.current.zoom);
    city.update(0);
    stage.renderer.render(stage.scene, stage.camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectionKey, planKey]);

  // ------------------------------------------------- markers follow the state
  // Cheap, and runs on every tick: the works are materials and visibility, not
  // geometry, so the state of the city can change once every five seconds
  // without the city being rebuilt once every five seconds.
  const worksKey = JSON.stringify(levels);
  useEffect(() => {
    const stage = stageRef.current;
    const works = worksRef.current;
    if (!stage || !works) return;
    works.apply(levels, selected);
    if (isCaptureMode()) {
      works.update(0);
      stage.renderer.render(stage.scene, stage.camera);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksKey, selected]);


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
    cityRef.current?.update(0);
    stage.renderer.render(stage.scene, stage.camera);
  }, [framing, zoom]);

  return <div ref={mountRef} className="city-canvas" aria-hidden="true" />;
}
