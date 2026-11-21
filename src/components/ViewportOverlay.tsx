import { useEffect, useRef, useState } from 'react';
import {
  Bone, Box, Camera, Check, ChevronDown, Focus, Grid3X3, Magnet, Monitor,
  MousePointer2, Move3D, Rotate3D, Scale3D, SlidersHorizontal, Sparkles, Video,
} from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import type { ShadingMode, ToolMode } from '../types';
import { cn } from '../utils/cn';
import { IconButton } from './UI';

const navigate = (view: string) => window.dispatchEvent(new CustomEvent('prisma:navigate', { detail: view }));

export default function ViewportOverlay() {
  const view = useStudioStore((state) => state.view);
  const setView = useStudioStore((state) => state.setView);
  const nodes = useStudioStore((state) => state.nodes);
  const selectedId = useStudioStore((state) => state.selectedId);
  const selected = nodes.find((node) => node.id === selectedId);
  const [shadingOpen, setShadingOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [snapOpen, setSnapOpen] = useState(false);
  const menus = useRef<HTMLDivElement>(null);
  const cameras = nodes.filter((node) => node.type === 'camera');
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menus.current?.contains(event.target as Node)) { setShadingOpen(false); setCameraOpen(false); setSnapOpen(false); }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  const tools: { value: ToolMode; label: string; icon: typeof Box; key: string }[] = [
    { value: 'select', label: 'Select', icon: MousePointer2, key: 'Q' },
    { value: 'translate', label: 'Move', icon: Move3D, key: 'W' },
    { value: 'rotate', label: 'Rotate', icon: Rotate3D, key: 'E' },
    { value: 'scale', label: 'Scale', icon: Scale3D, key: 'R' },
    { value: 'bone', label: 'Pose bones', icon: Bone, key: 'B' },
  ];
  const shadingOptions: { value: ShadingMode; label: string; detail: string; icon: typeof Box }[] = [
    { value: 'wireframe', label: 'Wireframe', detail: 'Topology display', icon: Grid3X3 },
    { value: 'solid', label: 'Solid · Matcap', detail: 'Fast studio clay', icon: Box },
    { value: 'material', label: 'Material Preview', detail: 'PBR + local environment', icon: Sparkles },
    { value: 'rendered', label: 'Rendered', detail: 'Shadows + post-processing', icon: Monitor },
  ];
  const activeShading = shadingOptions.find((option) => option.value === view.shading)!;
  return (
    <div className="viewport-overlay" ref={menus}>
      <div className="viewport-top-left">
        <div className="floating-toolbar transform-toolbar">
          {tools.map((tool) => <button type="button" key={tool.value} className={cn(view.tool === tool.value && 'is-active')} onClick={() => setView({ tool: tool.value })} title={`${tool.label} (${tool.key})`}><tool.icon size={16} /><span>{tool.label}</span><kbd>{tool.key}</kbd></button>)}
        </div>
        <div className="floating-toolbar mini-toolbar">
          <button type="button" className="space-toggle" onClick={() => setView({ space: view.space === 'world' ? 'local' : 'world' })} title="Toggle coordinate space">{view.space === 'world' ? 'WORLD' : 'LOCAL'}</button>
          <span />
          <IconButton icon={Magnet} label="Toggle snapping" active={view.snapping} onClick={() => setView({ snapping: !view.snapping })} />
          <button type="button" className={cn('snap-settings', snapOpen && 'is-active')} onClick={() => setSnapOpen(!snapOpen)} aria-label="Snapping options"><ChevronDown size={11} /></button>
          {snapOpen && (
            <div className="viewport-popover snap-popover">
              <strong><Magnet size={12} />Snap increments</strong>
              <label>Move<input type="number" min={0.01} step={0.05} value={view.translateSnap} onChange={(event) => setView({ translateSnap: Number(event.target.value) })} /><span>m</span></label>
              <label>Rotate<input type="number" min={1} step={5} value={Math.round(view.rotateSnap * 180 / Math.PI)} onChange={(event) => setView({ rotateSnap: Number(event.target.value) * Math.PI / 180 })} /><span>°</span></label>
              <label>Scale<input type="number" min={0.01} step={0.05} value={view.scaleSnap} onChange={(event) => setView({ scaleSnap: Number(event.target.value) })} /><span>×</span></label>
            </div>
          )}
        </div>
      </div>
      <div className="viewport-top-center">
        <div className="relative">
          <button type="button" className={cn('shading-button', shadingOpen && 'is-active')} onClick={() => setShadingOpen(!shadingOpen)}><activeShading.icon size={14} /><span>{activeShading.label}</span><ChevronDown size={11} /></button>
          {shadingOpen && (
            <div className="viewport-popover shading-popover">
              {shadingOptions.map((option) => <button type="button" key={option.value} onClick={() => { setView({ shading: option.value }); setShadingOpen(false); }}><option.icon size={15} /><span><strong>{option.label}</strong><small>{option.detail}</small></span>{view.shading === option.value && <Check size={13} />}</button>)}
            </div>
          )}
        </div>
      </div>
      <div className="viewport-top-right">
        <div className="floating-toolbar view-toolbar">
          <IconButton icon={Focus} label="Frame selected (F)" onClick={() => navigate('focus')} />
          <IconButton icon={Grid3X3} label="Toggle ground grid" active={view.showGrid} onClick={() => setView({ showGrid: !view.showGrid })} />
          <IconButton icon={Bone} label="Toggle bone overlays" active={view.showBones} onClick={() => setView({ showBones: !view.showBones })} />
          <span />
          <div className="relative">
            <button type="button" className={cn('camera-select', view.cameraViewId && 'is-active')} onClick={() => setCameraOpen(!cameraOpen)}><Video size={14} /><ChevronDown size={10} /></button>
            {cameraOpen && (
              <div className="viewport-popover camera-popover">
                <button type="button" onClick={() => { setView({ cameraViewId: null }); setCameraOpen(false); }}><Monitor size={14} /><span>Free perspective</span>{!view.cameraViewId && <Check size={12} />}</button>
                {cameras.map((camera) => <button type="button" key={camera.id} onClick={() => { setView({ cameraViewId: camera.id }); setCameraOpen(false); }}><Camera size={14} /><span>{camera.name}</span>{view.cameraViewId === camera.id && <Check size={12} />}</button>)}
                {!cameras.length && <p>Create a camera to enable look-through.</p>}
              </div>
            )}
          </div>
        </div>
        <div className="axis-navigator" aria-label="World axis navigator">
          <button type="button" className="axis-y" onClick={() => navigate('top')} title="Top view">Y</button>
          <button type="button" className="axis-x" onClick={() => navigate('right')} title="Right view">X</button>
          <button type="button" className="axis-z" onClick={() => navigate('front')} title="Front view">Z</button>
          <button type="button" className="axis-origin" onClick={() => navigate('perspective')} title="Perspective view"><Box size={13} /></button>
        </div>
      </div>
      {view.cameraViewId && <div className="camera-frame"><span>CAMERA · {nodes.find((node) => node.id === view.cameraViewId)?.name}</span><i className="camera-safe-area" /></div>}
      <div className="viewport-bottom-left">
        <span className="selection-status"><i />{selected ? selected.name : 'No selection'}</span>
        <span>{view.editMode.toUpperCase()} MODE</span>
      </div>
      <div className="viewport-bottom-center"><MousePointer2 size={11} /><span>Orbit</span><kbd>RMB</kbd><span>Pan</span><kbd>Wheel</kbd><span>Zoom</span><b>·</b><span>Two-finger touch supported</span></div>
      <div className="viewport-bottom-right"><SlidersHorizontal size={11} /><span>ACES</span><i /><span>{view.shading === 'rendered' ? 'PCF SHADOWS' : 'REALTIME'}</span></div>
    </div>
  );
}
