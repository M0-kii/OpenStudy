import { Book } from 'epubjs';
import type Contents from 'epubjs/types/contents';
import type { Location } from 'epubjs/types/rendition';
import type Section from 'epubjs/types/section';
import './readers.css';
import { flattenContents } from './contents';
import { emptyFindResult, findGroups, findPattern, groupedMatches, indexText, matchRange, selectMatch, type GroupMatch } from './find';
import { bounded, epubDefaults, type DocumentPreview, type EpubLayout, type EpubPosition, type FindDirection, type FindResult, type Reader, type ReaderContentsEntry, type ReaderState } from './index';

const chapterPolicy = "default-src 'none'; style-src 'unsafe-inline' blob: data:; img-src blob: data:; font-src blob: data:; media-src blob: data:; base-uri 'self'; form-action 'none'";
const activeElements = new Set(['applet', 'embed', 'fencedframe', 'foreignobject', 'frame', 'frameset', 'iframe', 'object', 'portal', 'script', 'template', 'animate', 'animatemotion', 'animatetransform', 'set']);
const removedAttributes = new Set(['target', 'download', 'ping', 'xml:base', 'srcdoc', 'srcset']);
const urlAttributes = new Set(['src', 'href', 'xlink:href', 'poster', 'background']);
const absoluteUrl = /^(?:[\w+.-]+:|[\\/]{2})/;
const chapterStyle = `
  html, body { background: #fafafa !important; color: #0a0a0a !important; }
  body { font-size: var(--study-size) !important; line-height: var(--study-leading) !important; }
  :where(p, li, dt, dd, blockquote) { font-size: inherit !important; line-height: var(--study-leading) !important; }
  a[href] { color: #0a0a0a; text-decoration: underline; }
  :focus-visible { outline: 2px solid #0a0a0a; outline-offset: 2px; }
`;

function sanitizeChapter(doc: Document) {
  const head = doc.querySelector('head');
  if (!head) throw new Error('This EPUB chapter has no document header.');
  const base = head.querySelector('base');
  if (base) {
    const url = new URL(base.getAttribute('href') || '', document.baseURI);
    if (url.protocol !== location.protocol || url.host !== location.host) base.remove();
  }

  for (const element of Array.from(doc.querySelectorAll('*'))) {
    const tag = element.localName.toLowerCase();
    if (activeElements.has(tag) || (tag === 'base' && element !== base) || (tag === 'meta' && element.hasAttribute('http-equiv')) ||
        (tag === 'link' && element.getAttribute('rel')?.toLowerCase() !== 'stylesheet')) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.replace(/[\u0000-\u0020\u007f]/g, '');
      const isLink = tag === 'a' || tag === 'area';
      const external = urlAttributes.has(name) && absoluteUrl.test(value) && (isLink || !value.startsWith('data:'));
      if (name.startsWith('on') || removedAttributes.has(name) || (tag !== 'base' && external)) {
        element.removeAttributeNode(attribute);
      }
    }
  }

  const policy = doc.createElementNS(head.namespaceURI, 'meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', chapterPolicy);
  head.prepend(policy);

  const css = doc.createElementNS(head.namespaceURI, 'style');
  css.textContent = chapterStyle;
  head.append(css);
}

function limit<T>(operation: Promise<T>, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const abort = () => fail(signal?.reason);
    const timeout = window.setTimeout(() => fail(new Error(message)), 12_000);
    signal?.addEventListener('abort', abort, { once: true });
    void operation.then((value) => {
      cleanup();
      resolve(value);
    }, fail);
    if (signal?.aborted) abort();
  });
}

async function loadBook(bytes: ArrayBuffer, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const book = new Book({
    replacements: 'blobUrl',
    requestMethod: () => Promise.reject(new Error('EPUB resources must be in the local file.')),
  });
  const opening = book.open(bytes, 'binary').then(() => book.opened);
  try {
    await limit(opening, 'This EPUB could not be opened.', signal);
    return book;
  } catch (error) {
    if (signal?.aborted) void opening.finally(() => book.destroy()).catch(() => {});
    else book.destroy();
    throw error;
  }
}

