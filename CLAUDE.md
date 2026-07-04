# Joplin Minimap — Project Notes

Things that aren't obvious from the code or the Joplin docs. If you're about to release, start with **Release pipeline**.

---

## Release pipeline (CRITICAL)

`publish/plugin.jpl` is a **gzipped tar archive** containing its own copy of `manifest.json`. Joplin uses the **outer** manifest (or the npm registry metadata) to decide whether an update is available, but reads the version actually installed from the **inner** manifest inside the `.jpl`.

If these disagree, Joplin gets stuck in an update loop: it sees a newer outer version, downloads and installs the `.jpl`, the inner manifest still reports the old version, on next restart Joplin prompts again — forever. (This actually happened to the sibling project joplin-explorer between v1.2.0 and v1.2.3.)

**Before every release:**

1. Bump version in BOTH `src/manifest.json` AND `package.json`.
2. Run `npm run dist` — this MUST regenerate `publish/plugin.jpl` so the inner manifest matches.
3. Verify the inner manifest:
   ```
   tar -xzf publish/plugin.jpl -C /tmp/check && cat /tmp/check/manifest.json
   ```
   Inner version MUST equal `src/manifest.json`'s version.
4. Only then `npm publish` and upload `publish/plugin.jpl` to the GitHub release.

`publish/` and `dist/` are NOT tracked in git. `scripts/pack-jpl.js` (copied from joplin-explorer) is the only thing that rebuilds the `.jpl`. Do not hand-edit the `.jpl`.

### npm publishing

- The `joplin-plugin` keyword in `package.json` is REQUIRED for the official Joplin plugin repository to pick the package up.
- npm Granular Access Tokens default to **7-day expiration**.
- For security-key users, the token MUST have **"Bypass 2FA when publishing"** checked, otherwise `npm publish` fails with `EOTP`.
- `npm unpublish` is only allowed within 24h. After that, bump and move on.

---

## Architecture

Zero dependencies. No webpack, no TypeScript, no `npm install`.

```
src/
  index.js                 plugin entry (Node context) - registers the content script
  minimapContentScript.js  markdown-it content script - a no-op plugin that only declares assets
  minimap-view.js          runs INSIDE the rendered viewer - builds the minimap from the DOM
  minimap.css              collapsed tick bars / hover-expanded panel styling
build.js                   copies src/ -> dist/ AND src/ -> publish/
scripts/pack-jpl.js        gzip-tars publish/ -> publish/plugin.jpl
```

- `build.js` outputs BOTH `dist/` (for Joplin's **Development plugins** setting, pointed at the project root) and `publish/` (what ships to npm; `files: ["publish"]`).
- The markdown rendering itself is untouched — `minimapContentScript.js`'s `plugin` function is intentionally empty; it exists only to inject the two assets.

## Runtime contexts

- `src/index.js` runs in Joplin's plugin host (Node). `joplin` is injected as a global — do not import it.
- `minimap-view.js` + `minimap.css` are content-script **assets**: they run inside the rendered-note webview. Plain browser JS only, no imports, no `webviewApi`.

## Hard-earned lessons (do not regress)

1. **Assets do NOT re-execute on note switch.** Joplin swaps the rendered DOM but only re-runs asset scripts on a full webview reload (e.g. toggling the editor mode). Symptom: minimap vanishes when switching notes, reappears after toggling the editor. Fix: install ONE persistent watcher (`window.__jpMinimapInstalled` guard) that listens to the `joplin-noteDidUpdate` DOM event, with a `MutationObserver` on `document.body` as fallback, and rebuilds (150ms debounce).
2. **The rebuild must not trigger itself.** The MutationObserver sees the minimap's own DOM insertion/removal. `isOwnMutation()` filters mutations whose target/added/removed nodes are inside `#jp-minimap` — removing it causes an infinite rebuild loop.
3. **The viewer DOM can be editable in some contexts.** Symptom: text caret visible in the expanded panel, keyboard input lands in it. Defenses (all needed): `contenteditable="false"` on the nav, `preventDefault()` on `mousedown` (stops caret placement/focus), CSS `user-select: none` + `caret-color: transparent`, `tabIndex = -1` on items.
4. **Scroll listeners accumulate across rebuilds.** Each `build()` registers a scroll handler for active-section highlighting; the previous one must be removed first (the `cleanup` closure). The listener uses `capture: true` because it's unknown which container actually scrolls.
5. **Never use `<a>` elements inside the rendered viewer.** Joplin shows a "Ctrl+click to open" (按住Ctrl打开) tooltip on anchors and routes them through its external-link handling. Minimap items are `<div>`s with click handlers.
6. **Windows + mounted-folder tooling:** writing these files through certain file-sync layers has truncated them mid-write before. After bulk edits, sanity-check with `node --check src/*.js build.js scripts/pack-jpl.js`.

## Settings plumbing

Settings are registered in `src/index.js` (`joplin.settings.registerSection/registerSettings`, `SettingItemType.Int = 1` as a raw number — no `api` import in plain JS). The viewer asset cannot call `joplin.settings` directly; it fetches values with `webviewApi.postMessage('joplin-minimap', 'getSettings')`, answered by `joplin.contentScripts.onMessage` in the entry. `webviewApi` is NOT always defined in the rendered webview (print/export) — always guard and fall back to defaults. Settings are re-fetched before every rebuild, so changes apply on the next render, not instantly.

## Behavior contract

- Minimap only appears in the rendered Markdown viewer (reading view / split-editor preview). Not in the Markdown editor, not in the Rich Text editor.
- Hidden when the note has fewer than `MIN_HEADINGS` (2) headings.
- Hidden in print/export (`@media print`).
- Theme-agnostic styling: colors derive from `currentColor` and rgba grays only — never hardcode theme colors.
