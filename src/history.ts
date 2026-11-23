export interface DayEntry {
  date: string;
  seconds: number;
  documents: Record<string, number>;
}

const key = 'openstudy.history.v1';

function day(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function readEntry(raw: unknown): DayEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return undefined;
  if (typeof value.seconds !== 'number' || !Number.isFinite(value.seconds) || value.seconds < 0) return undefined;
  const documents: Record<string, number> = {};
  if (value.documents && typeof value.documents === 'object') {
    for (const [name, seconds] of Object.entries(value.documents)) {
      if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) documents[name] = seconds;
    }
  }
  return { date: value.date, seconds: value.seconds, documents };
}

export function loadHistory(storage: Pick<Storage, 'getItem'> = localStorage): DayEntry[] {
  try {
    const saved = storage.getItem(key);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(readEntry).filter((entry): entry is DayEntry => Boolean(entry));
  } catch {
    return [];
  }
}

export function addReading(entries: DayEntry[], seconds: number, title: string, now = new Date()): DayEntry[] {
  const today = day(now);
  const current = entries.find((entry) => entry.date === today);
  const updated: DayEntry = current
    ? { ...current, seconds: current.seconds + seconds, documents: { ...current.documents, [title]: (current.documents[title] ?? 0) + seconds } }
    : { date: today, seconds, documents: { [title]: seconds } };
  return [...entries.filter((entry) => entry.date !== today), updated].sort((a, b) => a.date.localeCompare(b.date)).slice(-365);
}

export function saveHistory(entries: DayEntry[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(key, JSON.stringify(entries));
}

export function lastDays(entries: DayEntry[], count = 7, now = new Date()): DayEntry[] {
  const result: DayEntry[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    result.push(entries.find((entry) => entry.date === day(date)) ?? { date: day(date), seconds: 0, documents: {} });
  }
  return result;
}
