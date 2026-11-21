import { useMemo, useState } from 'react';
import {
  Bone, Box, Camera, ChevronDown, ChevronRight, Circle, Cone, Cylinder, Donut,
  Eye, EyeOff, Flashlight, Folder, Group, Layers3, Lightbulb, Lock, Search, Shapes,
  Sun, Type, Unlink, Unlock, X,
} from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import { getGeometryStats } from '../lib/geometry';
import type { SceneNode } from '../types';
import { cn } from '../utils/cn';
import { IconButton } from './UI';

function NodeIcon({ node, size = 14 }: { node: SceneNode; size?: number }) {
  const props = { size, strokeWidth: 1.65 };
  if (node.type === 'cube' || node.type === 'mesh') return <Box {...props} />;
  if (node.type === 'sphere') return <Circle {...props} />;
  if (node.type === 'cylinder') return <Cylinder {...props} />;
  if (node.type === 'cone') return <Cone {...props} />;
  if (node.type === 'torus') return <Donut {...props} />;
  if (node.type === 'plane') return <Layers3 {...props} />;
  if (node.type === 'text') return <Type {...props} />;
  if (node.type === 'camera') return <Camera {...props} />;
  if (node.type === 'pointLight') return <Lightbulb {...props} />;
  if (node.type === 'directionalLight') return <Sun {...props} />;
  if (node.type === 'spotLight') return <Flashlight {...props} />;
  if (node.type === 'group') return <Folder {...props} />;
  return <Shapes {...props} />;
}

