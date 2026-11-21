import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BoneData, EditMode, GeometryData, PrimitiveType, SceneNode, Vec3 } from '../types';

/** Create editable BufferGeometry for every built-in mesh primitive. */
export function createPrimitiveGeometry(type: PrimitiveType = 'cube'): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;
  switch (type) {
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.85, 32, 20);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.65, 0.65, 1.6, 32, 2);
      break;
    case 'cone':
      geometry = new THREE.ConeGeometry(0.8, 1.7, 32, 2);
      break;
    case 'plane':
      geometry = new THREE.PlaneGeometry(3, 3, 4, 4);
      geometry.rotateX(-Math.PI / 2);
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(0.8, 0.24, 16, 48);
      break;
    case 'cube':
    default:
      geometry = new THREE.BoxGeometry(1.4, 1.4, 1.4, 2, 2, 2);
      break;
  }
  return geometry;
}

export function geometryToData(geometry: THREE.BufferGeometry): GeometryData {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uvs = geometry.getAttribute('uv');
  return {
    positions: Array.from(positions.array as ArrayLike<number>),
    normals: normals ? Array.from(normals.array as ArrayLike<number>) : undefined,
    uvs: uvs ? Array.from(uvs.array as ArrayLike<number>) : undefined,
    indices: geometry.index ? Array.from(geometry.index.array as ArrayLike<number>) : undefined,
  };
}

export function dataToGeometry(data: GeometryData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  if (data.normals && data.normals.length === data.positions.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  }
  if (data.uvs && data.uvs.length === (data.positions.length / 3) * 2) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  }
  if (data.indices) geometry.setIndex(data.indices);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function getNodeGeometryData(node: SceneNode): GeometryData {
  if (node.geometry) return node.geometry;
  return geometryToData(createPrimitiveGeometry(node.primitive === 'mesh' ? 'cube' : node.primitive));
}

function nonIndexedTriangles(data: GeometryData): number[] {
  const geometry = dataToGeometry(data);
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const result = Array.from(nonIndexed.getAttribute('position').array as ArrayLike<number>);
  if (nonIndexed !== geometry) nonIndexed.dispose();
  geometry.dispose();
  return result;
}

function finishPositions(positions: number[]): GeometryData {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const data = geometryToData(geometry);
  geometry.dispose();
  return data;
}

function readTriangle(source: number[], triangle: number): THREE.Vector3[] {
  return [0, 1, 2].map((corner) => {
    const i = triangle * 9 + corner * 3;
    return new THREE.Vector3(source[i], source[i + 1], source[i + 2]);
  });
}

function pushTriangle(target: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  target.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

/** Extrude selected triangles along their own averaged normal, including side walls. */
export function extrudeGeometry(data: GeometryData, faces: number[], distance = 0.35): GeometryData {
  const source = nonIndexedTriangles(data);
  const output: number[] = [];
  const selected = new Set(faces);
  const count = source.length / 9;
  for (let face = 0; face < count; face += 1) {
    const [a, b, c] = readTriangle(source, face);
    if (!selected.has(face)) {
      pushTriangle(output, a, b, c);
      continue;
    }
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const offset = normal.multiplyScalar(distance);
    const at = a.clone().add(offset);
    const bt = b.clone().add(offset);
    const ct = c.clone().add(offset);
    pushTriangle(output, at, bt, ct);
    const edges: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      [a, b, bt, at],
      [b, c, ct, bt],
      [c, a, at, ct],
    ];
    edges.forEach(([v0, v1, v2, v3]) => {
      pushTriangle(output, v0, v1, v2);
      pushTriangle(output, v0, v2, v3);
    });
  }
  return finishPositions(output);
}

/** Inset selected faces with a real recessed inner face and connecting rim. */
export function insetGeometry(data: GeometryData, faces: number[], amount = 0.22): GeometryData {
  const source = nonIndexedTriangles(data);
  const output: number[] = [];
  const selected = new Set(faces);
  const count = source.length / 9;
  for (let face = 0; face < count; face += 1) {
    const [a, b, c] = readTriangle(source, face);
    if (!selected.has(face)) {
      pushTriangle(output, a, b, c);
      continue;
    }
    const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const inset = (v: THREE.Vector3) => center.clone().add(v.clone().sub(center).multiplyScalar(1 - amount)).addScaledVector(normal, -0.035);
    const ai = inset(a);
    const bi = inset(b);
    const ci = inset(c);
    pushTriangle(output, ai, bi, ci);
    const edges: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      [a, b, bi, ai],
      [b, c, ci, bi],
      [c, a, ai, ci],
    ];
    edges.forEach(([v0, v1, v2, v3]) => {
      pushTriangle(output, v0, v1, v2);
      pushTriangle(output, v0, v2, v3);
    });
  }
  return finishPositions(output);
}