export async function previewEpub(bytes: ArrayBuffer, signal?: AbortSignal): Promise<DocumentPreview> {
  const book = await loadBook(bytes, signal);
  try {
    const metadata = await book.loaded.metadata;
    const cover = await book.loaded.cover;
    const image = cover ? await book.archive.getBlob(cover).catch(() => undefined) : undefined;
    signal?.throwIfAborted();
    return {
      title: metadata.title?.trim() || undefined,
      details: metadata.creator?.trim() || 'EPUB book',
      image: image?.type.startsWith('image/') ? URL.createObjectURL(image) : undefined,
    };
  } finally {
    book.destroy();
  }
}

function normalizeLayout(layout?: Partial<EpubLayout>): EpubLayout {
  return {
    fontSize: bounded(layout?.fontSize, epubDefaults.fontSize, 14, 36),
    lineHeight: bounded(layout?.lineHeight, epubDefaults.lineHeight, 1.2, 2.2),
    width: bounded(layout?.width, epubDefaults.width, 440, 960),
  };
}

export async function openEpub(
  host: HTMLElement,
  bytes: ArrayBuffer,
  initial: EpubPosition | undefined,
  onChange: (state: ReaderState) => void,
  signal?: AbortSignal,
): Promise<Reader> {
  const book = await loadBook(bytes, signal);
  const sections: Section[] = [];
  book.spine.each((section: Section) => sections.push(section));
  let closed = false;
  let layout = normalizeLayout(initial);
  let anchor = typeof initial?.cfi === 'string' && initial.cfi.startsWith('epubcfi(') ? initial.cfi : '';
  let state: ReaderState | undefined;
  let sectionIndex = 0;
  let outline: Promise<ReaderContentsEntry[]> | undefined;
  let search: { query: string; match: GroupMatch } | undefined;
  let matches: ReturnType<typeof groupedMatches> | undefined;
  let indexedChapter: { group: number; text: ReturnType<typeof indexText> } | undefined;
  let searchId = 0;
  let marked: string | undefined;
  let dimensions = { width: 0, height: 0 };
  const page = document.createElement('div');
  page.className = 'epub-book';
  host.replaceChildren(page);
  const initialSize = measure();
  page.style.width = `${initialSize.width}px`;
  dimensions = initialSize;
  book.spine.hooks.content.register(sanitizeChapter);
  const rendition = book.renderTo(page, {
    ...initialSize,
    spread: 'none',
    flow: 'paginated',
    allowScriptedContent: false,
  });
  const observer = new ResizeObserver(resize);

  function measure() {
    return {
      width: Math.max(1, Math.min(host.clientWidth || layout.width, layout.width)),
      height: Math.max(1, host.clientHeight || 600),
    };
  }

  function resize() {
    if (closed || !host.clientWidth || !host.clientHeight) return;
    const next = measure();
    if (next.width === dimensions.width && next.height === dimensions.height) return;
    dimensions = next;
    page.style.width = `${next.width}px`;
    rendition.resize(next.width, next.height);
  }

  function titleFor(location: Location) {
    const item = book.navigation?.get(location.start.href);
    const title = item?.label?.trim();
    if (title) return title;
    return `Section ${location.start.index + 1}`;
  }

  function relocated(location: Location) {
    if (closed || !location?.start?.cfi) return;
    sectionIndex = location.start.index;
    state = {
      position: { kind: 'epub', cfi: anchor || location.start.cfi, ...layout },
      label: titleFor(location),
      canPrevious: !location.atStart,
      canNext: !location.atEnd,
    };
    onChange(state);
  }

  function prepareContent(contents: Contents) {
    const frame = contents.window.frameElement;
    frame?.setAttribute('title', 'EPUB page');
    const body = contents.document.body;
    body.style.setProperty('--study-size', `${layout.fontSize}px`);
    body.style.setProperty('--study-leading', String(layout.lineHeight));
    function readerContext(event: MouseEvent | KeyboardEvent): void {
      event.preventDefault();
      const target = event.target as Element | null;
      const anchorBounds = target?.getBoundingClientRect?.();
      const frameBounds = frame?.getBoundingClientRect();
      host.dispatchEvent(new CustomEvent('openstudy:reader-context', {
        bubbles: true,
        detail: {
          source: contents.document,
          target,
          x: (frameBounds?.left ?? 0) + ('clientX' in event ? event.clientX : anchorBounds?.left ?? 8),
          y: (frameBounds?.top ?? 0) + ('clientY' in event ? event.clientY : anchorBounds?.bottom ?? 8),
        },
      }));
    }
    contents.document.addEventListener('contextmenu', readerContext);
    contents.document.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        readerContext(event);
        return;
      }
      const forwarded = new KeyboardEvent('keydown', {
        key: event.key, code: event.code, repeat: event.repeat, ctrlKey: event.ctrlKey,
        metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, bubbles: true, cancelable: true,
      });
      if (!host.dispatchEvent(forwarded)) event.preventDefault();
    }, true);
    contents.document.addEventListener('click', (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('a[href]')) anchor = '';
    }, true);
  }

  async function display(cfi?: string) {
    let rejectDisplay: (reason: unknown) => void;
    const operation = new Promise<void>((resolve, reject) => {
      rejectDisplay = reject;
      rendition.on('displayError', rejectDisplay);
      rendition.display(cfi).then(resolve, reject);
    });
    try {
      await limit(operation, 'This EPUB section could not be displayed.', signal);
    } finally {
      rendition.off('displayError', rejectDisplay!);
    }
    const current = await rendition.currentLocation() as unknown as Location;
    relocated(current);
  }

  async function setEpubLayout(changes: Partial<EpubLayout>) {
    if (closed) return;
    const next = normalizeLayout({ ...layout, ...changes });
    if (next.width === layout.width && next.fontSize === layout.fontSize && next.lineHeight === layout.lineHeight) return;
    const position = state?.position;
    if (position?.kind === 'epub') anchor = position.cfi;
    layout = next;
    resize();
    rendition.clear();
    await display(anchor || undefined);
  }

  function chapterTarget(value: unknown): string | undefined {
    const href = typeof value === 'string' ? value.trim() : '';
    if (!href || absoluteUrl.test(href) || href.includes('\\')) return undefined;
    const origin = 'https://openstudy.invalid';
    const navPath = book.packaging.navPath || book.packaging.ncxPath || '';
    try {
      const url = new URL(href, new URL(navPath, `${origin}/`));
      if (url.origin !== origin) return undefined;
      const candidates = [url.pathname.replace(/^\//, '') + url.hash, href];
      return candidates.find((target) => target.split('#')[0] && book.spine.get(target));
    } catch {
      return undefined;
    }
  }

  function contents() {
    if (closed) return Promise.resolve([]);
    return outline ??= limit(book.loaded.navigation, 'This EPUB has no readable contents.', signal).then((navigation) =>
      closed ? [] : flattenContents(navigation.toc, (item) => item.subitems, (item, depth) => {
        const label = typeof item.label === 'string' ? item.label.trim() : '';
        const target = chapterTarget(item.href);
        if (!label || !target) return undefined;
        const section = book.spine.get(target);
        const hash = target.indexOf('#');
        let fragment = hash < 0 ? '' : target.slice(hash + 1);
        try { fragment = decodeURIComponent(fragment); } catch { /* Keep a malformed ID literal. */ }
        const fragmentCfi = () => {
          if (!fragment || !section || section.index !== sectionIndex) return undefined;
          const contents = (rendition.getContents() as unknown as Contents[]).find((view) => view.sectionIndex === section.index);
          const marker = contents?.document?.getElementById(fragment);
          try {
            return marker ? section.cfiFromElement(marker) : undefined;
          } catch {
            return undefined;
          }
        };
        return {
          label, depth,
          current: (position) => {
            if (position.kind !== 'epub' || !section || section.index !== sectionIndex) return false;
            if (!fragment) return true;
            const cfi = fragmentCfi();
            try {
              return !!cfi && rendition.epubcfi.compare(cfi, position.cfi) <= 0;
            } catch {
              return false;
            }
          },
          goTo: async () => {
            if (closed) return;
            anchor = '';
            await display(target);
            if (closed || !fragment) return;
            // A page can start before its fragment even after an explicit contents jump.
            const cfi = fragmentCfi();
            if (cfi) {
              anchor = cfi;
              relocated(await rendition.currentLocation() as unknown as Location);
            }
          },
        };
      }));
  }

  function clearMarker() {
    if (marked) rendition.annotations.remove(marked, 'highlight');
    marked = undefined;
  }

  function clearFind() {
    searchId++;
    search = undefined;
    matches = undefined;
    indexedChapter = undefined;
    clearMarker();
  }

  async function chapterText(group: number): Promise<ReturnType<typeof indexText>> {
    if (indexedChapter?.group === group) return indexedChapter.text;
    // Read a separate document so background search never loads or unloads a rendition's section.
    const doc = await limit(book.load(sections[group].url), 'This EPUB section could not be searched.', signal);
    if (closed || !(doc instanceof Document)) throw new Error('This EPUB section could not be searched.');
    sanitizeChapter(doc);
    const body = doc.querySelector('body');
    if (!body) throw new Error('This EPUB section has no readable body.');
    const text = indexText(body);
    indexedChapter = { group, text };
    return text;
  }

  async function find(query: string, direction: FindDirection = 'next', onProgress?: (result: FindResult) => void): Promise<FindResult> {
    const pattern = findPattern(query);
    if (!pattern || closed || !sections.length) return emptyFindResult;
    const currentSearch = ++searchId;
    const active = () => !closed && currentSearch === searchId;
    const index = matches?.query === pattern.source ? matches : groupedMatches(pattern, sections.length, async (group) => (await chapterText(group)).text);
    matches = index;
    const previous = search?.query === pattern.source ? search.match : undefined;
    for (const { group, from } of findGroups(sections.length, sectionIndex, direction, previous)) {
      if (!active()) return emptyFindResult;
      const match = selectMatch(await index.read(group), direction, from);
      if (!match) continue;
      if (!active()) return emptyFindResult;
      const range = matchRange(await chapterText(group), match);
      if (!active()) return emptyFindResult;
      if (!range) throw new Error('This EPUB match could not be displayed.');
      const cfi = sections[group].cfiFromRange(range);
      const selected = { ...match, group };
      clearMarker();
      search = { query: pattern.source, match: selected };
      anchor = cfi;
      await display(cfi);
      if (!active()) return emptyFindResult;
      marked = cfi;
      rendition.annotations.highlight(marked, undefined, undefined, 'openstudy-find-hit', { fill: '#f6c453', 'fill-opacity': '.45' });
      const result = index.result(selected);
      if (result.counting && onProgress) void index.countRest(active, () => onProgress(index.result(selected)));
      return result;
    }
    if (!active()) return emptyFindResult;
    const result = index.result();
    clearFind();
    return result;
  }

  function destroy() {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', destroy);
    observer.disconnect();
    rendition.off('relocated', relocated);
    clearFind();
    book.destroy();
    page.remove();
  }

  try {
    signal?.throwIfAborted();
    signal?.addEventListener('abort', destroy, { once: true });
    rendition.hooks.content.register(prepareContent);
    rendition.on('relocated', relocated);
    await display(anchor || undefined).catch(async (error: unknown) => {
      if (!anchor || signal?.aborted) throw error;
      anchor = '';
      await display();
    });
    signal?.throwIfAborted();
    observer.observe(host);
    return {
      previous: async () => { anchor = ''; await rendition.prev(); },
      next: async () => { anchor = ''; await rendition.next(); },
      goTo: async (target) => { if (target.kind === 'epub') { anchor = target.cfi; await display(target.cfi); } },
      zoom: (delta) => setEpubLayout({ fontSize: layout.fontSize + delta * 2 }),
      fit: () => setEpubLayout(epubDefaults),
      setEpubLayout,
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
