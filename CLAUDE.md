# Joplin Minimap — Project Notes

Things that aren't obvious from the code or the Joplin docs. If you're about to release, start with **Release pipeline**.

---

## Release pipeline (CRITICAL)

`publish/plugin.jpl` is a **plain, UNCOMPRESSED tar archive** containing its own copy of `manifest.json`.

**Never gzip the .jpl.** Joplin's own generator builds it with `tar.create` and no gzip option, and the mobile and web apps read it with a library that does not sniff for compression. A gzipped `.jpl` installs fine on desktop (whose reader happens to auto-detect gzip) and then fails everywhere else with `Invalid tar header. Maybe the tar is corrupted or it needs to be gunzipped?`. `pack-jpl.js` gzipped it from the very first release; nobody noticed through v1.2.0 because the plugin was desktop-only, and it surfaced the first time a build was installed on the web app.

Joplin uses the **outer** manifest (or the npm registry metadata) to decide whether an update is available, but reads the version actually installed from the **inner** manifest inside the `.jpl`.

If these disagree, Joplin gets stuck in an update loop: it sees a newer outer version, downloads and installs the `.jpl`, the inner manifest still reports the old version, on next restart Joplin prompts again — forever. (This actually happened to the sibling project joplin-explorer between v1.2.0 and v1.2.3.)

**Before every release:**

1. Bump version in BOTH `src/manifest.json` AND `package.json`.
2. Run `npm run dist` — this MUST regenerate `publish/plugin.jpl` so the inner manifest matches.
3. Verify the inner manifest:
   ```
   tar -xf publish/plugin.jpl -C /tmp/check && cat /tmp/check/manifest.json
   ```
   Inner version MUST equal `src/manifest.json`'s version.
4. Only then `npm publish` and upload `publish/plugin.jpl` to the GitHub release.

`publish/` and `dist/` are NOT tracked in git. `scripts/pack-jpl.js` (copied from joplin-explorer) is the only thing that rebuilds the `.jpl`. Do not hand-edit the `.jpl`.

### npm publishing

- The `joplin-plugin` keyword in `package.json` is REQUIRED for the official Joplin plugin repository to pick the package up.
- npm Granular Access Tokens default to **7-day expiration**.
- For security-key users, the token MUST have **"Bypass 2FA when publishing"** checked, otherwise `npm publish` fails with `EOTP`.
- `npm unpublish` is only allowed within 24h. After that, bump and move on.
- **npm STAGES a publish before it lands, and the CLI lies about it.** The first `npm publish` uploads the tarball into a staging queue for malware scanning; the version is NOT live yet. Publishing again while the scan runs fails with `E409 Cannot publish over previously staged version`. Nothing is broken and nothing needs clearing - wait a few minutes and publish again. Do NOT bump the version to escape it and do NOT go hunting for a way to discard the stage: `npm stage list` reports "No staged versions" the whole time, because a package still being scanned is invisible to it.
- **Never filter the output of `npm publish`.** It prints `+ package@version` BEFORE the upload is accepted, so grepping for that line reports success on a failed publish. Read the whole output, and confirm against the registry itself:

  ```
  curl -s https://registry.npmjs.org/<pkg> | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j['dist-tags'].latest)})"
  ```

  `npm view <pkg> version` is cached and can report the OLD version for a while after a successful publish, so disagreement between the two means "check again", not "it failed".
