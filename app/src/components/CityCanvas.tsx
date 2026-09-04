import * as THREE from "three";
import { useEffect, useRef } from "react";

import type { PublicCityProjection } from "../city/projection";
import { buildCity, disposeCity, type City } from "../render/city/city";
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
};

/** Eased so a scripted fly-through is reproducible frame for frame. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

/** How fast the camera settles on a new framing, in inverse seconds. */
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

export function CityCanvas({ projection, framing, zoom }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<ReturnType<typeof createStage> | null>(null);
  const cityRef = useRef<City | null>(null);
  // Kept in refs so the animation loop reads the current value without being
  // torn down and restarted on every camera change.
  const viewRef = useRef({ framing, zoom });
  viewRef.current = { framing, zoom };

  // --------------------------------------------------------------- the stage
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const stage = createStage(mount, { supersample: supersampleFromLocation() });
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

    const glide = (dt: number) => {
      const { framing: key, zoom: bias } = viewRef.current;
      const target = framingFor(key);
      // Exponential approach, framerate-independent. Roughly nine tenths of the
      // way there in three quarters of a second.
      const k = 1 - Math.exp(-dt * GLIDE_RATE);
      held.focus.lerp(new THREE.Vector3(...target.focus), k);
      held.height += (target.height * bias - held.height) * k;
      stage.frame(held.focus, held.height);
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
      const scale = Math.min(availableWidth / VIEW.width, availableHeight / VIEW.height);
      stage.resize(
        Math.max(320, Math.round(VIEW.width * scale)),
        Math.max(200, Math.round(VIEW.height * scale)),
      );
    };

    const loop = () => {
      const dt = timer.getDelta();
      clock += dt;
      glide(dt);
      cityRef.current?.update(clock);
      stage.renderer.render(stage.scene, stage.camera);
      raf = requestAnimationFrame(loop);
    };

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
      window.removeEventListener("resize", fit);
      delete (window as { __city?: unknown }).__city;
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
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    if (cityRef.current) {
      stage.scene.remove(cityRef.current.group);
      disposeCity(cityRef.current);
    }

    const city = buildCity(projection);
    cityRef.current = city;
    stage.scene.add(city.group);

    const f = framingFor(viewRef.current.framing);
    stage.frame(new THREE.Vector3(...f.focus), f.height * viewRef.current.zoom);
    city.update(0);
    stage.renderer.render(stage.scene, stage.camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectionKey]);

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
