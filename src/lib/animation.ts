import * as THREE from 'three';
import type { Interpolation, Keyframe, ProjectSnapshot, SceneNode, Track, Vec3 } from '../types';
import { DEFAULT_MATERIAL } from '../types';
import { createDefaultBones, createDemoCharacterGeometry } from './geometry';

export const colorToArray = (color: string): number[] => {
  const c = new THREE.Color(color);
  return [c.r, c.g, c.b];
};

export const arrayToColor = (value: number[]): string => `#${new THREE.Color(value[0], value[1], value[2]).getHexString()}`;

export function getNodeProperty(node: SceneNode, property: string): number[] {
  if (property === 'position' || property === 'rotation' || property === 'scale') return [...node[property]];
  if (property === 'material.color') return colorToArray(node.material.color);
  if (property === 'material.emissive') return colorToArray(node.material.emissive);
  if (property === 'material.opacity') return [node.material.opacity];
  if (property === 'material.roughness') return [node.material.roughness];
  if (property === 'material.metalness') return [node.material.metalness];
  if (property === 'material.emissiveIntensity') return [node.material.emissiveIntensity];
  const boneMatch = property.match(/^bone\.([^.]+)\.(position|rotation|scale)$/);
  if (boneMatch) {
    const bone = node.rig?.bones.find((item) => item.id === boneMatch[1]);
    return bone ? [...bone[boneMatch[2] as 'position' | 'rotation' | 'scale']] : [0, 0, 0];
  }
  return [0];
}

export function setNodeProperty(node: SceneNode, property: string, value: number[]): SceneNode {
  if (property === 'position' || property === 'rotation' || property === 'scale') {
    return { ...node, [property]: [...value].slice(0, 3) as Vec3 };
  }
  if (property.startsWith('material.')) {
    const key = property.split('.')[1];
    const material = { ...node.material };
    if (key === 'color' || key === 'emissive') material[key] = arrayToColor(value);
    else if (key === 'opacity' || key === 'roughness' || key === 'metalness' || key === 'emissiveIntensity') {
      material[key] = value[0];
    }
    return { ...node, material };
  }
  const boneMatch = property.match(/^bone\.([^.]+)\.(position|rotation|scale)$/);
  if (boneMatch && node.rig) {
    return {
      ...node,
      rig: {
        ...node.rig,
        bones: node.rig.bones.map((bone) => bone.id === boneMatch[1]
          ? { ...bone, [boneMatch[2]]: [...value].slice(0, 3) as Vec3 }
          : bone),
      },
    };
  }
  return node;
}

function easeInOut(t: number) {
  // Cubic Bezier (0.42, 0, 0.58, 1), solved with Newton iterations.
  const x1 = 0.42;
  const x2 = 0.58;
  const sampleX = (u: number) => 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u ** 2 * x2 + u ** 3;
  const sampleY = (u: number) => 3 * (1 - u) * u ** 2 + u ** 3;
  let u = t;
  for (let i = 0; i < 7; i += 1) {
    const x = sampleX(u) - t;
    const derivative = 3 * (1 - u) ** 2 * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u ** 2 * (1 - x2);
    if (Math.abs(derivative) < 0.0001) break;
    u -= x / derivative;
    u = Math.max(0, Math.min(1, u));
  }
  return sampleY(u);
}

export function interpolateValue(a: number[], b: number[], t: number, mode: Interpolation): number[] {
  if (mode === 'constant') return [...a];
  const amount = mode === 'bezier' ? easeInOut(t) : t;
  return a.map((value, index) => THREE.MathUtils.lerp(value, b[index] ?? value, amount));
}

export function sampleTrack(track: Track | undefined, frame: number): number[] | null {
  if (!track?.keys.length) return null;
  const keys = [...track.keys].sort((a, b) => a.frame - b.frame);
  const exact = keys.find((key) => key.frame === frame);
  if (exact) return [...exact.value];
  if (frame <= keys[0].frame) return [...keys[0].value];
  if (frame >= keys[keys.length - 1].frame) return [...keys[keys.length - 1].value];
  for (let i = 0; i < keys.length - 1; i += 1) {
    const left = keys[i];
    const right = keys[i + 1];
    if (frame >= left.frame && frame <= right.frame) {
      const span = Math.max(0.0001, right.frame - left.frame);
      return interpolateValue(left.value, right.value, (frame - left.frame) / span, left.interpolation);
    }
  }
  return [...keys[0].value];
}

export function sampleNodeAtFrame(node: SceneNode, tracks: Track[], frame: number): SceneNode {
  return tracks.filter((track) => track.nodeId === node.id).reduce((sampled, track) => {
    const value = sampleTrack(track, frame);
    return value ? setNodeProperty(sampled, track.property, value) : sampled;
  }, node);
}

const baseNode = (id: string, name: string, type: SceneNode['type'], position: Vec3): SceneNode => ({
  id,
  name,
  type,
  parentId: null,
  position,
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  visible: true,
  locked: false,
  geometryVersion: 0,
  material: { ...DEFAULT_MATERIAL, textures: {} },
});