- `npm stage` (list / approve / reject) needs a newer CLI than 11.11. Run it with `npx npm@latest stage ...` rather than upgrading npm globally.

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
scripts/pack-jpl.js        tars (UNCOMPRESSED) publish/ -> publish/plugin.jpl
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
6. **The viewer's overlay scrollbar eats clicks.** On Windows 11 (and other overlay-scrollbar environments) the note viewer's scrollbar reserves no layout space but hit-tests ABOVE page content — z-index cannot beat it. Symptom: clicking the rightmost strip of the expanded panel does nothing. Fix: `scrollbarGap()` shifts the whole nav left of the scrollbar zone (measured width, or 14px fallback for overlay scrollbars). Apply the shift in both collapsed and expanded states — shifting only on hover moves the panel out from under the cursor and causes a hover/unhover flicker loop.
7. **Never fight the browser over focus.** Do NOT preventDefault on mousedown (it blocks the mouse-focus path, so Joplin's later programmatic focus registers as keyboard-like and draws a :focus-visible ring on the scroll container), and do NOT blur() elements from a focusin interceptor (Joplin re-focuses, producing a blur/focus flicker war). Natural mouse-initiated focus never shows a ring. contenteditable="false" + user-select:none are sufficient against the caret/typing issue.
8. **Jump on MOUSEDOWN, never on click.** The press gives the webview focus, Joplin may re-render the note, and the minimap rebuilds between mousedown and mouseup - the click event then never fires (down/up targets differ). Only mousedown is guaranteed to run before the re-render.
9. **Clicking the minimap can re-render the whole note.** The click gives the webview focus; Joplin may re-render, detaching every heading element captured in the build closure - and `scrollIntoView` on a detached node is a silent NO-OP. Symptoms: first click after focusing elsewhere does nothing and the panel "flashes" (our rebuild). Fix: jumps are index+text-based lookups against the live DOM (`jumpTo`), and a `pendingJump` is re-applied by the next `build()` within 1.2s of the click.
10. **NEVER inject into an editable context (`isEditableContext()` guard).** The Rich Text editor runs the same markdown-it render pipeline including plugin assets. A nav injected there gets captured by the HTML-to-markdown round-trip on save: the heading labels become REAL note content (with escaped dots, e.g. "1\\. xxx"), sync to every device, and look like "an outline appearing below the document". Two releases (v1.1.4, v1.1.5) chased phantom CSS-loss theories before the data-level evidence (outline present in the note BODY via the data API) revealed this. Lesson: when a "rendering" bug survives a rendering fix, check whether it's actually in the data.
11. **Styles are INLINE in minimap-view.js (`MINIMAP_CSS`), injected by `ensureStyle()` on every build AND re-injected by a dedicated `<head>` observer.** Joplin's asset cleanup can strip the style from head AFTER the last body mutation, so a build-time check alone is not enough (v1.1.4 shipped that and the unstyled-outline bug recurred). The head observer re-adds the style the moment it disappears.
    Original rationale: **Styles are inline and injected by the view script itself.** There is deliberately no separate CSS asset: Joplin can re-render the document in ways that drop injected asset stylesheets while the watcher script survives - the rebuilt nav then renders unstyled as flow content BELOW the note (users see a duplicated outline under the document). The nav and its CSS must live and die together.
12. **RTL: direction is per ROW, and only in the expanded panel.** The panel hangs off the right edge, so an RTL heading (Persian/Arabic/Hebrew) must right-align and indent from the right - `build()` resolves each row's direction from its first strong character (the `dir="auto"` algorithm) and sets `dir` on the item; the expanded CSS then flips automatically (`justify-content`, `padding-inline-start`, `text-align: start`, `margin-inline-end` on the to-do dot). But `#jp-minimap` and `.jp-mm-item` are pinned to `direction: ltr` so the COLLAPSED state never flips: `.jp-mm-list { align-items: flex-end }` resolves against the inline axis, so inside an RTL note the tick bars would otherwise unalign from the right edge (measured: 10/14/19/23px ragged instead of a flush 10px), and an RTL row would put its to-do dot to the right of its bar. Only `#jp-minimap:hover .jp-mm-item[dir="rtl"]` restores rtl.
    Per-row (not per-panel) direction is a DELIBERATE choice, not an oversight: in a mixed note the panel visibly splits - RTL rows hug the right edge, LTR rows hug the left, with a gap between them. The alternative (one direction for the whole panel, by majority vote) looks tidier but forces the minority language to align against its own reading direction, which is the bug issue #1 reported in the first place. Weighed with a rendered side-by-side; per-row won.
13. **Docking side is a CLASS on the nav, never a direction flip.** `minimapSide` ('right' default / 'left') sets inline `left`/`right` in `build()` - and ALWAYS clears the opposite offset, because a fixed box with both set stretches between them instead of hugging an edge. The scrollbar gap is added on the right only (the viewer's scrollbar is never on the left). Mirroring the collapsed state is pure flexbox on `#jp-minimap.jp-mm-left`, NOT `direction: rtl` - that would re-break everything lesson 12 pins down. Two rules do it: `align-items/justify-content: flex-start`, plus `order: 1` on the to-do dot so it moves to the far side of the tick bar. That last one is not cosmetic: without it a dotted row pushes its bar 9px inward (4px dot + 5px gap) and the flush bar column goes ragged (measured 10px vs 19px). The expanded panel undoes the reorder (`#jp-minimap.jp-mm-left:hover .jp-mm-dot { order: 0 }`) so the dot still reads as a marker before the title. Expanded geometry is identical on both edges - verified by measurement, all four states (left/right x collapsed/expanded).
14. **The depth stepper hides rows, it does not rebuild them.** `+`/`-` in the panel header only flips `data-depth` on the nav; CSS does the hiding. Rebuilding instead would destroy and recreate the nav element, and the whole expanded panel rides on `:hover` over `#jp-minimap` - a fresh element under a stationary cursor is exactly the case where Chromium's hover recomputation is unreliable, so the panel would blink shut mid-click. Same reason the stepper lives INSIDE the nav: clicking it keeps the pointer on the hover target, so no click-to-pin state has to be invented.
    Three things that are NOT optional around it:
    - **Re-anchor after every step.** The panel is `top: 50%` + `translateY(-50%)`, so hiding rows slides its top edge DOWN and the stepper crawls out from under the cursor - two clicks and the pointer is outside the panel, which collapses it. `setDepth()` measures the header, applies the change, then pins the header back with an inline `top` (cleared on the next `build()`). Verified: header Y stayed at 202.1px across a 219.8px -> 65.1px height change.
    - **Step over levels the note does not have.** `levels` is the distinct levels present, and the stepper walks that array, not 1-6. A note using H2/H3/H5 steps 5 -> 3 -> 2; stepping 1-6 blindly would give clicks that visibly do nothing.
    - **Recompute the to-do dots.** `applyTodoDots()` runs on every depth change, rolling open to-dos up to the nearest VISIBLE ancestor. Computing it once at build time (the first attempt) made the dots vanish as soon as the depth dropped - worse than having no dots, because the panel then looks clean while work is hidden underneath.
15. **Heading tiers key off RANK, not absolute level.** `jp-mm-r0/r1/r2` come from the index of the row's level within `levels`, so a note that starts at H2 still gets a proper top tier instead of rendering uniformly as sub-headings. Size and weight only - issue #2 also asked for an accent colour and that CANNOT be granted: the panel is theme-agnostic by contract (currentColor + neutral rgba), and any fixed colour breaks on some Joplin theme.
16. **The expanded panel is a CLASS, not `:hover` (mobile).** Every expanded-state rule keys off `#jp-minimap.jp-mm-open`, toggled from JS. It cannot be `:hover`: on touch, `:hover` latches after a tap and the panel sticks open with no way to dismiss it. Mouse devices get `mouseenter`/`mouseleave`, which is behaviourally identical to the old `:hover` (mouseenter fires for the subtree, so children do not re-trigger it).
    `isTouch` is `(hover: hover)` NOT matching - a device capability, never a screen width or a user-agent sniff, so a touchscreen laptop with a mouse keeps desktop behaviour. It also gates: the `scrollbarGap()` inset (a phone has no scrollbar zone to dodge, and the 14px unmeasurable-fallback would be pure waste), and closing the panel after a jump (there is no cursor to move away, so the panel would cover the heading the reader just asked for).
    Touch input relies on the browser's own tap-vs-scroll decision rather than duplicating it: a real tap synthesises `mousedown`, a scroll gesture does not, so the existing row handler works untouched. The only custom part is OPENING - collapsed rows are 18x2px, unhittable, so the whole strip is one target. That handler `preventDefault()`s on touchend, which is load-bearing: without it the synthetic mousedown falls through and the tap that opens the panel also jumps to whatever row landed under the finger.
17. **Markdown-it content-script JS assets DO load on mobile/web** - verified in the web app (app.joplincloud.com, which runs the mobile code path) with v1.3.0. This was the open question that decided whether mobile support was possible at all, so do not re-litigate it. The API docs only ever disclaim mobile for `CodeMirrorPlugin`'s `codeMirrorResources`; `MarkdownItPlugin` carries no such caveat, and that matches what the app actually does.
    iOS is a separate matter and NOT a code problem: "To adhere to AppStore guidelines, the iOS app only allows installing recommended plugins." There is no Install-from-file on iOS and no documented way to debug there, so iOS users cannot get this plugin until it is accepted into Joplin's recommended list. Android has full remote WebView debugging via Chrome; the web app is the fastest dev loop and needs no device.
18. **Style knobs are var() FALLBACKS, never declarations (issue #5).** Every colour/size the panel exposes is written as `background: var(--jp-mm-bg, rgba(127, 127, 127, 0.16))` at the point of use. Do NOT declare the defaults on `#jp-minimap` instead: a declaration there out-specifies a user's `:root` rule in userstyle.css, and their override silently does nothing. Same reason `build()` sets `--jp-mm-font` inline ONLY when the scale differs from 100 - an inline custom property beats every stylesheet rule, so writing it unconditionally would make the variable un-overridable without `!important`. Verified: with the defaults in place the panel measures identically to before (bg rgba(127,127,127,0.16), rows 0.5, r0 13.5px, r2 11.5px), and a `:root` block overrides all of it with no `!important`.
    Font sizes are a PERCENTAGE setting, not px: the base is 12.5px and Joplin's Int setting cannot hold that, so 100% maps to exactly the old size and nobody's panel shifts on upgrade. Tier sizes became `em` (1.08 / 0.92 / 0.88) which are exact matches for the old 13.5 / 11.5 / 11px.
19. **"No colours" was narrowed, not reversed.** Issue #2 asked for an accent colour to mark hierarchy and was refused: any fixed hue I pick breaks on some Joplin theme I cannot test. Issue #5 asked for contrast control because the panel is unreadable on certain themes - a different problem, and the user can see their own theme. The answer is a **High contrast mode** built from opacity and neutral rgba only (no hue), plus variables for anyone who wants actual colours. The theme-agnostic contract is intact: nothing ships a fixed colour.
    Note what the real cause was, because a colour picker would not have fixed it: inactive rows sit at `opacity: 0.5`, and the deepest tier multiplies in another 0.8, so its text renders at 0.4. A custom colour at 0.4 opacity is still washed out.
20. **Windows + mounted-folder tooling:** writing these files through certain file-sync layers has truncated them mid-write before. After bulk edits, sanity-check with `node --check src/*.js build.js scripts/pack-jpl.js`.

## Settings plumbing

Settings are registered in `src/index.js` (`joplin.settings.registerSection/registerSettings`, `SettingItemType.Int = 1` as a raw number — no `api` import in plain JS). The viewer asset cannot call `joplin.settings` directly; it fetches values with `webviewApi.postMessage('joplin-minimap', 'getSettings')`, answered by `joplin.contentScripts.onMessage` in the entry. `webviewApi` is NOT always defined in the rendered webview (print/export) — always guard and fall back to defaults. Settings are re-fetched before every rebuild, so changes apply on the next render, not instantly.

## Behavior contract

- Minimap only appears in the rendered Markdown viewer (reading view / split-editor preview). Not in the Markdown editor, not in the Rich Text editor.
- Hidden when the note has fewer than `MIN_HEADINGS` (2) headings.
- Hidden in print/export (`@media print`).
- Theme-agnostic styling: colors derive from `currentColor` and rgba grays only — never hardcode theme colors.

## npm 发布方式迁移备忘（截止 2027-01）

npm 安全策略收紧（github.blog changelog 2026-07-08）：

- 2026-08 起：绕过 2FA 的 token 不能再做账号/包管理操作（本仓库只用它 publish，无影响）
- **2027-01 起：绕过 2FA 的 token 不能再直接 npm publish —— 当前发布流程会失效**
- 届时迁移到 trusted publishing（OIDC）：GitHub Actions 打 tag 触发构建+发布，npm 包与仓库绑定，无需长期 token
- 当前流程：发布时写临时 .npmrc + Automation token（token 位置见 D:\repos\.npm-publish-token.txt，短期有效，过期找用户要新的）
- 另：npm v12 起 install 默认禁用依赖的 postinstall/git/remote —— 升级 npm 后构建异常先查这个（npm approve-scripts）
