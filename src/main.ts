import './design-system.css';
import './style.css';
import './bars.css';
import { playChime, primeAlarm } from './alarm';
import { batteryAlertLevel } from './battery';
import { desktop, platform, type DocumentSelection } from './desktop';
import { setHighlights, highlightColors, type SavedHighlight } from './highlights.ts';
import { addReading, lastDays, loadHistory, normalizeHistory, saveHistory } from './history.ts';
import { loadLibrary, normalizeLibrary, recoverLibrary, reconnectDocument, saveLibrary, takeLibraryWarning, type SavedDocument } from './library';
import { openReader, previewDocument, type DocumentKind, type FindDirection, type FindResult, type PdfFit, type Reader, type ReaderContentsEntry, type ReaderState, type ReadingPosition } from './readers';
import { FindLifecycle } from './readers/find-lifecycle.ts';
import { setPaper } from './paper.ts';
import { loadSettings, normalizeSettings, saveSettings, type StudySettings } from './settings';
import { pdfFitMode, readingView } from './session.ts';
import { applySettings, type SettingsControls } from './settings-view.ts';
import { clockLabel, StudyTimer } from './timer';
import { bindContextMenu, copyText, disclosure, drawIcons, type ContextCommand, type ContextTarget } from './window-ui';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

function button(id: string): HTMLButtonElement {
  return element<HTMLButtonElement>(id);
}

type Screen = 'launcher' | 'reader' | 'break' | 'settings' | 'progress';
const screens: Record<Screen, HTMLElement> = {
  launcher: element('launcher-screen'),
  reader: element('reader-screen'),
  break: element('break-screen'),
  settings: element('settings-screen'),
  progress: element('progress-screen'),
};
const workspace = document.querySelector<HTMLElement>('.workspace-shell');
const viewport = element('reader-viewport');
const launcherError = element('launcher-error');
const launcherLoading = element('launcher-loading');
const launcherLoadingText = element('launcher-loading-text');
const cancelOnline = button('cancel-online');
const retryOnlineButton = button('retry-online');
const readerError = element('reader-error');
const breakError = element('break-error');
const settingsError = element('settings-error');
const settingsCategories = element('settings-categories');
const settingsTabs = Array.from(settingsCategories.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const themeSelect = element<HTMLSelectElement>('appearance-theme');
const accentSelect = element<HTMLSelectElement>('appearance-accent');
const paperSelect = element<HTMLSelectElement>('appearance-paper');
const motionSelect = element<HTMLSelectElement>('appearance-motion');
const timerSelect = element<HTMLSelectElement>('session-minutes');
const defaultMinutes = element<HTMLSelectElement>('default-minutes');
const showCountdown = element<HTMLInputElement>('show-countdown');
const continuousPdf = element<HTMLInputElement>('continuous-pdf');
const breakMinutes = element<HTMLSelectElement>('break-minutes');
const longBreakEvery = element<HTMLSelectElement>('long-break-every');
const blockAppSwitching = element<HTMLInputElement>('block-app-switching');
const batteryAlerts = element<HTMLInputElement>('battery-alerts');
const batteryAlarm = element<HTMLInputElement>('battery-alarm');
const readerContinuousPdf = element<HTMLInputElement>('reader-continuous-pdf');
const pdfPageJump = element<HTMLFormElement>('pdf-page-jump');
const readerPage = element<HTMLInputElement>('reader-page');
const readerProgress = element<HTMLInputElement>('reader-progress');
const recentList = element('recent-list');
const pickerButtons = ['choose-file', 'choose-file-inline'].map(button);
const openSourceToggle = button('open-source');
const openSourceMenu = disclosure(openSourceToggle, element('open-source-menu'));
const continueButton = button('continue-reading');
const reconnectButton = button('reconnect-document');
const selectedDocument = element('selected-document');
const preview = element('document-preview');
const noteDialog = element<HTMLDialogElement>('note-dialog');
const notesDialog = element<HTMLDialogElement>('notes-dialog');
const optionsDialog = element<HTMLDialogElement>('options-dialog');
const shortcutsDialog = element<HTMLDialogElement>('shortcuts-dialog');
const commandPalette = element<HTMLDialogElement>('command-palette');
const commandQuery = element<HTMLInputElement>('command-query');
const commandResults = element('command-results');
const linkDialog = element<HTMLDialogElement>('link-dialog');
const linkInput = element<HTMLInputElement>('pdf-link');
const linkError = element('link-error');
const contentsPanel = element('reader-contents');
const pinContents = button('pin-contents');
const findPanel = element('reader-find');
const findInput = element<HTMLInputElement>('find-query');
const searchResult = element('search-result');
const batteryAlert = element('battery-alert');
const os = platform();
const windowMenuToggle = button('window-menu-toggle');
const sidebarToggle = button('sidebar-toggle');
const toolbarToggle = button('reader-toolbar-toggle');
const sessionToggle = button('reader-session-toggle');
const windowMenu = element('window-menu');
const windowCommands = Array.from(windowMenu.querySelectorAll<HTMLButtonElement>('[data-command]'));
const appMenu = disclosure(windowMenuToggle, windowMenu);
const readerToolbar = disclosure(toolbarToggle, element('reader-toolbar'), element('reader-chrome'));
const sessionMenu = disclosure(sessionToggle, element('reader-session-card'), element('reader-session-dock'));
if (os === 'macos') {
  element('open-file-shortcut').textContent = '⌘O';
  element('shortcut-open').textContent = '⌘O';
  element('shortcut-find').textContent = '⌘F';
  element('shortcut-palette').textContent = '⌘K';
}
drawIcons();

const controls: SettingsControls = {
  defaultMinutes, timerSelect, showCountdown, themeSelect, accentSelect, paperSelect, motionSelect,
  continuousPdf, readerContinuousPdf, breakMinutes, longBreakEvery, blockAppSwitching, batteryAlerts, batteryAlarm, sidebarToggle, workspace,
  sidebarCollapseIcon: element('sidebar-collapse-icon'),
  sidebarExpandIcon: element('sidebar-expand-icon'),
  setTheme: (theme) => applyAppearance(theme),
  setPreferences: (next) => {
    document.documentElement.dataset.accent = next.accent;
    document.documentElement.dataset.paper = next.paper;
    document.documentElement.dataset.motion = next.motion;
    setPaper(next.paper);
  },
};

let library: SavedDocument[] = [];
let selection: { document: SavedDocument; bytes?: ArrayBuffer } | undefined;
let imageUrl: string | undefined;
let reader: Reader | undefined;
let reading: ReaderState | undefined;
let timer: StudyTimer | undefined;
let screen: Screen = 'launcher';
let settingsReturn: 'launcher' | 'break' = 'launcher';
let settings = loadSettings();
let busy = false;
let readerBusy = false;
let queuedPdfPage: number | undefined;
let saveDelay: ReturnType<typeof setTimeout> | undefined;
let announced = false;
let completedBreaks = 0;
let breakDeadline: number | null = null;
let canSave = true;
let lastDocument: SavedDocument | undefined;
let missingDocument: SavedDocument | undefined;
let replacementLink: SavedDocument | undefined;
let onlineRequest: AbortController | undefined;
let retryOnline: (() => void) | undefined;
let history = loadHistory();
let readingMark: number | undefined;
let readingRemainder = 0;
let batteryCheckPending = false;
let batteryLevel = 0;
let dismissedBatteryLevel = 0;
let alarmedBatteryLevel = 0;
let readerEntryHintShown = false;
let readerEntryHintTimer: ReturnType<typeof setTimeout> | undefined;
let contentsLinks: { entry: ReaderContentsEntry; button: HTMLButtonElement }[] = [];
let contentsPinned = false;
let reopenContents = false;

function showError(node: HTMLElement, message = ''): void {
  if (node.textContent !== message) node.textContent = message;
  node.hidden = !message;
}

function accrueReading(now = performance.now()): void {
  if (readingMark === undefined) return;
  const elapsed = Math.min(60_000, Math.max(0, now - readingMark));
  readingMark = now;
  readingRemainder += elapsed / 1000;
  const seconds = Math.floor(readingRemainder);
  if (!seconds) return;
  readingRemainder -= seconds;
  history = addReading(history, seconds, selection?.document.title ?? 'Unknown');
  try {
    saveHistory(history);
  } catch (error) {
    console.error(error);
  }
}

function startReadingClock(): void {
  readingMark = performance.now();
  readingRemainder = 0;
}

function stopReadingClock(): void {
  accrueReading();
  readingMark = undefined;
}

function setScreen(next: Screen): void {
  if (next !== screen) {
    queuedPdfPage = undefined;
    for (const error of [launcherError, readerError, breakError, settingsError]) showError(error);
    appMenu.close();
    openSourceMenu.close();
    clearTimeout(readerEntryHintTimer);
    delete screens.reader.dataset.entryHint;
    readerToolbar.close();
    sessionMenu.close();
    closeReaderPanel(contentsPanel);
    closeReaderPanel(findPanel);
  }
  screen = next;
  batteryAlert.hidden = (next !== 'reader' && next !== 'break') || batteryLevel <= dismissedBatteryLevel;
  for (const [name, node] of Object.entries(screens)) {
    node.hidden = name !== next;
    if (name === next && busy) node.setAttribute('aria-busy', 'true');
    else node.removeAttribute('aria-busy');
  }
  if (workspace) workspace.dataset.session = activeSession() ? 'active' : 'idle';
  const libraryNav = button('nav-library');
  const settingsNav = button('open-settings');
  libraryNav.setAttribute('aria-controls', activeSession() ? 'break-screen' : 'launcher-screen');
  if (next === 'launcher' || next === 'break') libraryNav.setAttribute('aria-current', 'page');
  else libraryNav.removeAttribute('aria-current');
  if (next === 'settings') settingsNav.setAttribute('aria-current', 'page');
  else settingsNav.removeAttribute('aria-current');
  const progressNav = button('nav-progress');
  if (next === 'progress') progressNav.setAttribute('aria-current', 'page');
  else progressNav.removeAttribute('aria-current');
  if (next === 'progress') renderProgress();
  syncControls();
}

function activeSession(): boolean {
  return screen === 'reader' || screen === 'break' || (screen === 'settings' && settingsReturn === 'break');
}

function syncControls(): void {
  const canChoose = !busy && !activeSession();
  for (const picker of [...pickerButtons, openSourceToggle, button('open-link')]) picker.disabled = !canChoose;
  continueButton.disabled = !canChoose;
  reconnectButton.disabled = !canChoose;
  retryOnlineButton.disabled = !canChoose;
  for (const row of recentList.querySelectorAll<HTMLButtonElement>('button')) row.disabled = !canChoose;
  button('nav-library').disabled = busy;
  button('nav-progress').disabled = busy;
  button('open-settings').disabled = busy;
  button('close-settings').disabled = busy;
  button('start-session').disabled = busy || !selection;
  button('resume-session').disabled = busy;
  button('end-from-break').disabled = busy;
  button('take-break').disabled = busy;
  button('end-session').disabled = busy;
  for (const command of windowCommands) {
    const source = button(command.dataset.command!);
    command.disabled = source.disabled;
    const current = source.getAttribute('aria-current');
    if (current) command.setAttribute('aria-current', current);
    else command.removeAttribute('aria-current');
  }
}

function setBusy(value: boolean): void {
  busy = value;
  if (value) screens[screen].setAttribute('aria-busy', 'true');
  else screens[screen].removeAttribute('aria-busy');
  syncControls();
}

function renderLibrary(): void {
  recentList.replaceChildren();
  element('recent-empty').hidden = library.length > 0;

  const recent = [...library].sort((a, b) => b.updatedAt - a.updatedAt);
  lastDocument = recent.find((entry) => entry.position);
  element('continue-document').hidden = !lastDocument || !selectedDocument.hidden;
  if (lastDocument) {
    element('continue-title').textContent = lastDocument.title;
    element('continue-kind').textContent = kindLabel(lastDocument.kind);
    element('continue-location').textContent = lastDocument.label ?? kindLabel(lastDocument.kind);
    button('continue-review-notes').hidden = lastDocument.notes.length === 0;
  }

  for (const entry of recent.slice(0, 5)) {
    const item = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'recent-item';
    row.disabled = busy || activeSession();
    if (entry.path === selection?.document.path) row.setAttribute('aria-current', 'true');
    const title = document.createElement('bdi');
    title.className = 'recent-title';
    title.textContent = entry.title;
    row.title = entry.title;
    const detail = document.createElement('bdi');
    detail.className = 'recent-meta';
    detail.textContent = entry.label ?? kindLabel(entry.kind);
    row.append(title, detail);
    row.addEventListener('click', () => void openRecent(entry));
    item.append(row);
    recentList.append(item);
  }
}

function kindLabel(kind: DocumentKind): string {
  return kind === 'markdown' ? 'Markdown' : kind.toUpperCase();
}

function clearPreview(): void {
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = undefined;
  preview.replaceChildren();
  preview.classList.remove('has-preview');
}

function showSelection(entry: SavedDocument, bytes?: ArrayBuffer, cover?: Awaited<ReturnType<typeof previewDocument>>): void {
  selection = { document: entry, bytes };
  clearPreview();
  imageUrl = cover?.image;
  if (imageUrl) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = imageUrl;
    preview.classList.add('has-preview');
    preview.append(image);
  }
  element('selected-name').textContent = entry.title;
  element('selected-meta').textContent = entry.label ?? cover?.details ?? kindLabel(entry.kind);
  selectedDocument.hidden = false;
  button('launcher-review-notes').hidden = entry.notes.length === 0;
}

