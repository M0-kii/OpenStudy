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

export function loadLibrary(): SavedDocument[] {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return [];
  const library: unknown = JSON.parse(saved);
  if (!Array.isArray(library)) throw new Error('Invalid library');
  return library;
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
