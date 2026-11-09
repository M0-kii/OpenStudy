export type DocumentKind = 'pdf' | 'epub';

export interface PdfPosition {
  kind: 'pdf';
  page: number;
  scroll: number;
  zoom: number;
}

export interface EpubLayout {
  fontSize: number;
  lineHeight: number;
  width: number;
}

export interface EpubPosition extends EpubLayout {
  kind: 'epub';
  cfi: string;
}

export type ReadingPosition = PdfPosition | EpubPosition;

export interface ReaderState {
  position: ReadingPosition;
  label: string;
  canPrevious: boolean;
  canNext: boolean;
}

export interface Reader {
  previous(): Promise<void>;
  next(): Promise<void>;
  goTo(position: ReadingPosition): Promise<void>;
  zoom(delta: number): Promise<void>;
  fit(): Promise<void>;
  setEpubLayout(layout: Partial<EpubLayout>): Promise<void>;
  find?(query: string): Promise<boolean>;
  destroy(): void;
}

export interface DocumentPreview {
  title?: string;
  details: string;
  image?: string;
}

export const epubDefaults: EpubLayout = { fontSize: 20, lineHeight: 1.6, width: 680 };

export function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export async function openReader(
  host: HTMLElement,
  kind: DocumentKind,
  bytes: ArrayBuffer,
  initial: ReadingPosition | undefined,
  onChange: (state: ReaderState) => void,
  signal?: AbortSignal,
): Promise<Reader> {
  if (kind === 'pdf') {
    const { openPdf } = await import('./pdf');
    return openPdf(host, bytes, initial?.kind === 'pdf' ? initial : undefined, onChange, signal);
  }

  const { openEpub } = await import('./epub');
  return openEpub(host, bytes, initial?.kind === 'epub' ? initial : undefined, onChange, signal);
}

export async function previewDocument(kind: DocumentKind, bytes: ArrayBuffer, signal?: AbortSignal): Promise<DocumentPreview> {
  if (kind === 'pdf') {
    const { previewPdf } = await import('./pdf');
    return previewPdf(bytes, signal);
  }

  const { previewEpub } = await import('./epub');
  return previewEpub(bytes, signal);
}
