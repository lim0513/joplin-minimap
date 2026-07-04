# Joplin Minimap

A hover-to-expand table of contents minimap for the [Joplin](https://joplinapp.org/) note viewer — heading tick marks on the right edge that expand into a clickable outline.

[中文说明](README-CN.md) | [日本語](README-JA.md)

## Features

- **Tick Bar Minimap** — Each heading is shown as a small horizontal bar on the right edge of the note viewer; bar length reflects the heading level (H1 longest)
- **Hover to Expand** — Move the mouse over the bars and they expand into a full table of contents overlay, indented by level, with long titles ellipsized
- **Click to Jump** — Click any entry to smooth-scroll to that heading
- **Reading Position** — The section currently in view is highlighted automatically
- **Live Rebuild** — Rebuilds itself when you switch notes or edit content (listens to `joplin-noteDidUpdate` with a MutationObserver fallback)
- **Theme Aware** — Follows light and dark themes automatically (colors derive from `currentColor`)
- **Unobtrusive** — Hidden for notes with fewer than 2 headings, hidden when printing/exporting, never steals focus or keyboard input

## Install

### From the Joplin plugin repository (once published)

1. In Joplin, go to **Tools → Options → Plugins**
2. Search for **Joplin Minimap**
3. Install and restart Joplin

### From file

1. Download `plugin.jpl` from the [latest release](https://github.com/lim0513/joplin-minimap/releases/latest)
2. In Joplin, go to **Tools → Options → Plugins**
3. Click the gear icon and select **Install from file**
4. Choose the downloaded `.jpl` file
5. Restart Joplin

## Usage

Open any note with 2 or more headings in the **rendered Markdown viewer** (reading view, or the preview side of the split editor):

- A column of tick bars appears at the right edge
- **Hover** over it to expand the full table of contents
- **Click** an entry to jump to that heading

Note: the minimap only appears in the rendered viewer, not in the plain Markdown editor or the Rich Text editor.

## How It Works

A markdown-it content script injects two assets into the rendered viewer: `minimap-view.js` builds the minimap dynamically from the rendered `h1`–`h6` elements after each render, and `minimap.css` handles the collapsed/expanded styling. The Markdown rendering itself is untouched.

## Settings

Configurable in **Tools → Options → Minimap**:

- **Minimum headings** — hide the minimap when the note has fewer headings than this (default 2)
- **Expanded panel width (px)** — maximum width of the hover-expanded table of contents (default 240)
- **Distance from right edge (px)** — gap between the minimap and the viewer's right edge (default 6)

Changed settings apply on the next render (switch notes or edit the note).

## Development

Zero dependencies — no `npm install` needed:

```bash
npm run dist
```

This builds `dist/` (loadable via Joplin's **Development plugins** setting pointed at the project root) and `publish/` including `publish/plugin.jpl`.

## License

MIT
