import { useMemo, useRef, useState } from 'react';
import {
  Bone, Box, Camera, Check, Diamond, Download, FileImage, Link2,
  MousePointer2, Move3D, Palette, Plus, Rotate3D, Scissors,
  Settings2, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import { getNodeProperty, sampleNodeAtFrame } from '../lib/animation';
import { getGeometryStats, getNodeGeometryData } from '../lib/geometry';
import { fileToDataUrl } from '../lib/io';
import type { EditMode, MaterialData, SceneNode, TextureSet, Vec3 } from '../types';
import { cn } from '../utils/cn';
import { EmptyState, IconButton, PanelSection, Segmented, SliderField, Toggle, ToolButton, VectorField } from './UI';

function KeyButton({ node, property, value }: { node: SceneNode; property: string; value?: number[] }) {
  const tracks = useStudioStore((state) => state.tracks);
  const frame = useStudioStore((state) => state.currentFrame);
  const addKey = useStudioStore((state) => state.addKey);
  const track = tracks.find((item) => item.nodeId === node.id && item.property === property);
  const keyed = track?.keys.some((key) => key.frame === Math.round(frame));
  return (
    <button
      type="button"
      className={cn('key-property-button', keyed && 'is-keyed', track && !keyed && 'has-track')}
      title={`Key ${property} at frame ${Math.round(frame)}`}
      onClick={() => addKey(node.id, property, frame, value ?? getNodeProperty(node, property))}
    ><Diamond size={11} fill={keyed ? 'currentColor' : 'none'} /></button>
  );
}

function TransformProperty({ node, property, label, degrees }: { node: SceneNode; property: 'position' | 'rotation' | 'scale'; label: string; degrees?: boolean }) {
  const updateNode = useStudioStore((state) => state.updateNode);
  const addKey = useStudioStore((state) => state.addKey);
  const autoKey = useStudioStore((state) => state.autoKey);
  const tracks = useStudioStore((state) => state.tracks);
  const frame = useStudioStore((state) => state.currentFrame);
  const onChange = (value: Vec3) => {
    updateNode(node.id, { [property]: value });
    if (autoKey || tracks.some((track) => track.nodeId === node.id && track.property === property)) addKey(node.id, property, frame, value);
  };
  return (
    <div className="property-with-key">
      <VectorField label={label} value={node[property]} degrees={degrees} onChange={onChange} />
      <KeyButton node={node} property={property} value={node[property]} />
    </div>
  );
}

function MaterialPropertyKey({ node, property }: { node: SceneNode; property: string }) {
  return <KeyButton node={node} property={property} value={getNodeProperty(node, property)} />;
}

function TextureSlot({ node, slot, label }: { node: SceneNode; slot: keyof TextureSet; label: string }) {
  const updateMaterial = useStudioStore((state) => state.updateMaterial);
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const url = node.material.textures[slot];
  const upload = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    try {
      const data = await fileToDataUrl(file);
      updateMaterial(node.id, { textures: { ...node.material.textures, [slot]: data } });
    } finally { setLoading(false); }
  };
  return (
    <div className="texture-slot">
      <button type="button" className="texture-preview" onClick={() => input.current?.click()} title={`Upload ${label} texture`}>
        {url ? <img src={url} alt={`${label} texture`} /> : <FileImage size={19} />}
        {loading && <span className="texture-loading" />}
      </button>
      <div className="min-w-0 flex-1">
        <strong>{label}</strong>
        <p>{url ? 'Embedded in project' : 'PNG, JPG or WebP'}</p>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => upload(event.target.files?.[0])} />
      <IconButton icon={url ? X : Upload} label={url ? `Remove ${label} map` : `Upload ${label} map`} onClick={() => {
        if (url) updateMaterial(node.id, { textures: { ...node.material.textures, [slot]: undefined } });
        else input.current?.click();
      }} />
    </div>
  );
}

