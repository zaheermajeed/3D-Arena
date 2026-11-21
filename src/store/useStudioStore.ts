import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as THREE from 'three';
import type {
  EditMode, Interpolation, Keyframe, NodeType, PrimitiveType, ProjectSnapshot,
  SceneNode, Track, Vec3, ViewSettings,
} from '../types';
import { DEFAULT_MATERIAL } from '../types';
import { createDemoProject, getNodeProperty } from '../lib/animation';
import {
  createPrimitiveGeometry, extrudeGeometry, geometryToData, getElementCenter,
  getNodeGeometryData, insetGeometry, subdivideGeometry, transformGeometryElements,
} from '../lib/geometry';

const uid = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID().slice(0, 8)
  : Math.random().toString(36).slice(2, 10);
const clampFrame = (frame: number, duration: number) => Math.max(0, Math.min(duration, frame));
const snapshot = (state: { nodes: SceneNode[]; tracks: Track[]; duration: number; fps: number }): ProjectSnapshot => ({
  nodes: state.nodes, tracks: state.tracks, duration: state.duration, fps: state.fps,
});

function nodeWorldMatrix(id: string, nodes: SceneNode[]): THREE.Matrix4 {
  const node = nodes.find((item) => item.id === id);
  if (!node) return new THREE.Matrix4();
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(...node.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...node.rotation)),
    new THREE.Vector3(...node.scale),
  );
  return node.parentId ? nodeWorldMatrix(node.parentId, nodes).multiply(local) : local;
}

function reparentInNodes(nodes: SceneNode[], id: string, parentId: string | null): SceneNode[] {
  if (id === parentId) return nodes;
  let cursor = parentId;
  while (cursor) {
    if (cursor === id) return nodes;
    cursor = nodes.find((node) => node.id === cursor)?.parentId ?? null;
  }
  const world = nodeWorldMatrix(id, nodes);
  const parentWorld = parentId ? nodeWorldMatrix(parentId, nodes) : new THREE.Matrix4();
  const local = parentWorld.invert().multiply(world);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  local.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion);
  return nodes.map((node) => node.id === id ? {
    ...node,
    parentId,
    position: position.toArray() as Vec3,
    rotation: [rotation.x, rotation.y, rotation.z] as Vec3,
    scale: scale.toArray() as Vec3,
  } : node);
}

interface StudioState extends ProjectSnapshot {
  projectName: string;
  selectedIds: string[];
  selectedId: string | null;
  selectedBoneId: string | null;
  selectedElements: number[];
  currentFrame: number;
  isPlaying: boolean;
  loop: boolean;
  autoKey: boolean;
  view: ViewSettings;
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
  select: (id: string | null, additive?: boolean) => void;
  selectBone: (id: string | null) => void;
  setSelectedElements: (elements: number[], additive?: boolean) => void;
  setView: (settings: Partial<ViewSettings>) => void;
  setEditMode: (mode: EditMode) => void;
  setFrame: (frame: number) => void;
  setPlaying: (playing: boolean) => void;
  stepFrame: (amount: number) => void;
  setDuration: (duration: number) => void;
  setFps: (fps: number) => void;
  setLoop: (loop: boolean) => void;
  setAutoKey: (autoKey: boolean) => void;
  setProjectName: (name: string) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  addNode: (type: NodeType) => string;
  updateNode: (id: string, patch: Partial<SceneNode>, recordAutoKey?: boolean) => void;
  updateMaterial: (id: string, patch: Partial<SceneNode['material']>, recordAutoKey?: boolean) => void;
  updateBone: (nodeId: string, boneId: string, patch: Partial<import('../types').BoneData>) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  renameNode: (id: string, name: string) => void;
  reparentNode: (id: string, parentId: string | null) => void;
  groupSelection: () => void;
  addKey: (nodeId: string, property: string, frame?: number, value?: number[]) => void;
  removeKey: (trackId: string, keyId: string) => void;
  moveKey: (trackId: string, keyId: string, frame: number) => void;
  setKeyInterpolation: (trackId: string, keyId: string, interpolation: Interpolation) => void;
  clearTrack: (trackId: string) => void;
  applyMeshOperation: (operation: 'extrude' | 'inset' | 'subdivide', amount?: number) => void;
  transformSelectedElements: (delta: Vec3) => void;
  getSelectedElementCenter: () => Vec3;
  addBone: () => void;
  removeBone: () => void;
  bindSelectedMesh: () => void;
  importNodes: (nodes: SceneNode[]) => void;
  loadProject: (project: ProjectSnapshot, name?: string) => void;
  resetDemo: () => void;
}

