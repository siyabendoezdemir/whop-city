import * as THREE from "three";

import type { EvidenceKind } from "../../city/evidence";
import type { DistrictId } from "../../city/projection";

/**
 * How the city says what it needs.
 *
 * Two separate things stand in every district, and keeping them separate is the
 * point of this file:
 *
 *   a **condition mark** — what Whop reported. Never changes because the
 *   operator did something in the browser.
 *
 *   a **progress mark** — what the operator has done here. Appears next to the
 *   condition mark, never instead of it.
 *
 * So a struggling district that has been worked keeps its hazard beacon and
 * gains a completion plate beside it. Local progress cannot make a business
 * look healthy, because it is drawn as a different object.
 *
 * Each condition is a different physical thing, not a different colour of the
 * same dot: survey stakes for ground that was never built on, a hazard chevron
 * on a strobing mast for a district reading wrong, a scaffold ring for recent
 * work, a low steady lamp for one that is fine, and a blank question plate when
 * City could not read it at all. Colour reinforces; shape and motion carry.
 */

/** Where each district's marks stand. Chosen to read at the default framing. */
export const MARKER_ANCHORS: Record<DistrictId, [number, number, number]> = {
  "commerce-core": [3, 0, -48],
  "offer-forge": [-46, 0, -10],
  "creator-quarter": [20, 0, 6],
};

/**
 * The ground each district covers, for picking.
 *
 * A flat invisible box over the parcels, so clicking anywhere in the
 * neighbourhood selects it rather than requiring a hit on the mast. It is a
 * proxy: the architecture itself stays merged per material, because unpicking
 * that to make buildings individually pickable would cost the draw-call budget
 * the whole city is built around.
 */
const DISTRICT_BOUNDS: Record<DistrictId, { centre: [number, number]; size: [number, number] }> = {
  "commerce-core": { centre: [4, -51], size: [58, 50] },
  "offer-forge": { centre: [-46, -10], size: [34, 82] },
  "creator-quarter": { centre: [26, 8], size: [104, 28] },
};

const LAMP_COLOUR: Record<EvidenceKind, number> = {
  mixed: 0xff6b4a,
  nothing: 0x7fc4ff,
  recent: 0xffb457,
  working: 0x6fd39a,
  unread: 0x8ea4c0,
};

/** Tall enough to clear the district's own towers; short where nothing is wrong. */
const MAST_TALL = 26;
const MAST_LOW = 12;

export type ProgressMark = "none" | "focused" | "worked" | "declined" | "changed";

export type Marker = {
  group: THREE.Group;
  /** Meshes a raycast may hit to select this district. */
  targets: THREE.Object3D[];
  /** Height of the lamp above the anchor. Varies with the condition. */
  lampHeight: () => number;
  districtId: DistrictId;
  setCondition: (kind: EvidenceKind) => void;
  setProgress: (mark: ProgressMark) => void;
  setSelected: (selected: boolean) => void;
  update: (t: number) => void;
  dispose: () => void;
};

/** A flat plate on a short post, for the progress marks. */
function plate(colour: number, symbol: "check" | "cross" | "query"): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5, metalness: 0.1 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5, 5), material);
  post.position.y = 2.5;
  post.castShadow = true;
  group.add(post);

  const face = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3.1, 0.28), material);
  face.position.y = 6.2;
  face.castShadow = true;
  group.add(face);

  // The symbol, cut in as raised bars so it reads in silhouette as well as in
  // colour. Two bars for a check, two crossed for a cross, one stub for query.
  const inkMaterial = new THREE.MeshBasicMaterial({ color: 0x0f1a2b, toneMapped: false });
  const bar = (w: number, h: number, x: number, y: number, rotation: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), inkMaterial);
    mesh.position.set(x, 6.2 + y, 0.2);
    mesh.rotation.z = rotation;
    group.add(mesh);
  };
  if (symbol === "check") {
    bar(1.1, 0.42, -0.5, -0.35, Math.PI / 4);
    bar(2.0, 0.42, 0.35, 0.1, -Math.PI / 4);
  } else if (symbol === "cross") {
    bar(2.1, 0.4, 0, 0, Math.PI / 4);
    bar(2.1, 0.4, 0, 0, -Math.PI / 4);
  } else {
    bar(0.42, 1.5, 0, 0.35, 0);
    bar(0.42, 0.42, 0, -0.8, 0);
  }

  group.userData.materials = [material, inkMaterial];
  return group;
}