export function createDemoProject(): ProjectSnapshot {
  const hero: SceneNode = {
    ...baseNode('hero', 'ASTRA · Rigged character', 'mesh', [0, 0, 0]),
    primitive: 'mesh',
    geometry: createDemoCharacterGeometry(),
    material: {
      ...DEFAULT_MATERIAL,
      color: '#6675df',
      roughness: 0.28,
      metalness: 0.42,
      emissive: '#17245e',
      emissiveIntensity: 0.32,
      textures: {},
    },
    rig: { bones: createDefaultBones(), bound: true },
  };
  const visor = {
    ...baseNode('visor', 'Luminous visor', 'cube', [0, 2.5, 0.34]),
    parentId: 'hero',
    scale: [0.42, 0.09, 0.07] as Vec3,
    material: { ...DEFAULT_MATERIAL, color: '#b8fbff', emissive: '#43d9ff', emissiveIntensity: 2.4, roughness: 0.15, textures: {} },
  };
  const pedestal = {
    ...baseNode('pedestal', 'Display plinth', 'cylinder', [0, -0.16, 0]),
    scale: [1.65, 0.16, 1.65] as Vec3,
    material: { ...DEFAULT_MATERIAL, color: '#171a2b', roughness: 0.25, metalness: 0.8, textures: {} },
  };
  const ring = {
    ...baseNode('ring', 'Energy ring', 'torus', [0, 0.035, 0]),
    rotation: [Math.PI / 2, 0, 0] as Vec3,
    scale: [1.7, 1.7, 0.12] as Vec3,
    material: { ...DEFAULT_MATERIAL, color: '#46d9ff', emissive: '#1ba9ff', emissiveIntensity: 3, roughness: 0.22, textures: {} },
  };
  const camera = { ...baseNode('camera_main', 'Cinematic camera', 'camera', [5.4, 3.2, 6.5]) };
  camera.rotation = [-0.2, 0.67, 0];
  const key = { ...baseNode('key_light', 'Key · Directional', 'directionalLight', [4, 7, 5]), color: '#d9e5ff', intensity: 3.2 };
  key.rotation = [-0.65, 0.5, 0];
  const rim = { ...baseNode('rim_light', 'Rim · Point', 'pointLight', [-3, 3.5, -2]), color: '#9b6dff', intensity: 45 };
  const spot = { ...baseNode('spot_light', 'Softbox · Spot', 'spotLight', [1, 5, 3]), color: '#66e5ff', intensity: 70 };
  spot.rotation = [-1.1, 0.2, 0];
  const nodes = [hero, visor, pedestal, ring, camera, key, rim, spot];
  const keyframe = (frame: number, value: number[], interpolation: Interpolation = 'bezier'): Keyframe => ({
    id: `demo-${frame}-${Math.random().toString(36).slice(2, 7)}`, frame, value, interpolation,
  });
  const track = (nodeId: string, property: string, keys: Keyframe[]): Track => ({
    id: `${nodeId}-${property}`, nodeId, property, keys,
  });
  const tracks = [
    track('hero', 'rotation', [keyframe(0, [0, -0.18, 0]), keyframe(48, [0, 0.24, 0]), keyframe(96, [0, -0.18, 0])]),
    track('hero', 'bone.arm_r.rotation', [
      keyframe(0, [0, 0, 0]), keyframe(24, [0, 0, -2.15]), keyframe(48, [0.2, 0, -2.35]), keyframe(72, [0, 0, -2.15]), keyframe(96, [0, 0, 0]),
    ]),
    track('hero', 'bone.forearm_r.rotation', [
      keyframe(0, [0, 0, 0]), keyframe(24, [0, 0, -0.35]), keyframe(36, [0, 0, -1.15]), keyframe(48, [0, 0, -0.35]), keyframe(60, [0, 0, -1.15]), keyframe(72, [0, 0, -0.35]), keyframe(96, [0, 0, 0]),
    ]),
    track('hero', 'bone.arm_l.rotation', [keyframe(0, [0, 0, 0.08]), keyframe(48, [0.12, 0, -0.16]), keyframe(96, [0, 0, 0.08])]),
    track('hero', 'bone.spine.rotation', [keyframe(0, [0, 0, 0]), keyframe(48, [0.04, 0.12, -0.05]), keyframe(96, [0, 0, 0])]),
    track('hero', 'bone.head.rotation', [keyframe(0, [0, 0.08, 0]), keyframe(48, [-0.08, -0.16, 0.05]), keyframe(96, [0, 0.08, 0])]),
    track('visor', 'material.emissiveIntensity', [keyframe(0, [1.4]), keyframe(48, [3.2]), keyframe(96, [1.4])]),
    track('ring', 'rotation', [keyframe(0, [Math.PI / 2, 0, 0], 'linear'), keyframe(96, [Math.PI / 2, Math.PI * 2, 0], 'linear')]),
    track('camera_main', 'position', [keyframe(0, [5.4, 3.2, 6.5]), keyframe(48, [3.2, 2.6, 7.2]), keyframe(96, [5.4, 3.2, 6.5])]),
    track('camera_main', 'rotation', [keyframe(0, [-0.2, 0.67, 0]), keyframe(48, [-0.12, 0.4, 0]), keyframe(96, [-0.2, 0.67, 0])]),
  ];
  return { nodes, tracks, duration: 120, fps: 30 };
}
