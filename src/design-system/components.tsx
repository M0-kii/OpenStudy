import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import './components.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'quiet';
};

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return <button type="button" className={`button button-${variant} ${className}`.trim()} {...rest} />;
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: string;
  label: string;
};

export function IconButton({ icon, label, className = '', ...rest }: IconButtonProps) {
  return (
    <button type="button" aria-label={label} title={label} className={`icon-button ${className}`.trim()} {...rest}>
      <i className="icon" data-lucide={icon} aria-hidden="true" />
    </button>
  );
}

export function Surface({ popup = false, className = '', ...rest }: HTMLAttributes<HTMLDivElement> & { popup?: boolean }) {
  return <div className={`${popup ? 'surface-popup' : 'surface'} ${className}`.trim()} {...rest} />;
}

export function Chip({ selected = false, className = '', ...rest }: HTMLAttributes<HTMLSpanElement> & { selected?: boolean }) {
  return <span className={`ds-chip ${className}`.trim()} data-selected={selected} {...rest} />;
}

export function SettingRow({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <label>{label}</label>
        {help && <p>{help}</p>}
      </div>
      {children}
    </div>
  );
}

export function Tabs({ items, active, onChange }: { items: string[]; active: string; onChange: (value: string) => void }) {
  return (
    <div className="settings-categories" role="tablist">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          className="settings-tab"
          aria-selected={item === active}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export function TextField({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="ds-field">
      <span>{label}</span>
      <input {...rest} />
    </label>
  );
}
