import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls, PerspectiveCamera, TransformControls } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useStudioStore } from '../store/useStudioStore';
import { sampleNodeAtFrame } from '../lib/animation';
import { applyAutomaticSkinning, createPrimitiveGeometry, dataToGeometry } from '../lib/geometry';
import { createTextGeometry } from '../lib/io';
import type { MaterialData, SceneNode, TextureSet } from '../types';

export const objectRegistry = new Map<string, THREE.Object3D>();
export const boneRegistry = new Map<string, THREE.Bone>();
const skinnedMeshRegistry = new Map<string, THREE.SkinnedMesh>();
export const viewportRuntime: { canvas: HTMLCanvasElement | null } = { canvas: null };

function makeSolidMatcap() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(43, 35, 3, 64, 64, 82);
  gradient.addColorStop(0, '#f2f5ff');
  gradient.addColorStop(0.22, '#aab5d2');
  gradient.addColorStop(0.62, '#58617a');
  gradient.addColorStop(1, '#1b2031');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function useTextureSet(textures: TextureSet) {
  const [maps, setMaps] = useState<{ albedo?: THREE.Texture; normal?: THREE.Texture; roughness?: THREE.Texture }>({});
  useEffect(() => {
    let alive = true;
    const loaded: THREE.Texture[] = [];
    const next: typeof maps = {};
    const entries = Object.entries(textures) as [keyof TextureSet, string][];
    if (!entries.length) setMaps({});
    entries.forEach(([slot, url]) => {
      if (!url) return;
      new THREE.TextureLoader().load(url, (texture) => {
        if (!alive) { texture.dispose(); return; }
        texture.colorSpace = slot === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = 4;
        loaded.push(texture);
        next[slot] = texture;
        setMaps({ ...next });
      });
    });
    return () => { alive = false; loaded.forEach((texture) => texture.dispose()); };
  }, [textures.albedo, textures.normal, textures.roughness]);
  return maps;
}

function PBRMaterial({ data }: { data: MaterialData }) {
  const shading = useStudioStore((state) => state.view.shading);
  const maps = useTextureSet(data.textures);
  const matcap = useMemo(makeSolidMatcap, []);
  if (shading === 'solid') {
    return <meshMatcapMaterial matcap={matcap} color={data.color} opacity={data.opacity} transparent={data.opacity < 1} side={THREE.DoubleSide} />;
  }
  if (shading === 'wireframe') {
    return <meshStandardMaterial color="#73c9e8" emissive="#173d52" emissiveIntensity={0.5} wireframe transparent opacity={0.9} />;
  }
  return (
    <meshStandardMaterial
      color={data.color}
      roughness={data.roughness}
      metalness={data.metalness}
      emissive={data.emissive}
      emissiveIntensity={data.emissiveIntensity}
      opacity={data.opacity}
      transparent={data.opacity < 1}
      map={maps.albedo ?? null}
      normalMap={maps.normal ?? null}
      roughnessMap={maps.roughness ?? null}
      side={THREE.DoubleSide}
      envMapIntensity={1.15}
    />
  );
}

function elementFromHit(event: ThreeEvent<PointerEvent>, mode: 'vertex' | 'edge' | 'face') {
  const faceIndex = event.faceIndex ?? 0;
  if (mode === 'face') return faceIndex;
  const mesh = event.object as THREE.Mesh;
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute('position');
  const triangle = [0, 1, 2].map((corner) => geometry.index ? geometry.index.getX(faceIndex * 3 + corner) : faceIndex * 3 + corner);
  const localPoint = mesh.worldToLocal(event.point.clone());
  const vertices = triangle.map((index) => new THREE.Vector3().fromBufferAttribute(positions, index));
  if (mode === 'vertex') {
    let closest = 0;
    let distance = Infinity;
    vertices.forEach((vertex, index) => {
      const next = vertex.distanceToSquared(localPoint);
      if (next < distance) { distance = next; closest = index; }
    });
    return faceIndex * 3 + closest;
  }
  let closestEdge = 0;
  let distance = Infinity;
  const line = new THREE.Line3();
  const closest = new THREE.Vector3();
  for (let edge = 0; edge < 3; edge += 1) {
    line.set(vertices[edge], vertices[(edge + 1) % 3]);
    line.closestPointToPoint(localPoint, true, closest);
    const next = closest.distanceToSquared(localPoint);
    if (next < distance) { distance = next; closestEdge = edge; }
  }
  return faceIndex * 3 + closestEdge;
}

