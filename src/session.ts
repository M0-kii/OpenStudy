import type { PdfFit, ReaderState } from './readers';

export function pdfFitMode(fit: PdfFit | undefined, continuousPdf: boolean): PdfFit | undefined {
  if (fit === undefined || fit !== 'auto') return fit;
  return continuousPdf ? 'width' : 'page';
}

export interface ReadingView {
  location: string;
  showPageJump: boolean;
  page?: string;
  total?: string;
  canPrevious: boolean;
  canNext: boolean;
  zoomLabel: string;
  epubLayout?: { fontSize: number; lineHeight: number; width: number };
}

export function readingView(state: ReaderState, continuousPdf: boolean): ReadingView {
  const position = state.position;
  const pdfPage = position.kind === 'pdf' && state.pageCount ? position.page : undefined;
  const fit = position.kind === 'pdf' ? pdfFitMode(position.fit, continuousPdf) : undefined;

  return {
    location: state.label,
    showPageJump: pdfPage !== undefined,
    page: pdfPage === undefined ? undefined : String(pdfPage),
    total: pdfPage === undefined ? undefined : String(state.pageCount),
    canPrevious: state.canPrevious,
    canNext: state.canNext,
    zoomLabel: position.kind === 'epub'
      ? `${position.fontSize}px`
      : fit === 'page' || fit === 'width' ? `Fit ${fit}` : `${Math.round(position.zoom * 100)}%`,
    epubLayout: position.kind === 'epub'
      ? { fontSize: position.fontSize, lineHeight: position.lineHeight, width: position.width }
      : undefined,
  };
}
