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
 *   a **ring** on the ground under the selected plot, and a second, quieter one
 *   under whichever plot the pointer is over
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

export type MarkerKind = "ready" | "build" | "owned";

/**
 * How big each marker is and how far above the roofline it floats.
 *
 * `owned` is a third of the size and sits closer to the roof, because it is
 * saying a much smaller thing. A bubble with a glyph in it is a callout: it
 * means there is something here to do. Eleven of those over a city where
 * nothing is waiting would be eleven false alarms, and the player would learn
 * within a minute to stop reading them — which would cost the two that matter.
 *
 * So this is a plain ring, not a bubble, and it only has to survive being
 * looked for. It is the answer to "which of these are mine" on a city that has
 * earned nothing yet, where the plots are eleven lawns, no bubble is showing
 * because nothing is claimable, and the palette has nothing to separate either
 * — a lawn is a lawn whoever owns it.
 */
const MARKER: Record<MarkerKind, { size: number; lift: number }> = {
  ready: { size: 7.2, lift: 4.6 },
  build: { size: 7.2, lift: 4.6 },
  owned: { size: 4.4, lift: 3.4 },
};

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
  /**
   * Ring whichever plot the pointer is over, or none.
   *
   * Deliberately not part of `apply`, and deliberately not React state. This
   * fires on every pointer move across the canvas; routing that through a
   * re-render to reach the same two lines of matrix maths would rebuild the
   * whole HUD sixty times a second to move one ring.
   */
  hover: (plotId: string | null) => void;
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

  // A ring, for a plot with nothing waiting on it. Drawn as an outline rather
  // than a disc so it reads as a boundary the way the selection and hover rings
  // do, and finished before any of the callout furniture below is reached — an
  // "owned" marker with a tail pointing at the roof would be a callout, which
  // is the one thing it must not be.
  if (kind === "owned") {
    const ring = r * 0.8;
    // Dark under light. A white ring alone survives against the bay and
    // disappears against a pale roof or a concrete apron, which are two of the
    // three things it will ever be seen over; the dark halo under it is what
    // makes it hold on all of them.
    ctx.save();
    ctx.shadowColor = "rgba(16,20,28,0.55)";
    ctx.shadowBlur = size * 0.055;
    ctx.strokeStyle = "rgba(24,32,44,0.5)";
    ctx.lineWidth = size * 0.13;
    ctx.beginPath();
    ctx.arc(cx, size / 2, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.94)";
    ctx.lineWidth = size * 0.075;
    ctx.beginPath();
    ctx.arc(cx, size / 2, ring, 0, Math.PI * 2);
    ctx.stroke();

    // A dot in the middle, so it is a mark rather than a hoop. An empty circle
    // at this size reads as a hole punched in the picture.
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.beginPath();
    ctx.arc(cx, size / 2, ring * 0.24, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

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

  // One unit quad for all three; the size difference is in the instance matrix,
  // so a marker kind costs a texture rather than a geometry.
  const quad = keep(new THREE.PlaneGeometry(1, 1));
  const sheet = (kind: MarkerKind) =>
    new THREE.InstancedMesh(
      quad,
      keep(
        new THREE.MeshBasicMaterial({
          map: keep(bubbleTexture(kind)),
          transparent: true,
          // Always on top. A marker hidden behind the tower next door is a
          // building the player never finds.
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
      count,
    );
  const markers: Record<MarkerKind, THREE.InstancedMesh> = {
    ready: sheet("ready"),
    build: sheet("build"),
    owned: sheet("owned"),
  };
  for (const [kind, mesh] of Object.entries(markers)) {
    mesh.name = `works:marker:${kind}`;
    // Under the callouts. Where a quiet ring and a live bubble land on the same
    // pixels, the bubble is the one worth reading.
    mesh.renderOrder = kind === "owned" ? 19 : 20;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
  }

  // One plot is selected at a time, and the pointer is over at most one, so
  // each ring is a single mesh that moves rather than one per plot.
  const band = keep(new THREE.RingGeometry(0.92, 1, 48));
  const surround = keep(new THREE.RingGeometry(0.885, 1.035, 48));
  const circle = (
    name: string,
    color: number,
    opacity: number,
    geometry: THREE.BufferGeometry = band,
  ) => {
    const material = keep(
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material };
  };

  const { mesh: ring, material: ringMaterial } = circle("works:ring", 0xffd9a0, 0.5);

  /**
   * The hover ring: a white band on a dark one.
   *
   * Cooler than the selection ring, because it answers a different question.
   * Selection says "this is the one you are looking at"; hover only says "this
   * one is yours and it can be clicked", which is the thing that was impossible
   * to find out without clicking and seeing what happened.
   *
   * Two bands rather than one because a single white hairline is legible over
   * asphalt and over grass and over nothing else — and the ground it has to
   * work on is mostly pale: footway, kerb, forecourt, concrete apron. A
   * reviewer watching the first version scored it four out of ten and said it
   * would be missed at a glance, which for a cue whose whole job is to be found
   * is a failure. The darker band sits a shade wider underneath and gives the
   * white something to be white against.
   */
  const { mesh: hoverShadow } = circle("works:hover:edge", 0x121821, 0.42, surround);
  const { mesh: hoverRing } = circle("works:hover", 0xffffff, 0.85);
  hoverShadow.renderOrder = 1;
  hoverRing.renderOrder = 2;

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
  let hoveredIndex = -1;

  /** Where a plot's marker floats, ignoring the bob. */
  const restingHeight = (index: number, kind: MarkerKind) =>
    slots[index].top + MARKER[kind].lift;

  /** How wide a ring sits on a plot: just inside its shorter dimension. */
  const ringReach = (index: number) =>
    Math.max(sites[index].width, sites[index].depth) * 0.44;

  function placeRing(mesh: THREE.Mesh, index: number, swell = 1): void {
    if (index < 0) {
      mesh.visible = false;
      return;
    }
    const reach = ringReach(index) * swell;
    mesh.position.set(sites[index].x, 0.4, sites[index].z);
    mesh.scale.set(reach, reach, 1);
    mesh.visible = true;
  }

  /** The hover ring and the dark band it stands on, which move together. */
  function placeHover(index: number): void {
    placeRing(hoverShadow, index);
    placeRing(hoverRing, index);
  }

  function writeMarkers(bob: number): void {
    for (const kind of ["ready", "build", "owned"] as const) {
      const { size } = MARKER[kind];
      scale.set(size, size, 1);
      let used = 0;
      sites.forEach((site, index) => {
        if (slots[index].marker !== kind) return;
        at.set(site.x, restingHeight(index, kind) + bob, site.z);
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
      // The callout height, whatever is actually showing: this is where a test
      // or a capture looks for the marker, and the two that carry a glyph are
      // the ones worth aiming at.
      return new THREE.Vector3(sites[index].x, restingHeight(index, "ready"), sites[index].z);
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
      placeRing(ring, selectedIndex);
      // The selected plot already has a ring, and two concentric ones on the
      // same ground read as a rendering fault rather than as two states.
      if (hoveredIndex === selectedIndex) hoveredIndex = -1;
      placeHover(hoveredIndex);
    },

    hover: (plotId) => {
      const index = plotId ? sites.findIndex((site) => site.id === plotId) : -1;
      const wanted = index === selectedIndex ? -1 : index;
      if (wanted === hoveredIndex) return;
      hoveredIndex = wanted;
      placeHover(hoveredIndex);
    },

    update: (t) => {
      // One shared bob. Every marker rides the same wave, which reads as the
      // city breathing rather than as eleven independent bouncing objects.
      writeMarkers(Math.sin(t * 1.9) * 0.55);

      if (ring.visible && selectedIndex >= 0) {
        const wobble = 1 + Math.sin(t * 2.1) * 0.035;
        placeRing(ring, selectedIndex, wobble);
        ringMaterial.opacity = 0.34 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.1));
      }
    },

    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}