export function createMarker(districtId: DistrictId): Marker {
  const group = new THREE.Group();
  group.name = `marker:${districtId}`;
  group.position.set(...MARKER_ANCHORS[districtId]);

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ------------------------------------------------------- condition mark
  const condition = new THREE.Group();
  condition.name = "condition";
  group.add(condition);

  const mastMaterial = track(
    new THREE.MeshStandardMaterial({ color: 0x2c3846, roughness: 0.55, metalness: 0.3 }),
  );
  const mast = new THREE.Mesh(track(new THREE.CylinderGeometry(0.28, 0.42, 1, 6)), mastMaterial);
  mast.castShadow = true;
  condition.add(mast);

  // The lamp is drawn without depth testing: a marker behind a tower is a
  // district that cannot be found. The mast below it stays physical.
  const lampMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false }),
  );
  const lamp = new THREE.Mesh(track(new THREE.SphereGeometry(1.15, 16, 12)), lampMaterial);
  lamp.renderOrder = 10;
  condition.add(lamp);

  const glowMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  const glow = new THREE.Mesh(track(new THREE.SphereGeometry(2.76, 16, 12)), glowMaterial);
  glow.renderOrder = 9;
  condition.add(glow);

  /** Hazard chevron: only for a district reading wrong. */
  const signMaterial = track(
    new THREE.MeshStandardMaterial({ color: 0xff6b4a, roughness: 0.6, metalness: 0.05 }),
  );
  const sign = new THREE.Mesh(track(new THREE.ConeGeometry(2.1, 2.8, 3)), signMaterial);
  sign.position.y = MAST_TALL - 4.5;
  sign.castShadow = true;
  condition.add(sign);

  /** Scaffold ring: only for recent work. */
  const scaffoldMaterial = track(
    new THREE.MeshStandardMaterial({ color: 0xffb457, roughness: 0.7, metalness: 0.1 }),
  );
  const scaffold = new THREE.Mesh(
    track(new THREE.TorusGeometry(2.4, 0.22, 6, 12)),
    scaffoldMaterial,
  );
  scaffold.rotation.x = Math.PI / 2;
  scaffold.position.y = MAST_TALL - 6;
  condition.add(scaffold);

  /** Survey stakes: only for ground nothing was built on. */
  const stakeMaterial = track(
    new THREE.MeshStandardMaterial({ color: 0x7fc4ff, roughness: 0.7, metalness: 0 }),
  );
  const stakes = new THREE.Group();
  for (const [sx, sz] of [
    [-3, -3],
    [3, -3],
    [3, 3],
    [-3, 3],
  ]) {
    const stake = new THREE.Mesh(track(new THREE.CylinderGeometry(0.13, 0.13, 2.4, 4)), stakeMaterial);
    stake.position.set(sx, 1.2, sz);
    stakes.add(stake);
  }
  const line = new THREE.Mesh(track(new THREE.TorusGeometry(4.2, 0.07, 4, 16)), stakeMaterial);
  line.rotation.x = Math.PI / 2;
  line.position.y = 2.2;
  stakes.add(line);
  condition.add(stakes);

  // -------------------------------------------------------- progress mark
  const worked = plate(0x6fd39a, "check");
  const declined = plate(0x7c8ba1, "cross");
  const changed = plate(0xffb457, "query");
  for (const mark of [worked, declined, changed]) {
    mark.position.set(4.6, 0, 2.4);
    mark.visible = false;
    group.add(mark);
    for (const material of mark.userData.materials as THREE.Material[]) track(material);
  }

  /** Focus ring: the player's own selection, on the ground, not in the sky. */
  const ringMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  const ring = new THREE.Mesh(track(new THREE.RingGeometry(6.4, 7.6, 40)), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.35;
  ring.visible = false;
  group.add(ring);

  // ---------------------------------------------------------------- picking
  const targetMaterial = track(new THREE.MeshBasicMaterial({ visible: false }));
  const mastTarget = new THREE.Mesh(
    track(new THREE.CylinderGeometry(4.4, 4.4, MAST_TALL + 4, 8)),
    targetMaterial,
  );
  mastTarget.position.y = (MAST_TALL + 4) / 2;
  mastTarget.userData.districtId = districtId;
  mastTarget.renderOrder = 11;
  group.add(mastTarget);

  const bounds = DISTRICT_BOUNDS[districtId];
  const areaTarget = new THREE.Mesh(
    track(new THREE.BoxGeometry(bounds.size[0], 3, bounds.size[1])),
    targetMaterial,
  );
  // In world space, not marker space: the anchor is inside the district, not
  // at the middle of it.
  areaTarget.position.set(
    bounds.centre[0] - MARKER_ANCHORS[districtId][0],
    1.5,
    bounds.centre[1] - MARKER_ANCHORS[districtId][2],
  );
  areaTarget.userData.districtId = districtId;
  group.add(areaTarget);

  let strobe = false;
  let blink = false;
  let selected = false;
  let mastHeight = MAST_TALL;

  const setMast = (height: number) => {
    mastHeight = height;
    mast.scale.y = height;
    mast.position.y = height / 2;
    lamp.position.y = height + 0.6;
    glow.position.y = height + 0.6;
  };

  return {
    group,
    targets: [mastTarget, areaTarget],
    lampHeight: () => mastHeight + 0.6,
    districtId,

    setCondition: (kind) => {
      const colour = new THREE.Color(LAMP_COLOUR[kind]);
      lampMaterial.color.copy(colour);
      glowMaterial.color.copy(colour);

      sign.visible = kind === "mixed";
      scaffold.visible = kind === "recent";
      stakes.visible = kind === "nothing";
      // A district nobody built on does not need a beacon over the skyline; a
      // district reading wrong does.
      setMast(kind === "mixed" || kind === "recent" ? MAST_TALL : MAST_LOW);
      strobe = kind === "mixed";
      glowMaterial.opacity = kind === "unread" ? 0.12 : 0.28;
    },

    setProgress: (mark) => {
      worked.visible = mark === "worked";
      declined.visible = mark === "declined";
      changed.visible = mark === "changed";
      blink = mark === "changed";
    },

    setSelected: (next) => {
      selected = next;
      ring.visible = next;
    },

    update: (t) => {
      // A district reading wrong strobes; everything else breathes slowly, so
      // motion carries meaning rather than just being alive.
      const beat = strobe
        ? 0.5 + 0.5 * Math.sin(t * 5.2)
        : blink
          ? 0.4 + 0.35 * Math.sin(t * 2.0)
          : 0.35;
      const emphasis = selected ? 1.35 : 1;
      glow.scale.setScalar((0.86 + beat * 0.34) * emphasis);
      lamp.scale.setScalar(0.92 + beat * 0.16);
      if (scaffold.visible) scaffold.rotation.z = t * 0.5;
      if (sign.visible) sign.rotation.y = t * 0.6;
      if (ring.visible) {
        ring.scale.setScalar(1 + Math.sin(t * 2.2) * 0.045);
        ringMaterial.opacity = 0.36 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.2));
      }
      if (changed.visible) changed.rotation.y = Math.sin(t * 1.4) * 0.35;
      void mastHeight;
    },

    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}

export function createMarkers(districtIds: readonly DistrictId[]): {
  group: THREE.Group;
  markers: Marker[];
  update: (t: number) => void;
  dispose: () => void;
} {
  const group = new THREE.Group();
  group.name = "markers";
  const markers = districtIds.map((districtId) => {
    const marker = createMarker(districtId);
    group.add(marker.group);
    return marker;
  });

  return {
    group,
    markers,
    update: (t) => {
      for (const marker of markers) marker.update(t);
    },
    dispose: () => {
      for (const marker of markers) marker.dispose();
    },
  };
}
