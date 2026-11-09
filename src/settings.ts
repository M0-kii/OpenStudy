export type StudyTheme = 'dark' | 'light';

export interface StudySettings {
  defaultMinutes: number;
  showCountdown: boolean;
  pdfContinuous: boolean;
  sidebarCollapsed: boolean;
  theme: StudyTheme;
}

const key = 'openstudy.settings.v1';
const defaults: StudySettings = {
  defaultMinutes: 0,
  showCountdown: true,
  pdfContinuous: false,
  sidebarCollapsed: false,
  theme: 'dark',
};
const minutePresets = [0, 15, 25, 45, 60];

function normalize(value: unknown): StudySettings {
  if (value === null || typeof value !== 'object') return { ...defaults };
  const { defaultMinutes, showCountdown, pdfContinuous, sidebarCollapsed, theme } = value as Partial<StudySettings>;
  return {
    defaultMinutes: typeof defaultMinutes === 'number' && minutePresets.includes(defaultMinutes) ? defaultMinutes : defaults.defaultMinutes,
    showCountdown: typeof showCountdown === 'boolean' ? showCountdown : defaults.showCountdown,
    pdfContinuous: pdfContinuous === true,
    sidebarCollapsed: sidebarCollapsed === true,
    theme: theme === 'light' ? 'light' : defaults.theme,
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
