export type Vec3 = [number, number, number];

export type PrimitiveType =
  | 'cube'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'plane'
  | 'torus'
  | 'text'
  | 'mesh';

export type NodeType = PrimitiveType | 'group' | 'camera' | 'pointLight' | 'directionalLight' | 'spotLight';
export type ToolMode = 'select' | 'translate' | 'rotate' | 'scale' | 'bone';
export type EditMode = 'object' | 'vertex' | 'edge' | 'face';
export type ShadingMode = 'wireframe' | 'solid' | 'material' | 'rendered';
export type Interpolation = 'linear' | 'bezier' | 'constant';
export type CoordinateSpace = 'world' | 'local';

export interface GeometryData {
  positions: number[];
  normals?: number[];
  uvs?: number[];
  indices?: number[];
}

export interface TextureSet {
  albedo?: string;
  normal?: string;
  roughness?: string;
}

export interface MaterialData {
  color: string;
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  textures: TextureSet;
}

export interface BoneData {
  id: string;
  name: string;
  parentId: string | null;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface RigData {
  bones: BoneData[];
  bound: boolean;
}

export interface SceneNode {
  id: string;
  name: string;
  type: NodeType;
  parentId: string | null;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  locked: boolean;
  primitive?: PrimitiveType;
  geometry?: GeometryData;
  geometryVersion: number;
  material: MaterialData;
  text?: string;
  color?: string;
  intensity?: number;
  rig?: RigData;
}

export interface Keyframe {
  id: string;
  frame: number;
  value: number[];
  interpolation: Interpolation;
}

export interface Track {
  id: string;
  nodeId: string;
  /** position, rotation, scale, material.color, material.opacity, bone.<id>.rotation */
  property: string;
  keys: Keyframe[];
}

export interface ProjectSnapshot {
  nodes: SceneNode[];
  tracks: Track[];
  duration: number;
  fps: number;
}

export interface ViewSettings {
  tool: ToolMode;
  editMode: EditMode;
  shading: ShadingMode;
  space: CoordinateSpace;
  snapping: boolean;
  translateSnap: number;
  rotateSnap: number;
  scaleSnap: number;
  showGrid: boolean;
  showBones: boolean;
  cameraViewId: string | null;
}

export const DEFAULT_MATERIAL: MaterialData = {
  color: '#8b9dff',
  roughness: 0.38,
  metalness: 0.18,
  emissive: '#000000',
  emissiveIntensity: 0,
  opacity: 1,
  textures: {},
};
