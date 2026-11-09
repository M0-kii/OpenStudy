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
  continuous = false,
): Promise<Reader> {
  signal?.throwIfAborted();
  const loading = loadPdf(bytes);
  const pdf = await load();
  const stack = document.createElement('div');
  stack.className = 'pdf-stack';
  const pageInset = 20;
  const pageRatios = new Map<number, number>();
  const resident = new Set<PageSlot>();
  let slots: PageSlot[] = [];
  let stackContinuous = continuous;
  let stackWidth = 0;
  let stackHeight = 0;
  let pageWidth = 0;
  let scrollFrame = 0;
  let pinnedScroll = 0;
  let closed = false;
  let position = normalize(initial?.page ?? 1, initial?.zoom ?? 1, initial?.scroll ?? 0);
  let published: PdfPosition | undefined;
  let search = { query: '', page: 0 };
  let searchId = 0;
  const searchableText = new Map<number, string>();
  const resize = new ResizeObserver(() => {
    if (!host.clientWidth || !host.clientHeight) return;
    if (host.clientWidth !== stackWidth || host.clientHeight !== stackHeight) {
      void display(currentPosition()).catch(() => {});
    }
  });

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

  function publish(current: PdfPosition) {
    position = current;
    if (published?.page === current.page && published.zoom === current.zoom && published.scroll === current.scroll) return;
    published = current;
    onChange({
      position: { ...current },
      label: `Page ${current.page} of ${pdf.numPages}`,
      pageCount: pdf.numPages,
      canPrevious: current.page > 1,
      canNext: current.page < pdf.numPages,
    });
  }

  function makeSlot(page: number): PageSlot {
    const element = document.createElement('article');
    element.className = 'pdf-page';
    element.setAttribute('aria-label', `Page ${page}`);
    element.setAttribute('aria-hidden', 'true');
    element.dataset.page = String(page);
    return { page, element };
  }

  function aspectRatio(page: number): number {
    return pageRatios.get(page) ?? 792 / 612;
  }

  function sizeSlot(slot: PageSlot) {
    slot.element.style.width = `${pageWidth}px`;
    slot.element.style.height = `${pageWidth * aspectRatio(slot.page)}px`;
  }

  function slotTop(slot: PageSlot): number {
    return slot.element.offsetTop - pageInset;
  }

  function indexAt(y: number): number {
    let first = 0;
    let last = slots.length - 1;
    while (first < last) {
      const middle = Math.ceil((first + last) / 2);
      if (slotTop(slots[middle]) <= y) first = middle;
      else last = middle - 1;
    }
    return first;
  }

  function currentPosition(): PdfPosition {
    if (!slots.length || host.scrollTop === pinnedScroll || !host.clientHeight) return position;
    const slot = slots[indexAt(host.scrollTop)];
    return normalize(slot.page, position.zoom, (host.scrollTop - slotTop(slot)) / Math.max(1, slot.element.offsetHeight));
  }

  function pin(next: PdfPosition) {
    const slot = slots[continuous ? next.page - 1 : 0];
    const last = slots[slots.length - 1];
    const top = Math.round(slotTop(slot) + next.scroll * slot.element.offsetHeight);
    const lastTop = slotTop(last);
    const end = last.element.offsetTop + last.element.offsetHeight;
    // Leave enough room to align short last pages and restore a deep anchor in single-page mode.
    stack.style.paddingBottom = `${Math.max(30, Math.max(lastTop, top) + host.clientHeight - end)}px`;
    host.scrollTop = top;
    pinnedScroll = host.scrollTop;
    publish(next);
  }

  function release(slot: PageSlot) {
    slot.drawing?.task?.cancel();
    slot.drawing?.textLayer?.cancel();
    slot.drawing = undefined;
    slot.element.replaceChildren();
    slot.element.setAttribute('aria-hidden', 'true');
    resident.delete(slot);
  }

  function draw(slot: PageSlot): Promise<void> {
    if (slot.drawing) return slot.drawing.finished;
    const drawing: PageDrawing = { finished: Promise.resolve() };
    slot.drawing = drawing;
    resident.add(slot);
    drawing.finished = paintSlot(slot, drawing);
    return drawing.finished;
  }

  async function paintSlot(slot: PageSlot, drawing: PageDrawing) {
    try {
      const page = await pdf.getPage(slot.page);
      if (closed || slot.drawing !== drawing) return;
      const natural = page.getViewport({ scale: 1 });
      const ratio = natural.height / natural.width;
      if (ratio !== aspectRatio(slot.page)) {
        const anchor = currentPosition();
        pageRatios.set(slot.page, ratio);
        sizeSlot(slot);
        pin(anchor);
        scheduleVisible();
      }
      const { canvas, task, viewport } = pageCanvas(page, pageWidth / natural.width, window.devicePixelRatio || 1);
      const article = slot.element;
      article.style.setProperty('--scale-factor', String(viewport.scale));
      article.style.setProperty('--user-unit', String(page.userUnit));
      article.style.setProperty('--total-scale-factor', String(viewport.scale * page.userUnit));
      canvas.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div');
      text.className = 'textLayer';
      const textLayer = new TextLayer({ textContentSource: page.streamTextContent(), viewport, container: text });
      drawing.task = task;
      drawing.textLayer = textLayer;
      await Promise.all([task.promise, textLayer.render().catch(() => {})]);
      if (closed || slot.drawing !== drawing) return;
      drawing.task = undefined;
      drawing.textLayer = undefined;
      article.replaceChildren(canvas, text);
      article.removeAttribute('aria-hidden');
    } catch (error) {
      if (closed || slot.drawing !== drawing) return;
      const message = document.createElement('p');
      message.className = 'pdf-page-error';
      message.textContent = `Page ${slot.page} could not be displayed.`;
      slot.element.replaceChildren(message);
      slot.element.removeAttribute('aria-hidden');
      throw error;
    }
  }

  function scheduleVisible() {
    if (closed || !continuous || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!continuous || !host.clientHeight) return;
      const top = host.scrollTop;
      const overscan = Math.min(600, host.clientHeight / 2);
      const first = Math.max(indexAt(top - overscan), indexAt(top) - 2);
      const last = Math.min(indexAt(top + host.clientHeight + overscan), first + 11);
      for (const slot of resident) if (slot.page - 1 < first || slot.page - 1 > last) release(slot);
      for (let index = first; index <= last; index++) void draw(slots[index]).catch(() => {});
    });
  }

  function scrolled() {
    publish(currentPosition());
    scheduleVisible();
  }

  async function display(next: PdfPosition) {
    if (closed) return;
    const width = host.clientWidth || stackWidth || 800;
    const nextPageWidth = Math.min(1080, Math.max(200, width - 56)) * next.zoom;
    const rebuild = slots.length === 0 || stackContinuous !== continuous || (!continuous && slots[0].page !== next.page);
    if (rebuild || nextPageWidth !== pageWidth) for (const slot of resident) release(slot);
    if (rebuild) {
      slots = continuous ? Array.from({ length: pdf.numPages }, (_, index) => makeSlot(index + 1)) : [makeSlot(next.page)];
      stackContinuous = continuous;
    }
    if (rebuild || nextPageWidth !== pageWidth) {
      pageWidth = nextPageWidth;
      for (const slot of slots) sizeSlot(slot);
    }
    if (rebuild) {
      const pages = document.createDocumentFragment();
      for (const slot of slots) pages.append(slot.element);
      stack.replaceChildren(pages);
      if (!stack.isConnected) host.replaceChildren(stack);
    }
    stackWidth = width;
    stackHeight = host.clientHeight;
    if (position.page !== next.page) host.scrollLeft = 0;
    pin(next);
    scheduleVisible();
    await draw(slots[continuous ? next.page - 1 : 0]);
  }

  function destroy() {
    if (closed) return;
    closed = true;
    resize.disconnect();
    cancelAnimationFrame(scrollFrame);
    host.removeEventListener('scroll', scrolled);
    signal?.removeEventListener('abort', destroy);
    for (const slot of resident) release(slot);
    stack.remove();
    void loading.destroy().catch(() => {});
  }

  function go(page: number) {
    return display(normalize(page, position.zoom, 0));
  }

  function step(offset: number) {
    const target = currentPosition().page + offset;
    return target >= 1 && target <= pdf.numPages ? go(target) : Promise.resolve();
  }

  async function find(query: string) {
    query = query.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    if (!query || closed) return false;
    const currentSearch = ++searchId;
    const page = currentPosition().page;
    const start = search.query === query && search.page === page ? page + 1 : page;
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
    await display(position);
    signal?.throwIfAborted();
    host.addEventListener('scroll', scrolled, { passive: true });
    resize.observe(host);
    return {
      previous: () => step(-1),
      next: () => step(1),
      goTo: async (target) => { if (target.kind === 'pdf') await display(normalize(target.page, position.zoom, target.scroll)); },
      zoom: (delta) => {
        const current = currentPosition();
        return display(normalize(current.page, current.zoom * 1.18 ** delta, current.scroll));
      },
      fit: () => {
        const current = currentPosition();
        return display(normalize(current.page, 1, current.scroll));
      },
      setPdfContinuous: async (enabled) => {
        if (continuous === enabled || closed) return;
        const anchor = currentPosition();
        continuous = enabled;
        await display(anchor);
      },
      setEpubLayout: async () => {},
      find,
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}

interface PageSlot {
  page: number;
  element: HTMLElement;
  drawing?: PageDrawing;
}

interface PageDrawing {
  finished: Promise<void>;
  task?: RenderTask;
  textLayer?: TextLayer;
}
