import * as THREE from "three";

import type { AttentionLevel } from "../../city/attention";
import type { DistrictId } from "../../city/projection";

/**
 * District markers.
 *
 * The city has to be able to ask for attention without turning into a map with
 * pins on it. These are diegetic: a slim mast standing in the district with a
 * lamp on top, the kind of thing a harbour or a works yard would actually have.
 * The lamp pulses when the district wants looking at and sits steady once it
 * has been reviewed.
 *
 * They are also the click targets. Picking the mast is easier and far more
 * forgiving than picking a roof, and it means selection works the same whether
 * the operator uses the mouse, the keyboard, or the queue in the shell.
 */

/** Where each district's marker stands. Chosen to read at the default framing. */
export const MARKER_ANCHORS: Record<DistrictId, [number, number, number]> = {
  "commerce-core": [3, 0, -48],
  "offer-forge": [-46, 0, -10],
  "creator-quarter": [20, 0, 6],
};

const LAMP_COLOUR: Record<AttentionLevel, number> = {
  urgent: 0xff6b4a,
  opportunity: 0x7fc4ff,
  watch: 0xffb457,
  steady: 0x6fd39a,
  unknown: 0x8ea4c0,
};

export type Marker = {
  group: THREE.Group;
  /** The mesh a raycast has to hit. Generous on purpose. */
  target: THREE.Mesh;
  districtId: DistrictId;
  setLevel: (level: AttentionLevel, resolved: boolean) => void;
  setSelected: (selected: boolean) => void;
  update: (t: number) => void;
  dispose: () => void;
};

/**
 * Tall enough to clear the district it stands in.
 *
 * Commerce Core has towers, and a marker hidden behind one is a district that
 * cannot be picked. The mast is physical and depth-tested like everything else;
 * the lamp on top is not, so a beacon is always findable even when the mast is
 * behind a roof. That is the objective-marker convention and it is worth the
 * small break from strict physicality — an operator has to be able to see what
 * is asking for them.
 */
const MAST_HEIGHT = 26;
const LAMP_RADIUS = 1.15;

export function createMarker(districtId: DistrictId): Marker {
  const group = new THREE.Group();
  group.name = `marker:${districtId}`;
  group.position.set(...MARKER_ANCHORS[districtId]);

  const mastMaterial = new THREE.MeshStandardMaterial({
    color: 0x2c3846,
    roughness: 0.55,
    metalness: 0.3,
  });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, MAST_HEIGHT, 6), mastMaterial);
  mast.position.y = MAST_HEIGHT / 2;
  mast.castShadow = true;
  group.add(mast);

  const lampMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    depthTest: false,
  });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(LAMP_RADIUS, 16, 12), lampMaterial);
  lamp.position.y = MAST_HEIGHT + 0.6;
  lamp.renderOrder = 10;
  group.add(lamp);

  // The glow is a second, larger, additive shell. Cheap, and it survives the
  // tone mapping that would otherwise flatten the lamp into the sky.
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    depthTest: false,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(LAMP_RADIUS * 2.4, 16, 12), glowMaterial);
  glow.position.copy(lamp.position);
  glow.renderOrder = 9;
  group.add(glow);

  // A wide invisible cylinder so the whole mast is clickable, not just its
  // three-pixel silhouette at the default framing.
  const targetMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const target = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, MAST_HEIGHT + 4, 8), targetMaterial);
  target.position.y = (MAST_HEIGHT + 4) / 2;
  // Pickable through the architecture, for the same reason the lamp is visible
  // through it: the marker is the affordance, and it has to be reachable.
  target.renderOrder = 11;
  target.userData.districtId = districtId;
  group.add(target);

  let pulse = true;
  let selected = false;

  return {
    group,
    target,
    districtId,
    setLevel: (level, resolved) => {
      const colour = new THREE.Color(LAMP_COLOUR[level]);
      lampMaterial.color.copy(colour);
      glowMaterial.color.copy(colour);
      // A reviewed district stops asking. It is still lit, just not insistent.
      pulse = !resolved && level !== "steady";
      glowMaterial.opacity = resolved ? 0.16 : 0.28;
    },
    setSelected: (next) => {
      selected = next;
    },
    update: (t) => {
      const beat = pulse ? 0.5 + 0.5 * Math.sin(t * 2.6) : 0.35;
      const emphasis = selected ? 1.35 : 1;
      const scale = (0.86 + beat * 0.34) * emphasis;
      glow.scale.setScalar(scale);
      lamp.scale.setScalar(0.92 + beat * 0.16);
      group.rotation.y = t * 0.25;
    },
    dispose: () => {
      mast.geometry.dispose();
      lamp.geometry.dispose();
      glow.geometry.dispose();
      target.geometry.dispose();
      mastMaterial.dispose();
      lampMaterial.dispose();
      glowMaterial.dispose();
      targetMaterial.dispose();
    },
  };
}

/** All three markers, plus the picking set. */
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