function openRecent(entry: SavedDocument): Promise<boolean> {
  return selectDocument(async (signal) => ({
    ...entry, bytes: await readSavedDocument(entry, signal),
  }), (error) => showReopenError(entry, error, () => void openRecent(entry)), undefined, entry.online ? entry.path : undefined);
}

function beginOnlineRequest(url: string, status: HTMLElement): AbortController {
  const host = new URL(url).host;
  const request = new AbortController();
  onlineRequest = request;
  showError(status, `Opening PDF from ${host}…`);
  if (status === launcherLoadingText) {
    launcherLoading.hidden = false;
    cancelOnline.hidden = false;
    cancelOnline.focus();
  }
  return request;
}

function finishOnlineRequest(request: AbortController | undefined): void {
  if (!request || onlineRequest !== request) return;
  onlineRequest = undefined;
  cancelOnline.hidden = true;
}

function readSavedDocument(entry: SavedDocument, signal?: AbortSignal): Promise<ArrayBuffer> {
  return entry.online ? desktop.readOnlinePdf(entry.path, signal) : desktop.readDocument(entry.path);
}

function documentError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : error;
  if (error instanceof Error && error.name === 'PasswordException') return 'This PDF is password-protected. Choose an unlocked copy.';
  if (typeof message === 'string' && message.includes('reset after damaged data')) return message;
  if (typeof message === 'string' && message.includes('smaller than 256 MB')) return 'Choose a document smaller than 256 MB.';
  return fallback;
}

function showReopenError(entry: SavedDocument, error: unknown, retry?: () => void): void {
  missingDocument = entry;
  retryOnline = entry.online ? retry : undefined;
  retryOnlineButton.hidden = !retryOnline;
  reconnectButton.textContent = entry.online ? 'Update PDF link' : 'Locate file';
  reconnectButton.hidden = false;
  showError(launcherError, documentError(error, entry.online
    ? 'This PDF link could not be opened. If the link has changed, update it here.'
    : 'This file could not be reopened. If it moved, locate it to keep your place and notes.'));
}

type ChosenDocument = DocumentSelection & { online?: true };

