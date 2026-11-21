import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import fontData from 'three-font/examples/fonts/helvetiker_regular.typeface.json';
import JSZip from 'jszip';
import type { MaterialData, ProjectSnapshot, SceneNode, Track } from '../types';
import { DEFAULT_MATERIAL } from '../types';
import { applyAutomaticSkinning, createPrimitiveGeometry, dataToGeometry, geometryToData } from './geometry';
import { sampleNodeAtFrame } from './animation';

const uid = () => Math.random().toString(36).slice(2, 10);
const font = new FontLoader().parse(fontData);

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function textureToDataUrl(texture?: THREE.Texture | null): Promise<string | undefined> {
  if (!texture?.image) return undefined;
  try {
    const image = texture.image as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    // Compressed/GPU-only texture formats remain importable as geometry even
    // when the browser cannot read their pixels back into a 2D canvas.
    return undefined;
  }
}

function importedMaterial(input: THREE.Material | THREE.Material[]): MaterialData {
  const source = (Array.isArray(input) ? input[0] : input) as THREE.MeshStandardMaterial;
  return {
    ...DEFAULT_MATERIAL,
    color: source?.color ? `#${source.color.getHexString()}` : DEFAULT_MATERIAL.color,
    roughness: typeof source?.roughness === 'number' ? source.roughness : 0.45,
    metalness: typeof source?.metalness === 'number' ? source.metalness : 0.05,
    emissive: source?.emissive ? `#${source.emissive.getHexString()}` : '#000000',
    emissiveIntensity: source?.emissiveIntensity ?? 0,
    opacity: source?.opacity ?? 1,
    textures: {},
  };
}

/** Import mesh geometry and world transforms into the editable native scene format. */
export async function importModel(file: File): Promise<SceneNode[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  let root: THREE.Group | THREE.Object3D;
  if (extension === 'obj') {
    root = new OBJLoader().parse(await file.text());
  } else if (extension === 'gltf' || extension === 'glb') {
    const buffer = await file.arrayBuffer();
    const data = extension === 'gltf' ? new TextDecoder().decode(buffer) : buffer;
    const gltf = await new GLTFLoader().parseAsync(data, '');
    root = gltf.scene;
  } else if (extension === 'fbx') {
    root = new FBXLoader().parse(await file.arrayBuffer(), '');
  } else {
    throw new Error('Choose an OBJ, GLTF, GLB, or FBX file.');
  }
  root.updateMatrixWorld(true);
  const nodes: SceneNode[] = [];
  const textureJobs: Promise<void>[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    object.matrixWorld.decompose(position, quaternion, scale);
    const rotation = new THREE.Euler().setFromQuaternion(quaternion);
    const geometry = object.geometry.clone();
    // Imported triangles remain fully editable; normals are rebuilt only when absent.
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    nodes.push({
      id: uid(), name: object.name || `${file.name} · Mesh ${nodes.length + 1}`, type: 'mesh', parentId: null,
      position: position.toArray(), rotation: [rotation.x, rotation.y, rotation.z], scale: scale.toArray(),
      visible: object.visible, locked: false, primitive: 'mesh', geometry: geometryToData(geometry), geometryVersion: 0,
      material: importedMaterial(object.material),
    });
    const target = nodes[nodes.length - 1];
    const source = (Array.isArray(object.material) ? object.material[0] : object.material) as THREE.MeshStandardMaterial;
    ([['albedo', source.map], ['normal', source.normalMap], ['roughness', source.roughnessMap]] as const).forEach(([slot, texture]) => {
      textureJobs.push(textureToDataUrl(texture).then((url) => {
        if (url) target.material.textures[slot] = url;
      }));
    });
    geometry.dispose();
  });
  if (!nodes.length) throw new Error('The file loaded, but no mesh objects were found.');
  await Promise.all(textureJobs);
  return nodes;
}

export function createTextGeometry(text = 'PRISMA') {
  const geometry = new TextGeometry(text || 'TEXT', {
    font, size: 0.7, depth: 0.16, curveSegments: 6, bevelEnabled: true,
    bevelThickness: 0.018, bevelSize: 0.012, bevelSegments: 2,
  });
  geometry.center();
  return geometry;
}

function makeMaterial(data: MaterialData, shading: 'material' | 'rendered' = 'rendered') {
  const material = new THREE.MeshStandardMaterial({
    color: data.color, roughness: data.roughness, metalness: data.metalness,
    emissive: data.emissive, emissiveIntensity: data.emissiveIntensity,
    opacity: data.opacity, transparent: data.opacity < 1,
  });
  if (shading === 'material') material.envMapIntensity = 1.2;
  return material;
}

