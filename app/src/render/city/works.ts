import * as THREE from "three";

import { type Trade } from "../../game/catalog";
import { plotSite } from "../../game/plots";
import type { Plot } from "../../game/state";

/**
 * The works: what the player's decisions look like standing in the street.
 *
 * The buildings themselves are the approved architecture, raised through the
 * renderer's existing states as a plot levels up. This layer is everything the
 * architecture cannot say on its own and everything that has to change faster
 * than the city can be rebuilt:
 *
 *   a **trade sign** whose silhouette says what the plot does — a canopy for a
 *   market, a crossarm for a signal tower, a stack for a foundry
 *
 *   a **lamp** lit while the plot is running and dead when it is not, coloured
 *   by the trouble: amber over capacity, red when the city could not pay
 *
 *   a **crown** on a level-three plot, so the top of the ladder is visible
 *   from the wide shot rather than only in a panel
 *
 *   an invisible **pick box** over the parcel, so a plot is selected by
 *   clicking the ground it stands on rather than by hunting for a marker
 *
 * Every piece is instanced. Eleven plots with a post, a lamp and a sign each
 * would be fifty-odd draw calls and the city has a budget; this is seven,
 * whatever the city grows into. Hiding an instance means scaling it to nothing
 * rather than removing it, so the count never changes either.
 */

const TRADE_TONE: Record<Trade, number> = {
  market: 0x6fd39a,
  arcade: 0x6fd39a,
  signal: 0x7fc4ff,
  stage: 0x7fc4ff,
  foundry: 0xffb457,
  depot: 0xffb457,
};

const DARK_TONE = { capacity: 0xffb457, funds: 0xec6f45 } as const;
const DERELICT_TONE = 0xec6f45;
const IDLE_TONE = 0x8ea4c0;

/** Which sign a trade puts up. */
type SignKind = "canopy" | "crossarm" | "stack";

const SIGN_OF: Record<Trade, SignKind> = {
  market: "canopy",
  arcade: "canopy",
  signal: "crossarm",
  stage: "crossarm",
  foundry: "stack",
  depot: "stack",
};

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export type Works = {
  group: THREE.Group;
  picks: THREE.Object3D[];
  /** Screen-space anchor for a plot, for tests and captures. */
  anchor: (plotId: string) => THREE.Vector3 | null;
  apply: (plots: readonly Plot[], selected: string | null) => void;
  update: (t: number) => void;
  dispose: () => void;
};

