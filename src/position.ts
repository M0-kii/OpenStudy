import type { DocumentKind, EpubPosition, MarkdownPosition, PdfFit, PdfPosition, ReadingPosition } from './readers';

const fits: PdfFit[] = ['auto', 'page', 'width', 'custom'];

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function readPosition(raw: unknown, kind: 'pdf'): PdfPosition | undefined;
export function readPosition(raw: unknown, kind: 'markdown'): MarkdownPosition | undefined;
export function readPosition(raw: unknown, kind: 'epub'): EpubPosition | undefined;
export function readPosition(raw: unknown, kind: DocumentKind): ReadingPosition | undefined;
export function readPosition(raw: unknown, kind: DocumentKind): ReadingPosition | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  if (value.kind !== kind) return undefined;

  if (kind === 'pdf') {
    const { page, zoom, scroll, fit } = value;
    if (!finite(page) || !Number.isInteger(page) || page < 1) return undefined;
    if (!finite(zoom) || zoom <= 0 || !finite(scroll) || scroll < 0) return undefined;
    const savedFit = typeof fit === 'string' && fits.includes(fit as PdfFit) ? fit as PdfFit : undefined;
    return { kind: 'pdf', page, zoom, scroll, ...(savedFit ? { fit: savedFit } : {}) };
  }

  if (kind === 'markdown') {
    const { scroll, zoom } = value;
    if (!finite(scroll) || scroll < 0 || !finite(zoom) || zoom <= 0) return undefined;
    return { kind: 'markdown', scroll, zoom };
  }

  const { cfi, fontSize, lineHeight, width } = value;
  if (typeof cfi !== 'string' || !cfi.startsWith('epubcfi(') || !cfi.endsWith(')')) return undefined;
  if (!finite(fontSize) || fontSize <= 0 || !finite(lineHeight) || lineHeight <= 0 || !finite(width) || width <= 0) return undefined;
  return { kind: 'epub', cfi, fontSize, lineHeight, width };
}
