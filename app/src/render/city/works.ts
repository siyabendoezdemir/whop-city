import * as THREE from "three";

import { plotSite } from "../../game/plots";

/**
 * The works: everything laid over the city that is about the *game* rather than
 * the architecture.
 *
 * There are only three things left here, and that is deliberate. Once a plot's
 * level started driving the building itself — vacant ground at nought, a tower
 * at five — the posts, lamps, trade signs and crowns this layer used to plant
 * were saying a second time what the skyline already said, and standing in
 * front of it while they did.
 *
 *   a **marker** floating over any plot with something waiting: a gold bubble
 *   with a chevron on a built plot, a plus on empty ground
 *
 *   a **ring** on the ground under the selected plot
 *
 *   an invisible **pick box** over the whole parcel, so a plot is chosen by
 *   clicking the building or the ground it stands on
 *
 * The markers are the part that had to be got right. They used to be HTML
 * positioned from a projected point on a 300ms timer, which meant that during
 * any camera move they lagged the world by up to a third of a second and
 * visibly swam. They are geometry in the scene now: they are placed once, in
 * world space, at the measured top of whatever is actually standing on the plot
 * — `city.tops`, from the real bounding box, not a predicted height — so there
 * is no per-frame reprojection to get wrong and nothing to drift out of sync
 * with the camera. They cannot jitter because nothing moves them.
 *
 * Everything is instanced. Hiding one means scaling it to nothing rather than
 * removing it, so the instance count never changes and neither does the draw
 * count.
 */

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** How far above the roofline a marker floats. */
const MARKER_LIFT = 4.6;
const MARKER_SIZE = 7.2;

export type MarkerKind = "ready" | "build";

export type Works = {
  group: THREE.Group;
  picks: THREE.Object3D[];
  /** Screen-space anchor for a plot, for tests and captures. */
  anchor: (plotId: string) => THREE.Vector3 | null;
  apply: (input: {
    tops: Readonly<Record<string, number>>;
    markers: Readonly<Record<string, MarkerKind>>;
    selected: string | null;
  }) => void;
  update: (t: number) => void;
  dispose: () => void;
};

/**
 * The bubble, drawn once into a canvas.
 *
 * A texture rather than geometry because the shape wants a soft edge and a
 * drop shadow, and both are two lines here and a mesh each otherwise.
 */