function ObjectInspector({ node }: { node: SceneNode }) {
  const updateNode = useStudioStore((state) => state.updateNode);
  const renameNode = useStudioStore((state) => state.renameNode);
  const setView = useStudioStore((state) => state.setView);
  const cameraViewId = useStudioStore((state) => state.view.cameraViewId);
  return (
    <>
      <PanelSection title="Object" icon={Box}>
        <label className="stack-field"><span>Name</span><input value={node.name} onChange={(event) => renameNode(node.id, event.target.value)} /></label>
        <div className="metadata-row"><span>Type</span><strong>{node.type}</strong></div>
        <div className="metadata-row"><span>Node ID</span><code>{node.id}</code></div>
      </PanelSection>
      <PanelSection title="Transform" icon={Move3D}>
        <TransformProperty node={node} property="position" label="Location" />
        <TransformProperty node={node} property="rotation" label="Rotation" degrees />
        <TransformProperty node={node} property="scale" label="Scale" />
      </PanelSection>
      {node.type === 'text' && (
        <PanelSection title="Text 3D" icon={Sparkles}>
          <label className="stack-field"><span>Content</span><input value={node.text} onChange={(event) => updateNode(node.id, { text: event.target.value })} /></label>
          <p className="panel-hint">True beveled glyph geometry is generated from a bundled local typeface; no external font is requested.</p>
        </PanelSection>
      )}
      {node.type === 'camera' && (
        <PanelSection title="Camera" icon={Camera}>
          <button type="button" className={cn('wide-action', cameraViewId === node.id && 'is-active')} onClick={() => setView({ cameraViewId: cameraViewId === node.id ? null : node.id })}>
            <Camera size={15} />{cameraViewId === node.id ? 'Exit camera view' : 'Look through this camera'}
          </button>
          <div className="metadata-row"><span>Lens</span><strong>45 mm · 45° FOV</strong></div>
          <p className="panel-hint">Animate Location and Rotation, then enable camera view for a cinematic preview.</p>
        </PanelSection>
      )}
      {node.type.includes('Light') && (
        <PanelSection title="Light" icon={Sparkles}>
          <label className="color-field"><span>Light color</span><input type="color" value={node.color} onChange={(event) => updateNode(node.id, { color: event.target.value })} /><code>{node.color}</code></label>
          <SliderField label="Energy" value={node.intensity ?? 1} min={0} max={node.type === 'directionalLight' ? 10 : 200} step={0.5} onChange={(intensity) => updateNode(node.id, { intensity })} />
          <p className="panel-hint">Rendered shading enables real-time PCF soft shadows. Rotate the light to aim its target.</p>
        </PanelSection>
      )}
    </>
  );
}

function MeshInspector({ node }: { node: SceneNode }) {
  const view = useStudioStore((state) => state.view);
  const setEditMode = useStudioStore((state) => state.setEditMode);
  const applyOperation = useStudioStore((state) => state.applyMeshOperation);
  const selectedElements = useStudioStore((state) => state.selectedElements);
  const [amount, setAmount] = useState(0.35);
  const supported = !['group', 'camera', 'pointLight', 'directionalLight', 'spotLight', 'text'].includes(node.type);
  const stats = useMemo(() => supported ? getGeometryStats(getNodeGeometryData(node)) : null, [node, supported]);
  if (!supported) return <EmptyState icon={Box} title="No editable mesh" description="Select a primitive or imported mesh to edit its geometry." />;
  return (
    <>
      <PanelSection title="Selection mode" icon={MousePointer2}>
        <Segmented<EditMode>
          label="Mesh selection mode"
          value={view.editMode}
          onChange={setEditMode}
          options={[{ value: 'object', label: 'Object' }, { value: 'vertex', label: 'Vertex' }, { value: 'edge', label: 'Edge' }, { value: 'face', label: 'Face' }]}
        />
        <div className="selection-readout">
          <span>{view.editMode === 'object' ? 'Object transforms' : `${selectedElements.length} ${view.editMode}${selectedElements.length === 1 ? '' : 's'} selected`}</span>
          <kbd>{view.editMode === 'object' ? '1' : view.editMode === 'vertex' ? '2' : view.editMode === 'edge' ? '3' : '4'}</kbd>
        </div>
        <p className="panel-hint">Click mesh elements in the viewport. Shift-click adds to the selection; drag the gizmo to move them directly.</p>
      </PanelSection>
      <PanelSection title="Geometry operations" icon={Scissors}>
        <SliderField label="Offset / inset" value={amount} min={0.02} max={1.5} step={0.01} onChange={setAmount} />
        <div className="grid grid-cols-3 gap-1.5">
          <ToolButton icon={Move3D} label="Extrude" onClick={() => applyOperation('extrude', amount)} />
          <ToolButton icon={Box} label="Inset" onClick={() => applyOperation('inset', Math.min(0.8, amount))} />
          <ToolButton icon={Plus} label="Subdivide" onClick={() => applyOperation('subdivide')} />
        </div>
        {view.editMode === 'face' && !selectedElements.length && <p className="warning-hint">Select at least one face before extruding or insetting.</p>}
      </PanelSection>
      <PanelSection title="Mesh data" icon={Settings2}>
        <div className="mesh-stat-grid">
          <div><strong>{stats?.vertices.toLocaleString()}</strong><span>Vertices</span></div>
          <div><strong>{Math.round(stats?.triangles ?? 0).toLocaleString()}</strong><span>Triangles</span></div>
        </div>
        <div className="metadata-row"><span>Geometry revision</span><strong>{node.geometryVersion}</strong></div>
        <div className="metadata-row"><span>Normals</span><strong>Automatic</strong></div>
      </PanelSection>
    </>
  );
}

