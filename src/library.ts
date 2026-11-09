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
