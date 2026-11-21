import { useState } from 'react';
import { Box, CheckCircle2, Download, FileJson, Film, Image as ImageIcon, Loader2, Package, ShieldCheck } from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import {
  createVideoRecorder, downloadBlob, exportCurrentPNG, exportGLB, exportOBJ,
  exportPNGSequence, exportProject,
} from '../lib/io';
import { viewportRuntime } from './Viewport';
import { Modal } from './UI';
import { cn } from '../utils/cn';

const nextPresentationFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const safeName = (name: string) => name.trim().replace(/[^a-z0-9-_]+/gi, '-') || 'prisma-scene';

export default function ExportDialog({ onClose, notify }: { onClose: () => void; notify: (message: string, error?: boolean) => void }) {
  const nodes = useStudioStore((state) => state.nodes);
  const tracks = useStudioStore((state) => state.tracks);
  const selectedId = useStudioStore((state) => state.selectedId);
  const currentFrame = useStudioStore((state) => state.currentFrame);
  const duration = useStudioStore((state) => state.duration);
  const fps = useStudioStore((state) => state.fps);
  const projectName = useStudioStore((state) => state.projectName);
  const setFrame = useStudioStore((state) => state.setFrame);
  const setPlaying = useStudioStore((state) => state.setPlaying);
  const [tab, setTab] = useState<'model' | 'video' | 'image'>('model');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(duration);
  const [format, setFormat] = useState<'mp4' | 'webm'>('webm');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const filename = safeName(projectName);

  const exportNodes = () => {
    if (!selectedOnly || !selectedId) return nodes;
    const included = new Set<string>();
    const collect = (id: string) => {
      included.add(id);
      nodes.filter((node) => node.parentId === id).forEach((node) => collect(node.id));
    };
    collect(selectedId);
    return nodes.filter((node) => included.has(node.id));
  };
  const validate = () => {
    if (busy) return false;
    if (!viewportRuntime.canvas && tab !== 'model') { notify('The viewport is not ready for capture yet.', true); return false; }
    return true;
  };
  const run = async (label: string, action: () => Promise<void>) => {
    if (!validate()) return;
    setBusy(true); setProgress(0); setStatus(label);
    try { await action(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Export failed.', true); }
    finally { setBusy(false); setStatus(''); setProgress(0); }
  };
  const recordVideo = () => run('Recording real-time viewport frames…', async () => {
    const canvas = viewportRuntime.canvas!;
    if (end <= start) throw new Error('The end frame must be greater than the start frame.');
    const original = currentFrame;
    setPlaying(false);
    const recorder = createVideoRecorder(canvas, fps, format);
    setFrame(start);
    await nextPresentationFrame();
    recorder.start();
    await new Promise<void>((resolve) => {
      const started = performance.now();
      const tick = (time: number) => {
        const frame = start + (time - started) / 1000 * fps;
        if (frame >= end) {
          setFrame(end); setProgress(0.94);
          setTimeout(resolve, 180);
        } else {
          setFrame(frame);
          setProgress(Math.min(0.92, (frame - start) / (end - start) * 0.92));
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
    const blob = await recorder.stop();
    downloadBlob(blob, `${filename}_${start}-${end}.${recorder.extension}`);
    setProgress(1);
    setFrame(original);
    notify(`Animation exported as ${recorder.extension.toUpperCase()} (${recorder.mimeType}).`);
  });
  const recordSequence = () => run('Rendering and compressing PNG frames…', async () => {
    if (end < start) throw new Error('The end frame must be after the start frame.');
    if (end - start + 1 > 600) throw new Error('PNG sequences are limited to 600 frames per export to protect browser memory.');
    const original = currentFrame;
    setPlaying(false);
    await exportPNGSequence({ canvas: viewportRuntime.canvas!, filename, start, end, fps, setFrame, onProgress: setProgress });
    setFrame(original);
    notify(`Rendered ${end - start + 1} PNG frames into a ZIP archive.`);
  });

  return (
    <Modal title="Export studio" subtitle="Local, client-side rendering · Your assets never leave this device" onClose={() => { if (!busy) onClose(); }} wide>
      <div className="export-tabs">
        <button type="button" className={cn(tab === 'model' && 'is-active')} onClick={() => setTab('model')} disabled={busy}><Package size={15} />3D Model</button>
        <button type="button" className={cn(tab === 'video' && 'is-active')} onClick={() => setTab('video')} disabled={busy}><Film size={15} />Animation</button>
        <button type="button" className={cn(tab === 'image' && 'is-active')} onClick={() => setTab('image')} disabled={busy}><ImageIcon size={15} />Images</button>
      </div>
      {busy && <div className="export-progress"><div><Loader2 size={14} className="animate-spin" /><span>{status}</span><strong>{Math.round(progress * 100)}%</strong></div><span><i style={{ width: `${progress * 100}%` }} /></span></div>}
      {tab === 'model' && (
        <div className="export-content">
          <div className="export-summary"><Box size={20} /><div><strong>Frame {Math.floor(currentFrame)} scene evaluation</strong><p>Export includes the visible hierarchy, evaluated transforms, PBR materials, and editable mesh geometry.</p></div></div>
          <label className="export-checkbox"><input type="checkbox" checked={selectedOnly} onChange={(event) => setSelectedOnly(event.target.checked)} disabled={!selectedId || busy} /><span>Export selected object and its children only</span></label>
          <div className="export-option-grid">
            <button type="button" disabled={busy} onClick={() => run('Packing binary glTF…', async () => { await exportGLB(exportNodes(), tracks, currentFrame, filename); notify('GLB model exported.'); })}>
              <Package size={22} /><strong>GLB</strong><span>Binary glTF 2.0</span><Download size={13} />
            </button>
            <button type="button" disabled={busy} onClick={() => run('Writing Wavefront geometry…', async () => { exportOBJ(exportNodes(), tracks, currentFrame, filename); notify('OBJ model exported.'); })}>
              <Box size={22} /><strong>OBJ</strong><span>Wavefront geometry</span><Download size={13} />
            </button>
            <button type="button" disabled={busy} onClick={() => run('Saving editable project…', async () => { exportProject({ nodes, tracks, duration, fps }, projectName, filename); notify('Editable project file saved.'); })}>
              <FileJson size={22} /><strong>PROJECT</strong><span>Scene, rig & keyframes</span><Download size={13} />
            </button>
          </div>
          <p className="export-note"><ShieldCheck size={13} />GLB/OBJ are static model exports at the current frame. Use Animation or Images for motion output.</p>
        </div>
      )}
      {(tab === 'video' || tab === 'image') && (
        <div className="export-content">
          <div className="range-fields">
            <label>Start frame<input type="number" min={0} max={duration} value={start} disabled={busy} onChange={(event) => setStart(Number(event.target.value))} /></label>
            <label>End frame<input type="number" min={1} max={duration} value={end} disabled={busy} onChange={(event) => setEnd(Number(event.target.value))} /></label>
            <label>Frame rate<select value={fps} disabled><option>{fps} FPS</option></select></label>
          </div>
          {tab === 'video' ? (
            <>
              <div className="format-picker"><span>Preferred codec</span><div><button type="button" className={cn(format === 'webm' && 'is-active')} onClick={() => setFormat('webm')} disabled={busy}>WebM · VP9/VP8</button><button type="button" className={cn(format === 'mp4' && 'is-active')} onClick={() => setFormat('mp4')} disabled={busy}>MP4 · H.264</button></div></div>
              <div className="export-summary"><Film size={20} /><div><strong>Real-time canvas recording</strong><p>Approximately {((end - start) / fps).toFixed(2)} seconds. Keep this tab visible while recording for the most consistent frame pacing.</p></div></div>
              <p className="export-note"><ShieldCheck size={13} />If MP4 encoding is unavailable, the app records WebM and reports the actual output codec. No simulated export.</p>
              <button type="button" className="primary-action export-main-action" disabled={busy} onClick={recordVideo}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}Record animation</button>
            </>
          ) : (
            <>
              <div className="export-summary"><ImageIcon size={20} /><div><strong>Lossless viewport captures</strong><p>Export the current frame immediately, or render every frame in the range and download a compressed PNG sequence.</p></div></div>
              <div className="image-export-actions">
                <button type="button" className="secondary-action" disabled={busy} onClick={() => run('Capturing current frame…', async () => { await exportCurrentPNG(viewportRuntime.canvas!, `${filename}_frame-${Math.floor(currentFrame)}`); notify('Current frame exported as PNG.'); })}><ImageIcon size={15} />Current frame · PNG</button>
                <button type="button" className="primary-action" disabled={busy} onClick={recordSequence}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}PNG sequence · ZIP</button>
              </div>
              <p className="export-note"><CheckCircle2 size={13} />Each frame is evaluated, presented, and captured individually. The ZIP contains numbered, lossless PNG files.</p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