/** Loop-free 1-to-4 triangle subdivision; works on any editable triangle mesh. */
export function subdivideGeometry(data: GeometryData, faces?: number[]): GeometryData {
  const source = nonIndexedTriangles(data);
  const output: number[] = [];
  const selected = faces?.length ? new Set(faces) : null;
  const count = source.length / 9;
  for (let face = 0; face < count; face += 1) {
    const [a, b, c] = readTriangle(source, face);
    if (selected && !selected.has(face)) {
      pushTriangle(output, a, b, c);
      continue;
    }
    const ab = a.clone().add(b).multiplyScalar(0.5);
    const bc = b.clone().add(c).multiplyScalar(0.5);
    const ca = c.clone().add(a).multiplyScalar(0.5);
    pushTriangle(output, a, ab, ca);
    pushTriangle(output, ab, b, bc);
    pushTriangle(output, ca, bc, c);
    pushTriangle(output, ab, bc, ca);
  }
  return finishPositions(output);
}

/** Translate directly selected vertices, edge endpoints, or face corners in local space. */
export function transformGeometryElements(
  data: GeometryData,
  mode: EditMode,
  elements: number[],
  delta: Vec3,
): GeometryData {
  const positions = nonIndexedTriangles(data);
  const indices = new Set<number>();
  elements.forEach((element) => {
    if (mode === 'vertex') indices.add(element);
    if (mode === 'face') [0, 1, 2].forEach((corner) => indices.add(element * 3 + corner));
    if (mode === 'edge') {
      const face = Math.floor(element / 3);
      const edge = element % 3;
      indices.add(face * 3 + edge);
      indices.add(face * 3 + ((edge + 1) % 3));
    }
  });
  const source = [...positions];
  const moved = new Set<number>();
  indices.forEach((index) => {
    const offset = index * 3;
    if (offset + 2 >= source.length) return;
    const origin: Vec3 = [source[offset], source[offset + 1], source[offset + 2]];
    // Raycast selections address triangle corners. Move every coincident corner
    // as one welded vertex so adjacent faces do not tear apart.
    for (let vertex = 0; vertex < source.length / 3; vertex += 1) {
      if (moved.has(vertex)) continue;
      const i = vertex * 3;
      const epsilon = 0.000001;
      if (Math.abs(source[i] - origin[0]) > epsilon || Math.abs(source[i + 1] - origin[1]) > epsilon || Math.abs(source[i + 2] - origin[2]) > epsilon) continue;
      positions[i] += delta[0];
      positions[i + 1] += delta[1];
      positions[i + 2] += delta[2];
      moved.add(vertex);
    }
  });
  return finishPositions(positions);
}

export function getElementCenter(data: GeometryData, mode: EditMode, elements: number[]): Vec3 {
  if (!elements.length) return [0, 0, 0];
  const positions = nonIndexedTriangles(data);
  const center = new THREE.Vector3();
  let count = 0;
  const addVertex = (index: number) => {
    const i = index * 3;
    if (i + 2 >= positions.length) return;
    center.add(new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]));
    count += 1;
  };
  elements.forEach((element) => {
    if (mode === 'vertex') addVertex(element);
    if (mode === 'face') [0, 1, 2].forEach((corner) => addVertex(element * 3 + corner));
    if (mode === 'edge') {
      const face = Math.floor(element / 3);
      const edge = element % 3;
      addVertex(face * 3 + edge);
      addVertex(face * 3 + ((edge + 1) % 3));
    }
  });
  if (!count) return [0, 0, 0];
  center.multiplyScalar(1 / count);
  return center.toArray() as Vec3;
}

export function getGeometryStats(data: GeometryData) {
  const vertices = data.positions.length / 3;
  return { vertices, triangles: data.indices ? data.indices.length / 3 : vertices / 3 };
}

/**
 * Distance-based automatic skin binding. Each vertex receives the four nearest
 * bone segments with inverse-cube falloff, producing smooth normalized weights.
 */
