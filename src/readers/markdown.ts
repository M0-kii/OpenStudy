import MarkdownIt from 'markdown-it';
import './markdown.css';
import './readers.css';
import { findPattern, findText, highlightMatch, indexText, matchRange, type TextMatch } from './find';
import { bounded, type DocumentPreview, type FindDirection, type MarkdownPosition, type Reader, type ReaderState } from './index';

const markdown = new MarkdownIt({ html: false, linkify: false });
type Token = ReturnType<typeof markdown.parse>[number];

function inlineText(token: Token): string {
  return token.children?.map(inlineText).join('') ?? token.content;
}

markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(inlineText(tokens[index]));

function slug(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '');
}

function fragmentSlug(href: string | null): string | undefined {
  if (!href?.startsWith('#')) return undefined;
  try {
    return slug(decodeURIComponent(href.slice(1))) || undefined;
  } catch {
    return undefined;
  }
}

function parseDocument(bytes: ArrayBuffer) {
  if (bytes.byteLength > 1024 * 1024) throw new Error('Choose a Markdown file no larger than 1 MB.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Save the Markdown file with UTF-8 encoding and try again.');
  }
  if (!text.trim() || text.includes('\0')) throw new Error('Choose a Markdown file containing text.');

  const tokens = markdown.parse(text, {});
  const tokenCount = tokens.reduce((count, token) => count + 1 + (token.children?.length ?? 0), 0);
  if (tokenCount > 24_000) throw new Error('This Markdown file has too many elements. Try opening a smaller section.');

  const sections = new Map<string, string>();
  const suffixes = new Map<string, number>();
  let title: string | undefined;
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'heading_open') continue;
    const label = inlineText(tokens[index + 1]).trim();
    if (!title && label) title = label.slice(0, 160);
    const base = slug(label) || 'section';
    let key = base;
    while (sections.has(key)) {
      const suffix = (suffixes.get(base) ?? 0) + 1;
      suffixes.set(base, suffix);
      key = `${base}-${suffix}`;
    }
    const id = `markdown-section-${sections.size}`;
    sections.set(key, id);
    token.attrSet('id', id);
    token.attrSet('tabindex', '-1');
  }

  // Only generated section IDs can become active links.
  for (const token of tokens) {
    for (const child of token.children ?? []) {
      if (child.type !== 'link_open') continue;
      const fragment = fragmentSlug(child.attrGet('href'));
      const target = fragment && sections.get(fragment);
      child.attrs = target ? [['href', `#${target}`]] : null;
    }
  }
  return { tokens, title, sectionCount: sections.size };
}

export function previewMarkdown(bytes: ArrayBuffer, signal?: AbortSignal): DocumentPreview {
  signal?.throwIfAborted();
  const { title, sectionCount } = parseDocument(bytes);
  const details = sectionCount ? `${sectionCount} ${sectionCount === 1 ? 'section' : 'sections'}` : 'Markdown document';
  return { title, details };
}

