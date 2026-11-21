export type StudyTheme = 'dark' | 'light' | 'system';
export type Accent = 'ochre' | 'sage' | 'slate' | 'rose';
export type Paper = 'paper' | 'sepia' | 'night';
export type Motion = 'full' | 'reduced';

const themes: StudyTheme[] = ['dark', 'light', 'system'];
const accents: Accent[] = ['ochre', 'sage', 'slate', 'rose'];
const papers: Paper[] = ['paper', 'sepia', 'night'];
const motions: Motion[] = ['full', 'reduced'];

export interface StudySettings {
  defaultMinutes: number;
  showCountdown: boolean;
  pdfContinuous: boolean;
  sidebarCollapsed: boolean;
  theme: StudyTheme;
  accent: Accent;
  paper: Paper;
  motion: Motion;
  blockAppSwitching: boolean;
  batteryAlerts: boolean;
  batteryAlarm: boolean;
}

const key = 'openstudy.settings.v1';
const defaults: StudySettings = {
  defaultMinutes: 0,
  showCountdown: true,
  pdfContinuous: false,
  sidebarCollapsed: false,
  theme: 'dark',
  accent: 'ochre',
  paper: 'paper',
  motion: 'full',
  blockAppSwitching: false,
  batteryAlerts: true,
  batteryAlarm: true,
};
const minutePresets = [0, 15, 25, 45, 60];

function normalize(value: unknown): StudySettings {
  if (value === null || typeof value !== 'object') return { ...defaults };
  const { defaultMinutes, showCountdown, pdfContinuous, sidebarCollapsed, theme, accent, paper, motion, blockAppSwitching, batteryAlerts, batteryAlarm } = value as Partial<StudySettings>;
  return {
    defaultMinutes: typeof defaultMinutes === 'number' && minutePresets.includes(defaultMinutes) ? defaultMinutes : defaults.defaultMinutes,
    showCountdown: typeof showCountdown === 'boolean' ? showCountdown : defaults.showCountdown,
    pdfContinuous: pdfContinuous === true,
    sidebarCollapsed: sidebarCollapsed === true,
    theme: themes.includes(theme as StudyTheme) ? theme as StudyTheme : defaults.theme,
    accent: accents.includes(accent as Accent) ? accent as Accent : defaults.accent,
    paper: papers.includes(paper as Paper) ? paper as Paper : defaults.paper,
    motion: motions.includes(motion as Motion) ? motion as Motion : defaults.motion,
    blockAppSwitching: blockAppSwitching === true,
    batteryAlerts: batteryAlerts !== false,
    batteryAlarm: batteryAlarm !== false,
  };
}

export function loadSettings(storage?: Pick<Storage, 'getItem'>): StudySettings {
  try {
    const saved = (storage ?? localStorage).getItem(key);
    return saved ? normalize(JSON.parse(saved)) : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings: StudySettings, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(key, JSON.stringify(normalize(settings)));
}