const demo = createDemoProject();
const defaultView: ViewSettings = {
  tool: 'translate', editMode: 'object', shading: 'rendered', space: 'world', snapping: false,
  translateSnap: 0.25, rotateSnap: Math.PI / 12, scaleSnap: 0.1,
  showGrid: true, showBones: true, cameraViewId: null,
};

export const useStudioStore = create<StudioState>()(persist((set, get) => ({
  ...demo,
  projectName: 'Astra Motion Study',
  selectedIds: ['hero'], selectedId: 'hero', selectedBoneId: null, selectedElements: [],
  currentFrame: 0, isPlaying: false, loop: true, autoKey: false, view: defaultView,
  past: [], future: [],
  select: (id, additive = false) => set((state) => {
    if (!id) return { selectedId: null, selectedIds: [], selectedBoneId: null, selectedElements: [] };
    const selectedIds = additive
      ? state.selectedIds.includes(id) ? state.selectedIds.filter((item) => item !== id) : [...state.selectedIds, id]
      : [id];
    return { selectedIds, selectedId: selectedIds[selectedIds.length - 1] ?? null, selectedBoneId: null, selectedElements: [] };
  }),
  selectBone: (id) => set({ selectedBoneId: id, selectedElements: [], view: { ...get().view, editMode: 'object', tool: id ? 'rotate' : get().view.tool } }),
  setSelectedElements: (elements, additive = false) => set((state) => ({
    selectedElements: additive
      ? [...new Set([...state.selectedElements, ...elements])]
      : elements,
  })),
  setView: (settings) => set((state) => ({ view: { ...state.view, ...settings } })),
  setEditMode: (editMode) => set((state) => ({
    view: { ...state.view, editMode, tool: editMode === 'object' ? state.view.tool : 'translate' }, selectedElements: [], selectedBoneId: null,
  })),
  setFrame: (frame) => set((state) => ({ currentFrame: clampFrame(frame, state.duration) })),
  setPlaying: (isPlaying) => set({ isPlaying }),
  stepFrame: (amount) => set((state) => ({ isPlaying: false, currentFrame: clampFrame(Math.round(state.currentFrame + amount), state.duration) })),
  setDuration: (duration) => set((state) => ({ duration: Math.max(1, Math.round(duration)), currentFrame: clampFrame(state.currentFrame, duration) })),
  setFps: (fps) => set({ fps }),
  setLoop: (loop) => set({ loop }),
  setAutoKey: (autoKey) => set({ autoKey }),
  setProjectName: (projectName) => set({ projectName }),
  pushHistory: () => set((state) => ({ past: [...state.past.slice(-39), snapshot(state)], future: [] })),
  undo: () => set((state) => {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    return { ...previous, past: state.past.slice(0, -1), future: [snapshot(state), ...state.future], selectedElements: [] };
  }),
  redo: () => set((state) => {
    const next = state.future[0];
    if (!next) return state;
    return { ...next, past: [...state.past, snapshot(state)], future: state.future.slice(1), selectedElements: [] };
  }),
  addNode: (type) => {
    get().pushHistory();
    const id = uid();
    const count = get().nodes.filter((node) => node.type === type).length + 1;
    const isLight = type.toLowerCase().includes('light');
    const label = type === 'pointLight' ? 'Point light' : type === 'directionalLight' ? 'Directional light' : type === 'spotLight' ? 'Spot light' : type[0].toUpperCase() + type.slice(1);
    const geometry = type !== 'group' && type !== 'camera' && !isLight && type !== 'text'
      ? geometryToData(createPrimitiveGeometry(type as PrimitiveType)) : undefined;
    const node: SceneNode = {
      id, name: `${label} ${count}`, type, parentId: null,
      position: type === 'camera' ? [4, 3, 5] : isLight ? [2, 4, 3] : [0, type === 'plane' ? 0 : 1, 0],
      rotation: type === 'directionalLight' || type === 'spotLight' ? [-0.7, 0.4, 0] : [0, 0, 0],
      scale: [1, 1, 1], visible: true, locked: false, geometryVersion: 0,
      primitive: geometry ? type as PrimitiveType : type === 'text' ? 'text' : undefined,
      geometry, text: type === 'text' ? 'PRISMA' : undefined,
      material: { ...DEFAULT_MATERIAL, textures: {} }, color: isLight ? '#ffffff' : undefined,
      intensity: isLight ? type === 'pointLight' || type === 'spotLight' ? 35 : 2.5 : undefined,
    };
    set((state) => ({ nodes: [...state.nodes, node], selectedId: id, selectedIds: [id], selectedElements: [], selectedBoneId: null }));
    return id;
  },
  updateNode: (id, patch, recordAutoKey = false) => {
    const state = get();
    set({ nodes: state.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) });
    if (recordAutoKey && state.autoKey) {
      (['position', 'rotation', 'scale'] as const).forEach((property) => {
        if (patch[property]) get().addKey(id, property);
      });
    }
  },
  updateMaterial: (id, patch, recordAutoKey = false) => {
    const state = get();
    set({ nodes: state.nodes.map((node) => node.id === id ? { ...node, material: { ...node.material, ...patch } } : node) });
    if (recordAutoKey && state.autoKey) {
      Object.keys(patch).forEach((key) => {
        if (['color', 'emissive', 'opacity', 'roughness', 'metalness', 'emissiveIntensity'].includes(key)) get().addKey(id, `material.${key}`);
      });
    }
  },
  updateBone: (nodeId, boneId, patch) => {
    const state = get();
    set({
      nodes: state.nodes.map((node) => node.id === nodeId && node.rig ? {
        ...node, rig: { ...node.rig, bones: node.rig.bones.map((bone) => bone.id === boneId ? { ...bone, ...patch } : bone) },
      } : node),
    });
    if (state.autoKey) {
      (['position', 'rotation', 'scale'] as const).forEach((property) => {
        if (patch[property]) get().addKey(nodeId, `bone.${boneId}.${property}`);
      });
    }
  },
  removeSelected: () => {
    const state = get();
    if (!state.selectedIds.length) return;
    get().pushHistory();
    const removed = new Set<string>();
    const collect = (id: string) => {
      removed.add(id);
      state.nodes.filter((node) => node.parentId === id).forEach((node) => collect(node.id));
    };
    state.selectedIds.forEach(collect);
    set({
      nodes: state.nodes.filter((node) => !removed.has(node.id)),
      tracks: state.tracks.filter((track) => !removed.has(track.nodeId)),
      selectedId: null, selectedIds: [], selectedBoneId: null, selectedElements: [],
      view: { ...state.view, cameraViewId: state.view.cameraViewId && removed.has(state.view.cameraViewId) ? null : state.view.cameraViewId },
    });
  },
  duplicateSelected: () => {
    const state = get();
    const source = state.nodes.find((node) => node.id === state.selectedId);
    if (!source) return;
    get().pushHistory();
    const id = uid();
    const boneIdMap = new Map<string, string>();
    source.rig?.bones.forEach((bone) => boneIdMap.set(bone.id, uid()));
    const clone: SceneNode = {
      ...structuredClone(source), id, name: `${source.name} copy`, parentId: source.parentId,
      position: [source.position[0] + 0.65, source.position[1], source.position[2] + 0.65],
      rig: source.rig ? {
        ...structuredClone(source.rig),
        bones: source.rig.bones.map((bone) => ({ ...structuredClone(bone), id: boneIdMap.get(bone.id)!, parentId: bone.parentId ? boneIdMap.get(bone.parentId)! : null })),
      } : undefined,
    };
    const tracks = state.tracks.filter((track) => track.nodeId === source.id).map((track) => ({
      ...structuredClone(track), id: uid(), nodeId: id,
      property: track.property.replace(/^bone\.([^.]+)/, (_, boneId) => `bone.${boneIdMap.get(boneId) ?? boneId}`),
      keys: track.keys.map((key) => ({ ...key, id: uid() })),
    }));
    set({ nodes: [...state.nodes, clone], tracks: [...state.tracks, ...tracks], selectedId: id, selectedIds: [id] });
  },
  renameNode: (id, name) => set((state) => ({ nodes: state.nodes.map((node) => node.id === id ? { ...node, name } : node) })),
  reparentNode: (id, parentId) => {
    get().pushHistory();
    set((state) => ({ nodes: reparentInNodes(state.nodes, id, parentId) }));
  },
  groupSelection: () => {
    const state = get();
    if (state.selectedIds.length < 2) return;
    get().pushHistory();
    const id = uid();
    const group: SceneNode = {
      id, name: `Group ${state.nodes.filter((node) => node.type === 'group').length + 1}`, type: 'group', parentId: null,
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, locked: false,
      geometryVersion: 0, material: { ...DEFAULT_MATERIAL, textures: {} },
    };
    let nodes = [...state.nodes, group];
    const rootsToGroup = state.selectedIds.filter((selected) => {
      let parent = state.nodes.find((node) => node.id === selected)?.parentId ?? null;
      while (parent) {
        if (state.selectedIds.includes(parent)) return false;
        parent = state.nodes.find((node) => node.id === parent)?.parentId ?? null;
      }
      return true;
    });
    rootsToGroup.forEach((selected) => { nodes = reparentInNodes(nodes, selected, id); });
    set({ nodes, selectedId: id, selectedIds: [id] });
  },
  addKey: (nodeId, property, frame = get().currentFrame, explicitValue) => {
    const state = get();
    const node = state.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const value = explicitValue ?? getNodeProperty(node, property);
    const existing = state.tracks.find((track) => track.nodeId === nodeId && track.property === property);
    const key: Keyframe = { id: uid(), frame: Math.round(frame), value: [...value], interpolation: 'bezier' };
    if (existing) {
      const atFrame = existing.keys.find((item) => item.frame === key.frame);
      set({
        tracks: state.tracks.map((track) => track.id === existing.id ? {
          ...track,
          keys: atFrame
            ? track.keys.map((item) => item.id === atFrame.id ? { ...item, value: [...value] } : item)
            : [...track.keys, key].sort((a, b) => a.frame - b.frame),
        } : track),
      });
    } else {
      set({ tracks: [...state.tracks, { id: uid(), nodeId, property, keys: [key] }] });
    }
  },
  removeKey: (trackId, keyId) => set((state) => ({
    tracks: state.tracks.map((track) => track.id === trackId ? { ...track, keys: track.keys.filter((key) => key.id !== keyId) } : track).filter((track) => track.keys.length),
  })),
  moveKey: (trackId, keyId, frame) => set((state) => ({
    tracks: state.tracks.map((track) => track.id === trackId ? {
      ...track, keys: track.keys.map((key) => key.id === keyId ? { ...key, frame: clampFrame(Math.round(frame), state.duration) } : key).sort((a, b) => a.frame - b.frame),
    } : track),
  })),
  setKeyInterpolation: (trackId, keyId, interpolation) => set((state) => ({
    tracks: state.tracks.map((track) => track.id === trackId ? { ...track, keys: track.keys.map((key) => key.id === keyId ? { ...key, interpolation } : key) } : track),
  })),
  clearTrack: (trackId) => set((state) => ({ tracks: state.tracks.filter((track) => track.id !== trackId) })),
  applyMeshOperation: (operation, amount) => {
    const state = get();
    const node = state.nodes.find((item) => item.id === state.selectedId);
    if (!node || !['mesh', 'cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'].includes(node.type)) return;
    const data = getNodeGeometryData(node);
    const triangleCount = (data.indices?.length ?? data.positions.length) / 3;
    const faces = state.view.editMode === 'face' && state.selectedElements.length
      ? state.selectedElements : Array.from({ length: triangleCount }, (_, index) => index);
    if ((operation === 'extrude' || operation === 'inset') && state.view.editMode === 'face' && !state.selectedElements.length) return;
    get().pushHistory();
    const geometry = operation === 'extrude' ? extrudeGeometry(data, faces, amount ?? 0.35)
      : operation === 'inset' ? insetGeometry(data, faces, amount ?? 0.22)
        : subdivideGeometry(data, state.selectedElements.length ? faces : undefined);
    set({
      nodes: state.nodes.map((item) => item.id === node.id ? { ...item, geometry, geometryVersion: item.geometryVersion + 1 } : item),
      selectedElements: [],
    });
  },
  transformSelectedElements: (delta) => {
    const state = get();
    const node = state.nodes.find((item) => item.id === state.selectedId);
    if (!node || !state.selectedElements.length || state.view.editMode === 'object') return;
    get().pushHistory();
    const geometry = transformGeometryElements(getNodeGeometryData(node), state.view.editMode, state.selectedElements, delta);
    set({ nodes: state.nodes.map((item) => item.id === node.id ? { ...item, geometry, geometryVersion: item.geometryVersion + 1 } : item) });
  },
  getSelectedElementCenter: () => {
    const state = get();
    const node = state.nodes.find((item) => item.id === state.selectedId);
    return node ? getElementCenter(getNodeGeometryData(node), state.view.editMode, state.selectedElements) : [0, 0, 0];
  },
  addBone: () => {
    const state = get();
    const node = state.nodes.find((item) => item.id === state.selectedId);
    if (!node || node.type === 'camera' || node.type === 'group' || node.type.includes('Light')) return;
    get().pushHistory();
    const id = uid();
    const parentId = state.selectedBoneId && node.rig?.bones.some((bone) => bone.id === state.selectedBoneId)
      ? state.selectedBoneId : node.rig?.bones[0]?.id ?? null;
    const bone = { id, name: `Bone ${(node.rig?.bones.length ?? 0) + 1}`, parentId, position: parentId ? [0, 0.5, 0] as Vec3 : [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 };
    set({
      nodes: state.nodes.map((item) => item.id === node.id ? {
        ...item,
        geometry: getNodeGeometryData(item),
        rig: { bones: [...(item.rig?.bones ?? []), bone], bound: true },
      } : item),
      selectedBoneId: id,
      view: { ...state.view, editMode: 'object', tool: 'rotate', showBones: true },
    });
  },
  removeBone: () => {
    const state = get();
    const node = state.nodes.find((item) => item.id === state.selectedId);
    if (!node?.rig || !state.selectedBoneId) return;
    get().pushHistory();
    const removed = new Set<string>();
    const collect = (id: string) => {
      removed.add(id);
      node.rig!.bones.filter((bone) => bone.parentId === id).forEach((bone) => collect(bone.id));
    };
    collect(state.selectedBoneId);
    set({
      nodes: state.nodes.map((item) => item.id === node.id ? { ...item, rig: { ...item.rig!, bones: item.rig!.bones.filter((bone) => !removed.has(bone.id)) } } : item),
      tracks: state.tracks.filter((track) => track.nodeId !== node.id || ![...removed].some((id) => track.property.startsWith(`bone.${id}.`))),
      selectedBoneId: null,
    });
  },
  bindSelectedMesh: () => {
    const state = get();
    const node = state.nodes.find((item) => item.id === state.selectedId);
    if (!node?.rig) return;
    get().pushHistory();
    set({ nodes: state.nodes.map((item) => item.id === node.id ? { ...item, rig: { ...item.rig!, bound: true }, geometryVersion: item.geometryVersion + 1 } : item) });
  },
  importNodes: (imported) => {
    if (!imported.length) return;
    get().pushHistory();
    set((state) => ({ nodes: [...state.nodes, ...imported], selectedId: imported[0].id, selectedIds: [imported[0].id] }));
  },
  loadProject: (project, name) => {
    get().pushHistory();
    set({ ...project, projectName: name ?? get().projectName, selectedId: project.nodes[0]?.id ?? null, selectedIds: project.nodes[0] ? [project.nodes[0].id] : [], currentFrame: 0, isPlaying: false, selectedBoneId: null, selectedElements: [] });
  },
  resetDemo: () => get().loadProject(createDemoProject(), 'Astra Motion Study'),
}), {
  name: 'prisma-studio-project-v1',
  partialize: (state) => ({
    nodes: state.nodes, tracks: state.tracks, duration: state.duration, fps: state.fps,
    projectName: state.projectName, view: state.view,
  }),
  merge: (persisted, current) => {
    const restored = persisted as Partial<StudioState>;
    const nodes = restored.nodes ?? current.nodes;
    const selectedId = nodes[0]?.id ?? null;
    return {
      ...current, ...restored, nodes, selectedId, selectedIds: selectedId ? [selectedId] : [],
      view: { ...current.view, ...restored.view }, currentFrame: 0, isPlaying: false, past: [], future: [],
      selectedBoneId: null, selectedElements: [],
    };
  },
}));