async function selectDocument(
  pick: (signal?: AbortSignal) => Promise<ChosenDocument | null>,
  onError: (error: unknown) => void,
  replacement?: SavedDocument,
  onlineUrl?: string,
  startPage?: number,
): Promise<boolean> {
  if (busy || activeSession()) return false;
  if (screen === 'settings') setScreen('launcher');
  const initiator = document.activeElement;
  setBusy(true);
  if (!replacement) {
    missingDocument = undefined;
    reconnectButton.hidden = true;
    retryOnlineButton.hidden = true;
    showError(launcherError);
  }
  let opened = false;
  let kind: DocumentKind | undefined;
  let request: AbortController | undefined;
  try {
    if (onlineUrl) request = beginOnlineRequest(onlineUrl, linkDialog.open ? element('link-status') : launcherLoadingText);
    const file = await pick(request?.signal);
    request?.signal.throwIfAborted();
    if (!file) return false;
    if (!request) {
      launcherLoadingText.textContent = 'Opening document…';
      launcherLoading.hidden = false;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    kind = file.online ? 'pdf' : extension === 'md' || extension === 'markdown' ? 'markdown'
      : extension === 'pdf' || extension === 'epub' ? extension : undefined;
    if (!kind) throw new Error('Choose a PDF, EPUB, or Markdown file.');
    const source = { path: file.path, name: file.name, kind, online: file.online };
    const repaired = replacement ? reconnectDocument(library, replacement, source) : undefined;
    const cover = await previewDocument(kind, file.bytes, request?.signal);
    if (request?.signal.aborted) {
      if (cover.image) URL.revokeObjectURL(cover.image);
      return false;
    }
    const existing = library.find((entry) => entry.path === file.path);
    const saved = repaired?.document ?? existing ?? {
      ...source,
      title: cover.title || file.name.replace(/\.[^.]+$/, ''),
      updatedAt: 0,
      notes: [],
    };
    if (startPage && kind === 'pdf') saved.position = { kind: 'pdf', page: startPage, zoom: 1, scroll: 0, fit: 'auto' };
    if (repaired) {
      try {
        saveLibrary(repaired.library);
      } catch {
        if (cover.image) URL.revokeObjectURL(cover.image);
        throw new Error('OpenStudy could not save the new location. Try again.');
      }
      library = repaired.library;
    }
    missingDocument = undefined;
    reconnectButton.hidden = true;
    retryOnlineButton.hidden = true;
    showError(launcherError);
    showSelection(saved, file.bytes, cover);
    renderLibrary();
    opened = true;
    return true;
  } catch (error) {
    if (request?.signal.aborted) return false;
    if (!replacement && kind === 'markdown' && error instanceof Error) showError(launcherError, error.message);
    else onError(error);
    return false;
  } finally {
    finishOnlineRequest(request);
    launcherLoading.hidden = true;
    setBusy(false);
    if (opened && !linkDialog.open) button('start-session').focus();
    else if (!linkDialog.open && !retryOnlineButton.hidden) retryOnlineButton.focus();
    else if (!launcherError.hidden && !reconnectButton.hidden && !linkDialog.open) reconnectButton.focus();
    else if (!linkDialog.open) {
      const restore = initiator instanceof HTMLButtonElement && !initiator.closest('[inert], [hidden]')
        ? initiator : openSourceToggle;
      restore.focus();
    }
  }
}

function persist(): boolean {
  clearTimeout(saveDelay);
  if (!selection || !activeSession() || !reading) return false;
  const entry = selection.document;
  entry.position = { ...reading.position };
  entry.label = reading.label;
  entry.updatedAt = Date.now();
  if (!library.includes(entry)) library.push(entry);

  try {
    if (!canSave) throw new Error('Saved library could not be loaded');
    saveLibrary(library);
    return true;
  } catch (error) {
    console.error(error);
    showError(screen === 'reader' ? readerError : screen === 'settings' ? settingsError : breakError, 'OpenStudy could not save your reading progress.');
    return false;
  }
}

function updateReading(state: ReaderState): void {
  reading = state;
  updateActiveContents(state);
  const view = readingView(state, readerContinuousPdf.checked);
  const location = element('reader-location');
  location.textContent = view.location;
  location.hidden = view.showPageJump;
  pdfPageJump.hidden = !view.showPageJump;
  if (view.page !== undefined && view.total !== undefined) {
    readerPage.max = view.total;
    if (document.activeElement !== readerPage) readerPage.value = view.page;
    readerProgress.max = view.total;
    readerProgress.style.setProperty('--attr-max', view.total);
    readerProgress.disabled = view.total === '1';
    if (!readerProgress.matches(':active')) {
      readerProgress.value = view.page;
      readerProgress.style.setProperty('--control-value', view.page);
      readerProgress.setAttribute('aria-valuetext', view.location);
    }
    element('reader-page-total').textContent = `/ ${view.total}`;
  }
  const locationStatus = element('reader-location-status');
  if (locationStatus.textContent !== view.location) locationStatus.textContent = view.location;
  element('break-location').textContent = view.location;
  button('previous-page').disabled = !view.canPrevious;
  button('next-page').disabled = !view.canNext;
  element('zoom-level').textContent = view.zoomLabel;
  if (view.epubLayout) {
    element<HTMLSelectElement>('line-height').value = String(view.epubLayout.lineHeight);
    element<HTMLSelectElement>('reading-width').value = String(view.epubLayout.width);
  }
  clearTimeout(saveDelay);
  if (reader) saveDelay = setTimeout(persist, 250);
}

function updateClock(): void {
  const remaining = timer?.milliseconds(performance.now());
  for (const id of ['session-clock', 'break-clock']) {
    const clock = document.getElementById(id);
    if (!clock) continue;
    clock.hidden = remaining === undefined || (id === 'session-clock' && remaining > 0 && !settings.showCountdown);
    if (remaining !== undefined) {
      const label = remaining ? clockLabel(remaining) : 'Time’s up';
      if (clock.textContent !== label) clock.textContent = label;
    }
  }
  const announcement = document.getElementById('timer-announcement');
  if (remaining === 0 && !announced) {
    announced = true;
    completedBreaks++;
    playChime();
    if (announcement) announcement.textContent = 'Study time is up.';
  } else if (announcement && (remaining === undefined || (remaining > 0 && announcement.textContent))) {
    announcement.textContent = '';
  }
}

async function checkBattery(): Promise<void> {
  if (!settings.batteryAlerts || !reader || (screen !== 'reader' && screen !== 'break') || batteryCheckPending) return;
  const session = reader;
  batteryCheckPending = true;
  try {
    const status = await desktop.getBatteryStatus();
    if (reader !== session || !settings.batteryAlerts) return;
    batteryLevel = batteryAlertLevel(status);
    if (!batteryLevel) dismissedBatteryLevel = alarmedBatteryLevel = 0;
    const visible = batteryLevel > dismissedBatteryLevel && (screen === 'reader' || screen === 'break');
    if (visible && status) {
      const message = batteryLevel === 2
        ? `Battery at ${status.percent}%. Plug in now to keep reading.`
        : `Battery at ${status.percent}%. Plug in when you can.`;
      if (element('battery-message').textContent !== message) element('battery-message').textContent = message;
      if (settings.batteryAlarm && batteryLevel > alarmedBatteryLevel) {
        playChime();
        alarmedBatteryLevel = batteryLevel;
      }
    }
    batteryAlert.hidden = !visible;
  } catch {
    // A failed probe should not interrupt reading.
  } finally {
    batteryCheckPending = false;
  }
}

function showReaderEntryHint(): void {
  if (readerEntryHintShown) return;
  readerEntryHintShown = true;
  const key = 'openstudy.reader-entry-hint.v1';
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    // The in-memory flag is enough for this launch when storage is unavailable.
  }
  screens.reader.dataset.entryHint = '';
  readerToolbar.preview(true);
  readerEntryHintTimer = setTimeout(() => {
    delete screens.reader.dataset.entryHint;
    readerToolbar.preview(false);
  }, 5500);
}

async function startSession(entry = selection?.document, position = entry?.position, minutes = Number(timerSelect.value)): Promise<void> {
  if (screen !== 'launcher' || busy || !entry) return;
  primeAlarm();
  setBusy(true);
  showError(readerError);
  let openingDocument = false;
  let request: AbortController | undefined;
  const retry = () => void startSession(entry, position, minutes);
  try {
    let bytes = selection?.document === entry ? selection.bytes : undefined;
    if (!bytes && entry.online) {
      showError(launcherError);
      retryOnlineButton.hidden = reconnectButton.hidden = true;
      request = beginOnlineRequest(entry.path, launcherLoadingText);
      openingDocument = true;
      bytes = await readSavedDocument(entry, request.signal);
      request.signal.throwIfAborted();
      finishOnlineRequest(request);
      launcherLoading.hidden = true;
      openingDocument = false;
    }
    element('reader-title').textContent = entry.title;
    element('break-title').textContent = entry.title;
    pdfPageJump.hidden = true;
    element('reader-location').hidden = false;
    element('reader-location').textContent = '';
    element('reader-location-status').textContent = '';
    element('epub-options').hidden = entry.kind !== 'epub';
    element('pdf-reading-options').hidden = entry.kind !== 'pdf';
    readerContinuousPdf.checked = settings.pdfContinuous;
    button('reader-options').hidden = entry.kind === 'markdown';
    const previousLabel = entry.kind === 'markdown' ? 'Scroll back' : 'Previous page';
    const nextLabel = entry.kind === 'markdown' ? 'Scroll forward' : 'Next page';
    for (const [id, label] of [['previous-page', previousLabel], ['next-page', nextLabel]]) {
      button(id).setAttribute('aria-label', label);
      button(id).title = label;
    }
    findInput.value = '';
    showError(searchResult);
    element('contents-list').replaceChildren();
    contentsLinks = [];
    setContentsPinned(false);
    reopenContents = false;
    screens.reader.dataset.kind = entry.kind;
    reading = undefined;
    missingDocument = undefined;
    retryOnlineButton.hidden = reconnectButton.hidden = true;
    batteryLevel = dismissedBatteryLevel = alarmedBatteryLevel = 0;
    setScreen('reader');
    await desktop.setFullscreen(true, os === 'windows' && settings.blockAppSwitching);
    openingDocument = true;
    bytes ??= await readSavedDocument(entry);
    setHighlights(entry.highlights ?? []);
    reader = await openReader(viewport, entry.kind, bytes, position, updateReading, undefined, settings.pdfContinuous, (highlight) => {
      const list = entry.highlights ??= [];
      list.push(highlight);
      if (!persist()) {
        list.pop();
        bookmarkFeedback('Could not save the highlight.');
        return;
      }
      setHighlights(list);
    });
    if (selection?.document === entry) selection.bytes = undefined;
    else showSelection(entry);
    timer = minutes > 0 ? new StudyTimer(minutes) : undefined;
    announced = false;
    timer?.resume(performance.now());
    startReadingClock();
    updateClock();
    persist();
    void checkBattery();
    viewport.focus();
    showReaderEntryHint();
  } catch (error) {
    reader?.destroy();
    reader = undefined;
    viewport.replaceChildren();
    await desktop.setFullscreen(false).catch(console.error);
    setScreen('launcher');
    if (request?.signal.aborted) return;
    if (openingDocument && library.includes(entry)) showReopenError(entry, error, retry);
    else showError(launcherError, documentError(error, 'The reader could not start. Try opening the document again.'));
  } finally {
    finishOnlineRequest(request);
    launcherLoading.hidden = true;
    setBusy(false);
    if (screen === 'launcher') {
      if (!retryOnlineButton.hidden) retryOnlineButton.focus();
      else if (missingDocument && !reconnectButton.hidden) reconnectButton.focus();
      else if (request?.signal.aborted) (selectedDocument.hidden ? continueButton : button('start-session')).focus();
    }
  }
}