function RigInspector({ node }: { node: SceneNode }) {
  const selectedBoneId = useStudioStore((state) => state.selectedBoneId);
  const selectBone = useStudioStore((state) => state.selectBone);
  const addBone = useStudioStore((state) => state.addBone);
  const removeBone = useStudioStore((state) => state.removeBone);
  const bindSelectedMesh = useStudioStore((state) => state.bindSelectedMesh);
  const updateBone = useStudioStore((state) => state.updateBone);
  const addKey = useStudioStore((state) => state.addKey);
  const setView = useStudioStore((state) => state.setView);
  const showBones = useStudioStore((state) => state.view.showBones);
  const autoKey = useStudioStore((state) => state.autoKey);
  const frame = useStudioStore((state) => state.currentFrame);
  const tracks = useStudioStore((state) => state.tracks);
  const bone = node.rig?.bones.find((item) => item.id === selectedBoneId) ?? node.rig?.bones[0];
  if (!node.rig) {
    return <EmptyState icon={Bone} title="Create an armature" description="Add a root bone to this mesh. Additional bones form connected chains and bind automatically." />;
  }
  const changeBone = (property: 'position' | 'rotation' | 'scale', value: Vec3) => {
    if (!bone) return;
    updateBone(node.id, bone.id, { [property]: value });
    const path = `bone.${bone.id}.${property}`;
    if (autoKey || tracks.some((track) => track.nodeId === node.id && track.property === path)) addKey(node.id, path, frame, value);
  };
  return (
    <>
      <PanelSection title="Armature" icon={Bone} right={<span className="status-badge"><span />{node.rig.bound ? 'Bound' : 'Unbound'}</span>}>
        <div className="metadata-row"><span>Skeleton</span><strong>{node.rig.bones.length} bones</strong></div>
        <Toggle label="Show bone overlay" checked={showBones} onChange={(value) => setView({ showBones: value })} />
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <ToolButton icon={Plus} label="Child bone" onClick={addBone} />
          <ToolButton icon={Link2} label="Auto bind" onClick={bindSelectedMesh} />
        </div>
        <p className="panel-hint">Automatic skinning assigns four normalized weights per vertex using distance to the nearest bone segments.</p>
      </PanelSection>
      <PanelSection title="Bone chain" icon={Bone}>
        <div className="bone-list">
          {node.rig.bones.map((item) => (
            <button type="button" key={item.id} className={cn(bone?.id === item.id && 'is-active')} onClick={() => selectBone(item.id)}>
              <Bone size={12} /><span>{item.name}</span><small>{item.parentId ? 'Child' : 'Root'}</small>
            </button>
          ))}
        </div>
      </PanelSection>
      {bone && (
        <PanelSection title={`Pose · ${bone.name}`} icon={Rotate3D} right={<IconButton icon={Trash2} label="Delete bone and its children" onClick={removeBone} />}>
          <div className="property-with-key">
            <VectorField label="Rotation" value={bone.rotation} degrees onChange={(value) => changeBone('rotation', value)} />
            <KeyButton node={node} property={`bone.${bone.id}.rotation`} value={bone.rotation} />
          </div>
          <div className="property-with-key">
            <VectorField label="Offset" value={bone.position} onChange={(value) => changeBone('position', value)} />
            <KeyButton node={node} property={`bone.${bone.id}.position`} value={bone.position} />
          </div>
          <p className="panel-hint">Use the viewport rotation gizmo or these fields. The attached skinned mesh deforms immediately.</p>
        </PanelSection>
      )}
    </>
  );
}