function OutlinerRow({ node, nodes, depth, search }: { node: SceneNode; nodes: SceneNode[]; depth: number; search: string }) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);
  const selectedIds = useStudioStore((state) => state.selectedIds);
  const selected = selectedIds.includes(node.id);
  const select = useStudioStore((state) => state.select);
  const selectBone = useStudioStore((state) => state.selectBone);
  const selectedBoneId = useStudioStore((state) => state.selectedBoneId);
  const selectedId = useStudioStore((state) => state.selectedId);
  const updateNode = useStudioStore((state) => state.updateNode);
  const renameNode = useStudioStore((state) => state.renameNode);
  const reparentNode = useStudioStore((state) => state.reparentNode);
  const children = nodes.filter((item) => item.parentId === node.id);
  const matches = !search || node.name.toLowerCase().includes(search.toLowerCase()) || node.rig?.bones.some((bone) => bone.name.toLowerCase().includes(search.toLowerCase()));
  const childMatches = (id: string): boolean => nodes.filter((item) => item.parentId === id).some((item) => item.name.toLowerCase().includes(search.toLowerCase()) || childMatches(item.id));
  if (search && !matches && !childMatches(node.id)) return null;
  const hasChildren = children.length > 0 || !!node.rig?.bones.length;
  return (
    <div>
      <div
        className={cn('outliner-row group/row', selected && 'is-selected', dropTarget && 'is-drop-target', !node.visible && 'is-hidden')}
        style={{ paddingLeft: `${7 + depth * 14}px` }}
        draggable={!renaming}
        onDragStart={(event) => { event.dataTransfer.setData('application/prisma-node', node.id); event.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(event) => { event.preventDefault(); setDropTarget(true); event.dataTransfer.dropEffect = 'move'; }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(event) => {
          event.preventDefault(); event.stopPropagation(); setDropTarget(false);
          const id = event.dataTransfer.getData('application/prisma-node');
          if (id && id !== node.id) reparentNode(id, node.id);
        }}
        onClick={(event) => select(node.id, event.ctrlKey || event.metaKey || event.shiftKey)}
        onDoubleClick={() => setRenaming(true)}
      >
        <button type="button" className={cn('tree-expander', !hasChildren && 'invisible')} onClick={(event) => { event.stopPropagation(); setOpen(!open); }} aria-label={open ? 'Collapse node' : 'Expand node'}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className={cn('node-type-icon', node.type.includes('Light') && 'text-amber-300', node.type === 'camera' && 'text-violet-300', node.rig && 'text-cyan-300')}><NodeIcon node={node} /></span>
        {renaming ? (
          <input
            autoFocus
            className="rename-input"
            defaultValue={node.name}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { renameNode(node.id, event.currentTarget.value.trim() || node.name); setRenaming(false); }
              if (event.key === 'Escape') setRenaming(false);
            }}
            onBlur={(event) => { renameNode(node.id, event.target.value.trim() || node.name); setRenaming(false); }}
          />
        ) : <span className="node-name">{node.name}</span>}
        <div className="row-actions">
          <button type="button" aria-label={node.locked ? 'Unlock object' : 'Lock object'} onClick={(event) => { event.stopPropagation(); updateNode(node.id, { locked: !node.locked }); }}>
            {node.locked ? <Lock size={12} className="text-amber-400" /> : <Unlock size={12} />}
          </button>
          <button type="button" aria-label={node.visible ? 'Hide object' : 'Show object'} onClick={(event) => { event.stopPropagation(); updateNode(node.id, { visible: !node.visible }); }}>
            {node.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-slate-600" />}
          </button>
        </div>
      </div>
      {(open || !!search) && (
        <>
          {children.map((child) => <OutlinerRow key={child.id} node={child} nodes={nodes} depth={depth + 1} search={search} />)}
          {node.rig?.bones.map((bone) => (
            <button
              type="button"
              key={bone.id}
              className={cn('outliner-row w-full bone-row', selectedId === node.id && selectedBoneId === bone.id && 'is-selected')}
              style={{ paddingLeft: `${35 + depth * 14}px` }}
              onClick={() => { select(node.id); selectBone(bone.id); }}
            >
              <Bone size={12} className="text-cyan-400" />
              <span className="node-name">{bone.name}</span>
              <span className="ml-auto text-[8px] uppercase tracking-wider text-slate-600">Bone</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export default function Outliner() {
  const nodes = useStudioStore((state) => state.nodes);
  const selectedIds = useStudioStore((state) => state.selectedIds);
  const selectedId = useStudioStore((state) => state.selectedId);
  const groupSelection = useStudioStore((state) => state.groupSelection);
  const reparentNode = useStudioStore((state) => state.reparentNode);
  const [search, setSearch] = useState('');
  const [rootDrop, setRootDrop] = useState(false);
  const roots = nodes.filter((node) => !node.parentId || !nodes.some((parent) => parent.id === node.parentId));
  const selected = nodes.find((node) => node.id === selectedId);
  const stats = useMemo(() => nodes.reduce((total, node) => {
    if (!node.geometry) return total;
    const next = getGeometryStats(node.geometry);
    return { vertices: total.vertices + next.vertices, triangles: total.triangles + next.triangles };
  }, { vertices: 0, triangles: 0 }), [nodes]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="panel-titlebar">
        <div><Layers3 size={14} /><span>Scene</span><span className="count-badge">{nodes.length}</span></div>
        <div className="flex gap-1">
          <IconButton icon={Unlink} label="Move selected to scene root" disabled={!selected?.parentId} onClick={() => selected && reparentNode(selected.id, null)} />
          <IconButton icon={Group} label="Group selected objects (Ctrl+G)" disabled={selectedIds.length < 2} onClick={groupSelection} />
        </div>
      </div>
      <div className="p-2 pb-1">
        <label className="search-field">
          <Search size={13} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter objects & bones" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={12} /></button>}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {roots.map((node) => <OutlinerRow key={node.id} node={node} nodes={nodes} depth={0} search={search} />)}
        {!roots.length && <p className="p-6 text-center text-xs text-slate-600">The scene is empty. Add a primitive from the Create menu.</p>}
      </div>
      <div
        className={cn('root-drop-zone', rootDrop && 'is-drop-target')}
        onDragOver={(event) => { event.preventDefault(); setRootDrop(true); }}
        onDragLeave={() => setRootDrop(false)}
        onDrop={(event) => {
          event.preventDefault(); setRootDrop(false);
          const id = event.dataTransfer.getData('application/prisma-node');
          if (id) reparentNode(id, null);
        }}
      >
        <Unlink size={11} /> Drop here to unparent
      </div>
      <div className="outliner-stats">
        <span>{stats.vertices.toLocaleString()} vertices</span>
        <span>{Math.round(stats.triangles).toLocaleString()} triangles</span>
      </div>
    </div>
  );
}
