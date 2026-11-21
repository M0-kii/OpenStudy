import type { StudySettings } from './settings';

export interface SettingsControls {
  defaultMinutes: HTMLSelectElement;
  timerSelect: HTMLSelectElement;
  showCountdown: HTMLInputElement;
  themeSelect: HTMLSelectElement;
  accentSelect: HTMLSelectElement;
  paperSelect: HTMLSelectElement;
  motionSelect: HTMLSelectElement;
  continuousPdf: HTMLInputElement;
  readerContinuousPdf: HTMLInputElement;
  blockAppSwitching: HTMLInputElement;
  batteryAlerts: HTMLInputElement;
  batteryAlarm: HTMLInputElement;
  sidebarToggle: HTMLButtonElement;
  workspace: HTMLElement | null;
  sidebarCollapseIcon: HTMLElement;
  sidebarExpandIcon: HTMLElement;
  setTheme(theme: StudySettings['theme']): void;
  setPreferences(settings: StudySettings): void;
}

export function applySettings(settings: StudySettings, controls: SettingsControls): void {
  controls.defaultMinutes.value = String(settings.defaultMinutes);
  controls.timerSelect.value = String(settings.defaultMinutes);
  controls.showCountdown.checked = settings.showCountdown;
  controls.themeSelect.value = settings.theme;
  controls.accentSelect.value = settings.accent;
  controls.paperSelect.value = settings.paper;
  controls.motionSelect.value = settings.motion;
  controls.continuousPdf.checked = settings.pdfContinuous;
  controls.readerContinuousPdf.checked = settings.pdfContinuous;
  controls.blockAppSwitching.checked = settings.blockAppSwitching;
  controls.batteryAlerts.checked = settings.batteryAlerts;
  controls.batteryAlarm.checked = settings.batteryAlarm;
  controls.batteryAlarm.disabled = !settings.batteryAlerts;

  controls.sidebarToggle.setAttribute('aria-expanded', String(!settings.sidebarCollapsed));
  const label = settings.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
  controls.sidebarToggle.setAttribute('aria-label', label);
  controls.sidebarToggle.title = label;
  controls.sidebarCollapseIcon.hidden = settings.sidebarCollapsed;
  controls.sidebarExpandIcon.hidden = !settings.sidebarCollapsed;
  if (controls.workspace) controls.workspace.dataset.sidebar = settings.sidebarCollapsed ? 'collapsed' : 'expanded';

  controls.setTheme(settings.theme);
  controls.setPreferences(settings);
}
