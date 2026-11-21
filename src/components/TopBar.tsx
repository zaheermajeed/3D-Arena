import { useEffect, useRef, useState } from 'react';
import {
  Box, Boxes, Camera, ChevronDown, Circle, Cone, Cylinder, Donut, Download,
  FileJson, FolderOpen, Group, HardDrive, Import, Lightbulb, Loader2,
  PanelLeft, PanelRight, Plane, Plus, Redo2, RotateCcw, Sun,
  Type, Undo2, Flashlight,
} from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import { exportProject, importModel, importProject } from '../lib/io';
import type { NodeType } from '../types';
import { IconButton } from './UI';
import { cn } from '../utils/cn';

const createItems: { section: string; items: { type: NodeType; label: string; icon: typeof Box }[] }[] = [
  { section: 'Mesh', items: [
    { type: 'cube', label: 'Cube', icon: Box }, { type: 'sphere', label: 'Sphere', icon: Circle },
    { type: 'cylinder', label: 'Cylinder', icon: Cylinder }, { type: 'cone', label: 'Cone', icon: Cone },
    { type: 'plane', label: 'Plane', icon: Plane }, { type: 'torus', label: 'Torus', icon: Donut },
    { type: 'text', label: 'Text 3D', icon: Type },
  ] },
  { section: 'Scene', items: [
    { type: 'group', label: 'Empty group', icon: Group }, { type: 'camera', label: 'Camera', icon: Camera },
    { type: 'pointLight', label: 'Point light', icon: Lightbulb }, { type: 'directionalLight', label: 'Directional light', icon: Sun },
    { type: 'spotLight', label: 'Spot light', icon: Flashlight },
  ] },
];

export default function TopBar({ onExport, onToggleLeft, onToggleRight, notify }: {
  onExport: () => void; onToggleLeft: () => void; onToggleRight: () => void; notify: (message: string, error?: boolean) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const addNode = useStudioStore((state) => state.addNode);
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);
  const canUndo = useStudioStore((state) => state.past.length > 0);
  const canRedo = useStudioStore((state) => state.future.length > 0);
  const projectName = useStudioStore((state) => state.projectName);
  const setProjectName = useStudioStore((state) => state.setProjectName);
  const nodes = useStudioStore((state) => state.nodes);
  const tracks = useStudioStore((state) => state.tracks);
  const duration = useStudioStore((state) => state.duration);
  const fps = useStudioStore((state) => state.fps);
  const importNodes = useStudioStore((state) => state.importNodes);
  const loadProject = useStudioStore((state) => state.loadProject);
  const resetDemo = useStudioStore((state) => state.resetDemo);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) { setCreateOpen(false); setProjectOpen(false); }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  const loadModel = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    try {
      const imported = await importModel(file);
      importNodes(imported);
      notify(`Imported ${imported.length} editable mesh${imported.length === 1 ? '' : 'es'} from ${file.name}.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not import this model.', true); }
    finally { setLoading(false); if (modelInput.current) modelInput.current.value = ''; }
  };
  const openProject = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    try {
      const data = await importProject(file);
      loadProject(data.project, data.name);
      notify(`Opened ${data.name}.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not open this project.', true); }
    finally { setLoading(false); setProjectOpen(false); if (projectInput.current) projectInput.current.value = ''; }
  };
  return (
    <header className="topbar" ref={menu}>
      <div className="brand-block">
        <span className="brand-mark"><Boxes size={19} strokeWidth={1.7} /></span>
        <div className="brand-copy"><strong>PRISMA</strong><span>STUDIO</span></div>
      </div>
      <div className="mobile-panel-buttons">
        <IconButton icon={PanelLeft} label="Toggle scene panel" onClick={onToggleLeft} />
      </div>
      <span className="topbar-divider" />
      <div className="relative">
        <button type="button" className={cn('menu-button', projectOpen && 'is-active')} onClick={() => { setProjectOpen(!projectOpen); setCreateOpen(false); }}>Project<ChevronDown size={11} /></button>
        {projectOpen && (
          <div className="dropdown-menu project-menu">
            <button type="button" onClick={() => projectInput.current?.click()}><FolderOpen size={14} /><span>Open project<small>.prisma.json</small></span></button>
            <button type="button" onClick={() => { exportProject({ nodes, tracks, duration, fps }, projectName, projectName.replace(/[^a-z0-9]+/gi, '-')); setProjectOpen(false); }}><FileJson size={14} /><span>Save project file<small>Editable scene & animation</small></span></button>
            <div className="dropdown-separator" />
            <button type="button" onClick={() => { resetDemo(); setProjectOpen(false); notify('Restored the rigged Astra demo scene.'); }}><RotateCcw size={14} /><span>Restore demo scene<small>Undo is available</small></span></button>
          </div>
        )}
      </div>
      <div className="relative">
        <button type="button" className={cn('create-button', createOpen && 'is-active')} onClick={() => { setCreateOpen(!createOpen); setProjectOpen(false); }}><Plus size={14} />Create<ChevronDown size={11} /></button>
        {createOpen && (
          <div className="dropdown-menu create-menu">
            {createItems.map((group) => (
              <div key={group.section}>
                <span className="dropdown-label">{group.section}</span>
                <div className="create-grid">
                  {group.items.map((item) => <button type="button" key={item.type} onClick={() => { addNode(item.type); setCreateOpen(false); }}><item.icon size={16} /><span>{item.label}</span></button>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="menu-button import-button" onClick={() => modelInput.current?.click()} disabled={loading}>
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Import size={14} />}<span>Import</span>
      </button>
      <input ref={modelInput} type="file" accept=".obj,.gltf,.glb,.fbx" className="hidden" onChange={(event) => loadModel(event.target.files?.[0])} />
      <input ref={projectInput} type="file" accept=".json,.prisma.json" className="hidden" onChange={(event) => openProject(event.target.files?.[0])} />
      <span className="topbar-divider" />
      <div className="history-buttons"><IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} /><IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} /></div>
      <div className="project-title-wrap"><input value={projectName} onChange={(event) => setProjectName(event.target.value)} aria-label="Project name" /><span><HardDrive size={10} />Saved on this device</span></div>
      <div className="engine-badge"><span /><span>WEBGL2</span></div>
      <button type="button" className="export-button" onClick={onExport}><Download size={14} /><span>Export</span></button>
      <div className="mobile-panel-buttons"><IconButton icon={PanelRight} label="Toggle inspector panel" onClick={onToggleRight} /></div>
    </header>
  );
}