function useMeshPointer(node: SceneNode) {
  const select = useStudioStore((state) => state.select);
  const setSelectedElements = useStudioStore((state) => state.setSelectedElements);
  return (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const { editMode, tool } = useStudioStore.getState().view;
    if (tool === 'bone') {
      select(node.id);
      return;
    }
    if (editMode === 'object') {
      select(node.id, event.shiftKey);
      return;
    }
    if (useStudioStore.getState().selectedId !== node.id) select(node.id);
    const element = elementFromHit(event, editMode);
    setSelectedElements([element], event.shiftKey);
  };
}

function EditOverlays({ node, geometry }: { node: SceneNode; geometry: THREE.BufferGeometry }) {
  const mode = useStudioStore((state) => state.view.editMode);
  const elements = useStudioStore((state) => state.selectedElements);
  const active = useStudioStore((state) => state.selectedId === node.id && mode !== 'object');
  const highlight = useMemo(() => {
    if (!active || !elements.length) return null;
    const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const output: number[] = [];
    const positions = source.getAttribute('position');
    const add = (vertex: number) => output.push(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
    elements.forEach((element) => {
      if (mode === 'vertex') add(element);
      if (mode === 'face') [0, 1, 2].forEach((corner) => add(element * 3 + corner));
      if (mode === 'edge') {
        const face = Math.floor(element / 3);
        const edge = element % 3;
        add(face * 3 + edge);
        add(face * 3 + ((edge + 1) % 3));
      }
    });
    source.dispose();
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(output, 3));
    return result;
  }, [active, elements, geometry, mode]);
  useEffect(() => () => highlight?.dispose(), [highlight]);
  if (!active) return null;
  return (
    <>
      {mode === 'vertex' && (
        <points geometry={geometry} raycast={() => null}>
          <pointsMaterial color="#9aabff" size={0.035} sizeAttenuation depthTest={false} transparent opacity={0.7} />
        </points>
      )}
      {mode === 'edge' && (
        <lineSegments raycast={() => null}>
          <wireframeGeometry args={[geometry]} />
          <lineBasicMaterial color="#7f8baa" transparent opacity={0.38} depthTest={false} />
        </lineSegments>
      )}
      {highlight && mode === 'edge' && (
        <lineSegments geometry={highlight} raycast={() => null} renderOrder={9}>
          <lineBasicMaterial color="#d9fbff" depthTest={false} toneMapped={false} />
        </lineSegments>
      )}
      {highlight && mode === 'face' && (
        <mesh geometry={highlight} raycast={() => null} renderOrder={8}>
          <meshBasicMaterial color="#55dcff" transparent opacity={0.34} depthTest={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {highlight && mode === 'vertex' && (
        <points geometry={highlight} raycast={() => null} renderOrder={9}>
          <pointsMaterial color="#d9fbff" size={0.075} sizeAttenuation depthTest={false} />
        </points>
      )}
    </>
  );
}

function StandardMesh({ node }: { node: SceneNode }) {
  const geometry = useMemo(() => node.type === 'text'
    ? createTextGeometry(node.text)
    : node.geometry ? dataToGeometry(node.geometry) : createPrimitiveGeometry(node.primitive), [node.id, node.geometry, node.geometryVersion, node.primitive, node.type, node.text]);
  const onPointerDown = useMeshPointer(node);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} onPointerDown={onPointerDown} castShadow receiveShadow>
      <PBRMaterial data={node.material} />
      <EditOverlays node={node} geometry={geometry} />
    </mesh>
  );
}

function RiggedMesh({ node, sampled }: { node: SceneNode; sampled: SceneNode }) {
  const rig = node.rig!;
  const structure = rig.bones.map((bone) => `${bone.id}:${bone.parentId}:${bone.position.join(',')}`).join('|');
  const built = useMemo(() => {
    const base = node.geometry ? dataToGeometry(node.geometry) : createPrimitiveGeometry(node.primitive);
    const geometry = applyAutomaticSkinning(base, rig.bones);
    base.dispose();
    const bones = rig.bones.map((data) => {
      const bone = new THREE.Bone();
      bone.name = data.id;
      bone.position.fromArray(data.position);
      bone.rotation.set(...data.rotation);
      bone.scale.fromArray(data.scale);
      bone.userData.nodeId = node.id;
      return bone;
    });
    rig.bones.forEach((data, index) => {
      const parent = rig.bones.findIndex((bone) => bone.id === data.parentId);
      if (parent >= 0) bones[parent].add(bones[index]);
    });
    const skeleton = new THREE.Skeleton(bones);
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = node.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const roots = bones.filter((_, index) => !rig.bones[index].parentId || !rig.bones.some((bone) => bone.id === rig.bones[index].parentId));
    roots.forEach((bone) => mesh.add(bone));
    mesh.bind(skeleton);
    return { mesh, bones, geometry };
    // Bind pose only changes when geometry or bone rest positions/topology change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.geometry, node.geometryVersion, structure]);
  useEffect(() => {
    skinnedMeshRegistry.set(node.id, built.mesh);
    built.bones.forEach((bone) => boneRegistry.set(`${node.id}:${bone.name}`, bone));
    return () => {
      skinnedMeshRegistry.delete(node.id);
      built.bones.forEach((bone) => boneRegistry.delete(`${node.id}:${bone.name}`));
      built.geometry.dispose();
      built.mesh.skeleton.dispose();
    };
  }, [built, node.id]);
  useLayoutEffect(() => {
    sampled.rig?.bones.forEach((data, index) => {
      const bone = built.bones[index];
      if (!bone) return;
      bone.position.fromArray(data.position);
      bone.rotation.set(...data.rotation);
      bone.scale.fromArray(data.scale);
    });
    built.mesh.updateMatrixWorld(true);
  }, [built, sampled.rig]);
  const onPointerDown = useMeshPointer(node);
  return (
    <primitive object={built.mesh} onPointerDown={onPointerDown}>
      <PBRMaterial data={sampled.material} />
    </primitive>
  );
}

function LightNode({ node }: { node: SceneNode }) {
  const light = useRef<THREE.Light>(null);
  const target = useRef<THREE.Object3D>(null);
  const select = useStudioStore((state) => state.select);
  const rendered = useStudioStore((state) => state.view.shading === 'rendered');
  useEffect(() => {
    if (light.current && target.current && 'target' in light.current) {
      (light.current as THREE.DirectionalLight).target = target.current;
    }
  }, []);
  const common = { color: node.color, intensity: node.intensity, castShadow: rendered };
  return (
    <>
      {node.type === 'pointLight' && <pointLight ref={light} {...common} distance={30} decay={2} shadow-mapSize={[512, 512]} />}
      {node.type === 'directionalLight' && <directionalLight ref={light} {...common} shadow-mapSize={[1024, 1024]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-bias={-0.0003} />}
      {node.type === 'spotLight' && <spotLight ref={light} {...common} distance={40} angle={Math.PI / 5} penumbra={0.55} decay={2} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0003} />}
      <object3D ref={target} position={[0, 0, -1]} />
      <mesh onPointerDown={(event) => { event.stopPropagation(); select(node.id); }}>
        {node.type === 'pointLight' ? <sphereGeometry args={[0.11, 12, 8]} /> : <octahedronGeometry args={[0.16, 0]} />}
        <meshBasicMaterial color={node.color} wireframe={node.type !== 'pointLight'} toneMapped={false} />
      </mesh>
    </>
  );
}

function CameraNode({ node }: { node: SceneNode }) {
  const select = useStudioStore((state) => state.select);
  return (
    <group onPointerDown={(event) => { event.stopPropagation(); select(node.id); }}>
      <mesh>
        <boxGeometry args={[0.42, 0.26, 0.55]} />
        <meshBasicMaterial color="#8793b5" wireframe />
      </mesh>
      <mesh position={[0, 0, -0.38]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.19, 0.35, 4]} />
        <meshBasicMaterial color="#8793b5" wireframe />
      </mesh>
    </group>
  );
}

function NodeView({ node, nodes }: { node: SceneNode; nodes: SceneNode[] }) {
  const tracks = useStudioStore((state) => state.tracks);
  const frame = useStudioStore((state) => state.currentFrame);
  const sampled = sampleNodeAtFrame(node, tracks, frame);
  const group = useRef<THREE.Group>(null);
  const children = nodes.filter((child) => child.parentId === node.id);
  useEffect(() => {
    if (group.current) objectRegistry.set(node.id, group.current);
    return () => { objectRegistry.delete(node.id); };
  }, [node.id]);
  const isMesh = !['group', 'camera', 'pointLight', 'directionalLight', 'spotLight'].includes(node.type);
  return (
    <group ref={group} name={node.name} position={sampled.position} rotation={sampled.rotation} scale={sampled.scale} visible={sampled.visible}>
      {isMesh && (sampled.rig?.bound && sampled.rig.bones.length ? <RiggedMesh node={sampled} sampled={sampled} /> : <StandardMesh node={sampled} />)}
      {node.type.includes('Light') && <LightNode node={sampled} />}
      {node.type === 'camera' && <CameraNode node={sampled} />}
      {children.map((child) => <NodeView key={child.id} node={child} nodes={nodes} />)}
    </group>
  );
}

function BoneJoint({ nodeId, boneId, index }: { nodeId: string; boneId: string; index: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const selected = useStudioStore((state) => state.selectedBoneId === boneId && state.selectedId === nodeId);
  const select = useStudioStore((state) => state.select);
  const selectBone = useStudioStore((state) => state.selectBone);
  useFrame(() => {
    const bone = boneRegistry.get(`${nodeId}:${boneId}`);
    if (mesh.current && bone) mesh.current.position.copy(bone.getWorldPosition(new THREE.Vector3()));
  });
  return (
    <mesh ref={mesh} renderOrder={20} onPointerDown={(event) => {
      event.stopPropagation(); select(nodeId); selectBone(boneId);
    }}>
      <sphereGeometry args={[selected ? 0.075 : 0.052, 10, 8]} />
      <meshBasicMaterial color={selected ? '#ecfaff' : index === 0 ? '#ffbd69' : '#62dcff'} depthTest={false} toneMapped={false} />
    </mesh>
  );
}

function BoneOverlay({ node }: { node: SceneNode }) {
  const lines = useRef<THREE.LineSegments>(null);
  const bones = node.rig?.bones ?? [];
  const edges = bones.filter((bone) => bone.parentId && bones.some((parent) => parent.id === bone.parentId));
  const geometry = useMemo(() => {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(edges.length * 6), 3));
    return result;
  }, [edges.length, node.id]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => {
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    edges.forEach((bone, index) => {
      const child = boneRegistry.get(`${node.id}:${bone.id}`);
      const parent = boneRegistry.get(`${node.id}:${bone.parentId}`);
      if (!child || !parent) return;
      const a = parent.getWorldPosition(new THREE.Vector3());
      const b = child.getWorldPosition(new THREE.Vector3());
      attribute.setXYZ(index * 2, a.x, a.y, a.z);
      attribute.setXYZ(index * 2 + 1, b.x, b.y, b.z);
    });
    attribute.needsUpdate = true;
    geometry.computeBoundingSphere();
    if (lines.current) lines.current.visible = node.visible;
  });
  return (
    <group>
      <lineSegments ref={lines} geometry={geometry} renderOrder={19} raycast={() => null}>
        <lineBasicMaterial color="#38c8f4" depthTest={false} transparent opacity={0.75} toneMapped={false} />
      </lineSegments>
      {bones.map((bone, index) => <BoneJoint key={bone.id} nodeId={node.id} boneId={bone.id} index={index} />)}
    </group>
  );
}

function SceneContent() {
  const nodes = useStudioStore((state) => state.nodes);
  const showBones = useStudioStore((state) => state.view.showBones);
  const selectedBoneId = useStudioStore((state) => state.selectedBoneId);
  const roots = nodes.filter((node) => !node.parentId || !nodes.some((parent) => parent.id === node.parentId));
  return (
    <>
      {roots.map((node) => <NodeView key={node.id} node={node} nodes={nodes} />)}
      {showBones && nodes.filter((node) => node.rig?.bound && node.visible).map((node) => <BoneOverlay key={node.id} node={node} />)}
      <TransformController key={selectedBoneId ?? 'object'} />
      <SelectionIndicator />
    </>
  );
}

function TransformController() {
  const selectedId = useStudioStore((state) => state.selectedId);
  const selectedBoneId = useStudioStore((state) => state.selectedBoneId);
  const selectedElements = useStudioStore((state) => state.selectedElements);
  const view = useStudioStore((state) => state.view);
  const updateNode = useStudioStore((state) => state.updateNode);
  const updateBone = useStudioStore((state) => state.updateBone);
  const transformElements = useStudioStore((state) => state.transformSelectedElements);
  const pushHistory = useStudioStore((state) => state.pushHistory);
  const [revision, setRevision] = useState(0);
  const pivot = useMemo(() => new THREE.Object3D(), []);
  const start = useRef(new THREE.Vector3());
  const node = useStudioStore((state) => state.nodes.find((item) => item.id === selectedId));
  const targetObject = selectedBoneId && selectedId ? boneRegistry.get(`${selectedId}:${selectedBoneId}`) : selectedId ? objectRegistry.get(selectedId) : null;
  const edit = view.editMode !== 'object' && selectedElements.length > 0;
  const target = edit ? pivot : targetObject;
  useEffect(() => {
    const timer = requestAnimationFrame(() => setRevision((value) => value + 1));
    return () => cancelAnimationFrame(timer);
  }, [selectedId, selectedBoneId, view.editMode, selectedElements.length, node?.geometryVersion]);
  useLayoutEffect(() => {
    if (!edit || !selectedId) return;
    const center = useStudioStore.getState().getSelectedElementCenter();
    const parent = objectRegistry.get(selectedId);
    pivot.position.fromArray(center);
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
    if (parent) {
      parent.updateWorldMatrix(true, false);
      pivot.position.applyMatrix4(parent.matrixWorld);
    }
    pivot.updateMatrixWorld(true);
  }, [edit, selectedId, selectedElements, node?.geometryVersion, pivot, revision]);
  if (!node || node.locked || !target || view.tool === 'select' || (!edit && view.tool === 'bone' && !selectedBoneId)) return null;
  const mode = edit ? 'translate' : view.tool === 'bone' ? 'rotate' : view.tool;
  return (
    <>
      {edit && <primitive object={pivot} />}
      <TransformControls
        object={target}
        mode={mode as 'translate' | 'rotate' | 'scale'}
        space={view.space}
        translationSnap={view.snapping ? view.translateSnap : null}
        rotationSnap={view.snapping ? view.rotateSnap : null}
        scaleSnap={view.snapping ? view.scaleSnap : null}
        size={0.78}
        onMouseDown={() => {
          if (!edit) pushHistory();
          start.current.copy(pivot.position);
        }}
        onMouseUp={() => {
          if (edit) {
            const worldDelta = pivot.position.clone().sub(start.current);
            const parent = objectRegistry.get(selectedId!);
            if (parent) {
              const worldQuaternion = parent.getWorldQuaternion(new THREE.Quaternion());
              worldDelta.applyQuaternion(worldQuaternion.invert());
              const worldScale = parent.getWorldScale(new THREE.Vector3());
              worldDelta.divide(worldScale);
            }
            if (worldDelta.lengthSq() > 0.0000001) transformElements(worldDelta.toArray());
            pivot.position.copy(start.current);
            return;
          }
          if (selectedBoneId && selectedId && targetObject) {
            updateBone(selectedId, selectedBoneId, {
              position: targetObject.position.toArray(), rotation: [targetObject.rotation.x, targetObject.rotation.y, targetObject.rotation.z], scale: targetObject.scale.toArray(),
            });
          } else if (selectedId && targetObject) {
            updateNode(selectedId, {
              position: targetObject.position.toArray(), rotation: [targetObject.rotation.x, targetObject.rotation.y, targetObject.rotation.z], scale: targetObject.scale.toArray(),
            }, true);
          }
        }}
      />
    </>
  );
}

function SelectionIndicator() {
  const selectedId = useStudioStore((state) => state.selectedId);
  const editMode = useStudioStore((state) => state.view.editMode);
  const bone = useStudioStore((state) => state.selectedBoneId);
  const object = selectedId && editMode === 'object' && !bone ? objectRegistry.get(selectedId) : null;
  const helper = useMemo(() => object ? new THREE.BoxHelper(object, 0x5adfff) : null, [object]);
  useEffect(() => () => { helper?.geometry.dispose(); (helper?.material as THREE.Material)?.dispose(); }, [helper]);
  useFrame(() => {
    if (!helper || !object) return;
    helper.visible = object.visible;
    helper.update();
    const material = helper.material as THREE.LineBasicMaterial;
    material.transparent = true;
    material.opacity = 0.72;
    material.depthTest = false;
  });
  return helper ? <primitive object={helper} renderOrder={18} raycast={() => null} /> : null;
}

const gridVertex = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const gridFragment = /* glsl */`
  varying vec3 vWorld;
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  float gridLine(vec2 p, float scale) {
    vec2 coord = p / scale;
    vec2 derivative = fwidth(coord);
    vec2 grid = abs(fract(coord - 0.5) - 0.5) / derivative;
    return 1.0 - min(min(grid.x, grid.y), 1.0);
  }
  void main() {
    float minor = gridLine(vWorld.xz, 0.25);
    float major = gridLine(vWorld.xz, 1.0);
    float distanceFade = 1.0 - smoothstep(9.0, 42.0, distance(cameraPosition.xz, vWorld.xz));
    float axisX = 1.0 - smoothstep(0.0, fwidth(vWorld.z) * 1.4 + 0.008, abs(vWorld.z));
    float axisZ = 1.0 - smoothstep(0.0, fwidth(vWorld.x) * 1.4 + 0.008, abs(vWorld.x));
    vec3 color = mix(uMinor, uMajor, major);
    color = mix(color, vec3(0.25, 0.55, 0.95), axisZ * 0.8);
    color = mix(color, vec3(0.95, 0.25, 0.38), axisX * 0.8);
    float alpha = max(minor * 0.19, major * 0.42) * distanceFade;
    alpha = max(alpha, max(axisX, axisZ) * 0.65 * distanceFade);
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

function InfiniteGrid() {
  const mesh = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => ({ uMinor: { value: new THREE.Color('#3b4057') }, uMajor: { value: new THREE.Color('#555d7c') } }), []);
  useFrame(({ camera }) => {
    if (!mesh.current) return;
    mesh.current.position.x = Math.round(camera.position.x / 10) * 10;
    mesh.current.position.z = Math.round(camera.position.z / 10) * 10;
  });
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, 0]} raycast={() => null}>
      <planeGeometry args={[120, 120]} />
      <shaderMaterial vertexShader={gridVertex} fragmentShader={gridFragment} uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function ActiveCamera() {
  const id = useStudioStore((state) => state.view.cameraViewId);
  const camera = useRef<THREE.PerspectiveCamera>(null);
  useFrame(() => {
    if (!id || !camera.current) return;
    const source = objectRegistry.get(id);
    if (!source) return;
    source.updateWorldMatrix(true, false);
    source.getWorldPosition(camera.current.position);
    source.getWorldQuaternion(camera.current.quaternion);
    camera.current.updateMatrixWorld();
  });
  return id ? <PerspectiveCamera ref={camera} makeDefault fov={45} near={0.05} far={250} /> : null;
}

function NavigationController() {
  const { camera, controls } = useThree();
  useEffect(() => {
    const navigate = (event: Event) => {
      const direction = (event as CustomEvent<string>).detail;
      const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
      const target = orbit?.target.clone() ?? new THREE.Vector3(0, 1, 0);
      const distance = camera.position.distanceTo(target) || 8;
      if (direction === 'front') camera.position.copy(target).add(new THREE.Vector3(0, 0.4, distance));
      if (direction === 'right') camera.position.copy(target).add(new THREE.Vector3(distance, 0.4, 0));
      if (direction === 'top') camera.position.copy(target).add(new THREE.Vector3(0, distance, 0.001));
      if (direction === 'perspective') camera.position.copy(target).add(new THREE.Vector3(distance * 0.65, distance * 0.4, distance * 0.75));
      if (direction === 'focus') {
        const id = useStudioStore.getState().selectedId;
        const object = id ? objectRegistry.get(id) : null;
        if (object) {
          const box = new THREE.Box3().setFromObject(object);
          const center = box.getCenter(new THREE.Vector3());
          const size = Math.max(1, box.getSize(new THREE.Vector3()).length());
          const offset = camera.position.clone().sub(orbit?.target ?? center).normalize().multiplyScalar(size * 1.4);
          orbit?.target.copy(center);
          camera.position.copy(center).add(offset);
        }
      }
      camera.lookAt(orbit?.target ?? target);
      orbit?.update();
    };
    window.addEventListener('prisma:navigate', navigate);
    return () => window.removeEventListener('prisma:navigate', navigate);
  }, [camera, controls]);
  return null;
}

function CanvasRuntime() {
  const { gl } = useThree();
  useEffect(() => {
    viewportRuntime.canvas = gl.domElement;
    return () => { viewportRuntime.canvas = null; };
  }, [gl]);
  return null;
}

export default function Viewport() {
  const shading = useStudioStore((state) => state.view.shading);
  const showGrid = useStudioStore((state) => state.view.showGrid);
  const cameraViewId = useStudioStore((state) => state.view.cameraViewId);
  const select = useStudioStore((state) => state.select);
  return (
    <Canvas
      className="studio-canvas"
      shadows={shading === 'rendered'}
      dpr={[1, 1.65]}
      camera={{ position: [5.4, 3.4, 6.5], fov: 42, near: 0.05, far: 300 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={[shading === 'solid' ? '#202331' : '#090b13']} />
      <fog attach="fog" args={['#090b13', 18, 65]} />
      <ambientLight intensity={shading === 'solid' ? 0 : 0.32} />
      <hemisphereLight args={['#9db4ff', '#171425', 0.65]} />
      {(shading === 'material' || shading === 'rendered') && (
        <Environment resolution={64}>
          <Lightformer form="rect" intensity={2.2} color="#dbe6ff" scale={[6, 4, 1]} position={[0, 5, 4]} rotation={[Math.PI / 2, 0, 0]} />
          <Lightformer form="rect" intensity={1.8} color="#8d6dff" scale={[4, 3, 1]} position={[-4, 2, -3]} rotation={[0, -Math.PI / 2, 0]} />
          <Lightformer form="ring" intensity={1.2} color="#5ce8ff" scale={3} position={[4, 2, 1]} rotation={[0, Math.PI / 2, 0]} />
        </Environment>
      )}
      {showGrid && <InfiniteGrid />}
      {shading === 'rendered' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]} receiveShadow raycast={() => null}>
          <planeGeometry args={[80, 80]} />
          <shadowMaterial transparent opacity={0.26} color="#02030a" />
        </mesh>
      )}
      <SceneContent />
      <OrbitControls makeDefault enabled={!cameraViewId} enableDamping dampingFactor={0.075} minDistance={0.4} maxDistance={80} maxPolarAngle={Math.PI * 0.495} target={[0, 1.2, 0]} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      <ActiveCamera />
      <NavigationController />
      <CanvasRuntime />
      {shading === 'rendered' && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.42} luminanceThreshold={1.35} luminanceSmoothing={0.55} mipmapBlur />
          <Vignette eskil={false} offset={0.18} darkness={0.48} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
