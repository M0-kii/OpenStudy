import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

type Selection = { name: string; path: string };
type DocumentSelection = Selection & { bytes: ArrayBuffer };

export function platform(): 'windows' | 'macos' | 'linux' | 'browser' {
  if (!isTauri()) return 'browser';
  if (/Windows/i.test(navigator.userAgent)) return 'windows';
  if (/Macintosh|Mac OS/i.test(navigator.userAgent)) return 'macos';
  return 'linux';
}

export async function pickDocument(): Promise<DocumentSelection | null> {
  if (isTauri()) {
    const selected = await invoke<Selection | null>('pick_document');
    return selected && { ...selected, bytes: await readDocument(selected.path) };
  }

  const file = await chooseBrowserFile();
  if (!file) return null;
  if (!/\.(pdf|epub|md|markdown)$/i.test(file.name)) throw new Error('Choose a PDF, EPUB, or Markdown file.');
  if (file.size > 256 * 1024 * 1024) throw new Error('Choose a document smaller than 256 MB.');
  const path = `preview:${file.name}:${file.lastModified}:${file.size}`;
  await browserFile(path, file);
  return { name: file.name, path, bytes: await file.arrayBuffer() };
}

export async function readDocument(path: string): Promise<ArrayBuffer> {
  if (isTauri()) {
    const bytes = await invoke<ArrayBuffer | number[]>('read_document', { path });
    return Array.isArray(bytes) ? Uint8Array.from(bytes).buffer : bytes;
  }
  const file = await browserFile(path);
  if (!file) throw new Error('This file is unavailable. Choose it again to reconnect it.');
  return file.arrayBuffer();
}

export async function setFullscreen(value: boolean): Promise<void> {
  if (isTauri()) {
    await invoke('set_study_fullscreen', { fullscreen: value });
  } else if (value && !document.fullscreenElement && document.fullscreenEnabled) {
    await document.documentElement.requestFullscreen();
  } else if (!value && document.fullscreenElement) {
    await document.exitFullscreen();
  }
}

export async function startDragging(): Promise<void> {
  if (isTauri()) await getCurrentWindow().startDragging();
}

export async function minimizeWindow(): Promise<void> {
  if (isTauri()) await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (isTauri()) await getCurrentWindow().toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  if (isTauri()) await getCurrentWindow().close();
}

export async function isWindowMaximized(): Promise<boolean> {
  return isTauri() && getCurrentWindow().isMaximized();
}

export async function setWindowTheme(theme: 'light'|'dark'): Promise<void> {
  if (isTauri()) await getCurrentWindow().setTheme(theme);
}

export function openNotificationSettings(): Promise<void> {
  return invoke('open_notification_settings');
}

function chooseBrowserFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.epub,.md,.markdown,application/pdf,application/epub+zip,text/markdown';
    input.hidden = true;
    const finish = () => {
      const file = input.files?.item(0) ?? null;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', finish, { once: true });
    input.addEventListener('cancel', finish, { once: true });
    document.body.append(input);
    input.click();
  });
}

async function browserFile(path: string, file?: File): Promise<File | undefined> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('openstudy-preview', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<File | undefined>((resolve, reject) => {
      const transaction = database.transaction('documents', file ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('documents');
      const request = file ? store.put(file, path) : store.get(path);
      transaction.oncomplete = () => resolve(file ?? request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