function updateBreakClock(): void {
  const clock = element('break-clock');
  if (breakDeadline === null) {
    clock.hidden = true;
    return;
  }
  const left = Math.max(0, breakDeadline - Date.now());
  if (!left) {
    breakDeadline = null;
    clock.textContent = 'Break over';
    element('timer-announcement').textContent = 'Break over.';
    return;
  }
  clock.textContent = `Break ${clockLabel(left)} remaining`;
}

async function takeBreak(): Promise<void> {
  if (screen !== 'reader' || busy || readerBusy) return;
  setBusy(true);
  showError(breakError);
  timer?.pause(performance.now());
  stopReadingClock();
  const saved = persist();
  try {
    await desktop.setFullscreen(false);
    reopenContents = contentsPinned && !contentsPanel.hidden;
    setScreen('break');
    if (!saved) showError(breakError, 'OpenStudy could not save your reading progress.');
    updateClock();
    const long = settings.longBreakEvery > 0 && completedBreaks > 0 && completedBreaks % settings.longBreakEvery === 0;
    const minutes = settings.breakMinutes * (long ? 3 : 1);
    breakDeadline = minutes > 0 ? Date.now() + minutes * 60_000 : null;
    updateBreakClock();
    void checkBattery();
  } catch (error) {
    console.error(error);
    timer?.resume(performance.now());
    showError(readerError, 'Could not leave fullscreen. You can still close OpenStudy.');
  } finally {
    setBusy(false);
    if (!screens.break.hidden) button('resume-session').focus();
  }
}

async function resumeSession(): Promise<boolean> {
  if (screen !== 'break' || busy) return false;
  breakDeadline = null;
  primeAlarm();
  setBusy(true);
  showError(breakError);
  try {
    await desktop.setFullscreen(true, os === 'windows' && settings.blockAppSwitching);
    setScreen('reader');
    await reader?.setPdfContinuous(settings.pdfContinuous);
    readingMark = performance.now();
    timer?.resume(performance.now());
    updateClock();
    void checkBattery();
    viewport.focus();
    return true;
  } catch (error) {
    console.error(error);
    await desktop.setFullscreen(false).catch(console.error);
    setScreen('break');
    showError(breakError, 'Could not enter fullscreen. Try resuming again.');
    return false;
  } finally {
    setBusy(false);
    if (!screens.reader.hidden && reopenContents) {
      reopenContents = false;
      void openContents(false);
    }
  }
}

async function endSession(): Promise<void> {
  if ((screen !== 'reader' && screen !== 'break') || busy || readerBusy) return;
  setBusy(true);
  try {
    stopReadingClock();
    if (screen === 'reader') await desktop.setFullscreen(false);
    if (!persist()) {
      showError(screen === 'break' ? breakError : readerError, screen === 'break'
        ? 'OpenStudy could not save your reading progress. Resume and try again.'
        : 'OpenStudy could not save your reading progress. Try again.');
      return;
    }
    reader?.destroy();
    reader = undefined;
    reading = undefined;
    timer = undefined;
    viewport.replaceChildren();
    selectedDocument.hidden = true;
    selection = undefined;
    clearPreview();
    timerSelect.value = String(settings.defaultMinutes);
    renderLibrary();
    setScreen('launcher');
    updateClock();
    showError(launcherError);
  } catch (error) {
    console.error(error);
    showError(screen === 'break' ? breakError : readerError, 'Could not end this session. You can still close OpenStudy.');
  } finally {
    setBusy(false);
    if (!screens.launcher.hidden) (element('continue-document').hidden ? openSourceToggle : continueButton).focus();
  }
}

async function readerAction(action: (active: Reader) => Promise<unknown>): Promise<void> {
  if (!reader || readerBusy || busy || screen !== 'reader') return;
  readerBusy = true;
  viewport.setAttribute('aria-busy', 'true');
  showError(readerError);
  try {
    await action(reader);
  } catch (error) {
    console.error(error);
    showError(readerError, 'Could not complete that reading action. Try again.');
  } finally {
    readerBusy = false;
    viewport.removeAttribute('aria-busy');
    if (queuedPdfPage !== undefined) {
      const page = queuedPdfPage;
      queuedPdfPage = undefined;
      void jumpToPdfPage(page);
    }
    findLife.runQueued();
  }
}

let notesEntry: SavedDocument | undefined;

