import { Book } from 'epubjs';
import type Contents from 'epubjs/types/contents';
import type { Location } from 'epubjs/types/rendition';
import './readers.css';
import { bounded, epubDefaults, type DocumentPreview, type EpubLayout, type EpubPosition, type Reader, type ReaderState } from './index';

const chapterPolicy = "default-src 'none'; style-src 'unsafe-inline' blob: data:; img-src blob: data:; font-src blob: data:; media-src blob: data:; base-uri 'self'; form-action 'none'";
const activeElements = new Set(['applet', 'embed', 'fencedframe', 'foreignobject', 'frame', 'frameset', 'iframe', 'object', 'portal', 'script', 'template', 'animate', 'animatemotion', 'animatetransform', 'set']);
const removedAttributes = new Set(['target', 'download', 'ping', 'xml:base', 'srcdoc', 'srcset']);
const urlAttributes = new Set(['src', 'href', 'xlink:href', 'poster', 'background']);
const absoluteUrl = /^(?:[\w+.-]+:|[\\/]{2})/;
const chapterStyle = `
  html, body { background: #f4f2eb !important; color: #26333e !important; }
  body { font-size: var(--study-size) !important; line-height: var(--study-leading) !important; }
  :where(p, li, dt, dd, blockquote) { font-size: inherit !important; line-height: var(--study-leading) !important; }
  a[href] { color: #284867; text-decoration: underline; }
  :focus-visible { outline: 2px solid #284867; outline-offset: 2px; }
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
  let closed = false;
  let layout = normalizeLayout(initial);
  let anchor = typeof initial?.cfi === 'string' && initial.cfi.startsWith('epubcfi(') ? initial.cfi : '';
  let state: ReaderState | undefined;
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
    contents.document.addEventListener('keydown', (event) => {
      const forwarded = new KeyboardEvent('keydown', {
        key: event.key, code: event.code, repeat: event.repeat, ctrlKey: event.ctrlKey,
        metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, bubbles: true, cancelable: true,
      });
      if (!host.dispatchEvent(forwarded)) event.preventDefault();
    });
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

  function destroy() {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', destroy);
    observer.disconnect();
    rendition.off('relocated', relocated);
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
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
