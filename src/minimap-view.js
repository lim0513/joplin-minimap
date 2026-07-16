/* Joplin Minimap - runs inside the rendered note viewer.
 * Collects h1-h6 from the rendered DOM, draws collapsed tick bars on the
 * right edge, expands into a full ToC on hover, and jumps on click.
 * Rebuilds itself whenever the note content changes (note switch, edit).
 */
(function () {
	'use strict';

	// Defaults; overridden from Joplin's plugin settings (Tools > Options > Minimap)
	// when webviewApi is available in this webview.
	var settings = { minHeadings: 2, panelWidth: 240, rightOffset: 6, showTodos: true };

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
	var MINIMAP_CSS = "/* Joplin Minimap \u2014 collapsed tick bars, hover-expanded ToC panel.\n * Colors use currentColor / rgba so it follows both light and dark themes.\n */\n\n#jp-minimap {\n\tuser-select: none;\n\t-webkit-user-select: none;\n\tcaret-color: transparent;\n\tcursor: default;\n\tposition: fixed;\n\ttop: 50%;\n\tright: 6px;\n\ttransform: translateY(-50%);\n\tz-index: 9999;\n\tfont-size: 12.5px;\n\tline-height: 1.35;\n\tcolor: inherit;\n}\n\n.jp-mm-list {\n\tdisplay: flex;\n\tflex-direction: column;\n\talign-items: flex-end;\n\tpadding: 8px 6px;\n\tmax-height: 84vh;\n\toverflow: hidden;\n\tborder-radius: 10px;\n\ttransition: background 0.15s ease, box-shadow 0.15s ease;\n}\n\n.jp-mm-item {\n\tdisplay: flex;\n\talign-items: center;\n\tjustify-content: flex-end;\n\tpadding: 3px 4px;\n\tborder-radius: 6px;\n\ttext-decoration: none;\n\tcolor: inherit;\n\topacity: 0.5;\n\tcursor: pointer;\n\toutline: none;\n}\n\n/* ---- collapsed state: tick bars, width by heading level ---- */\n\n.jp-mm-bar {\n\tdisplay: block;\n\theight: 2px;\n\tborder-radius: 1px;\n\tbackground: currentColor;\n}\n\n.jp-mm-l1 .jp-mm-bar { width: 18px; }\n.jp-mm-l2 .jp-mm-bar { width: 13px; }\n.jp-mm-l3 .jp-mm-bar { width: 9px; }\n.jp-mm-l4 .jp-mm-bar { width: 7px; }\n.jp-mm-l5 .jp-mm-bar { width: 5px; }\n.jp-mm-l6 .jp-mm-bar { width: 5px; }\n\n.jp-mm-label { display: none; }\n\n/* ---- expanded state (hover) ---- */\n\n#jp-minimap:hover .jp-mm-list {\n\talign-items: stretch;\n\toverflow-y: auto;\n\toverscroll-behavior: contain;\n\tbackground: rgba(127, 127, 127, 0.16);\n\tbackdrop-filter: blur(10px);\n\t-webkit-backdrop-filter: blur(10px);\n\tbox-shadow: 0 6px 28px rgba(0, 0, 0, 0.28);\n}\n\n#jp-minimap:hover .jp-mm-bar { display: none; }\n\n#jp-minimap:hover .jp-mm-item { justify-content: flex-start; }\n\n#jp-minimap:hover .jp-mm-label {\n\tdisplay: block;\n\tmax-width: var(--jp-mm-width, 240px);\n\twhite-space: nowrap;\n\toverflow: hidden;\n\ttext-overflow: ellipsis;\n}\n\n/* indent by heading level when expanded */\n#jp-minimap:hover .jp-mm-l2 { padding-left: 16px; }\n#jp-minimap:hover .jp-mm-l3 { padding-left: 28px; }\n#jp-minimap:hover .jp-mm-l4 { padding-left: 40px; }\n#jp-minimap:hover .jp-mm-l5 { padding-left: 52px; }\n#jp-minimap:hover .jp-mm-l6 { padding-left: 52px; }\n\n/* ---- shared states ---- */\n\n.jp-mm-item:hover {\n\topacity: 1;\n\tbackground: rgba(127, 127, 127, 0.22);\n}\n\n.jp-mm-active { opacity: 1; }\n\n#jp-minimap:hover .jp-mm-active {\n\tbackground: rgba(127, 127, 127, 0.18);\n}\n\n/* No scrollbar in the expanded panel: the wheel handler owns scrolling,\n * and a visible scrollbar at the panel edge invites overlay-scrollbar\n * style hover/click interference. */\n.jp-mm-list::-webkit-scrollbar { display: none; }\n.jp-mm-list { scrollbar-width: none; }\n\n/* ---- to-do markers (open only) ---- */\n.jp-mm-todo { padding-top: 1px; padding-bottom: 1px; }\n.jp-mm-todo .jp-mm-bar { display: none; }\n.jp-mm-dot { display: block; width: 4px; height: 4px; border-radius: 50%; background: #4c8dff; box-sizing: border-box; }\n#jp-minimap:hover .jp-mm-dot { display: none; }\n#jp-minimap:hover .jp-mm-todo { padding-left: 20px; }\n.jp-mm-todo .jp-mm-label { opacity: 1; }\n\n/* don't show over printed/exported output */\n@media print {\n\t#jp-minimap { display: none; }\n}\n";

	function ensureStyle() {
		if (document.getElementById('jp-minimap-style')) return;
		var styleEl = document.createElement('style');
		styleEl.id = 'jp-minimap-style';
		styleEl.textContent = MINIMAP_CSS;
		(document.head || document.documentElement).appendChild(styleEl);
	}

	// Clicking the minimap gives the webview focus, which can make Joplin
	// re-render the whole note. That detaches every heading element we hold,
	// and scrollIntoView on a detached node is a silent no-op. So jumps are
	// index/text-based against the LIVE DOM, and if a rebuild happens right
	// after a click (the re-render case), the jump is re-applied afterwards.
	var pendingJump = null; // { type, index, text, until }

	function rootEl() {
		return document.getElementById('rendered-md') || document.body;
	}

	function liveNodes(type) {
		var root = rootEl();
		if (type === 'todo') {
			return Array.prototype.slice.call(root.querySelectorAll('input[type="checkbox"]'));
		}
		return Array.prototype.slice.call(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
	}

	function entryText(type, node) {
		if (type === 'todo') {
			var box = node.closest('li') || node.parentElement || node;
			return (box.textContent || '').trim();
		}
		return (node.textContent || '').trim();
	}

	function scrollTargetFor(type, node) {
		if (type === 'todo') return node.closest('li') || node.parentElement || node;
		return node;
	}

	function jumpTo(type, index, text) {
		var ns = liveNodes(type);
		var n = ns[index];
		if (!n || (text && entryText(type, n) !== text)) {
			for (var i = 0; i < ns.length; i++) {
				if (entryText(type, ns[i]) === text) { n = ns[i]; break; }
			}
		}
		var target = n ? scrollTargetFor(type, n) : null;
		if (target && target.isConnected) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

		var withTodos = settings.showTodos !== false;
		var selector = withTodos
			? 'h1, h2, h3, h4, h5, h6, input[type="checkbox"]'
			: 'h1, h2, h3, h4, h5, h6';
		var nodes = Array.prototype.slice.call(root.querySelectorAll(selector));

		var entries = [];
		var headingCount = 0;
		var hIdx = 0;
		var tIdx = 0;
		for (var ni = 0; ni < nodes.length; ni++) {
			var node = nodes[ni];
			if (/^H[1-6]$/.test(node.tagName)) {
				headingCount++;
				entries.push({ type: 'heading', level: Number(node.tagName.charAt(1)), text: entryText('heading', node), index: hIdx++ });
			} else {
				// tIdx tracks position among ALL checkboxes (for live-DOM jump
				// resolution), but only OPEN to-dos are shown as markers.
				var isDone = !!node.checked;
				if (!isDone) entries.push({ type: 'todo', done: false, text: entryText('todo', node), index: tIdx });
				tIdx++;
			}
		}
		if (headingCount < settings.minHeadings) return;

		var nav = document.createElement('nav');
		nav.id = 'jp-minimap';
		// Applied in BOTH collapsed and expanded states: shifting only on hover
		// would move the panel out from under the cursor and cause a
		// hover/unhover flicker loop.
		nav.style.right = (settings.rightOffset + scrollbarGap(root)) + 'px';
		nav.style.setProperty('--jp-mm-width', settings.panelWidth + 'px');
		// The viewer DOM can be editable in some contexts; make sure the
		// minimap never shows a caret or accepts keyboard input.
		// NOTE: no preventDefault on mousedown! Blocking the default mouse-focus
		// path makes Joplin's later programmatic focus count as keyboard-like,
		// and the browser then draws a :focus-visible ring on the scroll
		// container. Natural mouse focus never shows a ring.
		nav.setAttribute('contenteditable', 'false');
		// Own the wheel entirely while the cursor is over the minimap:
		// scroll the ToC list ourselves and never let the event chain
		// through to the note underneath (scroll chaining feels erratic).
		nav.addEventListener('wheel', function (e) {
			e.preventDefault();
			list.scrollTop += e.deltaY;
		}, { passive: false });

		var list = document.createElement('div');
		list.className = 'jp-mm-list';

		var items = entries.map(function (entry) {
			// NOT an <a>: Joplin's viewer shows a "Ctrl+click to open" tooltip
			// on anchors and treats them as external links.
			var item = document.createElement('div');
			if (entry.type === 'todo') {
				item.className = 'jp-mm-item jp-mm-todo';
				var dot = document.createElement('span');
				dot.className = 'jp-mm-dot';
				item.appendChild(dot);
				var tlabel = document.createElement('span');
				tlabel.className = 'jp-mm-label';
				tlabel.textContent = '\u2610 ' + entry.text;
				item.appendChild(tlabel);
			} else {
				item.className = 'jp-mm-item jp-mm-l' + entry.level;
				var bar = document.createElement('span');
				bar.className = 'jp-mm-bar';
				item.appendChild(bar);
				var label = document.createElement('span');
				label.className = 'jp-mm-label';
				label.textContent = entry.text;
				item.appendChild(label);
			}

			// MOUSEDOWN, not click: the press gives the webview focus, Joplin may
			// re-render the note, and our panel gets rebuilt BETWEEN mousedown and
			// mouseup - so the click event (which needs the same target for both)
			// never fires. mousedown runs before any of that can happen.
			item.addEventListener('mousedown', function (e) {
				if (e.button !== 0) return;
				pendingJump = { type: entry.type, index: entry.index, text: entry.text, until: Date.now() + 1200 };
				jumpTo(entry.type, entry.index, entry.text);
			});

			list.appendChild(item);
			return item;
		});

		nav.appendChild(list);
		document.body.appendChild(nav);

		var headingItemIdx = [];
		for (var ei = 0; ei < entries.length; ei++) {
			if (entries[ei].type === 'heading') headingItemIdx.push(ei);
		}
		function updateActive() {
			var liveH = liveNodes('heading');
			var activeItem = -1;
			for (var i = 0; i < headingItemIdx.length; i++) {
				var hn = liveH[i];
				if (hn && hn.getBoundingClientRect().top <= 90) activeItem = headingItemIdx[i];
			}
			for (var j = 0; j < items.length; j++) {
				items[j].classList.toggle('jp-mm-active', j === activeItem);
			}
		}

		document.addEventListener('scroll', updateActive, { passive: true, capture: true });
		updateActive();

		// A rebuild arriving right after a click means the note was re-rendered
		// and the original scrollIntoView hit a detached node - redo the jump.
		if (pendingJump && Date.now() < pendingJump.until) {
			jumpTo(pendingJump.type, pendingJump.index, pendingJump.text);
			pendingJump = null;
		}

		cleanup = function () {
			document.removeEventListener('scroll', updateActive, { capture: true });
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
