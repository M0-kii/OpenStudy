import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { BatteryStatus } from './battery';

type Selection = { name: string; path: string };
type DocumentSelection = Selection & { bytes: ArrayBuffer };
const maxDocumentBytes = 256 * 1024 * 1024;

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
  if (file.size > maxDocumentBytes) throw new Error('Choose a document smaller than 256 MB.');
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

export async function readOnlinePdf(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  signal?.throwIfAborted();
  if (isTauri()) {
    const request = await invoke<number>('prepare_online_pdf');
    const cancel = () => void invoke('cancel_online_pdf', { request }).catch(() => {});
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (signal?.aborted) cancel();
      signal?.throwIfAborted();
      const bytes = await invoke<ArrayBuffer | number[]>('read_online_pdf', { request, url });
      signal?.throwIfAborted();
      return Array.isArray(bytes) ? Uint8Array.from(bytes).buffer : bytes;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  let address: URL;
  try {
    address = new URL(url.trim());
  } catch {
    throw new Error('Enter a valid HTTP or HTTPS PDF link.');
  }
  if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) {
    throw new Error('Use an HTTP or HTTPS link without a username or password.');
  }

  const abort = new AbortController();
  const cancel = () => abort.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => abort.abort(), 45_000);
  try {
    const response = await fetch(address, {
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: abort.signal,
    });
    if (!response.ok) throw new Error(`The PDF server returned HTTP ${response.status}.`);
    if (Number(response.headers.get('content-length')) > maxDocumentBytes) {
      throw new Error('Choose a PDF smaller than 256 MB.');
    }

    const stream = response.body?.getReader();
    if (!stream) throw new Error('This URL did not return a PDF.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await stream.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxDocumentBytes) throw new Error('Choose a PDF smaller than 256 MB.');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) {
      throw new Error('This URL did not return a PDF.');
    }
    return bytes.buffer;
  } catch (error) {
    signal?.throwIfAborted();
    if (abort.signal.aborted) throw new Error('The PDF download timed out. Try again.');
    if (error instanceof TypeError) throw new Error('Could not download the PDF. The browser requires a direct link that permits cross-origin requests.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    abort.abort();
  }
}

export async function setFullscreen(value: boolean, blockAppSwitching = false): Promise<void> {
  if (isTauri()) {
    await invoke('set_study_fullscreen', { fullscreen: value, blockAppSwitching });
  } else if (value && !document.fullscreenElement && document.fullscreenEnabled && navigator.userActivation.isActive) {
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

export async function getBatteryStatus(): Promise<BatteryStatus | null> {
  return isTauri() ? invoke('get_battery_status') : null;
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
