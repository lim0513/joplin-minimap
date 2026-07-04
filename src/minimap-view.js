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
		nav.style.right = settings.rightOffset + 'px';
		nav.style.setProperty('--jp-mm-width', settings.panelWidth + 'px');
		// The viewer DOM can be editable in some contexts; make sure the
		// minimap never shows a caret or accepts keyboard input.
		nav.setAttribute('contenteditable', 'false');
		nav.addEventListener('mousedown', function (e) { e.preventDefault(); });
		// Own the wheel entirely while the cursor is over the minimap:
		// scroll the ToC list ourselves and never let the event chain
		// through to the note underneath (scroll chaining feels erratic).
		nav.addEventListener('wheel', function (e) {
			e.preventDefault();
			list.scrollTop += e.deltaY;
		}, { passive: false });

		var list = document.createElement('div');
		list.className = 'jp-mm-list';

		var items = headings.map(function (h) {
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

			item.addEventListener('click', function () {
				h.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
