import { useState, type ReactNode } from 'react';
import { ChevronDown, X, type LucideIcon } from 'lucide-react';
import { cn } from '../utils/cn';
import type { Vec3 } from '../types';

export function IconButton({ icon: Icon, label, active, onClick, disabled, className, badge }: {
  icon: LucideIcon; label: string; active?: boolean; onClick?: () => void; disabled?: boolean; className?: string; badge?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-tooltip={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('icon-button tooltip', active && 'is-active', className)}
    >
      <Icon size={16} strokeWidth={1.8} />
      {badge && <span className="icon-badge">{badge}</span>}
    </button>
  );
}

export function ToolButton({ icon: Icon, label, active, onClick, disabled }: {
  icon: LucideIcon; label: string; active?: boolean; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" className={cn('tool-button', active && 'is-active')} onClick={onClick} disabled={disabled}>
      <Icon size={15} strokeWidth={1.7} />
      <span>{label}</span>
    </button>
  );
}

export function PanelSection({ title, icon: Icon, children, right, defaultOpen = true, className }: {
  title: string; icon?: LucideIcon; children: ReactNode; right?: ReactNode; defaultOpen?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn('panel-section', className)}>
      <div className="panel-section-heading">
        <button type="button" onClick={() => setOpen(!open)} className="panel-section-toggle" aria-expanded={open}>
          {Icon && <Icon size={13} className="text-slate-500" />}
          <span>{title}</span>
          <ChevronDown size={12} className={cn('transition-transform duration-200', !open && '-rotate-90')} />
        </button>
        {right}
      </div>
      <div className={cn('collapsible-grid', open && 'is-open')}>
        <div className="overflow-hidden">
          <div className="panel-section-content">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function SliderField({ label, value, min, max, step = 0.01, onChange, unit, disabled }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; unit?: string; disabled?: boolean;
}) {
  return (
    <label className={cn('field-row', disabled && 'opacity-40')}>
      <span className="field-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="numeric-wrap">
        <input aria-label={label} type="number" min={min} max={max} step={step} value={Number(value.toFixed(3))} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
        {unit && <span>{unit}</span>}
      </span>
    </label>
  );
}

export function NumberField({ label, value, onChange, min, max, step = 1, unit }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      <span className="numeric-wrap ml-auto">
        <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
        {unit && <span>{unit}</span>}
      </span>
    </label>
  );
}

export function VectorField({ label, value, onChange, degrees = false, step = 0.05 }: {
  label: string; value: Vec3; onChange: (value: Vec3) => void; degrees?: boolean; step?: number;
}) {
  const display = degrees ? value.map((item) => item * 180 / Math.PI) as Vec3 : value;
  return (
    <div className="vector-field">
      <span className="field-label">{label}</span>
      <div className="vector-inputs">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label key={axis} className={`axis-input axis-${axis.toLowerCase()}`}>
            <span>{axis}</span>
            <input
              aria-label={`${label} ${axis}`}
              type="number"
              step={degrees ? 1 : step}
              value={Number(display[index].toFixed(degrees ? 1 : 3))}
              onChange={(event) => {
                const next = [...display] as Vec3;
                next[index] = Number(event.target.value);
                onChange(degrees ? next.map((item) => item * Math.PI / 180) as Vec3 : next);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, icon: Icon }: { label: string; checked: boolean; onChange: (checked: boolean) => void; icon?: LucideIcon }) {
  return (
    <label className="toggle-row">
      <span className="flex items-center gap-2">{Icon && <Icon size={14} className="text-slate-500" />}{label}</span>
      <input className="peer sr-only" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track" />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string; icon?: LucideIcon }[]; onChange: (value: T) => void; label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button type="button" key={option.value} className={cn(value === option.value && 'is-active')} onClick={() => onChange(option.value)} title={option.label}>
          {option.icon && <option.icon size={13} />}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, subtitle, children, onClose, wide = false }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={cn('modal-card', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <IconButton icon={X} label="Close dialog" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="empty-state">
      <span><Icon size={20} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