function exportNotes(): void {
  if (!notesEntry || !notesEntry.notes.length && !notesEntry.bookmarks?.length && !notesEntry.highlights?.length) return;
  const bookmarks = notesEntry.bookmarks ?? [];
  const highlights = notesEntry.highlights ?? [];
  const body = [
    `# Notes — ${notesEntry.title}`, '',
    ...notesEntry.notes.flatMap((note) => [`## ${note.label || 'Passage'}`, '', note.text, '']),
    ...(bookmarks.length ? ['## Bookmarks', '', ...bookmarks.map((bookmark) => `- ${bookmark.label}`), ''] : []),
    ...(highlights.length ? ['## Highlights', '', ...highlights.map((highlight) => `- ${highlight.text}`), ''] : []),
  ].join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  const name = notesEntry.title.normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'notes';
  link.href = url;
  link.download = `${name}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showNotes(entry = selection?.document): void {
  if (!entry || busy || readerBusy) return;
  const doc = entry;
  notesEntry = doc;
  const list = element('notes-list');
  const notes = entry.notes;
  list.replaceChildren();
  element('notes-empty').hidden = notes.length > 0;
  button('export-notes').disabled = notes.length === 0 && !entry.bookmarks?.length && !entry.highlights?.length;

  async function jumpTo(position: ReadingPosition): Promise<void> {
    notesDialog.close();
    if (screen === 'launcher') {
      const target = position.kind === 'pdf' && doc.position?.kind === 'pdf'
        ? { ...position, fit: doc.position.fit, zoom: doc.position.zoom }
        : position;
      await startSession(doc, target, selectedDocument.hidden ? settings.defaultMinutes : Number(timerSelect.value));
      return;
    }
    if (screen === 'break' && !await resumeSession()) return;
    await readerAction((active) => active.goTo(position));
    viewport.focus();
  }

  function jumpButton(position: ReadingPosition, label: string): HTMLButtonElement {
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'quiet-button';
    jump.textContent = screen === 'launcher' ? `Study from ${label}` : `Go to ${label}`;
    jump.addEventListener('click', () => void jumpTo(position));
    return jump;
  }

  for (const note of notes) {
    const row = document.createElement('li');
    const text = document.createElement('p');
    text.textContent = note.text;
    row.append(text, jumpButton(note.position, note.label));
    list.append(row);
  }

  const bookmarks = entry.bookmarks ?? [];
  const bookmarkList = element('bookmark-list');
  bookmarkList.replaceChildren();
  element('bookmarks-heading').hidden = bookmarks.length === 0;
  for (const bookmark of bookmarks) {
    const row = document.createElement('li');
    row.append(jumpButton(bookmark.position, bookmark.label));
    bookmarkList.append(row);
  }

  const highlights = doc.highlights ?? [];
  const highlightList = element('highlight-list');
  highlightList.replaceChildren();
  element('highlights-heading').hidden = highlights.length === 0;
  for (const highlight of highlights) {
    const row = document.createElement('li');
    const text = document.createElement('p');
    text.textContent = highlight.text;
    row.append(text, jumpButton(highlight.position, highlight.color));
    highlightList.append(row);
  }

  notesDialog.showModal();
}

function renderProgress(): void {
  const days = lastDays(history);
  const max = Math.max(1, ...days.map((day) => day.seconds));
  const week = element('progress-week');
  week.replaceChildren();
  for (const day of days) {
    const column = document.createElement('div');
    column.className = 'progress-day';
    const track = document.createElement('span');
    track.className = 'progress-track';
    const fill = document.createElement('span');
    fill.className = 'progress-fill';
    fill.style.height = `${Math.round((day.seconds / max) * 100)}%`;
    track.append(fill);
    const label = document.createElement('span');
    label.className = 'progress-label';
    label.textContent = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
    const value = document.createElement('span');
    value.className = 'progress-value';
    value.textContent = day.seconds ? `${Math.round(day.seconds / 60)}m` : '–';
    column.append(track, label, value);
    week.append(column);
  }
  element('progress-empty').hidden = days.some((day) => day.seconds > 0);

  const totals = new Map<string, number>();
  for (const day of lastDays(history, 365)) {
    for (const [name, seconds] of Object.entries(day.documents)) totals.set(name, (totals.get(name) ?? 0) + seconds);
  }
  const list = element('progress-documents');
  list.replaceChildren();
  for (const [name, seconds] of [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const row = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = name;
    const time = document.createElement('span');
    time.textContent = `${Math.round(seconds / 60)} min`;
    row.append(title, time);
    list.append(row);
  }
}

function notificationCopy(): string {
  switch (os) {
    case 'windows':
      return 'In Settings → System → Notifications, expand “Turn on do not disturb automatically” and enable “When using an app in full-screen mode”. Windows handles the rule for all fullscreen apps.';
    case 'macos':
      return 'In System Settings → Focus, create a Study focus and add OpenStudy as an app schedule. Focus runs while you use OpenStudy, including windowed breaks. For a session-only focus, use the manual toggle in Control Center.';
    case 'linux':
      return 'On KDE Plasma, enable “while a fullscreen application is focused” in Notifications settings. On GNOME, turn on Do Not Disturb from the notification list or Notifications settings. Other desktops manage quieting in their own settings.';
    default:
      return 'For fewer interruptions, enable Do Not Disturb in your desktop settings.';
  }
}

function changeSettings(next: StudySettings, errorNode = settingsError): boolean {
  showError(errorNode);
  try {
    saveSettings(next);
    settings = next;
    applySettings(settings, controls);
    if (!settings.batteryAlerts) {
      batteryLevel = dismissedBatteryLevel = alarmedBatteryLevel = 0;
      batteryAlert.hidden = true;
    }
    updateClock();
    return true;
  } catch (error) {
    console.error(error);
    applySettings(settings, controls);
    showError(errorNode, 'OpenStudy could not save your settings. Try again.');
    return false;
  }
}

function resolvedTheme(theme: StudySettings['theme']): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyAppearance(theme = settings.theme): void {
  const resolved = resolvedTheme(theme);
  if (document.documentElement.dataset.theme === resolved) return;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#fafafa' : '#0a0a0a');
  void desktop.setWindowTheme(resolved).catch(console.error);
}

function selectSettingsTab(selected: HTMLButtonElement): void {
  for (const tab of settingsTabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    element(tab.getAttribute('aria-controls')!).hidden = !active;
  }
}

for (const tab of settingsTabs) tab.addEventListener('click', () => selectSettingsTab(tab));
settingsCategories.addEventListener('keydown', (event) => {
  const current = settingsTabs.indexOf(event.target as HTMLButtonElement);
  if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const last = settingsTabs.length - 1;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? last
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + settingsTabs.length) % settingsTabs.length;
  selectSettingsTab(settingsTabs[next]);
  settingsTabs[next].focus();
});

function returnFromSettings(): void {
  if (screen !== 'settings' || busy) return;
  setScreen(settingsReturn);
  button('open-settings').focus();
}

for (const picker of pickerButtons) {
  picker.addEventListener('click', () => {
    openSourceMenu.close();
    void selectDocument(desktop.pickDocument, (error) => showError(launcherError,
      documentError(error, 'Choose a readable PDF, EPUB, or Markdown file.')));
  });
}

function showLinkDialog(replacement?: SavedDocument): void {
  if (busy || activeSession()) return;
  if (screen === 'settings') setScreen('launcher');
  openSourceMenu.close();
  replacementLink = replacement;
  element('link-heading').textContent = replacement ? 'Update PDF link' : 'Open PDF link';
  linkInput.value = replacement?.path ?? '';
  showError(linkError);
  button('submit-link').textContent = 'Open PDF';
  linkDialog.showModal();
  linkInput.select();
}

button('open-link').addEventListener('click', () => showLinkDialog());
cancelOnline.addEventListener('click', () => onlineRequest?.abort());
retryOnlineButton.addEventListener('click', () => retryOnline?.());
reconnectButton.addEventListener('click', () => {
  if (!missingDocument) return;
  if (missingDocument.online) showLinkDialog(missingDocument);
  else void selectDocument(desktop.pickDocument, (error) => showError(launcherError, documentError(error,
    error instanceof Error && !/password/i.test(error.name) ? error.message : 'Choose the original file.')), missingDocument);
});
button('cancel-link').addEventListener('click', () => {
  onlineRequest?.abort();
  linkDialog.close();
  if (!busy) (replacementLink ? reconnectButton : openSourceToggle).focus();
});
linkDialog.addEventListener('cancel', () => onlineRequest?.abort());
linkInput.addEventListener('input', () => {
  showError(linkError);
  button('submit-link').textContent = 'Open PDF';
});
element('link-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  let url: URL;
  try {
    url = new URL(linkInput.value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    showError(linkError, 'Enter an HTTP or HTTPS PDF link without a username or password.');
    return;
  }
  const pageFragment = /^#page=(\d+)$/i.exec(url.hash);
  const startPage = pageFragment ? Math.max(1, Math.min(1_000_000, Number(pageFragment[1]))) : undefined;
  url.hash = '';
  const segment = url.pathname.split('/').filter(Boolean).pop() ?? url.hostname;
  let name = segment;
  try { name = decodeURIComponent(segment); } catch { /* Keep a malformed escape readable. */ }
  showError(linkError);
  const submit = button('submit-link');
  linkInput.readOnly = submit.disabled = true;
  button('cancel-link').focus();
  const opened = await selectDocument(async (signal) => ({
    path: url.href, name, online: true, bytes: await desktop.readOnlinePdf(url.href, signal),
  }), (error) => {
    showError(linkError, documentError(error, 'Could not open this PDF link. Check that it opens a PDF directly.'));
    submit.textContent = 'Retry';
  }, replacementLink, url.href, startPage);
  linkInput.readOnly = submit.disabled = false;
  showError(element('link-status'));
  if (opened) {
    linkDialog.close();
    button('start-session').focus();
  } else if (linkDialog.open) submit.focus();
  else openSourceToggle.focus();
});
continueButton.addEventListener('click', () => {
  if (lastDocument) void startSession(lastDocument, lastDocument.position, settings.defaultMinutes);
});
button('start-session').addEventListener('click', () => void startSession());
button('resume-session').addEventListener('click', () => void resumeSession());
button('take-break').addEventListener('click', () => void takeBreak());
button('end-session').addEventListener('click', () => void endSession());
button('end-from-break').addEventListener('click', () => void endSession());
button('previous-page').addEventListener('click', () => void readerAction((active) => active.previous()));
button('next-page').addEventListener('click', () => void readerAction((active) => active.next()));
button('dismiss-battery').addEventListener('click', () => {
  dismissedBatteryLevel = alarmedBatteryLevel = batteryLevel;
  batteryAlert.hidden = true;
  element(screen === 'break' ? 'resume-session' : 'reader-viewport').focus();
});
async function jumpToPdfPage(page: number): Promise<void> {
  const position = reading?.position;
  if (screen !== 'reader' || busy || position?.kind !== 'pdf' || !Number.isInteger(page)
    || page < 1 || page > (reading?.pageCount ?? 0)) return;
  if (readerBusy) {
    queuedPdfPage = page;
    return;
  }
  await readerAction((active) => active.goTo({ ...position, page, scroll: 0 }));
  if (reading?.position.kind === 'pdf') readerPage.value = String(reading.position.page);
}

pdfPageJump.addEventListener('submit', (event) => {
  event.preventDefault();
  void jumpToPdfPage(readerPage.valueAsNumber);
});
readerPage.addEventListener('blur', (event) => {
  if (event.relatedTarget instanceof Node && pdfPageJump.contains(event.relatedTarget)) return;
  if (reading?.position.kind === 'pdf') readerPage.value = String(reading.position.page);
});
readerProgress.addEventListener('input', () => {
  readerProgress.setAttribute('aria-valuetext', `Page ${readerProgress.value} of ${readerProgress.max}`);
  readerProgress.style.setProperty('--control-value', readerProgress.value);
});
readerProgress.addEventListener('change', () => void jumpToPdfPage(readerProgress.valueAsNumber));
button('zoom-in').addEventListener('click', () => void readerAction((active) => active.zoom(1)));
button('zoom-out').addEventListener('click', () => void readerAction((active) => active.zoom(-1)));
for (const fit of ['page', 'width'] as const) {
  button(`fit-${fit}`).addEventListener('click', () => {
    void readerAction(async (active) => {
      await active.setPdfFit(fit);
      optionsDialog.close();
      viewport.focus();
    });
  });
}
button('reader-options').addEventListener('click', () => {
  if (!reader || busy || readerBusy) return;
  if (reading?.position.kind === 'pdf') {
    const current = pdfFitMode(reading.position.fit, readerContinuousPdf.checked);
    button('fit-page').setAttribute('aria-pressed', String(current === 'page'));
    button('fit-width').setAttribute('aria-pressed', String(current === 'width'));
  }
  optionsDialog.showModal();
});
button('close-options').addEventListener('click', () => optionsDialog.close());

function showShortcuts(): void {
  shortcutsDialog.showModal();
  button('close-shortcuts').focus();
}
button('close-shortcuts').addEventListener('click', () => shortcutsDialog.close());

interface PaletteCommand { label: string; hint?: string; run(): void; }

function paletteCommands(): PaletteCommand[] {
  const mod = os === 'macos' ? '⌘' : 'Ctrl+';
  const commands: PaletteCommand[] = [
    { label: 'Open a file', hint: `${mod}O`, run: () => button('choose-file').click() },
    { label: 'Open a PDF link', run: () => showLinkDialog() },
    { label: 'Study space', run: () => setScreen('launcher') },
    { label: 'Progress', run: () => setScreen('progress') },
    { label: 'Settings', run: () => setScreen('settings') },
    { label: 'Keyboard shortcuts', hint: '?', run: showShortcuts },
  ];
  if (screen === 'reader') {
    commands.push(
      { label: 'Find in document', hint: `${mod}F`, run: () => openFind() },
      { label: 'Bookmark this spot', run: () => button('add-bookmark').click() },
      { label: 'Look up later', run: () => button('review-notes').click() },
      { label: 'Take a break', hint: 'Esc', run: () => void takeBreak() },
    );
  }
  if (screen === 'break') {
    commands.push(
      { label: 'Resume studying', run: () => void resumeSession() },
      { label: 'End session', run: () => void endSession() },
    );
  }
  if (screen === 'launcher') {
    for (const entry of library.slice(0, 8)) {
      commands.push({ label: entry.title, hint: `Recent · ${kindLabel(entry.kind)}`, run: () => void openRecent(entry) });
    }
  }
  return commands;
}

function renderPalette(): void {
  const query = commandQuery.value.trim().toLowerCase();
  const matches = paletteCommands().filter((command) => !query
    || command.label.toLowerCase().includes(query) || command.hint?.toLowerCase().includes(query)).slice(0, 10);
  commandResults.replaceChildren();
  for (const command of matches) {
    const row = document.createElement('li');
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'command-result';
    option.setAttribute('role', 'option');
    const label = document.createElement('span');
    label.textContent = command.label;
    option.append(label);
    if (command.hint) {
      const hint = document.createElement('kbd');
      hint.textContent = command.hint;
      option.append(hint);
    }
    option.addEventListener('click', () => {
      commandPalette.close();
      command.run();
    });
    row.append(option);
    commandResults.append(row);
  }
}

function openPalette(): void {
  if (busy) return;
  commandQuery.value = '';
  renderPalette();
  commandPalette.showModal();
  commandQuery.focus();
}

commandQuery.addEventListener('input', renderPalette);
commandQuery.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const buttons = [...commandResults.querySelectorAll<HTMLButtonElement>('button')];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = current < 0 ? (step > 0 ? 0 : buttons.length - 1) : (current + step + buttons.length) % buttons.length;
    buttons[next].focus();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const active = document.activeElement;
    const target = active instanceof HTMLButtonElement && commandResults.contains(active)
      ? active : commandResults.querySelector('button');
    target?.click();
  }
});
readerContinuousPdf.addEventListener('change', async () => {
  const previous = settings.pdfContinuous;
  const enabled = readerContinuousPdf.checked;
  readerContinuousPdf.disabled = true;
  try {
    await readerAction(async (active) => {
      await active.setPdfContinuous(enabled);
      if (!changeSettings({ ...settings, pdfContinuous: enabled }, readerError)) {
        readerContinuousPdf.checked = previous;
        await active.setPdfContinuous(previous);
      }
    });
  } finally {
    readerContinuousPdf.disabled = false;
    readerContinuousPdf.checked = settings.pdfContinuous;
  }
});
element<HTMLSelectElement>('line-height').addEventListener('change', (event) => {
  const lineHeight = Number((event.target as HTMLSelectElement).value);
  void readerAction((active) => active.setEpubLayout({ lineHeight }));
});
element<HTMLSelectElement>('reading-width').addEventListener('change', (event) => {
  const width = Number((event.target as HTMLSelectElement).value);
  void readerAction((active) => active.setEpubLayout({ width }));
});
function closeReaderPanel(panel: HTMLElement, focus = false): void {
  if (!panel.hidden && panel === findPanel) {
    findLife.clear();
    reader?.clearFind();
  }
  panel.hidden = true;
  const toggle = button(panel === contentsPanel ? 'toggle-contents' : 'toggle-find');
  toggle.setAttribute('aria-expanded', 'false');
  if (focus) (toggle.closest('[inert]') ? viewport : toggle).focus();
}

function setContentsPinned(pinned: boolean): void {
  contentsPinned = pinned;
  contentsPanel.toggleAttribute('data-pinned', pinned);
  pinContents.setAttribute('aria-pressed', String(pinned));
  pinContents.textContent = pinned ? 'Unpin' : 'Pin';
}

function updateActiveContents(state: ReaderState): void {
  if (contentsPanel.hidden) return;
  let current: HTMLButtonElement | undefined;
  let currentPage = 0;
  for (const link of contentsLinks) {
    const { entry } = link;
    if (state.position.kind === 'pdf' && entry.page !== undefined) {
      if (entry.page >= currentPage && entry.page <= state.position.page) {
        currentPage = entry.page;
        current = link.button;
      }
    } else if (entry.current ? entry.current(state.position) : entry.label === state.label) {
      current = link.button;
    }
  }
  for (const link of contentsLinks) {
    if (link.button === current) link.button.setAttribute('aria-current', 'location');
    else link.button.removeAttribute('aria-current');
  }
}

async function openContents(focus = true): Promise<void> {
  if (!reader || busy) return;
  const active = reader;
  if (!contentsPinned) closeReaderPanel(findPanel);
  contentsPanel.hidden = false;
  button('toggle-contents').setAttribute('aria-expanded', 'true');
  if (focus) button('close-contents').focus();
  if (contentsLinks.length) {
    if (reading) updateActiveContents(reading);
    return;
  }
  const list = element('contents-list');
  const status = element('contents-status');
  list.replaceChildren();
  showError(status, 'Loading contents…');
  try {
    const entries = await active.contents();
    if (reader !== active || contentsPanel.hidden) return;
    showError(status, entries.length ? '' : 'No table of contents.');
    const items = document.createDocumentFragment();
    contentsLinks = entries.map((entry) => {
      const item = document.createElement('li');
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'quiet-button';
      jump.dir = 'auto';
      jump.textContent = entry.label;
      item.style.setProperty('--contents-depth', String(Math.min(6, Math.max(0, entry.depth))));
      jump.addEventListener('click', () => void readerAction(async () => {
        await entry.goTo();
        if (!contentsPinned) {
          closeReaderPanel(contentsPanel);
          viewport.focus();
        }
      }));
      item.append(jump);
      items.append(item);
      return { entry, button: jump };
    });
    list.replaceChildren(items);
    if (reading) updateActiveContents(reading);
  } catch {
    if (reader === active) showError(status, 'Could not load contents.');
  }
}

function openFind(): void {
  if (!reader || busy || !reader.find) return;
  if (!contentsPinned) closeReaderPanel(contentsPanel);
  findPanel.hidden = false;
  button('toggle-find').setAttribute('aria-expanded', 'true');
  findInput.focus();
  findInput.select();
}

button('toggle-contents').addEventListener('click', () => {
  if (contentsPanel.hidden) void openContents();
  else closeReaderPanel(contentsPanel, true);
});
pinContents.addEventListener('click', () => {
  setContentsPinned(!contentsPinned);
  if (!contentsPinned) closeReaderPanel(findPanel);
});
button('toggle-find').addEventListener('click', () => {
  if (findPanel.hidden) openFind();
  else closeReaderPanel(findPanel, true);
});
button('close-contents').addEventListener('click', () => closeReaderPanel(contentsPanel, true));
button('close-find').addEventListener('click', () => closeReaderPanel(findPanel, true));
findInput.addEventListener('input', () => {
  findLife.clear();
  reader?.clearFind();
  showError(searchResult);
});
findInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  button(event.shiftKey ? 'find-previous' : 'find-next').click();
});
findPanel.addEventListener('submit', (event) => {
  event.preventDefault();
  const direction = (event as SubmitEvent).submitter === button('find-previous') ? 'previous' : 'next';
  findDocument(findInput.value.trim(), direction);
});

const findLife = new FindLifecycle({
  query: () => findInput.value.trim(),
  hidden: () => findPanel.hidden,
  message: (text) => showError(searchResult, text),
  busy: () => readerBusy || busy,
  search: async (query, direction, onProgress) => {
    let result: FindResult | undefined;
    await readerAction(async (active) => {
      result = await active.find(query, direction, onProgress);
    });
    return result;
  },
});

function findDocument(query: string, direction: FindDirection): void {
  void findLife.run(query, direction);
}

let bookmarkFeedbackTimer: ReturnType<typeof setTimeout> | undefined;

function bookmarkFeedback(message: string): void {
  const node = element('bookmark-feedback');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(bookmarkFeedbackTimer);
  bookmarkFeedbackTimer = setTimeout(() => { node.hidden = true; }, 1600);
}

button('add-bookmark').addEventListener('click', () => {
  if (!selection || !reading || !reader || busy || readerBusy) return;
  const bookmarks = selection.document.bookmarks ??= [];
  bookmarks.push({ position: { ...reading.position }, label: reading.label, createdAt: Date.now() });
  if (!persist()) {
    bookmarks.pop();
    bookmarkFeedback('Could not save the bookmark.');
    return;
  }
  bookmarkFeedback('Bookmark saved');
});

for (const buttonEl of document.querySelectorAll<HTMLButtonElement>('.highlight-button')) {
  buttonEl.addEventListener('click', () => {
    const color = buttonEl.dataset.highlight as typeof highlightColors[number] | undefined;
    if (!color || !highlightColors.includes(color)) return;
    void readerAction((active) => active.highlight(color));
  });
}

const noteText = element<HTMLTextAreaElement>('note-text');
button('add-note').addEventListener('click', () => {
  if (!reading || !reader || busy || readerBusy) return;
  noteText.value = '';
  showError(element('note-save-error'));
  noteDialog.showModal();
  noteText.focus();
});
element('note-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = noteText.value.trim();
  if (!selection || !reading || !text) return;
  const notes = selection.document.notes;
  notes.push({ text, position: { ...reading.position }, label: reading.label });
  if (!persist()) {
    notes.pop();
    showError(element('note-save-error'), 'Could not save your note. Your draft is still here.');
    return;
  }
  showError(readerError);
  noteDialog.close();
});
button('cancel-note').addEventListener('click', () => noteDialog.close());
button('review-notes').addEventListener('click', () => showNotes());
button('launcher-review-notes').addEventListener('click', () => showNotes());
button('break-review-notes').addEventListener('click', () => showNotes());
button('continue-review-notes').addEventListener('click', () => showNotes(lastDocument));
button('close-notes').addEventListener('click', () => notesDialog.close());
button('export-notes').addEventListener('click', exportNotes);

const notificationsDescription = element('notifications-description');
const osSettingsButton = button('open-os-settings');
notificationsDescription.textContent = notificationCopy();
element('launcher-notifications').textContent = notificationCopy();
osSettingsButton.hidden = os !== 'windows';
button('launcher-os-settings').hidden = os !== 'windows';
element('windows-focus-setting').hidden = os !== 'windows';
applySettings(settings, controls);
defaultMinutes.addEventListener('change', () => changeSettings({ ...settings, defaultMinutes: Number(defaultMinutes.value) }));
showCountdown.addEventListener('change', () => changeSettings({ ...settings, showCountdown: showCountdown.checked }));
themeSelect.addEventListener('change', () => changeSettings({ ...settings, theme: themeSelect.value as StudySettings['theme'] }));
accentSelect.addEventListener('change', () => changeSettings({ ...settings, accent: accentSelect.value as StudySettings['accent'] }));
paperSelect.addEventListener('change', () => changeSettings({ ...settings, paper: paperSelect.value as StudySettings['paper'] }));
motionSelect.addEventListener('change', () => changeSettings({ ...settings, motion: motionSelect.value as StudySettings['motion'] }));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (settings.theme === 'system') applyAppearance('system');
});
continuousPdf.addEventListener('change', () => changeSettings({ ...settings, pdfContinuous: continuousPdf.checked }));
breakMinutes.addEventListener('change', () => changeSettings({ ...settings, breakMinutes: Number(breakMinutes.value) }));
longBreakEvery.addEventListener('change', () => changeSettings({ ...settings, longBreakEvery: Number(longBreakEvery.value) }));
blockAppSwitching.addEventListener('change', () => changeSettings({ ...settings, blockAppSwitching: blockAppSwitching.checked }));
batteryAlerts.addEventListener('change', () => changeSettings({ ...settings, batteryAlerts: batteryAlerts.checked }));
batteryAlarm.addEventListener('change', () => changeSettings({ ...settings, batteryAlarm: batteryAlarm.checked }));

function downloadJson(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

button('export-library').addEventListener('click', () => {
  downloadJson('openstudy-library.json', { version: 1, library, settings, history });
  element('library-backup-status').textContent = 'Export saved.';
});

const importFile = element<HTMLInputElement>('import-library-file');
button('import-library').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.item(0);
  if (!file) return;
  const status = element('library-backup-status');
  try {
    const parsed: unknown = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== 'object' || (parsed as Record<string, unknown>).version !== 1) throw new Error('Unsupported export version');
    const payload = parsed as Record<string, unknown>;
    const incoming = normalizeLibrary(payload.library);
    const libraryWarning = takeLibraryWarning();
    const known = new Set(library.map((entry) => entry.path));
    const added: SavedDocument[] = [];
    for (const entry of incoming) {
      if (known.has(entry.path)) continue;
      known.add(entry.path);
      added.push(entry);
    }
    library = [...library, ...added];
    saveLibrary(library);

    const byDate = new Map(history.map((day) => [day.date, day]));
    for (const day of normalizeHistory(payload.history)) {
      const existing = byDate.get(day.date);
      if (existing) {
        const documents = { ...existing.documents };
        for (const [name, seconds] of Object.entries(day.documents)) documents[name] = (documents[name] ?? 0) + seconds;
        byDate.set(day.date, { date: day.date, seconds: existing.seconds + day.seconds, documents });
      } else byDate.set(day.date, day);
    }
    history = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-365);
    saveHistory(history);

    if (payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)) {
      settings = normalizeSettings(payload.settings);
      try { saveSettings(settings); } catch (error) { console.error(error); }
      applySettings(settings, controls);
    }

    renderLibrary();
    status.textContent = `Imported ${added.length} document${added.length === 1 ? '' : 's'}.${libraryWarning ? ` ${libraryWarning}` : ''}`;
  } catch {
    status.textContent = 'That file could not be read as a library export.';
  }
  importFile.value = '';
});
sidebarToggle.addEventListener('click', () => {
  const errorNode = screen === 'settings' ? settingsError : screen === 'break' ? breakError : launcherError;
  changeSettings({ ...settings, sidebarCollapsed: !settings.sidebarCollapsed }, errorNode);
});
button('open-settings').addEventListener('click', () => {
  if (busy || (screen !== 'launcher' && screen !== 'break')) return;
  settingsReturn = screen;
  setScreen('settings');
  element('settings-heading').focus();
});
button('close-settings').addEventListener('click', returnFromSettings);
button('nav-progress').addEventListener('click', () => {
  if (busy || screen === 'reader') return;
  setScreen('progress');
  element('progress-heading').focus();
});
button('nav-library').addEventListener('click', () => {
  if (busy || screen === 'reader') return;
  const target = screen === 'settings' ? settingsReturn : screen;
  setScreen(target);
  element(target === 'break' ? 'resume-session' : 'workspace-title').focus();
});
for (const [trigger, errorNode] of [[osSettingsButton, settingsError], [button('launcher-os-settings'), launcherError]] as const) {
  trigger.addEventListener('click', async () => {
    showError(errorNode);
    try {
      await desktop.openNotificationSettings();
    } catch {
      showError(errorNode, 'Could not open Windows Settings. Open it manually to change notifications.');
    }
  });
}

for (const command of windowCommands) {
  command.addEventListener('click', () => {
    appMenu.close();
    windowMenuToggle.focus();
    if (command.dataset.command === 'shortcuts') showShortcuts();
    else button(command.dataset.command!).click();
  });
}

const windowControls = element('window-controls');
if (os !== 'browser') {
  windowControls.hidden = false;
  const maximize = button('window-maximize');
  let resizeFrame = 0;
  async function syncMaximizeButton(): Promise<void> {
    if (screen === 'reader') return;
    const maximized = await desktop.isWindowMaximized();
    maximize.setAttribute('aria-label', maximized ? 'Restore window' : 'Maximize window');
    maximize.title = maximized ? 'Restore' : 'Maximize';
    element('window-maximize-icon').hidden = maximized;
    element('window-restore-icon').hidden = !maximized;
  }
  const runWindow = (action: () => Promise<void>) => void action().catch((error) => {
    console.error(error);
    showInteractionError('The window command could not be completed.');
  });
  const maximizeOrRestore = async () => {
    await desktop.toggleMaximizeWindow();
    await syncMaximizeButton();
  };
  element('window-bar').addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !(event.target instanceof Element)
      || event.target.closest('button, #window-menu') || !event.target.closest('[data-window-drag]')) return;
    runWindow(event.detail === 2 ? maximizeOrRestore : () => desktop.startDragging());
  });
  button('window-minimize').addEventListener('click', () => runWindow(() => desktop.minimizeWindow()));
  maximize.addEventListener('click', () => runWindow(maximizeOrRestore));
  button('window-close').addEventListener('click', () => {
    persist();
    runWindow(() => desktop.closeWindow());
  });
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => void syncMaximizeButton().catch(console.error));
  });
  void syncMaximizeButton().catch(console.error);
}

function showInteractionError(message: string): void {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) {
    showError(screen === 'reader' ? readerError : screen === 'settings' ? settingsError
      : screen === 'break' ? breakError : launcherError, message);
    return;
  }
  let status = dialog.querySelector<HTMLElement>('[data-command-error]');
  if (!status) {
    status = document.createElement('p');
    status.className = 'form-error';
    status.setAttribute('data-command-error', '');
    status.setAttribute('role', 'alert');
    dialog.append(status);
    dialog.addEventListener('close', () => status?.remove(), { once: true });
  }
  showError(status, message);
}

function contextCommands({ source, target }: ContextTarget): ContextCommand[] {
  const commands: ContextCommand[] = [];
  const field = target?.closest<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type="search"], input[type="text"], input[type="url"]');
  const fieldValue = field?.value;
  const start = field?.selectionStart ?? 0;
  const end = field?.selectionEnd ?? start;
  const selected = fieldValue !== undefined ? fieldValue.slice(start, end) : source.getSelection()?.toString() ?? '';
  const withClipboard = (work: () => Promise<void>) => void work().catch(() => showInteractionError('Clipboard access is unavailable.'));
  if (selected) commands.push({ label: 'Copy', run: () => withClipboard(() => copyText(selected)) });
  if (field && !field.disabled && !field.readOnly) {
    function replaceSelection(text: string): void {
      if (!field?.isConnected || field.value !== fieldValue) return;
      const room = field.maxLength < 0 ? text.length : Math.max(0, field.maxLength - field.value.length + end - start);
      field.setRangeText(text.slice(0, room), start, end, 'end');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.focus();
    }
    if (selected) commands.push({ label: 'Cut', run: () => withClipboard(async () => {
      await copyText(selected);
      replaceSelection('');
    }) });
    if (navigator.clipboard?.readText) commands.push({ label: 'Paste', run: () => withClipboard(async () => {
      replaceSelection(await navigator.clipboard.readText());
    }) });
    return commands;
  }
  if (document.querySelector('dialog[open]')) return commands;

  const targets = screen === 'reader'
    ? ['previous-page', 'next-page', 'toggle-contents', 'toggle-find', 'reader-options', 'add-note', 'review-notes', 'take-break']
    : screen === 'break' ? ['resume-session', 'break-review-notes', 'end-from-break']
    : ['choose-file', 'open-link', 'nav-library', 'open-settings'];
  for (const id of targets) {
    const action = button(id);
    if (action.disabled || action.hidden || (screen === 'settings' && id === 'open-settings')) continue;
    const label = action.getAttribute('aria-label') || action.textContent?.trim();
    if (label) commands.push({ label, run: () => action.click() });
  }
  return commands;
}

bindContextMenu(element('context-menu'), contextCommands);
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openPalette();
    return;
  }
  if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey
    && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]'))) {
    event.preventDefault();
    showShortcuts();
    return;
  }
  if (screen === 'reader' && event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey) && !event.altKey) {
    event.preventDefault();
    openFind();
    return;
  }
  if (event.key === 'Escape') {
    const panel = [findPanel, contentsPanel].find((candidate) => !candidate.hidden);
    if (panel) {
      event.preventDefault();
      closeReaderPanel(panel, true);
      return;
    }
    if (onlineRequest) {
      event.preventDefault();
      onlineRequest.abort();
      return;
    }
    for (const [menu, toggle] of [[appMenu, windowMenuToggle], [openSourceMenu, openSourceToggle], [sessionMenu, sessionToggle], [readerToolbar, toolbarToggle]] as const) {
      if (!menu.isPinned()) continue;
      event.preventDefault();
      menu.close();
      toggle.focus();
      return;
    }
  }
  if (event.key === 'Escape' && screen === 'reader') {
    event.preventDefault();
    void takeBreak();
  }
  if (screen === 'reader' && !event.ctrlKey && !event.metaKey && !event.altKey
    && !(event.target instanceof Element && event.target.closest('button, input, textarea, select, [role="menu"]'))) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      button(event.key === 'ArrowLeft' ? 'previous-page' : 'next-page').click();
    }
  }
  if (event.key === 'Escape' && screen === 'settings') {
    event.preventDefault();
    returnFromSettings();
  }
  if (event.key === 'Escape' && screen === 'progress') {
    event.preventDefault();
    setScreen('launcher');
  }
  if (event.key.toLowerCase() === 'o' && (event.ctrlKey || event.metaKey) && screen === 'launcher') {
    event.preventDefault();
    button('choose-file').click();
  }
});
window.addEventListener('pagehide', () => { stopReadingClock(); persist(); });
if (os === 'browser') {
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) void takeBreak();
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (screen === 'reader') accrueReading();
    readingMark = undefined;
    persist();
  } else if (screen === 'reader' && reading) {
    readingMark = performance.now();
  }
});

let dragDepth = 0;
function dragHasFiles(event: DragEvent): boolean {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files') && !busy && screen === 'launcher';
}
window.addEventListener('dragenter', (event) => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  element('drop-overlay').hidden = false;
});
window.addEventListener('dragover', (event) => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'copy';
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) element('drop-overlay').hidden = true;
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  element('drop-overlay').hidden = true;
  const file = event.dataTransfer?.files.item(0);
  if (!file || busy || screen !== 'launcher') return;
  void selectDocument(async () => {
    const name = file.name;
    const extension = name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'epub', 'md', 'markdown'].includes(extension ?? '')) throw new Error('Choose a PDF, EPUB, or Markdown file.');
    const nativePath = (file as File & { path?: string }).path;
    const path = nativePath ?? `preview:${name}:${file.lastModified}:${file.size}`;
    if (!nativePath) await desktop.cacheDocument(path, file);
    const bytes = nativePath ? await desktop.readDocument(path) : await file.arrayBuffer();
    return { name, path, bytes };
  }, (error) => showError(launcherError, documentError(error, 'Choose a PDF, EPUB, or Markdown file.')));
});
setInterval(updateClock, 250);
setInterval(updateBreakClock, 1000);
setInterval(() => void checkBattery(), 30_000);
setInterval(() => {
  if (screen !== 'reader' || document.hidden || !reading) return;
  accrueReading();
}, 15_000);

setScreen('launcher');
try {
  library = loadLibrary();
  renderLibrary();
  const libraryWarning = takeLibraryWarning();
  if (libraryWarning) showError(launcherError, libraryWarning);
} catch (error) {
  console.error(error);
  try {
    recoverLibrary();
    showError(launcherError, 'OpenStudy recovered from damaged reading history. A backup was kept under openstudy.library.v1.damaged.');
  } catch (repairError) {
    console.error(repairError);
    canSave = false;
    showError(launcherError, 'OpenStudy could not load your reading history.');
  }
}
setBusy(false);
