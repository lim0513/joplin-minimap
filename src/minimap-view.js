/* Joplin Minimap - runs inside the rendered note viewer.
 * Collects h1-h6 from the rendered DOM, draws collapsed tick bars on the
 * right edge, expands into a full ToC on hover, and jumps on click.
 * Rebuilds itself whenever the note content changes (note switch, edit).
 */
(function () {
	'use strict';

	// Defaults; overridden from Joplin's plugin settings (Tools > Options > Minimap)
	// when webviewApi is available in this webview.
	var settings = { minHeadings: 2, panelWidth: 240, rightOffset: 6, side: 'right', maxLevel: 6, fontScale: 100, highContrast: false, showTodos: true };

	function loadSettings() {
		if (typeof webviewApi === 'undefined' || !webviewApi.postMessage) {
			return Promise.resolve();
		}
		return webviewApi.postMessage('joplin-minimap', 'getSettings').then(function (s) {
			if (s && typeof s.minHeadings === 'number') settings = s;
		}).catch(function () { /* keep defaults (e.g. print/export context) */ });
	}

	// NEVER run inside an editable context (the Rich Text editor renders
	// notes through the same pipeline and would execute this asset). If the
	// nav lands in the RTE document, Joplin's HTML->markdown round-trip
	// SERIALIZES it into the note body on save - the heading list becomes
	// real note content and syncs to every device. This was the true root
	// cause of the "outline below the document" reports.
	function isEditableContext() {
		var b = document.body;
		if (!b) return false;
		if (b.isContentEditable) return true;
		if (b.id === 'tinymce') return true;
		if (b.classList && b.classList.contains('mce-content-body')) return true;
		return false;
	}
	if (isEditableContext()) return;

	// Only ever install one instance of the watcher per webview session.
	if (window.__jpMinimapInstalled) return;
	window.__jpMinimapInstalled = true;

	var cleanup = null; // removes listeners belonging to the current build

	// The stylesheet is injected BY THIS SCRIPT and re-checked on every build.
	// Rationale: Joplin can re-render the document in ways that drop injected
	// asset stylesheets while this script's watcher survives - the rebuilt nav
	// then renders UNSTYLED as flow content below the note (looks like a
	// duplicated outline under the document). Keeping the CSS inline and
	// re-injecting guarantees the nav and its styling live and die together.
	var MINIMAP_CSS = "/* Joplin Minimap \u2014 collapsed tick bars, hover-expanded ToC panel.\n * Colors use currentColor / rgba so it follows both light and dark themes.\n */\n\n#jp-minimap {\n\tuser-select: none;\n\t-webkit-user-select: none;\n\tcaret-color: transparent;\n\tcursor: default;\n\tposition: fixed;\n\ttop: 50%;\n\tright: 6px;\n\ttransform: translateY(-50%);\n\tz-index: 9999;\n\tfont-size: var(--jp-mm-font, 12.5px);\n\tline-height: 1.35;\n\tcolor: var(--jp-mm-color, inherit);\n\t/* Collapsed geometry is direction-independent: the tick bars always\n\t * hug the docked edge, whichever side that is, even in an RTL note. Per-item direction applies\n\t * to the expanded panel only (see the dir=rtl rule below). */\n\tdirection: ltr;\n}\n\n.jp-mm-list {\n\tdisplay: flex;\n\tflex-direction: column;\n\talign-items: flex-end;\n\tpadding: 8px 6px;\n\tmax-height: 84vh;\n\toverflow: hidden;\n\tborder-radius: 10px;\n\ttransition: background 0.15s ease, box-shadow 0.15s ease;\n}\n\n.jp-mm-item {\n\tdisplay: flex;\n\talign-items: center;\n\tjustify-content: flex-end;\n\tpadding: 3px 4px;\n\tborder-radius: 6px;\n\ttext-decoration: none;\n\tcolor: inherit;\n\topacity: var(--jp-mm-dim, 0.5);\n\tcursor: pointer;\n\toutline: none;\n\tdirection: ltr;\n}\n\n/* ---- collapsed state: tick bars, width by heading level ---- */\n\n.jp-mm-bar {\n\tdisplay: block;\n\theight: 2px;\n\tborder-radius: 1px;\n\tbackground: currentColor;\n}\n\n.jp-mm-l1 .jp-mm-bar { width: 18px; }\n.jp-mm-l2 .jp-mm-bar { width: 13px; }\n.jp-mm-l3 .jp-mm-bar { width: 9px; }\n.jp-mm-l4 .jp-mm-bar { width: 7px; }\n.jp-mm-l5 .jp-mm-bar { width: 5px; }\n.jp-mm-l6 .jp-mm-bar { width: 5px; }\n\n.jp-mm-label { display: none; }\n\n/* ---- depth stepper (issue #2) ---- */\n\n/* Rows deeper than the current depth are HIDDEN, not removed: keeping the\n * nav element alive is what lets the panel stay open across a depth change,\n * since the whole expansion rides on :hover over #jp-minimap. */\n#jp-minimap[data-depth=\"1\"] .jp-mm-l2,\n#jp-minimap[data-depth=\"1\"] .jp-mm-l3,\n#jp-minimap[data-depth=\"1\"] .jp-mm-l4,\n#jp-minimap[data-depth=\"1\"] .jp-mm-l5,\n#jp-minimap[data-depth=\"1\"] .jp-mm-l6,\n#jp-minimap[data-depth=\"2\"] .jp-mm-l3,\n#jp-minimap[data-depth=\"2\"] .jp-mm-l4,\n#jp-minimap[data-depth=\"2\"] .jp-mm-l5,\n#jp-minimap[data-depth=\"2\"] .jp-mm-l6,\n#jp-minimap[data-depth=\"3\"] .jp-mm-l4,\n#jp-minimap[data-depth=\"3\"] .jp-mm-l5,\n#jp-minimap[data-depth=\"3\"] .jp-mm-l6,\n#jp-minimap[data-depth=\"4\"] .jp-mm-l5,\n#jp-minimap[data-depth=\"4\"] .jp-mm-l6,\n#jp-minimap[data-depth=\"5\"] .jp-mm-l6 { display: none; }\n\n/* The stepper is part of the expanded panel only - collapsed, the minimap\n * stays the same narrow strip of tick marks it has always been. */\n.jp-mm-head { display: none; }\n\n\n/* ---- docked on the left edge ---- */\n\n/* Mirror the collapsed alignment so the tick bars hug the left border.\n * direction is pinned to ltr above, so flex-start is unambiguously the left\n * side whatever language the note is in. Placed BEFORE the :hover rules on\n * purpose: they carry the same specificity, so source order decides. */\n#jp-minimap.jp-mm-left .jp-mm-list { align-items: flex-start; }\n#jp-minimap.jp-mm-left .jp-mm-item { justify-content: flex-start; }\n\n/* The to-do dot mirrors too: docked right it hangs left of the tick bar,\n * docked left it must hang RIGHT of it - otherwise a dotted row pushes its\n * bar 9px inward (4px dot + 5px gap) and the flush bar column goes ragged.\n * order= reorders the flex row without touching the DOM, so the expanded\n * panel can put the dot back in front of the label. */\n#jp-minimap.jp-mm-left .jp-mm-dot {\n\torder: 1;\n\tmargin-inline-start: 5px;\n\tmargin-inline-end: 0;\n}\n\n/* ---- expanded state (hover) ---- */\n\n#jp-minimap.jp-mm-open .jp-mm-list {\n\talign-items: stretch;\n\toverflow-y: auto;\n\toverscroll-behavior: contain;\n\tbackground: var(--jp-mm-bg, rgba(127, 127, 127, 0.16));\n\tbackdrop-filter: blur(10px);\n\t-webkit-backdrop-filter: blur(10px);\n\tbox-shadow: 0 6px 28px rgba(0, 0, 0, 0.28);\n}\n\n#jp-minimap.jp-mm-open .jp-mm-bar { display: none; }\n\n#jp-minimap.jp-mm-open .jp-mm-item { justify-content: flex-start; }\n\n#jp-minimap.jp-mm-open .jp-mm-label {\n\tdisplay: block;\n\tmax-width: var(--jp-mm-width, 240px);\n\twhite-space: nowrap;\n\toverflow: hidden;\n\ttext-overflow: ellipsis;\n\ttext-align: start;\n}\n\n/* RTL headings (Persian/Arabic/Hebrew) read right-to-left in the expanded\n * panel: justify-content, padding-inline-start and text-align:start all flip\n * with the row direction, so the label hugs the right edge and nested levels\n * indent inward from the right. build() sets dir per row (first strong char). */\n#jp-minimap.jp-mm-open .jp-mm-item[dir=\"rtl\"] { direction: rtl; }\n\n/* indent by heading level when expanded (logical: left in LTR, right in RTL) */\n#jp-minimap.jp-mm-open .jp-mm-l2 { padding-inline-start: 16px; }\n#jp-minimap.jp-mm-open .jp-mm-l3 { padding-inline-start: 28px; }\n#jp-minimap.jp-mm-open .jp-mm-l4 { padding-inline-start: 40px; }\n#jp-minimap.jp-mm-open .jp-mm-l5 { padding-inline-start: 52px; }\n#jp-minimap.jp-mm-open .jp-mm-l6 { padding-inline-start: 52px; }\n\n#jp-minimap.jp-mm-open .jp-mm-head {\n\tdisplay: flex;\n\talign-items: center;\n\tjustify-content: center;\n\tgap: 7px;\n\tpadding: 0 4px 5px;\n\tmargin-bottom: 4px;\n\tborder-bottom: 1px solid rgba(127, 127, 127, 0.3);\n\tfont-size: 0.88em;\n\topacity: 0.8;\n\t/* The control reads the same either way round, and the panel is pinned\n\t * to ltr anyway - keep it out of the per-row bidi logic entirely. */\n\tdirection: ltr;\n}\n\n.jp-mm-step {\n\tmin-width: 15px;\n\ttext-align: center;\n\tborder-radius: 4px;\n\tfont-weight: 700;\n\tcursor: pointer;\n\tbackground: rgba(127, 127, 127, 0.22);\n}\n\n#jp-minimap.jp-mm-open .jp-mm-step:hover { background: rgba(127, 127, 127, 0.45); }\n\n/* Already at the shallowest / deepest level this note has. */\n.jp-mm-step-off { opacity: 0.3; cursor: default; }\n#jp-minimap.jp-mm-open .jp-mm-step-off:hover { background: rgba(127, 127, 127, 0.22); }\n\n.jp-mm-depth { font-variant-numeric: tabular-nums; }\n\n/* ---- heading tiers (issue #2): indentation alone is a weak cue when\n * scanning a long outline. Size and weight only - NEVER a colour. The\n * panel has to stay legible on every Joplin theme, so the palette is\n * limited to currentColor and neutral rgba (see CLAUDE.md). ---- */\n#jp-minimap.jp-mm-open .jp-mm-r0 .jp-mm-label { font-size: 1.08em; font-weight: 600; }\n#jp-minimap.jp-mm-open .jp-mm-r1 .jp-mm-label { font-weight: 500; }\n#jp-minimap.jp-mm-open .jp-mm-r2 .jp-mm-label { font-size: 0.92em; opacity: 0.8; }\n\n\n/* Expanded, the dot reads as a marker BEFORE the title on either edge. */\n#jp-minimap.jp-mm-open.jp-mm-left .jp-mm-dot {\n\torder: 0;\n\tmargin-inline-start: 0;\n\tmargin-inline-end: 5px;\n}\n\n/* ---- high contrast (issue #5) ---- */\n\n/* Still routed through the same variables, so a userstyle.css override wins\n * over the mode rather than fighting it. */\n#jp-minimap.jp-mm-hc .jp-mm-item { opacity: var(--jp-mm-dim, 0.82); }\n#jp-minimap.jp-mm-hc.jp-mm-open .jp-mm-r2 .jp-mm-label { opacity: 0.95; }\n\n#jp-minimap.jp-mm-hc.jp-mm-open .jp-mm-list {\n\tbackground: var(--jp-mm-bg, rgba(127, 127, 127, 0.38));\n\tbox-shadow: 0 6px 28px rgba(0, 0, 0, 0.45);\n}\n\n#jp-minimap.jp-mm-hc.jp-mm-open .jp-mm-head { opacity: 1; }\n#jp-minimap.jp-mm-hc .jp-mm-step { background: rgba(127, 127, 127, 0.4); }\n\n/* ---- shared states ---- */\n\n.jp-mm-item:hover {\n\topacity: 1;\n\tbackground: rgba(127, 127, 127, 0.22);\n}\n\n.jp-mm-active { opacity: 1; }\n\n#jp-minimap.jp-mm-open .jp-mm-active {\n\tbackground: rgba(127, 127, 127, 0.18);\n}\n\n/* No scrollbar in the expanded panel: the wheel handler owns scrolling,\n * and a visible scrollbar at the panel edge invites overlay-scrollbar\n * style hover/click interference. */\n.jp-mm-list::-webkit-scrollbar { display: none; }\n.jp-mm-list { scrollbar-width: none; }\n\n/* ---- open-to-do section dot: one muted red dot before the tick bar of\n * any section that contains at least one unchecked checkbox ---- */\n.jp-mm-dot {\n\tdisplay: none;\n\twidth: 4px;\n\theight: 4px;\n\tborder-radius: 50%;\n\tbackground: var(--jp-mm-dot, rgba(205, 97, 85, 0.85));\n\tmargin-inline-end: 5px;\n\tflex: none;\n}\n\n.jp-mm-dot.jp-mm-on { display: block; }\n\n/* don't show over printed/exported output */\n/* ---- touch devices ---- */\n\n/* (hover: none) is the device capability, not a screen width: a tablet with\n * a mouse keeps the desktop sizes, a touchscreen laptop gets these. */\n@media (hover: none) {\n\t/* Collapsed, the whole strip is the tap target - give it room. */\n\t.jp-mm-list { padding: 12px 14px; }\n\t.jp-mm-bar { height: 3px; }\n\n\t/* Expanded, each row has to be hittable on its own. */\n\t#jp-minimap.jp-mm-open .jp-mm-item { padding-top: 12px; padding-bottom: 12px; }\n\t#jp-minimap.jp-mm-open .jp-mm-label { font-size: 1.12em; }\n\t#jp-minimap.jp-mm-open .jp-mm-r0 .jp-mm-label { font-size: 1.2em; }\n\t#jp-minimap.jp-mm-open .jp-mm-r2 .jp-mm-label { font-size: 1.04em; }\n\n\t#jp-minimap.jp-mm-open .jp-mm-head { font-size: 1.04em; gap: 10px; padding-bottom: 8px; }\n\t.jp-mm-step { min-width: 32px; padding: 5px 0; }\n}\n@media print {\n\t#jp-minimap { display: none; }\n}\n";

	function ensureStyle() {
		if (document.getElementById('jp-minimap-style')) return;
		var styleEl = document.createElement('style');
		styleEl.id = 'jp-minimap-style';
		styleEl.textContent = MINIMAP_CSS;
		(document.head || document.documentElement).appendChild(styleEl);
	}

	// Bidi: the panel hangs off the right edge, so RTL headings (Persian,
	// Arabic, Hebrew) must read right-to-left inside it - otherwise their text
	// is forced left and the level indent grows from the wrong side. Resolve
	// each heading the way dir="auto" does: the FIRST strong character wins.
	// Ranges are deliberately coarse but disjoint (RTL blocks 0590-08FF plus the
	// Arabic/Hebrew presentation forms; everything else strong counts as LTR).
	var RTL_STRONG = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
	var LTR_STRONG = /[A-Za-z\u00C0-\u058F\u0900-\u1FFF\u2C00-\uD7FF\uF900-\uFAFF]/;

	function textDirection(text, heading) {
		var s = String(text || '');
		for (var i = 0; i < s.length; i++) {
			var c = s.charAt(i);
			if (RTL_STRONG.test(c)) return 'rtl';
			if (LTR_STRONG.test(c)) return 'ltr';
		}
		// No strong character at all (digits, punctuation, emoji): inherit the
		// direction the rendered heading itself got from the note.
		try {
			return window.getComputedStyle(heading).direction === 'rtl' ? 'rtl' : 'ltr';
		} catch (e) {
			return 'ltr';
		}
	}

	// Clicking the minimap gives the webview focus, which can make Joplin
	// re-render the whole note. That detaches every heading element we hold,
	// and scrollIntoView on a detached node is a silent no-op. So jumps are
	// index/text-based against the LIVE DOM, and if a rebuild happens right
	// after a click (the re-render case), the jump is re-applied afterwards.
	var pendingJump = null; // { index, text, until }

	// Deepest heading level the panel shows. null = follow the setting; once the
	// reader touches the stepper their choice sticks for the rest of the webview
	// session. It CANNOT live on the DOM: build() rebuilds the whole nav on every
	// note render, so anything held there is gone on the next keystroke.
	var userDepth = null;

	// Touch or mouse. This is a device CAPABILITY question, not a screen-size
	// one - a tablet with a mouse should behave like the desktop. The expanded
	// panel is driven by a class rather than :hover precisely because of this:
	// on touch, :hover latches after a tap and the panel gets stuck open.
	var isTouch = !(window.matchMedia && window.matchMedia('(hover: hover)').matches);

	// Snap a wanted depth onto a level this note actually has (notes routinely
	// start at H2 or skip a level).
	function clampDepth(levels, want) {
		var best = levels[0];
		for (var i = 0; i < levels.length; i++) {
			if (levels[i] <= want) best = levels[i];
		}
		return best;
	}

	function liveHeadings() {
		var root = document.getElementById('rendered-md') || document.body;
		return Array.prototype.slice.call(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
	}

	function findHeading(index, text) {
		var hs = liveHeadings();
		var h = hs[index];
		if (!h || (text && (h.textContent || '').trim() !== text)) {
			for (var i = 0; i < hs.length; i++) {
				if ((hs[i].textContent || '').trim() === text) { h = hs[i]; break; }
			}
		}
		return h;
	}

	// A smooth scrollIntoView is fire-and-forget: the browser animates towards
	// an offset worked out when it STARTS, and plenty can cut it short or make
	// it land wrong - the reader nudging the wheel, Joplin re-rendering the note
	// underneath, split view writing scrollTop of its own, or images above the
	// target finishing layout and shifting it. The jump then stops somewhere in
	// between, which is the "clicked H1 but only went up to 4.5" report.
	// Some environments ignore behavior:'smooth' altogether (headless Chromium
	// does, measured) and the jump never moves at all.
	//
	// So the animation is started for the feel, then the heading is watched
	// until it stops moving and an INSTANT scroll closes whatever gap is left.
	// The instant call uses the same alignment, so when the smooth scroll did
	// land correctly it is a no-op.
	var jumpWatch = null;
	var jumpRelease = null;

	function stopJumpWatch() {
		if (jumpWatch) { clearInterval(jumpWatch); jumpWatch = null; }
		if (jumpRelease) { jumpRelease(); jumpRelease = null; }
	}

	function watchJump(index, text) {
		stopJumpWatch();

		// The reader always wins: if they scroll themselves we are no longer
		// correcting a broken jump, we are fighting them.
		var takenOver = false;
		function onUserScroll(e) {
			// Wheeling the ToC list itself is not the reader taking over the note -
			// the panel has its own wheel handler, and clicking a row then scrolling
			// the list to pick another is a normal sequence.
			var t = e && e.target;
			if (t && t.closest && t.closest('#jp-minimap')) return;
			takenOver = true;
		}
		document.addEventListener('wheel', onUserScroll, { passive: true, capture: true });
		document.addEventListener('touchstart', onUserScroll, { passive: true, capture: true });
		jumpRelease = function () {
			document.removeEventListener('wheel', onUserScroll, { capture: true });
			document.removeEventListener('touchstart', onUserScroll, { capture: true });
		};

		var ticks = 0;
		var prevTop = null;
		jumpWatch = setInterval(function () {
			ticks++;
			if (takenOver) { stopJumpWatch(); return; }
			var h = findHeading(index, text);
			// A rebuild can briefly detach it; keep waiting, within reason.
			if (!h || !h.isConnected) { if (ticks > 20) stopJumpWatch(); return; }
			var top = Math.round(h.getBoundingClientRect().top);
			var settled = prevTop !== null && top === prevTop;
			prevTop = top;
			if (settled || ticks > 20) {
				stopJumpWatch();
				h.scrollIntoView({ block: 'start' });
			}
		}, 70);
	}

	function jumpTo(index, text) {
		var h = findHeading(index, text);
		if (!h || !h.isConnected) return;
		h.scrollIntoView({ behavior: 'smooth', block: 'start' });
		watchJump(index, text);
	}

	// Width of the note viewer's right-edge scrollbar zone. Overlay scrollbars
	// (e.g. Windows 11) reserve no layout space but still intercept clicks with
	// priority over page content, so when nothing is measurable we keep a safety
	// gap anyway. The minimap must stay clear of that zone or clicks on the
	// rightmost part of the panel silently hit the scrollbar instead.
	function scrollbarGap(root) {
		var gap = 0;
		var node = root;
		while (node && node !== document.documentElement) {
			if (node.scrollHeight > node.clientHeight + 1) {
				var w = node.offsetWidth - node.clientWidth;
				if (w > gap) gap = w;
			}
			node = node.parentElement;
		}
		return gap > 0 ? gap : 14;
	}

	function build() {
		if (cleanup) { cleanup(); cleanup = null; }
		if (isEditableContext()) {
			var stale = document.getElementById('jp-minimap');
			if (stale) stale.remove();
			return;
		}
		ensureStyle();

		var old = document.getElementById('jp-minimap');
		if (old) old.remove();

		var root = document.getElementById('rendered-md') || document.body;
		var headings = Array.prototype.slice.call(
			root.querySelectorAll('h1, h2, h3, h4, h5, h6')
		);
		if (headings.length < settings.minHeadings) return;

		// Distinct levels present, shallow to deep. The stepper walks THIS list
		// rather than 1-6, so every click visibly changes something.
		var levels = [];
		for (var li = 0; li < headings.length; li++) {
			var lvl = Number(headings[li].tagName.charAt(1));
			if (levels.indexOf(lvl) < 0) levels.push(lvl);
		}
		levels.sort(function (a, b) { return a - b; });
		var maxLevel = clampDepth(levels, userDepth === null ? settings.maxLevel : userDepth);

		// Which sections contain at least one OPEN checkbox: walk headings and
		// checkboxes in one document-ordered pass, attributing each unchecked
		// box to the nearest preceding heading. One dot per section, however
		// many open to-dos it holds.
		var sectionHasTodo = {};
		if (settings.showTodos !== false) {
			var walk = Array.prototype.slice.call(
				root.querySelectorAll('h1, h2, h3, h4, h5, h6, input[type="checkbox"]')
			);
			var lastHeading = -1;
			for (var wi = 0; wi < walk.length; wi++) {
				var wn = walk[wi];
				if (/^H[1-6]$/.test(wn.tagName)) lastHeading++;
				else if (!wn.checked && lastHeading >= 0) sectionHasTodo[lastHeading] = true;
			}
		}


		var nav = document.createElement('nav');
		nav.id = 'jp-minimap';
		// Applied in BOTH collapsed and expanded states: shifting only on hover
		// would move the panel out from under the cursor and cause a
		// hover/unhover flicker loop.
		// Docking side. ALWAYS clear the opposite offset: a fixed box with both
		// left and right set stretches between them instead of hugging one edge.
		// The scrollbar gap is a right-edge concern only - the viewer's scrollbar
		// never sits on the left, so no gap is added there.
		var navClasses = [];
		if (settings.highContrast === true) navClasses.push('jp-mm-hc');
		if (settings.side === 'left') {
			navClasses.push('jp-mm-left');
			nav.style.left = settings.rightOffset + 'px';
			nav.style.right = 'auto';
		} else {
			// No scrollbar zone to dodge on touch: scrollbarGap() falls back to a
			// 14px safety margin when it cannot measure one, which on a phone is
			// just 14px of wasted inset.
			nav.style.right = (settings.rightOffset + (isTouch ? 0 : scrollbarGap(root))) + 'px';
			nav.style.left = 'auto';
		}
		nav.className = navClasses.join(' ');
		nav.style.setProperty('--jp-mm-width', settings.panelWidth + 'px');
		// Only set when it differs from the default. An inline custom property
		// beats any stylesheet rule, so writing it unconditionally would make
		// --jp-mm-font impossible to override from userstyle.css without
		// !important - and 100% is exactly the stylesheet's own fallback anyway.
		var scale = Number(settings.fontScale) || 100;
		if (scale !== 100) {
			nav.style.setProperty('--jp-mm-font', (12.5 * scale / 100).toFixed(2) + 'px');
		}
		// The viewer DOM can be editable in some contexts; make sure the
		// minimap never shows a caret or accepts keyboard input.
		// NOTE: no preventDefault on mousedown! Blocking the default mouse-focus
		// path makes Joplin's later programmatic focus count as keyboard-like,
		// and the browser then draws a :focus-visible ring on the scroll
		// container. Natural mouse focus never shows a ring.
		nav.setAttribute('contenteditable', 'false');
		nav.setAttribute('data-depth', maxLevel);
		// Own the wheel entirely while the cursor is over the minimap:
		// scroll the ToC list ourselves and never let the event chain
		// through to the note underneath (scroll chaining feels erratic).
		nav.addEventListener('wheel', function (e) {
			e.preventDefault();
			list.scrollTop += e.deltaY;
		}, { passive: false });

		function setOpen(open) {
			nav.classList.toggle('jp-mm-open', open);
			// Drop the stepper's anchoring so the collapsed strip re-centres.
			if (!open) { nav.style.top = ''; nav.style.transform = ''; }
		}

		var closeOnOutside = null;
		if (isTouch) {
			// Collapsed, the whole strip is one tap target: an individual tick bar
			// is 18x2px, which no finger can hit. Once open, the rows take over.
			var touchAt = null;
			nav.addEventListener('touchstart', function (e) {
				var t = e.touches[0];
				touchAt = t ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
			}, { passive: true });
			nav.addEventListener('touchend', function (e) {
				if (nav.classList.contains('jp-mm-open')) return;
				var t = e.changedTouches[0];
				// A drag is the reader scrolling the note, not tapping the minimap.
				if (!touchAt || !t) return;
				if (Date.now() - touchAt.at > 700) return;
				if (Math.abs(t.clientX - touchAt.x) > 10 || Math.abs(t.clientY - touchAt.y) > 10) return;
				// Also suppresses the synthetic mousedown, so the tap that OPENS the
				// panel cannot fall through to whatever row lands under the finger.
				e.preventDefault();
				setOpen(true);
			});
			// touchstart, not click: it beats the browser's synthetic-click delay,
			// so the panel is already shut by the time the tap lands on the note.
			closeOnOutside = function (e) {
				if (!nav.contains(e.target)) setOpen(false);
			};
			document.addEventListener('touchstart', closeOnOutside, { passive: true });
		} else {
			nav.addEventListener('mouseenter', function () { setOpen(true); });
			nav.addEventListener('mouseleave', function () { setOpen(false); });
		}

		var list = document.createElement('div');
		list.className = 'jp-mm-list';

		// Depth stepper. It lives INSIDE the nav on purpose: clicking it keeps the
		// cursor over #jp-minimap, so the hover-expanded panel never collapses
		// mid-interaction and no click-to-pin state has to be invented. Pointless
		// when the note only has one heading level, so it is omitted entirely.
		var head = null;
		var minusBtn = null;
		var plusBtn = null;
		var depthText = null;
		if (levels.length > 1) {
			head = document.createElement('div');
			head.className = 'jp-mm-head';
			minusBtn = stepButton('-', -1);
			depthText = document.createElement('span');
			depthText.className = 'jp-mm-depth';
			plusBtn = stepButton('+', 1);
			head.appendChild(minusBtn);
			head.appendChild(depthText);
			head.appendChild(plusBtn);
			list.appendChild(head);
			renderHead();
		}

		function stepButton(sign, delta) {
			var b = document.createElement('span');
			b.className = 'jp-mm-step';
			b.textContent = sign;
			// mousedown for the same reason the rows use it (see below), and the
			// event must not reach anything underneath: adjusting the depth should
			// never scroll the note.
			b.addEventListener('mousedown', function (e) {
				if (e.button !== 0) return;
				e.preventDefault();
				e.stopPropagation();
				setDepth(levels[levels.indexOf(maxLevel) + delta]);
			});
			return b;
		}

		function renderHead() {
			if (!head) return;
			var lo = levels[0];
			depthText.textContent = lo === maxLevel ? ('H' + lo) : ('H' + lo + '-H' + maxLevel);
			minusBtn.classList.toggle('jp-mm-step-off', maxLevel === lo);
			plusBtn.classList.toggle('jp-mm-step-off', maxLevel === levels[levels.length - 1]);
		}

		function setDepth(next) {
			if (next === undefined) return;
			// The panel is vertically centred (top: 50% + translateY(-50%)), so
			// hiding rows slides its top edge DOWN and the stepper crawls out from
			// under the cursor - after a couple of clicks the pointer leaves the
			// panel entirely and it collapses. Measure the header, apply the
			// change, then pin the header back where it was. The inline top lasts
			// only until the next build(), which re-centres from scratch.
			var beforeY = head.getBoundingClientRect().top;
			maxLevel = next;
			userDepth = next;
			nav.setAttribute('data-depth', maxLevel);
			renderHead();
			applyTodoDots();
			var afterY = head.getBoundingClientRect().top;
			if (afterY !== beforeY) {
				var box = nav.getBoundingClientRect();
				var limit = window.innerHeight - box.height - 4;
				var top = box.top + (beforeY - afterY);
				nav.style.top = Math.max(4, Math.min(top, limit > 4 ? limit : 4)) + 'px';
				nav.style.transform = 'none';
			}
			updateActive();
		}

		// A row is built for EVERY heading; the stepper hides the deep ones with
		// CSS rather than rebuilding, so the nav element - and with it the :hover
		// state holding the panel open - survives a depth change untouched.
		var items = headings.map(function (h, index) {
			var level = Number(h.tagName.charAt(1));
			// Size/weight tier keys off the RANK among the levels this note uses,
			// not the absolute level: a note that starts at H2 still gets a proper
			// top tier instead of looking uniformly like sub-headings.
			var rank = Math.min(levels.indexOf(level), 2);

			// NOT an <a>: Joplin's viewer shows a "Ctrl+click to open" tooltip
			// on anchors and treats them as external links.
			var item = document.createElement('div');
			item.className = 'jp-mm-item jp-mm-l' + level + ' jp-mm-r' + rank;

			var bar = document.createElement('span');
			bar.className = 'jp-mm-bar';

			var label = document.createElement('span');
			label.className = 'jp-mm-label';
			label.textContent = (h.textContent || '').trim();

			// Explicit on BOTH directions, not just RTL: dir also turns on bidi
			// isolation, which keeps an LTR title readable inside an RTL note
			// (and vice versa). CSS pins the collapsed rows back to ltr so the
			// tick bars stay flush with the docked edge either way.
			item.setAttribute('dir', textDirection(label.textContent, h));

			// Muted red reminder dot before the bar (and before the label when
			// expanded - same element, flex order does the work). Built for every
			// row and shown with a class, because WHICH row carries a dot depends
			// on the current depth and the stepper changes that without rebuilding.
			var dot = document.createElement('span');
			dot.className = 'jp-mm-dot';
			item.appendChild(dot);
			item.appendChild(bar);
			item.appendChild(label);

			// MOUSEDOWN, not click: the press gives the webview focus, Joplin may
			// re-render the note, and our panel gets rebuilt BETWEEN mousedown and
			// mouseup - so the click event (which needs the same target for both)
			// never fires. mousedown runs before any of that can happen.
			item.addEventListener('mousedown', function (e) {
				if (e.button !== 0) return;
				var text = (label.textContent || '').trim();
				// If the press triggers a note re-render, the rebuild will
				// re-apply this jump against the fresh DOM.
				pendingJump = { index: index, text: text, until: Date.now() + 1200 };
				jumpTo(index, text);
				// On touch there is no cursor to move away, so the panel would sit
				// over the heading the reader just asked to see.
				if (isTouch) setOpen(false);
			});

			list.appendChild(item);
			return item;
		});

		nav.appendChild(list);
		document.body.appendChild(nav);

		// Open to-dos in a section the stepper has collapsed away roll up to the
		// nearest visible ancestor. Without this, lowering the depth silently
		// hides the only signal that a branch still holds unfinished work - which
		// is worse than having no dots at all, because the panel looks clean.
		function applyTodoDots() {
			var owner = {};
			if (settings.showTodos !== false) {
				var visible = -1;
				for (var i = 0; i < headings.length; i++) {
					if (Number(headings[i].tagName.charAt(1)) <= maxLevel) visible = i;
					if (sectionHasTodo[i] && visible >= 0) owner[visible] = true;
				}
			}
			for (var j = 0; j < items.length; j++) {
				items[j].firstChild.classList.toggle('jp-mm-on', owner[j] === true);
			}
		}
		applyTodoDots();

		function updateActive() {
			var activeIndex = 0;
			for (var i = 0; i < headings.length; i++) {
				if (headings[i].getBoundingClientRect().top <= 90) activeIndex = i;
			}
			// A heading hidden by the stepper highlights its nearest VISIBLE
			// ancestor instead, so the panel always shows where you are.
			var activeRow = 0;
			for (var k = 0; k <= activeIndex; k++) {
				if (Number(headings[k].tagName.charAt(1)) <= maxLevel) activeRow = k;
			}
			for (var j = 0; j < items.length; j++) {
				items[j].classList.toggle('jp-mm-active', j === activeRow);
			}
		}

		document.addEventListener('scroll', updateActive, { passive: true, capture: true });
		updateActive();

		// A rebuild arriving right after a click means the note was re-rendered
		// and the original scrollIntoView hit a detached node - redo the jump.
		if (pendingJump && Date.now() < pendingJump.until) {
			jumpTo(pendingJump.index, pendingJump.text);
			pendingJump = null;
		}

		cleanup = function () {
			document.removeEventListener('scroll', updateActive, { capture: true });
			if (closeOnOutside) document.removeEventListener('touchstart', closeOnOutside);
		};
	}

	function settingsAndBuild() {
		loadSettings().then(build);
	}

	var timer = null;
	function scheduleBuild() {
		clearTimeout(timer);
		timer = setTimeout(settingsAndBuild, 150);
	}

	// True if a mutation was caused by the minimap itself (avoid rebuild loops).
	function isOwnMutation(m) {
		if (m.target && m.target.closest && m.target.closest('#jp-minimap')) return true;
		var nodes = Array.prototype.slice.call(m.addedNodes)
			.concat(Array.prototype.slice.call(m.removedNodes));
		if (!nodes.length) return false;
		return nodes.every(function (n) {
			return n.id === 'jp-minimap' || (n.closest && n.closest('#jp-minimap'));
		});
	}

	function watch() {
		// Joplin fires this after each note render/update.
		document.addEventListener('joplin-noteDidUpdate', scheduleBuild);

		// Joplin's asset cleanup can remove our <style> from <head> AFTER the
		// last body mutation - nothing rebuilds, and the nav sits unstyled in
		// the page (the "outline below the document" bug, second incarnation:
		// v1.1.4 only re-checked the style during rebuilds). Watch the head
		// and re-inject immediately.
		var headObserver = new MutationObserver(function () {
			if (!document.getElementById('jp-minimap-style')) ensureStyle();
		});
		if (document.head) headObserver.observe(document.head, { childList: true });

		// Fallback: watch for the rendered content being swapped out
		// (note switch replaces the DOM without re-running this script).
		var mo = new MutationObserver(function (mutations) {
			for (var i = 0; i < mutations.length; i++) {
				if (!isOwnMutation(mutations[i])) { scheduleBuild(); return; }
			}
		});
		mo.observe(document.body, { childList: true, subtree: true });

		settingsAndBuild();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', watch);
	} else {
		watch();
	}
})();