function MaterialInspector({ node }: { node: SceneNode }) {
  const updateMaterial = useStudioStore((state) => state.updateMaterial);
  const autoKey = useStudioStore((state) => state.autoKey);
  const tracks = useStudioStore((state) => state.tracks);
  const addKey = useStudioStore((state) => state.addKey);
  const frame = useStudioStore((state) => state.currentFrame);
  const change = (patch: Partial<MaterialData>) => {
    updateMaterial(node.id, patch);
    Object.keys(patch).forEach((key) => {
      const property = `material.${key}`;
      if (autoKey || tracks.some((track) => track.nodeId === node.id && track.property === property)) {
        const updated = { ...node, material: { ...node.material, ...patch } };
        addKey(node.id, property, frame, getNodeProperty(updated, property));
      }
    });
  };
  return (
    <>
      <PanelSection title="PBR surface" icon={Palette} right={<span className="status-badge"><span />Standard</span>}>
        <div className="property-with-key">
          <label className="color-field"><span>Base color</span><input type="color" value={node.material.color} onChange={(event) => change({ color: event.target.value })} /><code>{node.material.color}</code></label>
          <MaterialPropertyKey node={node} property="material.color" />
        </div>
        <div className="property-with-key"><SliderField label="Roughness" value={node.material.roughness} min={0} max={1} onChange={(roughness) => change({ roughness })} /><MaterialPropertyKey node={node} property="material.roughness" /></div>
        <div className="property-with-key"><SliderField label="Metalness" value={node.material.metalness} min={0} max={1} onChange={(metalness) => change({ metalness })} /><MaterialPropertyKey node={node} property="material.metalness" /></div>
        <div className="property-with-key"><SliderField label="Opacity" value={node.material.opacity} min={0} max={1} onChange={(opacity) => change({ opacity })} /><MaterialPropertyKey node={node} property="material.opacity" /></div>
      </PanelSection>
      <PanelSection title="Emission" icon={Sparkles}>
        <div className="property-with-key">
          <label className="color-field"><span>Emissive color</span><input type="color" value={node.material.emissive} onChange={(event) => change({ emissive: event.target.value })} /><code>{node.material.emissive}</code></label>
          <MaterialPropertyKey node={node} property="material.emissive" />
        </div>
        <div className="property-with-key"><SliderField label="Strength" value={node.material.emissiveIntensity} min={0} max={8} step={0.05} onChange={(emissiveIntensity) => change({ emissiveIntensity })} /><MaterialPropertyKey node={node} property="material.emissiveIntensity" /></div>
      </PanelSection>
      <PanelSection title="Texture maps" icon={FileImage}>
        <div className="space-y-2">
          <TextureSlot node={node} slot="albedo" label="Albedo" />
          <TextureSlot node={node} slot="normal" label="Normal" />
          <TextureSlot node={node} slot="roughness" label="Roughness" />
        </div>
        <p className="panel-hint">Images are converted to data URLs and saved inside the local project. Uploaded maps also appear in Material Preview and Rendered modes.</p>
      </PanelSection>
    </>
  );
}

export default function Inspector() {
  const [tab, setTab] = useState<'object' | 'mesh' | 'rig' | 'material'>('object');
  const selectedId = useStudioStore((state) => state.selectedId);
  const base = useStudioStore((state) => state.nodes.find((node) => node.id === selectedId));
  const tracks = useStudioStore((state) => state.tracks);
  const frame = useStudioStore((state) => state.currentFrame);
  const addBone = useStudioStore((state) => state.addBone);
  const setView = useStudioStore((state) => state.setView);
  if (!base) return <EmptyState icon={MousePointer2} title="Nothing selected" description="Select an object in the viewport or scene outliner to inspect and animate it." />;
  const node = sampleNodeAtFrame(base, tracks, frame);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="panel-titlebar inspector-titlebar">
        <div><Settings2 size={14} /><span>Inspector</span></div>
        <span className="selection-chip">{node.name}</span>
      </div>
      <div className="inspector-tabs">
        {([['object', Settings2, 'Object'], ['mesh', Box, 'Mesh'], ['rig', Bone, 'Rig'], ['material', Palette, 'Material']] as const).map(([value, Icon, label]) => (
          <button type="button" key={value} className={cn(tab === value && 'is-active')} onClick={() => setTab(value)}><Icon size={14} /><span>{label}</span></button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'object' && <ObjectInspector node={node} />}
        {tab === 'mesh' && <MeshInspector node={node} />}
        {tab === 'rig' && (node.rig ? <RigInspector node={node} /> : (
          <div className="p-3">
            <EmptyState icon={Bone} title="Rig this object" description="Create a root bone, then extend a connected chain. Vertex weights are generated automatically." />
            <button type="button" className="primary-action mt-3 w-full" onClick={() => { addBone(); setView({ showBones: true, tool: 'rotate' }); }}><Plus size={15} />Create armature</button>
          </div>
        ))}
        {tab === 'material' && <MaterialInspector node={node} />}
      </div>
      <div className="inspector-footer"><Check size={11} /><span>Changes saved locally</span><Download size={11} /><span>Export ready</span></div>
    </div>
  );
}
