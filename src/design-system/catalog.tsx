import { useEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../design-system.css';
import '../style.css';
import '../bars.css';
import { drawIcons } from '../window-ui';
import './catalog.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'quiet';
};

function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return <button type="button" className={`button button-${variant} ${className}`.trim()} {...rest} />;
}

function IconButton({ icon, label, className = '', ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: string; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`icon-button ${className}`.trim()} {...rest}>
      <i className="icon" data-lucide={icon} aria-hidden="true" />
    </button>
  );
}

function Surface({ popup = false, className = '', ...rest }: HTMLAttributes<HTMLDivElement> & { popup?: boolean }) {
  return <div className={`${popup ? 'surface-popup' : 'surface'} ${className}`.trim()} {...rest} />;
}

function Chip({ selected = false, className = '', ...rest }: HTMLAttributes<HTMLSpanElement> & { selected?: boolean }) {
  return <span className={`ds-chip ${className}`.trim()} data-selected={selected} {...rest} />;
}

function SettingRow({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
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

function Tabs({ items, active, onChange }: { items: string[]; active: string; onChange: (value: string) => void }) {
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

function TextField({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="ds-field">
      <span>{label}</span>
      <input {...rest} />
    </label>
  );
}

const colorTokens = ['--plane', '--panel', '--control', '--hover', '--line', '--edge', '--text', '--muted', '--accent', '--accent-soft'];
const typeTokens = ['--text-xs', '--text-sm', '--text-base', '--text-md', '--text-lg', '--text-xl', '--text-2xl'];
const radiusTokens = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl'];

function Swatch({ token }: { token: string }) {
  return (
    <div className="ds-swatch">
      <span className="ds-swatch-color" style={{ background: `var(${token})` }} />
      <code>{token}</code>
    </div>
  );
}

function Catalog() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [tab, setTab] = useState('Appearance');

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { drawIcons(); });

  return (
    <div className="ds-catalog">
      <header className="ds-catalog-head">
        <div>
          <h1>OpenStudy design system</h1>
          <p>Tokens and React components shared by the desktop UI.</p>
        </div>
        <Button variant="outline" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        </Button>
      </header>

      <Surface className="ds-section">
        <h2>Color</h2>
        <div className="ds-swatches">
          {colorTokens.map((token) => <Swatch key={token} token={token} />)}
        </div>
      </Surface>

      <div className="ds-grid">
        <Surface className="ds-section">
          <h2>Type</h2>
          <div className="ds-stack">
            {typeTokens.map((token) => (
              <div key={token} className="ds-type-row">
                <code>{token}</code>
                <span style={{ fontSize: `var(${token})` }}>The quick brown fox</span>
              </div>
            ))}
          </div>
        </Surface>
        <Surface className="ds-section">
          <h2>Radius &amp; elevation</h2>
          <div className="ds-inline">
            {radiusTokens.map((token) => (
              <div key={token} className="ds-radius" style={{ borderRadius: `var(${token})` }}>{token.replace('--radius-', '')}</div>
            ))}
          </div>
          <div className="ds-inline ds-elevation">
            <div className="surface ds-sample">Surface</div>
            <div className="surface-popup ds-sample">Popup</div>
          </div>
        </Surface>
      </div>

      <Surface className="ds-section">
        <h2>Buttons &amp; chips</h2>
        <div className="ds-inline">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="quiet">Quiet</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="ds-inline">
          <IconButton icon="search" label="Search" />
          <IconButton icon="pencil" label="Add note" />
          <IconButton icon="sliders-horizontal" label="Reading options" />
          <Chip>Default</Chip>
          <Chip selected>Selected</Chip>
        </div>
      </Surface>

      <Surface className="ds-section">
        <h2>Form &amp; settings</h2>
        <Tabs items={['Appearance', 'Study sessions', 'Notifications']} active={tab} onChange={setTab} />
        <div className="ds-settings">
          <SettingRow label="Theme" help="Applied to the whole window.">
            <select aria-label="Theme"><option>Dark</option><option>Light</option></select>
          </SettingRow>
          <SettingRow label="Low battery alerts" help="Show an alert at 20% and 10%.">
            <input type="checkbox" defaultChecked aria-label="Low battery alerts" />
          </SettingRow>
          <TextField label="Session name" placeholder="e.g. Evening reading" />
        </div>
      </Surface>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Catalog />);
