import './style.css';
import { openNotificationSettings, pickDocument, platform, readDocument, setFullscreen } from './desktop';
import { loadLibrary, saveLibrary, type SavedDocument } from './library';
import { openReader, previewDocument, type Reader, type ReaderState, type ReadingPosition } from './readers';
import { loadSettings, saveSettings, type StudySettings } from './settings';
import { clockLabel, StudyTimer } from './timer';

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
const timerSelect = element<HTMLSelectElement>('session-minutes');
const defaultMinutes = element<HTMLSelectElement>('default-minutes');
const showCountdown = element<HTMLInputElement>('show-countdown');
const recentList = element('recent-list');
const pickerButtons = ['choose-file', 'choose-file-inline', 'choose-another'].map(button);
const selectedDocument = element('selected-document');
const preview = element('document-preview');
const noteDialog = element<HTMLDialogElement>('note-dialog');
const notesDialog = element<HTMLDialogElement>('notes-dialog');
const optionsDialog = element<HTMLDialogElement>('options-dialog');
const os = platform();

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
let saveDelay: ReturnType<typeof setTimeout> | undefined;
let announced = false;
let canSave = true;

function showError(node: HTMLElement, message = ''): void {
  node.textContent = message;
  node.hidden = !message;
}

function setScreen(next: Screen): void {
  if (next !== screen) {
    for (const error of [launcherError, readerError, breakError, settingsError]) showError(error);
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
    const title = document.createElement('span');
    title.className = 'recent-title';
    title.textContent = entry.title;
    const detail = document.createElement('span');
    detail.className = 'recent-meta';
    detail.textContent = entry.label ?? entry.kind.toUpperCase();
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
  try {
    const file = await pick();
    if (!file) return;
    launcherLoading.hidden = false;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension !== 'pdf' && extension !== 'epub') {
      showError(launcherError, 'Choose a PDF or EPUB file.');
      return;
    }
    const cover = await previewDocument(extension, file.bytes);
    const existing = library.find((entry) => entry.path === file.path);
    const saved = existing ?? {
      path: file.path,
      name: file.name,
      title: cover.title || file.name.replace(/\.[^.]+$/, ''),
      kind: extension,
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
      : size ? 'Choose a document smaller than 256 MB.' : failure);
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
  element('reader-location').textContent = state.label;
  element('break-location').textContent = state.label;
  button('previous-page').disabled = !state.canPrevious;
  button('next-page').disabled = !state.canNext;
  element('zoom-level').textContent = state.position.kind === 'pdf'
    ? `${Math.round(state.position.zoom * 100)}%`
    : `${state.position.fontSize}px`;
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
    element('pdf-search-form').hidden = entry.kind !== 'pdf';
    element('epub-options').hidden = entry.kind !== 'epub';
    button('fit-width').hidden = entry.kind !== 'pdf';
    element<HTMLInputElement>('pdf-search').value = '';
    showError(element('search-result'));
    reading = undefined;
    setScreen('reader');
    await setFullscreen(true);
    const bytes = selection.bytes ?? await readDocument(entry.path);
    reader = await openReader(viewport, entry.kind, bytes, position ?? entry.position, updateReading);
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
    timer?.resume(performance.now());
    updateClock();
    viewport.focus();
    return true;
  } catch (error) {
    console.error(error);
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
      element('selected-meta').textContent = selection.document.label ?? selection.document.kind.toUpperCase();
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
  showError(readerError);
  try {
    await action(reader);
  } catch (error) {
    console.error(error);
    showError(readerError, 'Could not complete that reading action. Try again.');
  } finally {
    readerBusy = false;
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

function changeSettings(next: StudySettings): void {
  showError(settingsError);
  try {
    saveSettings(next);
    if (next.defaultMinutes !== settings.defaultMinutes) timerSelect.value = String(next.defaultMinutes);
    settings = next;
    updateClock();
  } catch (error) {
    console.error(error);
    defaultMinutes.value = String(settings.defaultMinutes);
    showCountdown.checked = settings.showCountdown;
    showError(settingsError, 'OpenStudy could not save your settings. Try again.');
  }
}

function returnFromSettings(): void {
  if (screen !== 'settings' || busy) return;
  setScreen(settingsReturn);
  button('open-settings').focus();
}

for (const picker of pickerButtons) {
  picker.addEventListener('click', () => void selectDocument(
    pickDocument,
    'OpenStudy could not open that file. Choose a readable PDF or EPUB.',
  ));
}
button('start-session').addEventListener('click', () => void startSession());
button('resume-session').addEventListener('click', () => void resumeSession());
button('take-break').addEventListener('click', () => void takeBreak());
button('end-session').addEventListener('click', () => void endSession());
button('end-from-break').addEventListener('click', () => void endSession());
button('previous-page').addEventListener('click', () => void readerAction((active) => active.previous()));
button('next-page').addEventListener('click', () => void readerAction((active) => active.next()));
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
defaultMinutes.addEventListener('change', () => changeSettings({ ...settings, defaultMinutes: Number(defaultMinutes.value) }));
showCountdown.addEventListener('change', () => changeSettings({ ...settings, showCountdown: showCountdown.checked }));
button('open-settings').addEventListener('click', () => {
  if (busy || (screen !== 'launcher' && screen !== 'break')) return;
  settingsReturn = screen;
  setScreen('settings');
  element('settings-heading').focus();
});
button('close-settings').addEventListener('click', returnFromSettings);
button('nav-library').addEventListener('click', () => {
  if (busy || screen !== 'settings') return;
  setScreen(settingsReturn);
  element(settingsReturn === 'break' ? 'resume-session' : 'workspace-title').focus();
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

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape' && screen === 'reader') {
    event.preventDefault();
    void takeBreak();
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
