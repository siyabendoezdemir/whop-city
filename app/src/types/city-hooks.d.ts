/**
 * The capture and test hooks the renderer publishes on `window`.
 *
 * Not a product API: nothing here reaches the server or carries business data,
 * and the shell does not use any of it. It exists so a browser test can ask the
 * renderer what it actually built rather than inferring it from pixels.
 */

import type * as THREE from "three";

export type CityInfo = {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  parcels: number;
  propInstances: number;
};

export type CityHooks = {
  ready: boolean;
  framings: string[];
  frame: (key: string, t?: number, zoom?: number) => void;
  frameAt: (focus: [number, number, number], height: number, t: number) => void;
  flyTo: (to: string, from: string, progress: number, t: number) => void;
  renderFrame: (t: number) => void;
  framingTable: () => Array<{
    key: string;
    focus: [number, number, number];
    height: number;
    right: [number, number, number];
    up: [number, number, number];
  }>;
  shadowRig: () => number[];
  silhouette: (on: boolean) => void;
  info: () => CityInfo;
  scene: THREE.Scene;
};

declare global {
  interface Window {
    __city?: CityHooks;
  }
}

export {};
