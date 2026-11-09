import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import './readers.css';
import { bounded, type DocumentPreview, type PdfPosition, type Reader, type ReaderState } from './index';

GlobalWorkerOptions.workerSrc = workerUrl;

function loadPdf(bytes: ArrayBuffer) {
  const assets = new URL('./pdfjs/', document.baseURI);
  return getDocument({
    data: new Uint8Array(bytes.slice(0)),
    cMapUrl: new URL('cmaps/', assets).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', assets).href,
    wasmUrl: new URL('wasm/', assets).href,
    iccUrl: new URL('iccs/', assets).href,
  });
}

function pageCanvas(page: PDFPageProxy, scale: number, pixelRatio: number) {
  const viewport = page.getViewport({ scale });
  const outputScale = Math.min(pixelRatio, Math.sqrt(12_000_000 / (viewport.width * viewport.height)), 8192 / Math.max(viewport.width, viewport.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  const canvasContext = canvas.getContext('2d', { alpha: false });
  if (!canvasContext) throw new Error('The PDF drawing surface is unavailable.');
  const transform = [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0];
  const task = page.render({ canvas, canvasContext, viewport, transform });
  return { canvas, task, viewport };
}

export async function previewPdf(bytes: ArrayBuffer, signal?: AbortSignal): Promise<DocumentPreview> {
  signal?.throwIfAborted();
  const loading = loadPdf(bytes);
  const abort = () => { void loading.destroy().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    const pageSize = page.getViewport({ scale: 1 });
    const { canvas, task } = pageCanvas(page, Math.min(360 / pageSize.width, 480 / pageSize.height), 1);
    const metadata = pdf.getMetadata().catch(() => undefined);
    await task.promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    const info = (await metadata)?.info as { Title?: unknown } | undefined;
    signal?.throwIfAborted();
    return {
      title: typeof info?.Title === 'string' ? info.Title.trim() || undefined : undefined,
      details: `${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}`,
      image: blob ? URL.createObjectURL(blob) : undefined,
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    await loading.destroy().catch(() => {});
  }
}

export async function openPdf(
  host: HTMLElement,
  bytes: ArrayBuffer,
  initial: PdfPosition | undefined,
  onChange: (state: ReaderState) => void,
  signal?: AbortSignal,
): Promise<Reader> {
  signal?.throwIfAborted();
  const loading = loadPdf(bytes);
  const pdf = await load();
  let closed = false;
  let generation = 0;
  let task: RenderTask | undefined;
  let textLayer: TextLayer | undefined;
  let pageElement: HTMLElement | undefined;
  let renderedPosition: PdfPosition | undefined;
  let position = normalize(initial?.page ?? 1, initial?.zoom ?? 1, initial?.scroll ?? 0);
  let search = { query: '', page: 0 };
  let searchId = 0;
  const searchableText = new Map<number, string>();
  const resize = new ResizeObserver(() => {
    const width = host.clientWidth;
    if (width > 0 && width !== paintedWidth) void paint(position).catch(() => {});
  });
  let paintedWidth = 0;

  async function load() {
    const abort = () => { void loading.destroy().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await loading.promise;
    } catch (error) {
      await loading.destroy().catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  function normalize(page: number, zoom: number, scroll: number): PdfPosition {
    return {
      kind: 'pdf',
      page: Math.round(bounded(page, 1, 1, pdf.numPages)),
      zoom: bounded(zoom, 1, 0.55, 3),
      scroll: bounded(scroll, 0, 0, 1),
    };
  }

  function notify(current: PdfPosition) {
    onChange({
      position: { ...current },
      label: `Page ${current.page} of ${pdf.numPages}`,
      canPrevious: current.page > 1,
      canNext: current.page < pdf.numPages,
    });
  }

  function scrolled() {
    if (!pageElement || renderedPosition !== position) return;
    const scroll = host.scrollTop / Math.max(1, pageElement.offsetHeight);
    if (scroll === position.scroll) return;
    position.scroll = scroll;
    notify(position);
  }

  async function paint(next: PdfPosition) {
    if (closed) return;
    position = { ...next };
    const drawing = ++generation;
    task?.cancel();
    textLayer?.cancel();
    const page = await pdf.getPage(next.page);
    if (closed || drawing !== generation) return;
    const width = host.clientWidth || 800;
    const naturalWidth = page.getViewport({ scale: 1 }).width;
    const fitWidth = Math.min(1080, Math.max(200, width - 56));
    const { canvas, task: drawingTask, viewport } = pageCanvas(page, fitWidth / naturalWidth * next.zoom, window.devicePixelRatio || 1);
    const article = document.createElement('article');
    article.className = 'pdf-page';
    article.setAttribute('aria-label', `Page ${next.page}`);
    article.style.width = `${viewport.width}px`;
    article.style.height = `${viewport.height}px`;
    article.style.setProperty('--scale-factor', String(viewport.scale));
    article.style.setProperty('--user-unit', String(page.userUnit));
    article.style.setProperty('--total-scale-factor', String(viewport.scale * page.userUnit));
    canvas.setAttribute('aria-hidden', 'true');
    const text = document.createElement('div');
    text.className = 'textLayer';
    article.append(canvas, text);
    const layer = new TextLayer({ textContentSource: page.streamTextContent(), viewport, container: text });
    task = drawingTask;
    textLayer = layer;
    try {
      await Promise.all([drawingTask.promise, layer.render().catch(() => {})]);
    } catch (error) {
      if (!closed && drawing === generation) throw error;
      return;
    }
    if (closed || drawing !== generation) return;
    task = undefined;
    textLayer = undefined;
    paintedWidth = width;
    pageElement = article;
    host.replaceChildren(article);
    host.scrollTop = Math.round(next.scroll * viewport.height);
    if (renderedPosition?.page !== next.page) host.scrollLeft = 0;
    renderedPosition = position;
    position.scroll = host.scrollTop / Math.max(1, article.offsetHeight);
    notify(position);
  }

  function destroy() {
    if (closed) return;
    closed = true;
    resize.disconnect();
    host.removeEventListener('scroll', scrolled);
    signal?.removeEventListener('abort', destroy);
    task?.cancel();
    textLayer?.cancel();
    pageElement?.remove();
    void loading.destroy().catch(() => {});
  }

  function go(page: number) {
    return paint(normalize(page, position.zoom, 0));
  }

  async function find(query: string) {
    query = query.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    if (!query || closed) return false;
    const currentSearch = ++searchId;
    const start = search.query === query && search.page === position.page ? position.page + 1 : position.page;
    for (let offset = 0; offset < pdf.numPages; offset++) {
      if (closed || currentSearch !== searchId) return false;
      const pageNumber = (start + offset - 1) % pdf.numPages + 1;
      let text = searchableText.get(pageNumber);
      if (text === undefined) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        text = content.items.map((item) => 'str' in item ? item.str : '').join(' ').toLocaleLowerCase().replace(/\s+/g, ' ');
        searchableText.set(pageNumber, text);
      }
      if (text.includes(query) && currentSearch === searchId) {
        search = { query, page: pageNumber };
        await go(pageNumber);
        return true;
      }
    }
    return false;
  }

  try {
    signal?.throwIfAborted();
    signal?.addEventListener('abort', destroy, { once: true });
    await paint(position);
    signal?.throwIfAborted();
    host.addEventListener('scroll', scrolled, { passive: true });
    resize.observe(host);
    return {
      previous: () => position.page > 1 ? go(position.page - 1) : Promise.resolve(),
      next: () => position.page < pdf.numPages ? go(position.page + 1) : Promise.resolve(),
      goTo: async (target) => { if (target.kind === 'pdf') await paint(normalize(target.page, position.zoom, target.scroll)); },
      zoom: (delta) => paint(normalize(position.page, position.zoom * 1.18 ** delta, position.scroll)),
      fit: () => paint(normalize(position.page, 1, position.scroll)),
      setEpubLayout: async () => {},
      find,
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