function bubbleTexture(kind: MarkerKind): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size * 0.44;
  const r = size * 0.3;

  ctx.save();
  ctx.shadowColor = "rgba(18,22,30,0.5)";
  ctx.shadowBlur = size * 0.07;
  ctx.shadowOffsetY = size * 0.03;

  // Body: a warm gold disc with a lighter cap, so it reads as a struck coin.
  const body = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  body.addColorStop(0, kind === "ready" ? "#ffd66b" : "#9ad7ff");
  body.addColorStop(1, kind === "ready" ? "#e39a1c" : "#3f8fd0");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.restore();

  // Tail, pointing down at the roof it belongs to.
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.075, cy + r * 0.88);
  ctx.lineTo(cx + size * 0.075, cy + r * 0.88);
  ctx.lineTo(cx, cy + r * 1.5);
  ctx.closePath();
  ctx.fillStyle = kind === "ready" ? "#e39a1c" : "#3f8fd0";
  ctx.fill();

  ctx.lineWidth = size * 0.028;
  ctx.strokeStyle = "rgba(38,26,8,0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Glyph: a chevron for an upgrade waiting, a plus for empty ground.
  ctx.strokeStyle = "#2b1e06";
  ctx.lineWidth = size * 0.055;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (kind === "ready") {
    const w = r * 0.52;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy + w * 0.42);
    ctx.lineTo(cx, cy - w * 0.5);
    ctx.lineTo(cx + w, cy + w * 0.42);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - w, cy + w * 1.05);
    ctx.lineTo(cx, cy + w * 0.13);
    ctx.lineTo(cx + w, cy + w * 1.05);
    ctx.stroke();
  } else {
    const w = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy);
    ctx.lineTo(cx + w, cy);
    ctx.moveTo(cx, cy - w);
    ctx.lineTo(cx, cy + w);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createWorks(ids: readonly string[], camera: THREE.Camera): Works {
  const group = new THREE.Group();
  group.name = "works";
  const sites = ids.map((id) => ({ id, ...plotSite(id) }));
  const count = Math.max(1, sites.length);

  const disposables: Array<{ dispose: () => void }> = [];
  const keep = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // The camera never rotates, so a billboard is a fixed orientation rather than
  // a per-frame lookAt. One quaternion, read once, reused by every marker.
  camera.updateMatrixWorld();
  const facing = camera.quaternion.clone();

  const quad = keep(new THREE.PlaneGeometry(MARKER_SIZE, MARKER_SIZE));
  const markers: Record<MarkerKind, THREE.InstancedMesh> = {
    ready: new THREE.InstancedMesh(
      quad,
      keep(
        new THREE.MeshBasicMaterial({
          map: keep(bubbleTexture("ready")),
          transparent: true,
          // Always on top. A marker hidden behind the tower next door is a
          // building the player never finds.
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
      count,
    ),
    build: new THREE.InstancedMesh(
      quad,
      keep(
        new THREE.MeshBasicMaterial({
          map: keep(bubbleTexture("build")),
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
      count,
    ),
  };
  for (const [kind, mesh] of Object.entries(markers)) {
    mesh.name = `works:marker:${kind}`;
    mesh.renderOrder = 20;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
  }

  // One plot is selected at a time, so the ring is one mesh that moves.
  const ringMaterial = keep(
    new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  const ring = new THREE.Mesh(keep(new THREE.RingGeometry(0.92, 1, 48)), ringMaterial);
  ring.name = "works:ring";
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  group.add(ring);

  /**
   * Pick boxes.
   *
   * Tall enough to cover the building rather than the plot floor, because a
   * player aiming at the fortieth storey of a tower is aiming at the tower.
   * Resized whenever the levels change.
   */
  const picks = sites.map((site) => {
    const box = new THREE.Mesh(
      keep(new THREE.BoxGeometry(site.width * 0.96, 1, site.depth * 0.96)),
      keep(new THREE.MeshBasicMaterial({ visible: false })),
    );
    box.position.set(site.x, 0.5, site.z);
    box.userData.plotId = site.id;
    group.add(box);
    return box;
  });

  type Slot = { top: number; marker: MarkerKind | null };
  const slots: Slot[] = sites.map(() => ({ top: 0, marker: null }));

  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3(1, 1, 1);
  const at = new THREE.Vector3();
  let selectedIndex = -1;

  /** Where a plot's marker floats, ignoring the bob. */
  const restingHeight = (index: number) => slots[index].top + MARKER_LIFT;

  function writeMarkers(bob: number): void {
    for (const kind of ["ready", "build"] as const) {
      let used = 0;
      sites.forEach((site, index) => {
        if (slots[index].marker !== kind) return;
        at.set(site.x, restingHeight(index) + bob, site.z);
        matrix.compose(at, facing, scale);
        markers[kind].setMatrixAt(used++, matrix);
      });
      for (let spare = used; spare < count; spare++) markers[kind].setMatrixAt(spare, HIDDEN);
      markers[kind].instanceMatrix.needsUpdate = true;
    }
  }

  return {
    group,
    picks,

    anchor: (plotId) => {
      const index = sites.findIndex((site) => site.id === plotId);
      if (index < 0) return null;
      return new THREE.Vector3(sites[index].x, restingHeight(index), sites[index].z);
    },

    apply: ({ tops, markers: wanted, selected }) => {
      selectedIndex = sites.findIndex((site) => site.id === selected);

      sites.forEach((site, index) => {
        slots[index].top = Math.max(0, tops[site.id] ?? 0);
        slots[index].marker = wanted[site.id] ?? null;

        // Cover the building, floor to roof, so the whole thing is clickable.
        const reach = Math.max(6, slots[index].top + 2);
        picks[index].scale.set(1, reach, 1);
        picks[index].position.set(site.x, reach / 2, site.z);
      });

      writeMarkers(0);

      if (selectedIndex >= 0) {
        const site = sites[selectedIndex];
        const reach = Math.max(site.width, site.depth) * 0.44;
        ring.position.set(site.x, 0.4, site.z);
        ring.scale.set(reach, reach, 1);
        ring.visible = true;
      } else {
        ring.visible = false;
      }
    },

    update: (t) => {
      // One shared bob. Every marker rides the same wave, which reads as the
      // city breathing rather than as eleven independent bouncing objects.
      writeMarkers(Math.sin(t * 1.9) * 0.55);

      if (ring.visible && selectedIndex >= 0) {
        const wobble = 1 + Math.sin(t * 2.1) * 0.035;
        const site = sites[selectedIndex];
        const reach = Math.max(site.width, site.depth) * 0.44 * wobble;
        ring.scale.set(reach, reach, 1);
        ringMaterial.opacity = 0.34 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.1));
      }
    },

    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}