export function createWorks(ids: readonly string[]): Works {
  const group = new THREE.Group();
  group.name = "works";
  const sites = ids.map((id) => ({ id, ...plotSite(id) }));
  const count = sites.length;

  const disposables: Array<{ dispose: () => void }> = [];
  const keep = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const structural = keep(
    new THREE.MeshStandardMaterial({ color: 0x2c3846, roughness: 0.55, metalness: 0.25 }),
  );

  const posts = new THREE.InstancedMesh(
    keep(new THREE.CylinderGeometry(0.24, 0.34, 1, 6)),
    structural,
    count,
  );
  posts.name = "works:posts";
  posts.castShadow = true;
  posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(posts);

  // Lit without depth testing: a lamp behind a tower is a plot nobody can find.
  const lampMaterial = keep(
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false }),
  );
  const lamps = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.82, 12, 9)), lampMaterial, count);
  lamps.name = "works:lamps";
  lamps.renderOrder = 10;
  lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(lamps);

  const signGeometry: Record<SignKind, THREE.BufferGeometry> = {
    canopy: keep(new THREE.BoxGeometry(4.8, 0.34, 1.7)),
    crossarm: keep(new THREE.BoxGeometry(3.2, 0.3, 0.3)),
    stack: keep(new THREE.CylinderGeometry(0.6, 0.82, 3.4, 6)),
  };
  const signs: Record<SignKind, THREE.InstancedMesh> = {
    canopy: new THREE.InstancedMesh(signGeometry.canopy, structural, count),
    crossarm: new THREE.InstancedMesh(signGeometry.crossarm, structural, count),
    stack: new THREE.InstancedMesh(signGeometry.stack, structural, count),
  };
  for (const [kind, mesh] of Object.entries(signs)) {
    mesh.name = `works:sign:${kind}`;
    mesh.castShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
  }

  const crowns = new THREE.InstancedMesh(
    keep(new THREE.ConeGeometry(1.5, 3.4, 4)),
    keep(new THREE.MeshStandardMaterial({ color: 0xf0a44a, roughness: 0.35, metalness: 0.45 })),
    count,
  );
  crowns.name = "works:crowns";
  crowns.castShadow = true;
  crowns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(crowns);

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

  const picks = sites.map((site) => {
    const box = new THREE.Mesh(
      keep(new THREE.BoxGeometry(site.width * 0.96, 3, site.depth * 0.96)),
      keep(new THREE.MeshBasicMaterial({ visible: false })),
    );
    box.position.set(site.x, 1.5, site.z);
    box.userData.plotId = site.id;
    group.add(box);
    return box;
  });

  /** Per-plot presentation, recomputed whenever the city changes. */
  type Slot = {
    height: number;
    sign: SignKind | null;
    lit: boolean;
    pulse: boolean;
    bare: boolean;
    crowned: boolean;
  };
  const slots: Slot[] = sites.map(() => ({
    height: 0,
    sign: null,
    lit: false,
    pulse: false,
    bare: true,
    crowned: false,
  }));

  const matrix = new THREE.Matrix4();
  const colour = new THREE.Color();
  let selectedIndex = -1;

  function writeStatic(): void {
    const usedBySign: Record<SignKind, number> = { canopy: 0, crossarm: 0, stack: 0 };

    sites.forEach((site, index) => {
      const slot = slots[index];

      if (slot.bare) {
        posts.setMatrixAt(index, HIDDEN);
      } else {
        matrix.makeScale(1, slot.height, 1);
        matrix.setPosition(site.x, slot.height / 2, site.z);
        posts.setMatrixAt(index, matrix);
      }

      matrix.makeScale(slot.crowned ? 1 : 0, slot.crowned ? 1 : 0, slot.crowned ? 1 : 0);
      matrix.setPosition(site.x, slot.height + 2.6, site.z);
      crowns.setMatrixAt(index, matrix);
    });

    // Signs are laid out per kind so each instanced mesh is packed from zero.
    for (const kind of ["canopy", "crossarm", "stack"] as const) {
      sites.forEach((site, index) => {
        if (slots[index].sign !== kind) return;
        matrix.makeRotationY(0);
        matrix.setPosition(site.x, slots[index].height - 0.9, site.z);
        signs[kind].setMatrixAt(usedBySign[kind]++, matrix);
      });
      for (let spare = usedBySign[kind]; spare < count; spare++) {
        signs[kind].setMatrixAt(spare, HIDDEN);
      }
      signs[kind].instanceMatrix.needsUpdate = true;
    }

    posts.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    picks,

    anchor: (plotId) => {
      const index = sites.findIndex((site) => site.id === plotId);
      if (index < 0) return null;
      return new THREE.Vector3(sites[index].x, Math.max(3, slots[index].height + 1), sites[index].z);
    },

    apply: (plots, selected) => {
      selectedIndex = sites.findIndex((site) => site.id === selected);

      sites.forEach((site, index) => {
        const plot = plots.find((entry) => entry.id === site.id);
        const slot = slots[index];
        if (!plot) {
          slot.bare = true;
          slot.sign = null;
          slot.crowned = false;
          return;
        }

        slot.bare = plot.level === 0;
        slot.height = 4.4 + plot.level * 1.5;
        slot.sign = slot.bare || !plot.trade ? null : SIGN_OF[plot.trade];
        slot.lit = !plot.derelict && plot.offline === null && !slot.bare;
        slot.pulse = plot.derelict || plot.offline !== null;
        slot.crowned = plot.level >= 3 && plot.offline === null && !plot.derelict;

        colour.setHex(
          plot.derelict
            ? DERELICT_TONE
            : plot.offline
              ? DARK_TONE[plot.offline]
              : plot.trade
                ? TRADE_TONE[plot.trade]
                : IDLE_TONE,
        );
        lamps.setColorAt(index, colour);
      });

      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      writeStatic();

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
      // Trouble strobes, a working plot breathes: motion carries the same fact
      // the colour carries, for anyone who cannot use the colour.
      sites.forEach((site, index) => {
        const slot = slots[index];
        if (slot.bare) {
          lamps.setMatrixAt(index, HIDDEN);
          return;
        }
        const beat = slot.pulse
          ? 0.5 + 0.5 * Math.sin(t * 4.6 + index)
          : 0.5 + 0.5 * Math.sin(t * 1.3 + index);
        const size = (slot.lit ? 0.9 + beat * 0.22 : 0.58 + beat * 0.16) * (index === selectedIndex ? 1.3 : 1);
        matrix.makeScale(size, size, size);
        matrix.setPosition(site.x, slot.height + 0.6, site.z);
        lamps.setMatrixAt(index, matrix);
      });
      lamps.instanceMatrix.needsUpdate = true;

      if (ring.visible) {
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
