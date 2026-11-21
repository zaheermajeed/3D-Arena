import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ChevronDown, ChevronUp, ChevronsLeft, ChevronsRight, CircleDot, Diamond, KeyRound,
  Pause, Play, Plus, Repeat2, StepBack, StepForward, Trash2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import { getNodeProperty, sampleNodeAtFrame } from '../lib/animation';
import type { Interpolation, Track } from '../types';
import { cn } from '../utils/cn';
import { IconButton } from './UI';

const propertyLabel = (property: string) => {
  if (property.startsWith('bone.')) {
    const [, id, transform] = property.split('.');
    return `${id.replace(/_/g, ' ')} · ${transform}`;
  }
  return property.replace('material.', 'Material · ').replace(/^./, (letter) => letter.toUpperCase());
};

function usePlayback() {
  const isPlaying = useStudioStore((state) => state.isPlaying);
  const fps = useStudioStore((state) => state.fps);
  const duration = useStudioStore((state) => state.duration);
  const loop = useStudioStore((state) => state.loop);
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let previous = performance.now();
    let frame = useStudioStore.getState().currentFrame;
    if (frame >= duration) frame = 0;
    const tick = (time: number) => {
      const delta = Math.min(0.1, (time - previous) / 1000);
      previous = time;
      frame += delta * fps;
      if (frame >= duration) {
        if (loop) frame %= duration;
        else {
          useStudioStore.getState().setFrame(duration);
          useStudioStore.getState().setPlaying(false);
          return;
        }
      }
      useStudioStore.getState().setFrame(frame);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, fps, duration, loop]);
}

function KeyframeDot({ track, keyId, frame, pixels, selected, onSelect, onDragStart }: {
  track: Track; keyId: string; frame: number; pixels: number; selected: boolean;
  onSelect: () => void; onDragStart: (event: React.PointerEvent) => void;
}) {
  const key = track.keys.find((item) => item.id === keyId)!;
  return (
    <button
      type="button"
      className={cn('timeline-key', `curve-${key.interpolation}`, selected && 'is-selected')}
      style={{ left: frame * pixels }}
      title={`Frame ${frame} · ${key.interpolation}`}
      onPointerDown={(event) => { event.stopPropagation(); onSelect(); onDragStart(event); }}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
    ><Diamond size={11} fill="currentColor" /></button>
  );
}