export function applyAutomaticSkinning(source: THREE.BufferGeometry, bones: BoneData[]): THREE.BufferGeometry {
  const geometry = source.clone();
  const threeBones = bones.map((data) => {
    const bone = new THREE.Bone();
    bone.name = data.name;
    bone.position.fromArray(data.position);
    bone.rotation.set(...data.rotation);
    bone.scale.fromArray(data.scale);
    return bone;
  });
  bones.forEach((data, index) => {
    if (data.parentId) {
      const parent = bones.findIndex((bone) => bone.id === data.parentId);
      if (parent >= 0) threeBones[parent].add(threeBones[index]);
    }
  });
  threeBones.forEach((bone) => bone.updateMatrixWorld(true));
  const worldPositions = threeBones.map((bone) => bone.getWorldPosition(new THREE.Vector3()));
  const segments = bones.flatMap((bone, index) => {
    if (!bone.parentId) return [];
    const parent = bones.findIndex((item) => item.id === bone.parentId);
    return parent >= 0 ? [{ a: worldPositions[parent], b: worldPositions[index], index }] : [];
  });
  const positions = geometry.getAttribute('position');
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const point = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const line = new THREE.Line3();
  for (let i = 0; i < positions.count; i += 1) {
    point.fromBufferAttribute(positions, i);
    const distances = bones.map((_, boneIndex) => {
      let distance = point.distanceTo(worldPositions[boneIndex]);
      segments.forEach((segment) => {
        if (segment.index !== boneIndex) return;
        line.set(segment.a, segment.b);
        line.closestPointToPoint(point, true, closest);
        distance = Math.min(distance, point.distanceTo(closest));
      });
      return { boneIndex, distance };
    }).sort((a, b) => a.distance - b.distance).slice(0, Math.min(4, bones.length));
    let total = 0;
    distances.forEach(({ distance }) => { total += 1 / Math.pow(distance + 0.08, 3); });
    for (let slot = 0; slot < 4; slot += 1) {
      const item = distances[slot];
      skinIndices.push(item?.boneIndex ?? 0);
      skinWeights.push(item ? (1 / Math.pow(item.distance + 0.08, 3)) / total : 0);
    }
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  return geometry;
}

function transformedPart(geometry: THREE.BufferGeometry, position: Vec3, scale?: Vec3) {
  if (scale) geometry.scale(...scale);
  geometry.translate(...position);
  return geometry;
}

/** A single coherent humanoid mesh used by the preloaded, automatically weighted demo rig. */
export function createDemoCharacterGeometry(): GeometryData {
  const parts: THREE.BufferGeometry[] = [
    transformedPart(new THREE.BoxGeometry(0.92, 0.95, 0.5, 3, 4, 2), [0, 1.62, 0]),
    transformedPart(new THREE.BoxGeometry(0.74, 0.34, 0.46, 2, 2, 2), [0, 1.1, 0]),
    transformedPart(new THREE.SphereGeometry(0.4, 20, 14), [0, 2.48, 0], [0.9, 1.08, 0.9]),
    transformedPart(new THREE.CylinderGeometry(0.15, 0.18, 0.26, 16), [0, 2.08, 0]),
  ];
  [-1, 1].forEach((side) => {
    parts.push(
      transformedPart(new THREE.CylinderGeometry(0.14, 0.17, 0.72, 12, 3), [side * 0.63, 1.5, 0]),
      transformedPart(new THREE.CylinderGeometry(0.11, 0.14, 0.68, 12, 3), [side * 0.63, 0.82, 0]),
      transformedPart(new THREE.SphereGeometry(0.16, 12, 8), [side * 0.63, 0.45, 0]),
      transformedPart(new THREE.CylinderGeometry(0.18, 0.21, 0.62, 12, 3), [side * 0.26, 0.72, 0]),
      transformedPart(new THREE.CylinderGeometry(0.14, 0.18, 0.56, 12, 3), [side * 0.26, 0.2, 0]),
      transformedPart(new THREE.BoxGeometry(0.36, 0.16, 0.56, 2, 1, 2), [side * 0.26, 0.03, 0.13]),
    );
  });
  const merged = mergeGeometries(parts, false) ?? parts[0];
  merged.computeVertexNormals();
  const data = geometryToData(merged);
  parts.forEach((part) => part.dispose());
  if (merged !== parts[0]) merged.dispose();
  return data;
}

export function createDefaultBones(): BoneData[] {
  const bone = (id: string, name: string, parentId: string | null, position: Vec3): BoneData => ({
    id, name, parentId, position, rotation: [0, 0, 0], scale: [1, 1, 1],
  });
  return [
    bone('root', 'Root', null, [0, 0, 0]),
    bone('pelvis', 'Pelvis', 'root', [0, 1.15, 0]),
    bone('spine', 'Spine', 'pelvis', [0, 0.45, 0]),
    bone('head', 'Head', 'spine', [0, 0.9, 0]),
    bone('arm_l', 'Upper arm.L', 'spine', [-0.55, 0.25, 0]),
    bone('forearm_l', 'Forearm.L', 'arm_l', [0, -0.68, 0]),
    bone('arm_r', 'Upper arm.R', 'spine', [0.55, 0.25, 0]),
    bone('forearm_r', 'Forearm.R', 'arm_r', [0, -0.68, 0]),
    bone('leg_l', 'Upper leg.L', 'pelvis', [-0.26, -0.2, 0]),
    bone('shin_l', 'Shin.L', 'leg_l', [0, -0.65, 0]),
    bone('leg_r', 'Upper leg.R', 'pelvis', [0.26, -0.2, 0]),
    bone('shin_r', 'Shin.R', 'leg_r', [0, -0.65, 0]),
  ];
}
