# Joplin Minimap

A hover-to-expand table of contents minimap for the [Joplin](https://joplinapp.org/) note viewer — heading tick marks on the right edge that expand into a clickable outline.

[中文说明](README-CN.md) | [日本語](README-JA.md)

## Features

- **Tick Bar Minimap** — Each heading is shown as a small horizontal bar on the right edge of the note viewer; bar length reflects the heading level (H1 longest)
- **Desktop and Mobile** — Hover on desktop, tap on touch devices: the collapsed strip is a single tap target, rows and buttons grow to finger size when open, and tapping outside or picking a heading closes it again
- **Hover to Expand** — Move the mouse over the bars and they expand into a full table of contents overlay, indented by level, with long titles ellipsized
- **Depth Stepper** — `+` / `-` buttons at the top of the expanded panel raise or lower how deep the outline goes, so a long nested note collapses to its top-level structure in one click
- **Heading Tiers** — Top-level headings render larger and heavier than nested ones, so the shape of the document is readable at a glance
- **Click to Jump** — Click any entry to smooth-scroll to that heading
- **Reading Position** — The section currently in view is highlighted automatically
- **Live Rebuild** — Rebuilds itself when you switch notes or edit content (listens to `joplin-noteDidUpdate` with a MutationObserver fallback)
- **RTL Aware** — Headings in right-to-left scripts (Persian, Arabic, Hebrew) are right-aligned in the expanded panel and indent inward from the right; direction is detected per heading, so mixed notes stay readable
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

Configurable in **Tools → Options → Joplin Minimap**:

- **Minimum headings** — hide the minimap when the note has fewer headings than this (default 2)
- **Expanded panel width (px)** — maximum width of the hover-expanded table of contents (default 240)
- **Minimap side** — which edge of the viewer the minimap docks to, right or left (default right)
- **Default depth** — deepest heading level shown when a note opens; the `+`/`-` buttons change it on the fly (default 6, every level)
- **Edge distance (px)** — gap between the minimap and the viewer edge it sits on (default 6)
- **Text size (%)** — scales the text in the expanded panel; raise it on high-DPI screens (default 100, under *Advanced*)
- **High contrast panel** — brighter text and a more solid panel background, using no fixed colours so it still follows your theme (default off, under *Advanced*)

Changed settings apply on the next render (switch notes or edit the note).

### Styling it yourself

Every colour and size the panel uses reads from a CSS variable, so you can restyle it from `userstyle.css` in your Joplin profile directory (it applies to the rendered note viewer, which is where the minimap lives). Set them on `:root` — no `!important` needed:

```css
:root {
  --jp-mm-font:  15px;                      /* base text size            */
  --jp-mm-color: #e8e8e8;                   /* outline text              */
  --jp-mm-bg:    rgba(30, 30, 30, 0.92);    /* expanded panel background */
  --jp-mm-dim:   0.85;                      /* opacity of inactive rows  */
  --jp-mm-dot:   #cd6155;                   /* open-to-do dot            */
  --jp-mm-width: 320px;                     /* expanded panel max width  */
}
```

Joplin creates and opens the file for you: **Tools → Options → Appearance → Show Advanced Settings → Custom stylesheet for rendered Markdown**. It is `userstyle.css` in your profile directory (`%USERPROFILE%\.config\joplin-desktop\` on Windows, `~/.config/joplin-desktop/` elsewhere) if you would rather edit it directly. Restart Joplin afterwards.

Try **High contrast panel** first — it fixes most legibility complaints without picking any colours, so it keeps working when you switch themes.


## Development

Zero dependencies — no `npm install` needed:

```bash
npm run dist
```

This builds `dist/` (loadable via Joplin's **Development plugins** setting pointed at the project root) and `publish/` including `publish/plugin.jpl`.

## License

MIT