export function openMarkdown(
  host: HTMLElement,
  bytes: ArrayBuffer,
  initial: MarkdownPosition | undefined,
  onChange: (state: ReaderState) => void,
  signal?: AbortSignal,
): Reader {
  signal?.throwIfAborted();
  const { tokens, title } = parseDocument(bytes);
  const article = document.createElement('article');
  article.className = 'markdown-page';
  article.setAttribute('aria-label', title ?? 'Markdown document');
  article.innerHTML = markdown.renderer.render(tokens, markdown.options, {});
  const headings = Array.from(article.querySelectorAll<HTMLElement>('[id^="markdown-section-"]'));
  const firstLevel = Math.min(...headings.map((heading) => Number(heading.tagName[1])));
  let zoom = 1;
  let closed = false;
  let search: { query: string; match: TextMatch } | undefined;
  let unhighlight: (() => void) | undefined;
  let indexed: ReturnType<typeof indexText> | undefined;
  host.replaceChildren(article);

  function scrollRange(): number {
    return Math.max(0, host.scrollHeight - host.clientHeight);
  }

  function scrollFraction(range = scrollRange()): number {
    return range ? bounded(host.scrollTop / range, 0, 0, 1) : 0;
  }

  function labelAtScroll(scroll: number): string {
    const top = host.scrollTop - article.offsetTop + 32;
    let start = 0;
    let end = headings.length;
    while (start < end) {
      const middle = (start + end) >>> 1;
      if (headings[middle].offsetTop <= top) start = middle + 1;
      else end = middle;
    }
    return headings[start - 1]?.textContent?.trim().slice(0, 160) || `Document, ${Math.round(scroll * 100)}%`;
  }

  function notify() {
    if (closed || !host.clientHeight) return;
    const range = scrollRange();
    const scroll = scrollFraction(range);
    onChange({
      position: { kind: 'markdown', scroll, zoom },
      label: labelAtScroll(scroll),
      canPrevious: host.scrollTop > 1,
      canNext: host.scrollTop < range - 1,
    });
  }

  function place(scroll: number | undefined, scale: number | undefined) {
    if (closed) return;
    zoom = bounded(scale, 1, 0.65, 2.5);
    article.style.setProperty('--markdown-zoom', String(zoom));
    host.scrollTop = bounded(scroll, 0, 0, 1) * scrollRange();
    notify();
  }

  function turn(direction: number) {
    if (closed) return;
    host.scrollTop += Math.round(host.clientHeight * 0.86 * direction);
    notify();
  }

  function goToHeading(heading: HTMLElement) {
    if (closed) return;
    host.scrollTop = article.offsetTop + heading.offsetTop - 18;
    heading.focus({ preventScroll: true });
    notify();
  }

  function jump(event: MouseEvent) {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor) return;
    event.preventDefault();
    const heading = article.querySelector<HTMLElement>(anchor.hash);
    if (heading) goToHeading(heading);
  }

  function clearFind() {
    search = undefined;
    unhighlight?.();
    unhighlight = undefined;
  }

  async function find(query: string, direction: FindDirection = 'next') {
    const pattern = findPattern(query);
    if (!pattern || closed) return false;
    indexed ??= indexText(article);
    const previous = search?.query === pattern.source ? search.match : undefined;
    const from = previous && previous.index + (direction === 'next' ? previous.length : 0);
    const match = findText(indexed.text, pattern, direction, from) ?? findText(indexed.text, pattern, direction);
    const range = match && matchRange(indexed, match);
    clearFind();
    if (!match || !range) return false;
    search = { query: pattern.source, match };
    const top = range.getBoundingClientRect().top - host.getBoundingClientRect().top - host.clientHeight / 4;
    host.scrollTop += top;
    unhighlight = highlightMatch(range, article);
    notify();
    return true;
  }

  function destroy() {
    if (closed) return;
    closed = true;
    article.removeEventListener('click', jump);
    host.removeEventListener('scroll', notify);
    signal?.removeEventListener('abort', destroy);
    clearFind();
    article.remove();
  }

  article.addEventListener('click', jump);
  host.addEventListener('scroll', notify, { passive: true });
  signal?.addEventListener('abort', destroy, { once: true });
  place(initial?.scroll, initial?.zoom);

  return {
    previous: async () => turn(-1),
    next: async () => turn(1),
    goTo: async (position) => {
      if (position.kind === 'markdown') place(position.scroll, position.zoom);
    },
    zoom: async (delta) => place(scrollFraction(), Math.round((zoom + delta * 0.1) * 100) / 100),
    fit: async () => place(scrollFraction(), 1),
    setEpubLayout: async () => {},
    contents: async () => closed ? [] : headings.flatMap((heading) => {
      const label = heading.textContent?.trim();
      return label ? [{ label, depth: Number(heading.tagName[1]) - firstLevel, goTo: async () => goToHeading(heading) }] : [];
    }),
    find,
    clearFind,
    destroy,
  };
}
