# OpenStudy

OpenStudy is a desktop reading space for PDFs and EPUBs. Choose a file, start a fullscreen session, and return to the same spot after a break or the next time you open the app.

- **Continue reading** restores the page and zoom in a PDF or the passage and reading layout in an EPUB.
- **Take a break** (or press **Esc**) leaves fullscreen and pauses the optional session timer. Resume when you’re ready.
- **Look up later** saves a note with a link to the current reading position.
- Books, progress, and notes stay on your device.

## Downloads

Open the latest successful [Build run](https://github.com/M0-kii/OpenStudy/actions/workflows/build.yml) and download the artifact for your system. The build produces a Windows x64 installer, a macOS Apple Silicon disk image, and a Linux x64 Debian package.

## Notification settings

Open **Notification settings** in the launcher for setup instructions. On Windows 11 and KDE Plasma, enable your desktop’s fullscreen Do Not Disturb rule. On macOS, you can add OpenStudy to a Focus schedule. That schedule follows the active app and can stay on during a windowed break. On GNOME, use the Do Not Disturb switch in the notification list.

## Build from source

Install Node.js 22.13 or newer, pnpm, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
pnpm install --ignore-workspace --frozen-lockfile
pnpm tauri dev
pnpm test
pnpm tauri build
```

`pnpm dev` runs the reader interface in a browser for development. Use the Tauri app to test native window and notification behavior.
