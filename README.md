# OpenStudy

OpenStudy is a desktop reading space for PDFs, EPUBs, and Markdown files. Choose a file, start a fullscreen session, and return to the same spot after a break or the next time you open the app.

- **Recent files** restores the page, passage, or scroll position and reading size for each document.
- Move the pointer to the top edge or activate the **Reading toolbar** to reveal reading options. Use the corner arrows or **←** and **→** to navigate.
- Open **Session controls** at the bottom right to take a break or end the session. **Esc** leaves reading mode and pauses the optional timer when menus are closed.
- **Look up later** saves a note with a link to the current reading position.
- Books, progress, and notes stay on your device.

## Downloads

Open the latest successful [Build run](https://github.com/M0-kii/OpenStudy/actions/workflows/build.yml) and download the artifact for your system. The build produces a Windows x64 installer, a macOS Apple Silicon disk image, and a Linux x64 Debian package.

## Notification settings

Open **Settings** from the sidebar to set a default session length, choose whether to show the countdown, and stack PDF pages for continuous scrolling.

On Windows 11 and KDE Plasma, enable your desktop’s fullscreen Do Not Disturb rule. On macOS, add OpenStudy to a Focus schedule. That schedule follows the active app and can stay on during a windowed break. On GNOME, use the Do Not Disturb switch in the notification list.

On Windows, OpenStudy blocks **Alt+Tab** and **Alt+Shift+Tab** while its fullscreen reader has focus. **Esc** still takes a break. macOS and Linux keep their desktop app-switching shortcuts.

## Build from source

Install Node.js 22.13 or newer, pnpm, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
pnpm install --ignore-workspace --frozen-lockfile
pnpm tauri dev
pnpm test
pnpm tauri build
```

`pnpm dev` runs the reader interface in a browser for development. Use the Tauri app to test native window and notification behavior.
