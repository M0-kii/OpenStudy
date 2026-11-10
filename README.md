# OpenStudy

OpenStudy is a desktop reading space for PDFs, EPUBs, and Markdown files. Open a file or paste a direct PDF link, then start a fullscreen session.

- **Continue reading** returns to your last page, passage, or scroll position in one click. **Recent files** keeps a separate history for each document. Use **Locate file** if a document has moved.
- Move the pointer to the top edge to reveal the reading toolbar. Pin **Contents** beside the document or use **Ctrl+F** (**⌘F** on Mac) to find text and move between matches.
- PDFs start at **Fit page** in paged mode and **Fit width** in continuous mode. Open **Reading options** to change the fit, or use **+** and **−** to set your own zoom. Each PDF remembers its layout.
- Open **Session controls** at the bottom right to take a break or end the session. **Esc** leaves reading mode and pauses the optional timer when menus are closed.
- **Look up later** saves a note with a link to the current reading position.
- Progress, notes, and PDF links stay on your device. PDFs opened from links need a connection when reopened.

## Downloads

Download the installer for your system from [GitHub Releases](https://github.com/M0-kii/OpenStudy/releases/latest). Releases include a Windows x64 installer, a macOS Apple Silicon disk image, and a Linux x64 Debian package.

## Notification settings

Open **Settings** from the sidebar. Choose a light or dark theme under **Appearance**. Under **Study sessions**, set a default session length, show or hide the countdown, or stack PDF pages for continuous scrolling.

On Windows 11 and KDE Plasma, enable your desktop’s fullscreen Do Not Disturb rule. On macOS, add OpenStudy to a Focus schedule. That schedule follows the active app and can stay on during a windowed break. On GNOME, use the Do Not Disturb switch in the notification list.

On Windows, you can turn on **Block Alt+Tab while reading** under **Study sessions**. Press **Esc** to take a break and switch apps again.

On laptops, OpenStudy can show a quiet alert at 20% and 10% while the battery is discharging. You can turn these alerts off under **Notifications**.

## Build from source

Install Node.js 22.13 or newer, pnpm, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
pnpm install --ignore-workspace --frozen-lockfile
pnpm tauri dev
pnpm test
pnpm tauri build
```

`pnpm dev` runs the reader interface in a browser for development. Use the Tauri app to test native window and notification behavior.

## Publish a release

Bump the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the OpenStudy entry in `src-tauri/Cargo.lock` for each release. Use a patch bump for fixes and small improvements. Run `pnpm test`, commit the update, and push an annotated tag that matches the version, such as `v0.1.2`. Write the release notes in the tag annotation. The desktop build publishes a GitHub Release after all three installers pass.

To rebuild a release from an existing tag, run **Desktop builds** manually from `main` and enter the tag in the **release_tag** input.
