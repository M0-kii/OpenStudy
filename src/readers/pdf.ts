import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import './readers.css';
import { flattenContents } from './contents';
import { emptyFindResult, findGroups, findPattern, groupedMatches, highlightMatch, indexText, matchRange, selectMatch, type GroupMatch } from './find';
import { bounded, type DocumentPreview, type FindDirection, type FindResult, type PdfFit, type PdfPosition, type Reader, type ReaderContentsEntry, type ReaderState } from './index';

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
  const bottomInset = 30;
  const horizontalInset = 56;
  const pageRatios = new Map<number, number>();
  const resident = new Set<PageSlot>();
  let slots: PageSlot[] = [];
  let stackContinuous = continuous;
  let stackWidth = 0;
  let stackHeight = 0;
  let baseWidth = 0;
  let stackFit: Exclude<PdfFit, 'auto'> | undefined;
  let stackZoom = 1;
  let scrollFrame = 0;
  let pinnedScroll = 0;
  let closed = false;
  const savedFit = initial?.fit;
  const validFit = savedFit === 'auto' || savedFit === 'page' || savedFit === 'width' || savedFit === 'custom';
  let initialZoom = initial?.zoom ?? 1;
  if (initial && !validFit) {
    // Old zoom values were relative to a capped page width.
    const width = (host.clientWidth || 800) - horizontalInset;
    initialZoom = bounded(initialZoom, 1, 0.55, 3) * Math.min(1080, Math.max(200, width)) / Math.max(1, width);
  }
  let position = normalize(initial?.page ?? 1, initialZoom, initial?.scroll ?? 0, validFit ? savedFit : initial ? 'custom' : 'auto');
  let published: PdfPosition | undefined;
  let search: { query: string; match: GroupMatch } | undefined;
  let matches: ReturnType<typeof groupedMatches> | undefined;
  let searchId = 0;
  let unhighlight: (() => void) | undefined;
  let outline: Promise<ReaderContentsEntry[]> | undefined;
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

  function normalize(page: number, zoom: number, scroll: number, fit: PdfFit = position.fit ?? 'auto'): PdfPosition {
    return {
      kind: 'pdf',
      page: Math.round(bounded(page, 1, 1, pdf.numPages)),
      zoom: bounded(zoom, 1, 0.02, 3),
      scroll: bounded(scroll, 0, 0, 1),
      fit,
    };
  }

  function publish(current: PdfPosition) {
    position = current;
    if (published?.page === current.page && published.zoom === current.zoom && published.scroll === current.scroll
      && published.fit === current.fit) return;
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
    return { page, element, width: 0 };
  }

  function aspectRatio(page: number): number {
    return pageRatios.get(page) ?? 792 / 612;
  }

  function sizeSlot(slot: PageSlot) {
    const ratio = aspectRatio(slot.page);
    const availableHeight = Math.max(1, stackHeight - pageInset - bottomInset);
    slot.width = stackFit === 'page' ? Math.min(baseWidth, availableHeight / ratio)
      : baseWidth * (stackFit === 'custom' ? stackZoom : 1);
    slot.element.style.width = `${slot.width}px`;
    slot.element.style.height = `${slot.width * ratio}px`;
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
    const zoom = stackFit === 'custom' ? position.zoom : slot.width / baseWidth;
    return normalize(slot.page, zoom, (host.scrollTop - slotTop(slot)) / Math.max(1, slot.element.offsetHeight));
  }

  function pin(next: PdfPosition) {
    const slot = slots[continuous ? next.page - 1 : 0];
    const last = slots[slots.length - 1];
    const zoom = stackFit === 'custom' ? next.zoom : slot.width / baseWidth;
    const scroll = !continuous && stackFit === 'page' ? 0 : next.scroll;
    const top = Math.round(slotTop(slot) + scroll * slot.element.offsetHeight);
    const lastTop = slotTop(last);
    const end = last.element.offsetTop + last.element.offsetHeight;
    // Leave enough room to align short last pages and restore a deep anchor in single-page mode.
    stack.style.paddingBottom = `${Math.max(bottomInset, Math.max(lastTop, top) + host.clientHeight - end)}px`;
    host.scrollTop = top;
    pinnedScroll = host.scrollTop;
    publish({ ...next, zoom, scroll });
  }

  function release(slot: PageSlot) {
    if (search && slot.page === search.match.group + 1) unhighlight?.();
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
      const { canvas, task, viewport } = pageCanvas(page, slot.width / natural.width, window.devicePixelRatio || 1);
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
      markMatch(slot);
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
      const bottom = top + host.clientHeight;
      const last = Math.min(indexAt(bottom + overscan), Math.max(indexAt(bottom), first + 11));
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
    const height = host.clientHeight || stackHeight || 600;
    const nextBaseWidth = Math.max(1, width - horizontalInset);
    const nextFit = next.fit === undefined || next.fit === 'auto' ? (continuous ? 'width' : 'page') : next.fit;
    const rebuild = slots.length === 0 || stackContinuous !== continuous || (!continuous && slots[0].page !== next.page);
    const resize = nextBaseWidth !== baseWidth || nextFit !== stackFit
      || (nextFit === 'page' && height !== stackHeight) || (nextFit === 'custom' && next.zoom !== stackZoom);
    if (rebuild || resize) for (const slot of resident) release(slot);
    stackWidth = width;
    stackHeight = height;
    baseWidth = nextBaseWidth;
    stackFit = nextFit;
    stackZoom = next.zoom;
    if (rebuild) {
      slots = continuous ? Array.from({ length: pdf.numPages }, (_, index) => makeSlot(index + 1)) : [makeSlot(next.page)];
      stackContinuous = continuous;
    }
    if (rebuild || resize) {
      for (const slot of slots) sizeSlot(slot);
    }
    if (rebuild) {
      const pages = document.createDocumentFragment();
      for (const slot of slots) pages.append(slot.element);
      stack.replaceChildren(pages);
      if (!stack.isConnected) host.replaceChildren(stack);
    }
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
    clearFind();
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

  function setFit(fit: 'page' | 'width') {
    return display({ ...currentPosition(), fit });
  }

  function markMatch(slot: PageSlot): Range | undefined {
    if (!search || search.match.group + 1 !== slot.page) return undefined;
    const layer = slot.element.querySelector('.textLayer');
    const range = layer && matchRange(indexText(layer, true), search.match);
    if (!range) return undefined;
    unhighlight?.();
    unhighlight = highlightMatch(range, slot.element);
    return range;
  }

  function clearFind() {
    searchId++;
    search = undefined;
    matches = undefined;
    unhighlight?.();
    unhighlight = undefined;
  }

  async function pageText(group: number): Promise<string> {
    const pageNumber = group + 1;
    let text = searchableText.get(pageNumber);
    if (text === undefined) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      text = content.items.flatMap((item) => 'str' in item && item.str ? [item.str] : []).join(' ');
      if (text.length <= 262_144) {
        if (searchableText.size >= 32) searchableText.delete(searchableText.keys().next().value!);
        searchableText.set(pageNumber, text);
      }
    }
    return text;
  }

  async function find(query: string, direction: FindDirection = 'next', onProgress?: (result: FindResult) => void): Promise<FindResult> {
    const pattern = findPattern(query);
    if (!pattern || closed) return emptyFindResult;
    const currentSearch = ++searchId;
    const active = () => !closed && currentSearch === searchId;
    const index = matches?.query === pattern.source ? matches : groupedMatches(pattern, pdf.numPages, pageText);
    matches = index;
    const previous = search?.query === pattern.source ? search.match : undefined;
    for (const { group, from } of findGroups(pdf.numPages, currentPosition().page - 1, direction, previous)) {
      if (!active()) return emptyFindResult;
      const match = selectMatch(await index.read(group), direction, from);
      if (!match) continue;
      if (!active()) return emptyFindResult;
      const pageNumber = group + 1;
      const selected = { ...match, group };
      unhighlight?.();
      search = { query: pattern.source, match: selected };
      await go(pageNumber);
      if (!active() || position.page !== pageNumber) return emptyFindResult;
      const slot = slots[continuous ? group : 0];
      const range = markMatch(slot);
      if (range) {
        const relativeTop = range.getBoundingClientRect().top - slot.element.getBoundingClientRect().top - host.clientHeight / 4;
        pin(normalize(pageNumber, position.zoom, relativeTop / Math.max(1, slot.element.offsetHeight)));
        scheduleVisible();
      }
      const result = index.result(selected);
      if (result.counting && onProgress) void index.countRest(active, () => onProgress(index.result(selected)));
      return result;
    }
    if (!active()) return emptyFindResult;
    const result = index.result();
    clearFind();
    return result;
  }

  type OutlineItem = Awaited<ReturnType<typeof pdf.getOutline>>[number];

  async function resolveOutline(target: NonNullable<OutlineItem['dest']>) {
    if (closed) return;
    const destination = typeof target === 'string' ? await pdf.getDestination(target) : target;
    const ref = destination?.[0];
    const index = typeof ref === 'number' ? ref : ref && Number.isInteger(ref.num) && Number.isInteger(ref.gen)
      ? await pdf.getPageIndex(ref) : -1;
    if (!closed && Number.isInteger(index) && index >= 0 && index < pdf.numPages) {
      return { pageNumber: index + 1, destination };
    }
  }

  async function goToOutline({ pageNumber, destination }: NonNullable<Awaited<ReturnType<typeof resolveOutline>>>) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const mode = destination?.[1]?.name;
    const x = mode === 'XYZ' || mode === 'FitR' ? destination?.[2] : undefined;
    const y = mode === 'XYZ' ? destination?.[3] : mode === 'FitR' ? destination?.[5]
      : mode === 'FitH' || mode === 'FitBH' ? destination?.[2] : undefined;
    const scroll = typeof y === 'number' && Number.isFinite(y)
      ? viewport.convertToViewportPoint(typeof x === 'number' && Number.isFinite(x) ? x : page.view[0], y)[1] / viewport.height
      : 0;
    await display(normalize(pageNumber, position.zoom, scroll));
  }

  function contents() {
    if (closed) return Promise.resolve([]);
    return outline ??= pdf.getOutline().then(async (items) => {
      const resolvePages: (() => Promise<void>)[] = [];
      const entries = flattenContents(items ?? [], (item) => item.items, (item, depth) => {
        const label = typeof item.title === 'string' ? item.title.trim() : '';
        const target = item.dest;
        if (!label || !target) return;
        let resolution: ReturnType<typeof resolveOutline> | undefined;
        const resolve = () => resolution ??= resolveOutline(target);
        const entry: ReaderContentsEntry = {
          label,
          depth,
          goTo: async () => {
            const destination = await resolve();
            if (destination) await goToOutline(destination);
          },
        };
        resolvePages.push(async () => { entry.page = (await resolve().catch(() => undefined))?.pageNumber; });
        return entry;
      });
      for (let offset = 0; offset < resolvePages.length && !closed; offset += 16) {
        await Promise.all(resolvePages.slice(offset, offset + 16).map((resolve) => resolve()));
      }
      return entries;
    });
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
        return display(normalize(current.page, current.zoom * 1.18 ** delta, current.scroll, 'custom'));
      },
      fit: () => setFit('width'),
      setPdfFit: setFit,
      setPdfContinuous: async (enabled) => {
        if (continuous === enabled || closed) return;
        const anchor = currentPosition();
        continuous = enabled;
        await display(anchor);
      },
      setEpubLayout: async () => {},
      contents,
      find,
      clearFind,
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
  width: number;
  drawing?: PageDrawing;
}

interface PageDrawing {
  finished: Promise<void>;
  task?: RenderTask;
  textLayer?: TextLayer;
}