/** Build a fresh Three.js hierarchy for exporters, evaluated at a chosen animation frame. */
export function buildExportScene(nodes: SceneNode[], tracks: Track[], frame: number): THREE.Scene {
  const scene = new THREE.Scene();
  const objects = new Map<string, THREE.Object3D>();
  const sampled = nodes.map((node) => sampleNodeAtFrame(node, tracks, frame));
  sampled.forEach((node) => {
    let object: THREE.Object3D;
    if (node.type === 'group') object = new THREE.Group();
    else if (node.type === 'camera') object = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 200);
    else if (node.type === 'pointLight') object = new THREE.PointLight(node.color, node.intensity, 30, 2);
    else if (node.type === 'directionalLight') object = new THREE.DirectionalLight(node.color, node.intensity);
    else if (node.type === 'spotLight') object = new THREE.SpotLight(node.color, node.intensity, 40, Math.PI / 5, 0.5, 2);
    else {
      let geometry = node.type === 'text' ? createTextGeometry(node.text) : node.geometry ? dataToGeometry(node.geometry) : createPrimitiveGeometry(node.primitive);
      if (node.rig?.bound && node.rig.bones.length) geometry = applyAutomaticSkinning(geometry, node.rig.bones);
      object = new THREE.Mesh(geometry, makeMaterial(node.material));
      object.userData.prismaTextures = node.material.textures;
    }
    object.name = node.name;
    object.position.fromArray(node.position);
    object.rotation.set(...node.rotation);
    object.scale.fromArray(node.scale);
    object.visible = node.visible;
    objects.set(node.id, object);
  });
  sampled.forEach((node) => {
    const object = objects.get(node.id)!;
    const parent = node.parentId ? objects.get(node.parentId) : scene;
    parent?.add(object);
  });
  return scene;
}

export async function exportGLB(nodes: SceneNode[], tracks: Track[], frame: number, filename: string) {
  const scene = buildExportScene(nodes, tracks, frame);
  const textureJobs: Promise<void>[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const textures = object.userData.prismaTextures as SceneNode['material']['textures'] | undefined;
    const material = object.material as THREE.MeshStandardMaterial;
    if (textures) {
      Object.entries(textures).forEach(([slot, url]) => {
        if (!url) return;
        textureJobs.push(new THREE.TextureLoader().loadAsync(url).then((texture) => {
          texture.colorSpace = slot === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          if (slot === 'albedo') material.map = texture;
          if (slot === 'normal') material.normalMap = texture;
          if (slot === 'roughness') material.roughnessMap = texture;
          material.needsUpdate = true;
        }));
      });
    }
    delete object.userData.prismaTextures;
  });
  await Promise.all(textureJobs);
  const result = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true, trs: true });
  downloadBlob(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), `${filename}.glb`);
}

export function exportOBJ(nodes: SceneNode[], tracks: Track[], frame: number, filename: string) {
  const scene = buildExportScene(nodes, tracks, frame);
  const output = new OBJExporter().parse(scene);
  downloadBlob(new Blob([output], { type: 'text/plain' }), `${filename}.obj`);
}

export function exportProject(project: ProjectSnapshot, name: string, filename: string) {
  const payload = JSON.stringify({ format: 'prisma-studio/1', name, project }, null, 2);
  downloadBlob(new Blob([payload], { type: 'application/json' }), `${filename}.prisma.json`);
}

export async function importProject(file: File): Promise<{ name: string; project: ProjectSnapshot }> {
  const data = JSON.parse(await file.text());
  if (data.format !== 'prisma-studio/1' || !Array.isArray(data.project?.nodes) || !Array.isArray(data.project?.tracks)) {
    throw new Error('This is not a valid Prisma Studio project file.');
  }
  return { name: data.name || 'Imported project', project: data.project };
}

export async function exportCurrentPNG(canvas: HTMLCanvasElement, filename: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not capture this frame.');
  downloadBlob(blob, `${filename}.png`);
}

export async function exportPNGSequence(options: {
  canvas: HTMLCanvasElement;
  filename: string;
  start: number;
  end: number;
  fps: number;
  setFrame: (frame: number) => void;
  onProgress?: (progress: number) => void;
}) {
  const { canvas, filename, start, end, setFrame, onProgress } = options;
  const zip = new JSZip();
  const folder = zip.folder(filename)!;
  const total = Math.max(1, end - start + 1);
  for (let frame = start; frame <= end; frame += 1) {
    setFrame(frame);
    // Two presentation frames ensure React, skinning, and camera evaluation have committed.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error(`Could not capture frame ${frame}.`);
    folder.file(`${filename}_${String(frame).padStart(5, '0')}.png`, blob);
    onProgress?.((frame - start + 1) / total * 0.8);
  }
  const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } }, (meta) => {
    onProgress?.(0.8 + meta.percent / 100 * 0.2);
  });
  downloadBlob(archive, `${filename}_${start}-${end}.zip`);
}

export function createVideoRecorder(canvas: HTMLCanvasElement, fps: number, preferred: 'mp4' | 'webm') {
  if (!('MediaRecorder' in window) || !canvas.captureStream) throw new Error('Video recording is not supported by this browser.');
  const candidates = preferred === 'mp4'
    ? ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) throw new Error('No supported video encoder was found. PNG sequence export is still available.');
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  return {
    mimeType,
    extension: mimeType.includes('mp4') ? 'mp4' : 'webm',
    start: () => recorder.start(250),
    stop: () => new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error('The video encoder stopped unexpectedly.'));
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        resolve(new Blob(chunks, { type: mimeType }));
      };
      recorder.stop();
    }),
  };
}
