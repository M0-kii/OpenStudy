import {
  createIcons, ChevronLeft, ChevronRight, Copy, Ellipsis, FileText, FolderOpen, LogOut, Minus,
  NotebookPen, PanelLeft, Pause, Pencil, Plus, Settings2, SlidersHorizontal, Square, X,
} from 'lucide';

export function drawIcons(): void {
  createIcons({
    icons: {
      ChevronLeft, ChevronRight, Copy, Ellipsis, FileText, FolderOpen, LogOut, Minus,
      NotebookPen, PanelLeft, Pause, Pencil, Plus, Settings2, SlidersHorizontal, Square, X,
    },
  });
}

export function disclosure(button: HTMLButtonElement, panel: HTMLElement, hoverRegion?: HTMLElement) {
  let pinned = false;
  let hovered = false;

  function open(value: boolean): void {
    if (panel.inert === !value) return;
    panel.inert = !value;
    panel.toggleAttribute('data-open', value);
    button.setAttribute('aria-expanded', String(value));
  }

  function close(): void {
    pinned = false;
    hovered = false;
    open(false);
  }

  button.addEventListener('click', () => {
    if (pinned) close();
    else {
      pinned = true;
      open(true);
    }
  });

  hoverRegion?.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch' || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    hovered = true;
    open(true);
  });
  hoverRegion?.addEventListener('pointerleave', () => {
    hovered = false;
    if (!pinned && !panel.contains(document.activeElement)) open(false);
  });
  panel.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && panel.contains(event.relatedTarget)) return;
    if (!pinned && !hovered) open(false);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node) || button.contains(event.target) || panel.contains(event.target)) return;
    close();
  });
  window.addEventListener('blur', close);

  return { close, isPinned: () => pinned };
}

export interface ContextTarget {
  source: Document;
  target: Element | null;
}

export interface ContextPoint extends ContextTarget {
  x: number;
  y: number;
}

export interface ContextCommand {
  label: string;
  run: () => void;
}

export function bindContextMenu(menu: HTMLElement, commandsFor: (context: ContextTarget) => ContextCommand[]): void {
  let returnFocus: HTMLElement | null = null;

  function close(restoreFocus = false): void {
    if (menu.inert) return;
    menu.inert = true;
    menu.removeAttribute('data-open');
    if (restoreFocus) returnFocus?.focus({ preventScroll: true });
    returnFocus = null;
  }

  function show(point: ContextPoint): void {
    close();
    const commands = commandsFor(point);
    if (!commands.length) return;
    returnFocus = document.activeElement as HTMLElement | null;
    const dialog = point.target?.closest('dialog[open]');
    (dialog ?? document.body).append(menu);
    menu.replaceChildren();
    for (const command of commands) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'quiet-button';
      item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
      item.textContent = command.label;
      item.addEventListener('click', () => {
        close(true);
        command.run();
      });
      menu.append(item);
    }
    menu.style.left = `${Math.max(6, Math.min(point.x, innerWidth - menu.offsetWidth - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(point.y, innerHeight - menu.offsetHeight - 6))}px`;
    menu.inert = false;
    menu.setAttribute('data-open', '');
    menu.querySelector('button')?.focus({ preventScroll: true });
  }

  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    show({ source: document, target: event.target instanceof Element ? event.target : null, x: event.clientX, y: event.clientY });
  }, true);
  document.addEventListener('openstudy:reader-context', (event) => show((event as CustomEvent<ContextPoint>).detail));
  document.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Node && !menu.contains(event.target)) close();
  }, true);
  window.addEventListener('blur', () => close());
  window.addEventListener('resize', () => close());

  document.addEventListener('keydown', (event) => {
    if (blockedShortcut(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const target = event.target instanceof Element ? event.target : document.activeElement;
      const bounds = target?.getBoundingClientRect();
      show({ source: document, target, x: bounds?.left ?? 8, y: bounds?.bottom ?? 8 });
      return;
    }
    if (menu.inert) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menu.querySelectorAll('button'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  }, true);
}

function blockedShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  return key === 'f12' || key === 'f5'
    || ((event.ctrlKey || event.metaKey) && ['r', 'u'].includes(key))
    || ((event.ctrlKey && event.shiftKey || event.metaKey && event.altKey) && ['c', 'i', 'j', 'k', 'u'].includes(key))
    || (event.altKey && (key === 'arrowleft' || key === 'arrowright'));
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // The WebView can decline the asynchronous clipboard API.
    }
  }
  const field = document.createElement('textarea');
  field.className = 'visually-hidden';
  field.value = text;
  const previous = document.activeElement as HTMLElement | null;
  (document.querySelector('dialog[open]') ?? document.body).append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard access is unavailable.');
  } finally {
    field.remove();
    previous?.focus({ preventScroll: true });
  }
}
