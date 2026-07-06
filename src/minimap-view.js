/* Joplin Minimap - runs inside the rendered note viewer.
 * Collects h1-h6 from the rendered DOM, draws collapsed tick bars on the
 * right edge, expands into a full ToC on hover, and jumps on click.
 * Rebuilds itself whenever the note content changes (note switch, edit).
 */
(function () {
	'use strict';

	// Defaults; overridden from Joplin's plugin settings (Tools > Options > Minimap)
	// when webviewApi is available in this webview.
	var settings = { minHeadings: 2, panelWidth: 240, rightOffset: 6 };

	function loadSettings() {
		if (typeof webviewApi === 'undefined' || !webviewApi.postMessage) {
			return Promise.resolve();
		}
		return webviewApi.postMessage('joplin-minimap', 'getSettings').then(function (s) {
			if (s && typeof s.minHeadings === 'number') settings = s;
		}).catch(function () { /* keep defaults (e.g. print/export context) */ });
	}

	// Only ever install one instance of the watcher per webview session.
	if (window.__jpMinimapInstalled) return;
	window.__jpMinimapInstalled = true;

	var cleanup = null; // removes listeners belonging to the current build

	// Clicking the minimap gives the webview focus, which can make Joplin
	// re-render the whole note. That detaches every heading element we hold,
	// and scrollIntoView on a detached node is a silent no-op. So jumps are
	// index/text-based against the LIVE DOM, and if a rebuild happens right
	// after a click (the re-render case), the jump is re-applied afterwards.
	var pendingJump = null; // { index, text, until }

	function liveHeadings() {
		var root = document.getElementById('rendered-md') || document.body;
		return Array.prototype.slice.call(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
	}

	function jumpTo(index, text) {
		var hs = liveHeadings();
		var h = hs[index];
		if (!h || (text && (h.textContent || '').trim() !== text)) {
			for (var i = 0; i < hs.length; i++) {
				if ((hs[i].textContent || '').trim() === text) { h = hs[i]; break; }
			}
		}
		if (h && h.isConnected) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

		var old = document.getElementById('jp-minimap');
		if (old) old.remove();

		var root = document.getElementById('rendered-md') || document.body;
		var headings = Array.prototype.slice.call(
			root.querySelectorAll('h1, h2, h3, h4, h5, h6')
		);
		if (headings.length < settings.minHeadings) return;

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

		var items = headings.map(function (h, index) {
			var level = Number(h.tagName.charAt(1));

			// NOT an <a>: Joplin's viewer shows a "Ctrl+click to open" tooltip
			// on anchors and treats them as external links.
			var item = document.createElement('div');
			item.className = 'jp-mm-item jp-mm-l' + level;

			var bar = document.createElement('span');
			bar.className = 'jp-mm-bar';

			var label = document.createElement('span');
			label.className = 'jp-mm-label';
			label.textContent = (h.textContent || '').trim();

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
			});

			list.appendChild(item);
			return item;
		});

		nav.appendChild(list);
		document.body.appendChild(nav);

		function updateActive() {
			var activeIndex = 0;
			for (var i = 0; i < headings.length; i++) {
				if (headings[i].getBoundingClientRect().top <= 90) activeIndex = i;
			}
			for (var j = 0; j < items.length; j++) {
				items[j].classList.toggle('jp-mm-active', j === activeIndex);
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
