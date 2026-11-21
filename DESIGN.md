# OpenStudy design system

The UI is built from a token layer and the app's existing CSS classes. Tokens live in `src/design-system.css`; the React catalog in `src/design-system/` reuses the same classes. The app itself still uses imperative TypeScript for the reader, which owns its own DOM.

## Layers

- `src/design-system.css` — tokens, base element styles, and the `.surface` / `.surface-popup` recipes. Imported first in `src/main.ts`.
- `src/style.css` and `src/bars.css` — app components built from those tokens.
- `src/design-system/catalog.tsx` — the React catalog and its primitives (`Button`, `IconButton`, `Surface`, `Chip`, `SettingRow`, `Tabs`, `TextField`). The primitives are private to the catalog; there is no second set.
- `design-system.html` — live catalog. Run `pnpm dev` and open `/design-system.html`.

## Tokens

| Group | Examples | Rule |
| --- | --- | --- |
| Color | `--plane`, `--panel`, `--control`, `--text`, `--muted`, `--accent` | Use semantic tokens, never raw hex in components. Neutrals are warm; the single ochre accent drives primary buttons, active states, form controls and selection. Light theme overrides them on `html[data-theme='light']`. |
| Type | `--text-xs` … `--text-2xl`, `--weight-medium`, `--tracking-tight` | Headings use `text-wrap: balance`; paragraphs use `text-wrap: pretty`. |
| Space | `--space-1` … `--space-7` (4–48px) | Use for gaps and padding. Layout-specific values such as `--workspace-padding` stay separate. |
| Radius | `--radius-sm` … `--radius-xl` | Surfaces use `--panel-radius` / `--popup-radius`. `corner-shape: squircle` is applied as a progressive enhancement. |
| Elevation | `--panel-shadow`, `--popup-shadow`, `--shadow-color` | Shadows are layered and tinted with `color-mix(in oklab, …)` so they match the active theme. |
| Motion | `--duration-fast`, `--duration-normal`, `--ease-out` | All transitions are wrapped in `prefers-reduced-motion: no-preference`. |
| Layers | `--z-raised` … `--z-skip` | z-index values come from the scale instead of literals. |

## Two-plane layout

`--plane` is the background the sidebar sits on. `--panel` is the foreground content surface, inset by `--plane-gap` and rounded with `--panel-radius`. Fullscreen reading removes the frame: `.workspace-shell:has(.reader:not([hidden]))` resets padding, gap, radius and shadow.

## Adding to the catalog

The primitives in `catalog.tsx` emit the same classes the desktop UI uses (`.button`, `.icon-button`, `.setting-row`, `.settings-tab`). Compose those classes instead of introducing a second set. The catalog is their only consumer; if the app ever renders through React, lift them into a shared module first.