export default function Timeline() {
  usePlayback();
  const currentFrame = useStudioStore((state) => state.currentFrame);
  const duration = useStudioStore((state) => state.duration);
  const fps = useStudioStore((state) => state.fps);
  const isPlaying = useStudioStore((state) => state.isPlaying);
  const loop = useStudioStore((state) => state.loop);
  const autoKey = useStudioStore((state) => state.autoKey);
  const selectedId = useStudioStore((state) => state.selectedId);
  const selectedBoneId = useStudioStore((state) => state.selectedBoneId);
  const nodes = useStudioStore((state) => state.nodes);
  const tracks = useStudioStore((state) => state.tracks);
  const setFrame = useStudioStore((state) => state.setFrame);
  const setPlaying = useStudioStore((state) => state.setPlaying);
  const stepFrame = useStudioStore((state) => state.stepFrame);
  const setFps = useStudioStore((state) => state.setFps);
  const setDuration = useStudioStore((state) => state.setDuration);
  const setLoop = useStudioStore((state) => state.setLoop);
  const setAutoKey = useStudioStore((state) => state.setAutoKey);
  const addKey = useStudioStore((state) => state.addKey);
  const removeKey = useStudioStore((state) => state.removeKey);
  const moveKey = useStudioStore((state) => state.moveKey);
  const setKeyInterpolation = useStudioStore((state) => state.setKeyInterpolation);
  const clearTrack = useStudioStore((state) => state.clearTrack);
  const [pixels, setPixels] = useState(8);
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [keyMenu, setKeyMenu] = useState(false);
  const [selectedKey, setSelectedKey] = useState<{ trackId: string; keyId: string } | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const visibleTracks = useMemo(() => tracks.filter((track) => showAll || track.nodeId === selectedId), [tracks, showAll, selectedId]);
  const activeKey = selectedKey ? tracks.find((track) => track.id === selectedKey.trackId)?.keys.find((key) => key.id === selectedKey.keyId) : null;
  const activeTrack = selectedKey ? tracks.find((track) => track.id === selectedKey.trackId) : null;
  const majorStep = pixels < 3 ? 30 : pixels < 6 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(duration / majorStep) + 1 }, (_, index) => index * majorStep);

  const scrub = (clientX: number) => {
    const rect = content.current?.getBoundingClientRect();
    if (!rect) return;
    setFrame((clientX - rect.left) / pixels);
  };
  const startScrub = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    setPlaying(false);
    scrub(event.clientX);
    const move = (next: PointerEvent) => scrub(next.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
  const startKeyDrag = (event: React.PointerEvent, trackId: string, keyId: string) => {
    const initialX = event.clientX;
    const key = tracks.find((track) => track.id === trackId)?.keys.find((item) => item.id === keyId);
    if (!key) return;
    const initialFrame = key.frame;
    let moved = false;
    const move = (next: PointerEvent) => {
      const delta = (next.clientX - initialX) / pixels;
      if (Math.abs(delta) > 0.2) moved = true;
      if (moved) moveKey(trackId, keyId, initialFrame + delta);
    };
    const up = () => {
      if (!moved) setFrame(initialFrame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
  const insertKey = (property: string) => {
    const node = nodes.find((item) => item.id === selectedId);
    if (node) {
      const evaluated = sampleNodeAtFrame(node, tracks, currentFrame);
      addKey(node.id, property, currentFrame, getNodeProperty(evaluated, property));
    }
    setKeyMenu(false);
  };

  return (
    <section className={cn('timeline-panel', collapsed && 'is-collapsed')}>
      <header className="timeline-transport">
        <div className="transport-left">
          <button type="button" className="timeline-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand timeline' : 'Collapse timeline'}>
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}<span>Timeline</span>
          </button>
          <span className="toolbar-divider" />
          <IconButton icon={ChevronsLeft} label="Go to first frame" onClick={() => { setPlaying(false); setFrame(0); }} />
          <IconButton icon={StepBack} label="Previous frame" onClick={() => stepFrame(-1)} />
          <button type="button" className={cn('play-button', isPlaying && 'is-playing')} onClick={() => setPlaying(!isPlaying)} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
          <IconButton icon={StepForward} label="Next frame" onClick={() => stepFrame(1)} />
          <IconButton icon={ChevronsRight} label="Go to last frame" onClick={() => { setPlaying(false); setFrame(duration); }} />
          <IconButton icon={Repeat2} label="Loop playback" active={loop} onClick={() => setLoop(!loop)} />
        </div>
        <div className="transport-center">
          <label className="frame-counter"><input type="number" min={0} max={duration} value={Math.floor(currentFrame)} onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)); }} /><span>/ {duration}</span></label>
          <span className="timecode">{new Date((currentFrame / fps) * 1000).toISOString().slice(14, 23)}</span>
          <select className="fps-select" value={fps} onChange={(event) => setFps(Number(event.target.value))} aria-label="Frames per second">
            {[24, 30, 60].map((value) => <option key={value} value={value}>{value} FPS</option>)}
          </select>
        </div>
        <div className="transport-right">
          <button type="button" className={cn('autokey-button', autoKey && 'is-active')} onClick={() => setAutoKey(!autoKey)}><CircleDot size={12} />Auto key</button>
          <div className="relative">
            <button type="button" className="add-key-button" disabled={!selectedId} onClick={() => setKeyMenu(!keyMenu)}><KeyRound size={13} /><Plus size={10} />Key</button>
            {keyMenu && (
              <div className="key-menu">
                <span>Insert keyframe</span>
                {['position', 'rotation', 'scale', 'material.color', 'material.opacity'].map((property) => <button type="button" key={property} onClick={() => insertKey(property)}>{propertyLabel(property)}</button>)}
                {selectedBoneId && <button type="button" onClick={() => insertKey(`bone.${selectedBoneId}.rotation`)}>Selected bone · rotation</button>}
              </div>
            )}
          </div>
        </div>
      </header>
      {!collapsed && (
        <>
          <div className="timeline-workspace">
            <div className="track-label-column">
              <div className="track-label-header">
                                <button type="button" onClick={() => setShowAll(!showAll)}>{showAll ? 'All objects' : 'Selected object'}<ChevronDown size={10} /></button>
                <span>{visibleTracks.length} tracks</span>
              </div>
              {visibleTracks.map((track) => (
                <div className={cn('track-label', activeTrack?.id === track.id && 'is-active')} key={track.id}>
                  <Activity size={11} />
                  <div><strong>{propertyLabel(track.property)}</strong><span>{nodes.find((node) => node.id === track.nodeId)?.name ?? 'Missing object'}</span></div>
                  <button type="button" title="Delete entire track" onClick={() => { clearTrack(track.id); setSelectedKey(null); }}><Trash2 size={11} /></button>
                </div>
              ))}
              {!visibleTracks.length && <div className="no-tracks"><KeyRound size={16} /><span>No keys for this object</span><small>Select properties in the Inspector or use + Key.</small></div>}
            </div>
            <div className="timeline-scroll">
              <div ref={content} className="timeline-content" style={{ width: Math.max(600, duration * pixels + 80) }} onPointerDown={startScrub}>
                <div className="timeline-ruler">
                  {ticks.map((tick) => <span key={tick} className="ruler-tick" style={{ left: tick * pixels }}><i />{tick}</span>)}
                </div>
                <div className="track-lanes">
                  {visibleTracks.map((track) => (
                    <div className={cn('track-lane', activeTrack?.id === track.id && 'is-active')} key={track.id}>
                      {ticks.map((tick) => <i key={tick} className="lane-gridline" style={{ left: tick * pixels }} />)}
                      {track.keys.map((key) => (
                        <KeyframeDot
                          key={key.id} track={track} keyId={key.id} frame={key.frame} pixels={pixels}
                          selected={selectedKey?.keyId === key.id}
                          onSelect={() => setSelectedKey({ trackId: track.id, keyId: key.id })}
                          onDragStart={(event) => startKeyDrag(event, track.id, key.id)}
                        />
                      ))}
                    </div>
                  ))}
                  {!visibleTracks.length && <div className="empty-lane" />}
                </div>
                <div className="playhead" style={{ left: currentFrame * pixels }}><span /><i /></div>
              </div>
            </div>
          </div>
          <footer className="timeline-footer">
            <div className="key-inspector">
              {activeKey && activeTrack ? (
                <>
                  <Diamond size={11} fill="currentColor" />
                  <span>{propertyLabel(activeTrack.property)}</span>
                  <label>F <input type="number" value={activeKey.frame} min={0} max={duration} onChange={(event) => moveKey(activeTrack.id, activeKey.id, Number(event.target.value))} /></label>
                  <select value={activeKey.interpolation} onChange={(event) => setKeyInterpolation(activeTrack.id, activeKey.id, event.target.value as Interpolation)}>
                    <option value="linear">Linear</option><option value="bezier">Bezier · Ease in/out</option><option value="constant">Constant · Step</option>
                  </select>
                  <IconButton icon={Trash2} label="Delete keyframe" onClick={() => { removeKey(activeTrack.id, activeKey.id); setSelectedKey(null); }} />
                </>
              ) : <span className="timeline-hint">Drag the ruler to scrub · Drag diamonds to retime · Select a key to change its curve</span>}
            </div>
            <div className="timeline-zoom">
              <label>End <input type="number" min={1} max={2000} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
              <IconButton icon={ZoomOut} label="Zoom out timeline" onClick={() => setPixels(Math.max(1, pixels / 1.5))} />
              <input type="range" min={1} max={24} step={0.5} value={pixels} onChange={(event) => setPixels(Number(event.target.value))} aria-label="Timeline zoom" />
              <IconButton icon={ZoomIn} label="Zoom in timeline" onClick={() => setPixels(Math.min(24, pixels * 1.5))} />
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
