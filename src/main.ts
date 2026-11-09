import './style.css';
import './bars.css';
import {
  closeWindow, isWindowMaximized, minimizeWindow, openNotificationSettings, pickDocument, platform,
  readDocument, setFullscreen, setWindowTheme, startDragging, toggleMaximizeWindow,
} from './desktop';
import { loadLibrary, saveLibrary, type SavedDocument } from './library';
import { openReader, previewDocument, type DocumentKind, type Reader, type ReaderState, type ReadingPosition } from './readers';
import { loadSettings, saveSettings, type StudySettings } from './settings';
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

type Screen = 'launcher' | 'reader' | 'break' | 'settings';
const screens: Record<Screen, HTMLElement> = {
  launcher: element('launcher-screen'),
  reader: element('reader-screen'),
  break: element('break-screen'),
  settings: element('settings-screen'),
};
const workspace = document.querySelector<HTMLElement>('.workspace-shell');
const viewport = element('reader-viewport');
const launcherError = element('launcher-error');
const launcherLoading = element('launcher-loading');
const readerError = element('reader-error');
const breakError = element('break-error');
const settingsError = element('settings-error');
const settingsCategories = element('settings-categories');
const settingsTabs = Array.from(settingsCategories.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const themeSelect = element<HTMLSelectElement>('appearance-theme');
const timerSelect = element<HTMLSelectElement>('session-minutes');
const defaultMinutes = element<HTMLSelectElement>('default-minutes');
const showCountdown = element<HTMLInputElement>('show-countdown');
const continuousPdf = element<HTMLInputElement>('continuous-pdf');
const readerContinuousPdf = element<HTMLInputElement>('reader-continuous-pdf');
const pdfPageJump = element<HTMLFormElement>('pdf-page-jump');
const readerPage = element<HTMLInputElement>('reader-page');
const readerProgress = element<HTMLInputElement>('reader-progress');
const recentList = element('recent-list');
const pickerButtons = ['choose-file', 'choose-file-inline', 'choose-another'].map(button);
const selectedDocument = element('selected-document');
const preview = element('document-preview');
const noteDialog = element<HTMLDialogElement>('note-dialog');
const notesDialog = element<HTMLDialogElement>('notes-dialog');
const optionsDialog = element<HTMLDialogElement>('options-dialog');
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
if (os === 'macos') element('open-file-shortcut').textContent = '⌘O';
drawIcons();

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
let canSave = true;

function showError(node: HTMLElement, message = ''): void {
  node.textContent = message;
  node.hidden = !message;
}

function setScreen(next: Screen): void {
  if (next !== screen) {
    queuedPdfPage = undefined;
    for (const error of [launcherError, readerError, breakError, settingsError]) showError(error);
    appMenu.close();
    readerToolbar.close();
    sessionMenu.close();
  }
  screen = next;
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
  syncControls();
}

function activeSession(): boolean {
  return screen === 'reader' || screen === 'break' || (screen === 'settings' && settingsReturn === 'break');
}

function syncControls(): void {
  const canChoose = !busy && !activeSession();
  for (const picker of pickerButtons) picker.disabled = !canChoose;
  for (const row of recentList.querySelectorAll<HTMLButtonElement>('button')) row.disabled = !canChoose;
  button('nav-library').disabled = busy;
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

  for (const entry of [...library].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)) {
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
    row.addEventListener('click', () => void selectDocument(async () => ({
      path: entry.path,
      name: entry.name,
      bytes: await readDocument(entry.path),
    }), 'This file could not be reopened. Choose it again if it has moved.'));
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

async function selectDocument(
  pick: () => ReturnType<typeof pickDocument>,
  failure: string,
): Promise<void> {
  if (busy || activeSession()) return;
  if (screen === 'settings') setScreen('launcher');
  setBusy(true);
  showError(launcherError);
  let kind: DocumentKind | undefined;
  try {
    const file = await pick();
    if (!file) return;
    launcherLoading.hidden = false;
    const extension = file.name.split('.').pop()?.toLowerCase();
    kind = extension === 'md' || extension === 'markdown' ? 'markdown'
      : extension === 'pdf' || extension === 'epub' ? extension : undefined;
    if (!kind) {
      showError(launcherError, 'Choose a PDF, EPUB, or Markdown file.');
      return;
    }
    const cover = await previewDocument(kind, file.bytes);
    const existing = library.find((entry) => entry.path === file.path);
    const saved = existing ?? {
      path: file.path,
      name: file.name,
      title: cover.title || file.name.replace(/\.[^.]+$/, ''),
      kind,
      updatedAt: 0,
      notes: [],
    };
    selection = { document: saved, bytes: file.bytes };
    clearPreview();
    imageUrl = cover.image;
    if (imageUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = imageUrl;
      preview.classList.add('has-preview');
      preview.append(image);
    }
    element('selected-name').textContent = saved.title;
    element('selected-meta').textContent = saved.label ?? cover.details;
    selectedDocument.hidden = false;
    button('launcher-review-notes').hidden = saved.notes.length === 0;
    renderLibrary();
  } catch (error) {
    console.error(error);
    const password = error instanceof Error && /password/i.test(`${error.name} ${error.message}`);
    const detail = error instanceof Error ? error.message : error;
    const size = typeof detail === 'string' && detail.includes('smaller than 256 MB');
    showError(launcherError, password ? 'This PDF is password-protected. Choose an unlocked copy.'
      : size ? 'Choose a document smaller than 256 MB.'
      : kind === 'markdown' && error instanceof Error ? error.message : failure);
  } finally {
    launcherLoading.hidden = true;
    setBusy(false);
    if (selectedDocument.hidden === false && launcherError.hidden) button('start-session').focus();
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
  const location = element('reader-location');
  const pdf = state.position.kind === 'pdf' && !!state.pageCount;
  location.textContent = state.label;
  location.hidden = pdf;
  pdfPageJump.hidden = !pdf;
  if (state.position.kind === 'pdf' && state.pageCount) {
    const page = String(state.position.page);
    const total = String(state.pageCount);
    readerPage.max = total;
    if (document.activeElement !== readerPage) readerPage.value = page;
    readerProgress.max = total;
    readerProgress.disabled = state.pageCount === 1;
    if (!readerProgress.matches(':active')) {
      readerProgress.value = page;
      readerProgress.setAttribute('aria-valuetext', state.label);
    }
    element('reader-page-total').textContent = `/ ${total}`;
  }
  const locationStatus = element('reader-location-status');
  if (locationStatus.textContent !== state.label) locationStatus.textContent = state.label;
  element('break-location').textContent = state.label;
  button('previous-page').disabled = !state.canPrevious;
  button('next-page').disabled = !state.canNext;
  element('zoom-level').textContent = state.position.kind === 'epub'
    ? `${state.position.fontSize}px`
    : `${Math.round(state.position.zoom * 100)}%`;
  if (state.position.kind === 'epub') {
    element<HTMLSelectElement>('line-height').value = String(state.position.lineHeight);
    element<HTMLSelectElement>('reading-width').value = String(state.position.width);
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
    if (announcement) announcement.textContent = 'Study time is up.';
  } else if (remaining === undefined && announcement) {
    announcement.textContent = '';
  }
}

async function startSession(position?: ReadingPosition): Promise<void> {
  if (screen !== 'launcher' || busy || !selection) return;
  setBusy(true);
  showError(readerError);
  const entry = selection.document;
  try {
    element('reader-title').textContent = entry.title;
    element('break-title').textContent = entry.title;
    pdfPageJump.hidden = true;
    element('reader-location').hidden = false;
    element('reader-location').textContent = '';
    element('reader-location-status').textContent = '';
    element('pdf-search-form').hidden = entry.kind !== 'pdf';
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
    element<HTMLInputElement>('pdf-search').value = '';
    showError(element('search-result'));
    reading = undefined;
    setScreen('reader');
    await setFullscreen(true);
    const bytes = selection.bytes ?? await readDocument(entry.path);
    reader = await openReader(viewport, entry.kind, bytes, position ?? entry.position, updateReading, undefined, settings.pdfContinuous);
    selection.bytes = undefined;
    const minutes = Number(timerSelect.value);
    timer = minutes > 0 ? new StudyTimer(minutes) : undefined;
    announced = false;
    timer?.resume(performance.now());
    updateClock();
    persist();
    viewport.focus();
  } catch (error) {
    console.error(error);
    reader?.destroy();
    reader = undefined;
    viewport.replaceChildren();
    await setFullscreen(false).catch(console.error);
    setScreen('launcher');
    showError(launcherError, 'The reader could not start. Try another file or reopen this one.');
  } finally {
    setBusy(false);
  }
}

async function takeBreak(): Promise<void> {
  if (screen !== 'reader' || busy || readerBusy) return;
  setBusy(true);
  showError(breakError);
  timer?.pause(performance.now());
  persist();
  try {
    await setFullscreen(false);
    setScreen('break');
    updateClock();
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
  setBusy(true);
  showError(breakError);
  try {
    await setFullscreen(true);
    setScreen('reader');
    await reader?.setPdfContinuous?.(settings.pdfContinuous);
    timer?.resume(performance.now());
    updateClock();
    viewport.focus();
    return true;
  } catch (error) {
    console.error(error);
    await setFullscreen(false).catch(console.error);
    setScreen('break');
    showError(breakError, 'Could not enter fullscreen. Try resuming again.');
    return false;
  } finally {
    setBusy(false);
  }
}

async function endSession(): Promise<void> {
  if ((screen !== 'reader' && screen !== 'break') || busy || readerBusy) return;
  setBusy(true);
  try {
    if (screen === 'reader') await setFullscreen(false);
    const saved = persist();
    reader?.destroy();
    reader = undefined;
    reading = undefined;
    timer = undefined;
    viewport.replaceChildren();
    if (selection) {
      element('selected-meta').textContent = selection.document.label ?? kindLabel(selection.document.kind);
      button('launcher-review-notes').hidden = selection.document.notes.length === 0;
    }
    timerSelect.value = String(settings.defaultMinutes);
    renderLibrary();
    setScreen('launcher');
    updateClock();
    showError(launcherError, saved ? '' : 'OpenStudy could not save your reading progress.');
  } catch (error) {
    console.error(error);
    showError(screen === 'break' ? breakError : readerError, 'Could not end this session. You can still close OpenStudy.');
  } finally {
    setBusy(false);
    if (!screens.launcher.hidden) button('choose-file').focus();
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
  }
}

function showNotes(): void {
  if (!selection || busy || readerBusy) return;
  const list = element('notes-list');
  const notes = selection.document.notes;
  list.replaceChildren();
  element('notes-empty').hidden = notes.length > 0;
  for (const note of notes) {
    const row = document.createElement('li');
    const text = document.createElement('p');
    text.textContent = note.text;
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'quiet-button';
    jump.textContent = screen === 'launcher' ? `Study from ${note.label}` : `Go to ${note.label}`;
    jump.addEventListener('click', async () => {
      notesDialog.close();
      if (screen === 'launcher') {
        await startSession(note.position);
        return;
      }
      if (screen === 'break' && !await resumeSession()) return;
      await readerAction((active) => active.goTo(note.position));
      viewport.focus();
    });
    row.append(text, jump);
    list.append(row);
  }
  notesDialog.showModal();
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
    if (next.defaultMinutes !== settings.defaultMinutes) timerSelect.value = String(next.defaultMinutes);
    settings = next;
    applySidebarLayout();
    applyAppearance();
    continuousPdf.checked = settings.pdfContinuous;
    readerContinuousPdf.checked = settings.pdfContinuous;
    updateClock();
    return true;
  } catch (error) {
    console.error(error);
    defaultMinutes.value = String(settings.defaultMinutes);
    showCountdown.checked = settings.showCountdown;
    themeSelect.value = settings.theme;
    continuousPdf.checked = settings.pdfContinuous;
    readerContinuousPdf.checked = settings.pdfContinuous;
    showError(errorNode, 'OpenStudy could not save your settings. Try again.');
    return false;
  }
}

function applyAppearance(): void {
  const theme = settings.theme;
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#fafafa' : '#0a0a0a');
  void setWindowTheme(theme).catch(console.error);
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

function applySidebarLayout(): void {
  const collapsed = settings.sidebarCollapsed;
  if (workspace) workspace.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', label);
  sidebarToggle.title = label;
  element('sidebar-collapse-icon').hidden = collapsed;
  element('sidebar-expand-icon').hidden = !collapsed;
}

function returnFromSettings(): void {
  if (screen !== 'settings' || busy) return;
  setScreen(settingsReturn);
  button('open-settings').focus();
}

for (const picker of pickerButtons) {
  picker.addEventListener('click', () => void selectDocument(
    pickDocument,
    'OpenStudy could not open that file. Choose a readable PDF, EPUB, or Markdown file.',
  ));
}
button('start-session').addEventListener('click', () => void startSession());
button('resume-session').addEventListener('click', () => void resumeSession());
button('take-break').addEventListener('click', () => void takeBreak());
button('end-session').addEventListener('click', () => void endSession());
button('end-from-break').addEventListener('click', () => void endSession());
button('previous-page').addEventListener('click', () => void readerAction((active) => active.previous()));
button('next-page').addEventListener('click', () => void readerAction((active) => active.next()));
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
});
readerProgress.addEventListener('change', () => void jumpToPdfPage(readerProgress.valueAsNumber));
button('zoom-in').addEventListener('click', () => void readerAction((active) => active.zoom(1)));
button('zoom-out').addEventListener('click', () => void readerAction((active) => active.zoom(-1)));
button('fit-width').addEventListener('click', () => {
  optionsDialog.close();
  void readerAction((active) => active.fit());
});
button('reader-options').addEventListener('click', () => {
  if (reader && !busy && !readerBusy) optionsDialog.showModal();
});
button('close-options').addEventListener('click', () => optionsDialog.close());
readerContinuousPdf.addEventListener('change', async () => {
  const previous = settings.pdfContinuous;
  const enabled = readerContinuousPdf.checked;
  readerContinuousPdf.disabled = true;
  try {
    await readerAction(async (active) => {
      await active.setPdfContinuous?.(enabled);
      if (!changeSettings({ ...settings, pdfContinuous: enabled }, readerError)) {
        await active.setPdfContinuous?.(previous);
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
element('pdf-search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = element<HTMLInputElement>('pdf-search').value.trim();
  if (!query) return;
  const result = element('search-result');
  showError(result, 'Searching…');
  void readerAction(async (active) => {
    if (!await active.find?.(query)) {
      showError(result, 'No matching text found.');
      return;
    }
    showError(result);
    optionsDialog.close();
    viewport.focus();
  });
});

const noteText = element<HTMLTextAreaElement>('note-text');
button('add-note').addEventListener('click', () => {
  if (!reading || !reader || busy || readerBusy) return;
  noteText.value = '';
  noteDialog.showModal();
  noteText.focus();
});
element('note-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = noteText.value.trim();
  if (!selection || !reading || !text) return;
  selection.document.notes.push({ text, position: { ...reading.position }, label: reading.label });
  persist();
  noteDialog.close();
});
button('cancel-note').addEventListener('click', () => noteDialog.close());
button('review-notes').addEventListener('click', showNotes);
button('launcher-review-notes').addEventListener('click', showNotes);
document.getElementById('break-review-notes')?.addEventListener('click', showNotes);
button('close-notes').addEventListener('click', () => notesDialog.close());

const notificationsDescription = element('notifications-description');
const osSettingsButton = button('open-os-settings');
notificationsDescription.textContent = notificationCopy();
osSettingsButton.hidden = os !== 'windows';
defaultMinutes.value = String(settings.defaultMinutes);
timerSelect.value = String(settings.defaultMinutes);
showCountdown.checked = settings.showCountdown;
themeSelect.value = settings.theme;
continuousPdf.checked = settings.pdfContinuous;
readerContinuousPdf.checked = settings.pdfContinuous;
defaultMinutes.addEventListener('change', () => changeSettings({ ...settings, defaultMinutes: Number(defaultMinutes.value) }));
showCountdown.addEventListener('change', () => changeSettings({ ...settings, showCountdown: showCountdown.checked }));
themeSelect.addEventListener('change', () => changeSettings({
  ...settings,
  theme: themeSelect.value === 'light' ? 'light' : 'dark',
}));
continuousPdf.addEventListener('change', () => changeSettings({ ...settings, pdfContinuous: continuousPdf.checked }));
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
button('nav-library').addEventListener('click', () => {
  if (busy || screen === 'reader') return;
  const target = screen === 'settings' ? settingsReturn : screen;
  setScreen(target);
  element(target === 'break' ? 'resume-session' : 'workspace-title').focus();
});
osSettingsButton.addEventListener('click', async () => {
  showError(settingsError);
  try {
    await openNotificationSettings();
  } catch (error) {
    console.error(error);
    if (screen === 'settings') showError(settingsError, 'Could not open Windows Settings. Open it manually to change notifications.');
  }
});

for (const command of windowCommands) {
  command.addEventListener('click', () => {
    appMenu.close();
    windowMenuToggle.focus();
    button(command.dataset.command!).click();
  });
}

const windowControls = element('window-controls');
if (os !== 'browser') {
  windowControls.hidden = false;
  const maximize = button('window-maximize');
  let resizeFrame = 0;
  async function syncMaximizeButton(): Promise<void> {
    if (screen === 'reader') return;
    const maximized = await isWindowMaximized();
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
    await toggleMaximizeWindow();
    await syncMaximizeButton();
  };
  element('window-bar').addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !(event.target instanceof Element)
      || event.target.closest('button, #window-menu') || !event.target.closest('[data-window-drag]')) return;
    runWindow(event.detail === 2 ? maximizeOrRestore : startDragging);
  });
  button('window-minimize').addEventListener('click', () => runWindow(minimizeWindow));
  maximize.addEventListener('click', () => runWindow(maximizeOrRestore));
  button('window-close').addEventListener('click', () => {
    persist();
    runWindow(closeWindow);
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
  const field = target?.closest<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type="search"], input[type="text"]');
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
    ? ['previous-page', 'next-page', 'reader-options', 'add-note', 'review-notes', 'take-break']
    : screen === 'break' ? ['resume-session', 'break-review-notes', 'end-from-break']
    : ['choose-file', 'nav-library', 'open-settings'];
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
  if (event.key === 'Escape') {
    for (const [menu, toggle] of [[appMenu, windowMenuToggle], [sessionMenu, sessionToggle], [readerToolbar, toolbarToggle]] as const) {
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
  if (event.key.toLowerCase() === 'o' && (event.ctrlKey || event.metaKey) && screen === 'launcher') {
    event.preventDefault();
    button('choose-file').click();
  }
});
window.addEventListener('pagehide', persist);
if (os === 'browser') {
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) void takeBreak();
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist();
});
setInterval(updateClock, 250);

applySidebarLayout();
applyAppearance();
setScreen('launcher');
try {
  library = loadLibrary();
  renderLibrary();
} catch (error) {
  console.error(error);
  canSave = false;
  showError(launcherError, 'OpenStudy could not load your reading history.');
}
setBusy(false);
