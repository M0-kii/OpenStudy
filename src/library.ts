import { readPosition } from './position.ts';
import type { DocumentKind, ReadingPosition } from './readers';

export interface StudyNote {
  text: string;
  position: ReadingPosition;
  label: string;
}

export interface SavedDocument {
  path: string;
  name: string;
  title: string;
  kind: DocumentKind;
  online?: true;
  position?: ReadingPosition;
  label?: string;
  updatedAt: number;
  notes: StudyNote[];
}

const storageKey = 'openstudy.library.v1';

function readDocument(raw: unknown): SavedDocument | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const { path, name, title, kind, updatedAt, notes } = value;
  if (typeof path !== 'string' || typeof name !== 'string' || typeof title !== 'string') return undefined;
  if (kind !== 'pdf' && kind !== 'epub' && kind !== 'markdown') return undefined;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || !Array.isArray(notes)) return undefined;

  const readNotes: StudyNote[] = [];
  for (const rawNote of notes) {
    if (!rawNote || typeof rawNote !== 'object') continue;
    const note = rawNote as Record<string, unknown>;
    const position = readPosition(note.position, kind);
    if (typeof note.text !== 'string' || !position) continue;
    readNotes.push({ text: note.text, position, label: typeof note.label === 'string' ? note.label : '' });
  }

  return {
    path, name, title, kind, updatedAt, notes: readNotes,
    ...(value.online === true ? { online: true as const } : {}),
    position: readPosition(value.position, kind),
    label: typeof value.label === 'string' ? value.label : undefined,
  };
}

export function loadLibrary(): SavedDocument[] {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return [];
  const library: unknown = JSON.parse(saved);
  if (!Array.isArray(library)) throw new Error('Invalid library');
  return library.map(readDocument).filter((entry): entry is SavedDocument => Boolean(entry));
}

export function saveLibrary(library: SavedDocument[]): void {
  localStorage.setItem(storageKey, JSON.stringify(library));
}

export function reconnectDocument(
  library: SavedDocument[],
  entry: SavedDocument,
  source: Pick<SavedDocument, 'path' | 'name' | 'kind' | 'online'>,
): { library: SavedDocument[]; document: SavedDocument } {
  if (source.kind !== entry.kind || source.online !== entry.online) {
    throw new Error('Choose the original document in the same format.');
  }
  if (library.some((other) => other !== entry && other.path === source.path)) {
    throw new Error('That document already has its own reading history.');
  }
  const document = { ...entry, path: source.path, name: source.name };
  return { library: library.map((other) => other === entry ? document : other), document };
}
