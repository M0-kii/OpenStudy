import { readPosition } from '../position.ts';

export type DocumentKind = 'pdf' | 'epub' | 'markdown';

export type PdfFit = 'auto' | 'page' | 'width' | 'custom';

export interface PdfPosition {
  kind: 'pdf';
  page: number;
  scroll: number;
  zoom: number;
  fit?: PdfFit;
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

export interface MarkdownPosition {
  kind: 'markdown';
  scroll: number;
  zoom: number;
}

export type ReadingPosition = PdfPosition | EpubPosition | MarkdownPosition;

export interface ReaderState {
  position: ReadingPosition;
  label: string;
  pageCount?: number;
  canPrevious: boolean;
  canNext: boolean;
}

export type FindDirection = 'next' | 'previous';

export interface FindResult {
  found: boolean;
  index?: number;
  count: number;
  complete: boolean;
  counting: boolean;
}

export interface ReaderContentsEntry {
  label: string;
  depth: number;
  page?: number;
  current?(position: ReadingPosition): boolean;
  goTo(): Promise<void>;
}

export interface Reader {
  previous(): Promise<void>;
  next(): Promise<void>;
  goTo(position: ReadingPosition): Promise<void>;
  zoom(delta: number): Promise<void>;
  fit(): Promise<void>;
  setEpubLayout(layout: Partial<EpubLayout>): Promise<void>;
  setPdfContinuous(enabled: boolean): Promise<void>;
  setPdfFit(fit: 'page' | 'width'): Promise<void>;
  contents(): Promise<readonly ReaderContentsEntry[]>;
  find(query: string, direction?: FindDirection, onProgress?: (result: FindResult) => void): Promise<FindResult>;
  clearFind(): void;
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
  pdfContinuous = false,
): Promise<Reader> {
  if (kind === 'pdf') {
    const { openPdf } = await import('./pdf');
    return openPdf(host, bytes, readPosition(initial, 'pdf'), onChange, signal, pdfContinuous);
  }
  if (kind === 'markdown') {
    const { openMarkdown } = await import('./markdown');
    return openMarkdown(host, bytes, readPosition(initial, 'markdown'), onChange, signal);
  }

  const { openEpub } = await import('./epub');
  return openEpub(host, bytes, readPosition(initial, 'epub'), onChange, signal);
}

export async function previewDocument(kind: DocumentKind, bytes: ArrayBuffer, signal?: AbortSignal): Promise<DocumentPreview> {
  if (kind === 'pdf') {
    const { previewPdf } = await import('./pdf');
    return previewPdf(bytes, signal);
  }
  if (kind === 'markdown') {
    const { previewMarkdown } = await import('./markdown');
    return previewMarkdown(bytes, signal);
  }

  const { previewEpub } = await import('./epub');
  return previewEpub(bytes, signal);
}
