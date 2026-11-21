import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Keyboard, X } from 'lucide-react';
import Viewport from './components/Viewport';
import ViewportOverlay from './components/ViewportOverlay';
import Outliner from './components/Outliner';
import Inspector from './components/Inspector';
import Timeline from './components/Timeline';
import TopBar from './components/TopBar';
import ExportDialog from './components/ExportDialog';
import { IconButton, Modal } from './components/UI';
import { useStudioStore } from './store/useStudioStore';
import { getNodeProperty, sampleNodeAtFrame } from './lib/animation';
import { cn } from './utils/cn';

function ResizeHandle({ side, onResize }: { side: 'left' | 'right'; onResize: (delta: number) => void }) {
  const start = useRef(0);
  return (
    <div
      className={cn('resize-handle', `resize-${side}`)}
      role="separator"
      aria-label={`Resize ${side} panel`}
      onPointerDown={(event) => {
        start.current = event.clientX;
        const move = (next: PointerEvent) => {
          onResize((side === 'left' ? 1 : -1) * (next.clientX - start.current));
          start.current = next.clientX;
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
      }}
    />
  );
}

const shortcutGroups = [
  { title: 'Viewport', items: [['Q / W / E / R', 'Select / Move / Rotate / Scale'], ['B', 'Bone pose tool'], ['F', 'Frame selected object'], ['Middle / Right drag', 'Orbit / pan'], ['Wheel / pinch', 'Zoom'], ['Two-finger drag', 'Touch pan & zoom']] },
  { title: 'Modeling', items: [['1 / 2 / 3 / 4', 'Object / Vertex / Edge / Face'], ['Shift + click', 'Add to selection'], ['Ctrl + G', 'Group selected objects'], ['Ctrl + D', 'Duplicate selected object'], ['Delete', 'Delete selected objects']] },
  { title: 'Animation & project', items: [['Space', 'Play / pause'], ['K', 'Key location, rotation & scale'], ['Ctrl + Z', 'Undo'], ['Ctrl + Shift + Z', 'Redo'], ['Ctrl + S', 'Save project file'], ['Esc', 'Close dialog / clear selection']] },
];

export default function App() {
  const mobileAtStart = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
  const [leftOpen, setLeftOpen] = useState(!mobileAtStart);
  const [rightOpen, setRightOpen] = useState(!mobileAtStart);
  const [leftWidth, setLeftWidth] = useState(238);
  const [rightWidth, setRightWidth] = useState(304);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean; id: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setView = useStudioStore((state) => state.setView);
  const setEditMode = useStudioStore((state) => state.setEditMode);
  const setPlaying = useStudioStore((state) => state.setPlaying);
  const removeSelected = useStudioStore((state) => state.removeSelected);
  const duplicateSelected = useStudioStore((state) => state.duplicateSelected);
  const groupSelection = useStudioStore((state) => state.groupSelection);
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);
  const addKey = useStudioStore((state) => state.addKey);
  const select = useStudioStore((state) => state.select);

  const notify = useCallback((message: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, error, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(true);
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [setPlaying]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if (event.key === 'Escape') {
        if (exportOpen) setExportOpen(false);
        else if (shortcutsOpen) setShortcutsOpen(false);
        else if (!editing) select(null);
        return;
      }
      if (editing || exportOpen || shortcutsOpen) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); return; }
      if (modifier && event.key.toLowerCase() === 'g') { event.preventDefault(); groupSelection(); return; }
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        const state = useStudioStore.getState();
        import('./lib/io').then(({ exportProject }) => exportProject({ nodes: state.nodes, tracks: state.tracks, duration: state.duration, fps: state.fps }, state.projectName, state.projectName.replace(/[^a-z0-9]+/gi, '-')));
        notify('Editable project file saved.');
        return;
      }
      if (event.code === 'Space') { event.preventDefault(); setPlaying(!useStudioStore.getState().isPlaying); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); return; }
      if (event.key.toLowerCase() === 'f') { window.dispatchEvent(new CustomEvent('prisma:navigate', { detail: 'focus' })); return; }
      if (event.key.toLowerCase() === 'k') {
        const state = useStudioStore.getState();
        const node = state.nodes.find((item) => item.id === state.selectedId);
        if (node) {
          const evaluated = sampleNodeAtFrame(node, state.tracks, state.currentFrame);
          ['position', 'rotation', 'scale'].forEach((property) => addKey(node.id, property, state.currentFrame, getNodeProperty(evaluated, property)));
        }
        return;
      }
      const tools: Record<string, 'select' | 'translate' | 'rotate' | 'scale' | 'bone'> = { q: 'select', w: 'translate', e: 'rotate', r: 'scale', b: 'bone' };
      if (tools[event.key.toLowerCase()]) { setView({ tool: tools[event.key.toLowerCase()] }); return; }
      const modes: Record<string, 'object' | 'vertex' | 'edge' | 'face'> = { '1': 'object', '2': 'vertex', '3': 'edge', '4': 'face' };
      if (modes[event.key]) setEditMode(modes[event.key]);
      if (event.key === '?') setShortcutsOpen(true);
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [addKey, duplicateSelected, exportOpen, groupSelection, notify, redo, removeSelected, select, setEditMode, setPlaying, setView, shortcutsOpen, undo]);

  return (
    <div className="app-shell">
      <TopBar onExport={() => setExportOpen(true)} onToggleLeft={() => setLeftOpen(!leftOpen)} onToggleRight={() => setRightOpen(!rightOpen)} notify={notify} />
      <main className="studio-main">
        {(leftOpen || rightOpen) && <button type="button" className="mobile-panel-backdrop" aria-label="Close side panels" onClick={() => { setLeftOpen(false); setRightOpen(false); }} />}
        <aside className={cn('studio-sidebar sidebar-left', leftOpen && 'is-open')} style={{ width: leftOpen ? leftWidth : 0 }}>
          <div className="sidebar-inner" style={{ width: leftWidth }}><Outliner /></div>
          {leftOpen && <ResizeHandle side="left" onResize={(delta) => setLeftWidth((width) => Math.max(190, Math.min(330, width + delta)))} />}
        </aside>
        <button type="button" className="desktop-panel-toggle toggle-left" onClick={() => setLeftOpen(!leftOpen)} aria-label={leftOpen ? 'Collapse scene panel' : 'Open scene panel'}><ChevronLeft size={12} className={cn(!leftOpen && 'rotate-180')} /></button>
        <section className="workspace-center">
          <div className="viewport-wrap">
            <Viewport />
            <ViewportOverlay />
          </div>
          <Timeline />
        </section>
        <button type="button" className="desktop-panel-toggle toggle-right" onClick={() => setRightOpen(!rightOpen)} aria-label={rightOpen ? 'Collapse inspector panel' : 'Open inspector panel'}><ChevronRight size={12} className={cn(!rightOpen && 'rotate-180')} /></button>
        <aside className={cn('studio-sidebar sidebar-right', rightOpen && 'is-open')} style={{ width: rightOpen ? rightWidth : 0 }}>
          <div className="sidebar-inner" style={{ width: rightWidth }}><Inspector /></div>
          {rightOpen && <ResizeHandle side="right" onResize={(delta) => setRightWidth((width) => Math.max(270, Math.min(410, width + delta)))} />}
        </aside>
      </main>
      <button type="button" className="shortcut-help tooltip" data-tooltip="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts"><Keyboard size={14} /></button>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} notify={notify} />}
      {shortcutsOpen && (
        <Modal title="Studio shortcuts" subtitle="Fast control for mouse, keyboard, and touch workflows" onClose={() => setShortcutsOpen(false)} wide>
          <div className="shortcut-grid">
            {shortcutGroups.map((group) => <section key={group.title}><h3>{group.title}</h3>{group.items.map(([key, description]) => <div key={key}><kbd>{key}</kbd><span>{description}</span></div>)}</section>)}
          </div>
        </Modal>
      )}
      {toast && (
        <div key={toast.id} className={cn('studio-toast', toast.error && 'is-error')} role="status">
          {toast.error ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}
          <span>{toast.message}</span>
          <IconButton icon={X} label="Dismiss notification" onClick={() => setToast(null)} />
        </div>
      )}
    </div>
  );
}

