/* Joplin Minimap - runs inside the rendered note viewer.
 * Collects h1-h6 from the rendered DOM, draws collapsed tick bars on the
 * right edge, expands into a full ToC on hover, and jumps on click.
 * Rebuilds itself whenever the note content changes (note switch, edit).
 */
(function () {
	'use strict';

	var MIN_HEADINGS = 2; // don't show the minimap for notes with fewer headings

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
		if (headings.length < MIN_HEADINGS) return;

		var nav = document.createElement('nav');
		nav.id = 'jp-minimap';
		// The viewer DOM can be editable in some contexts; make sure the
		// minimap never shows a caret or accepts keyboard input.
		nav.setAttribute('contenteditable', 'false');
		nav.addEventListener('mousedown', function (e) { e.preventDefault(); });

		var list = document.createElement('div');
		list.className = 'jp-mm-list';

		var items = headings.map(function (h) {
			var level = Number(h.tagName.charAt(1));

			var item = document.createElement('a');
			item.className = 'jp-mm-item jp-mm-l' + level;
			item.href = 'javascript:;';
			item.tabIndex = -1;

			var bar = document.createElement('span');
			bar.className = 'jp-mm-bar';

			var label = document.createElement('span');
			label.className = 'jp-mm-label';
			label.textContent = (h.textContent || '').trim();

			item.appendChild(bar);
			item.appendChild(label);

			item.addEventListener('click', function (e) {
				e.preventDefault();
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

	var timer = null;
	function scheduleBuild() {
		clearTimeout(timer);
		timer = setTimeout(build, 150);
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

		build();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', watch);
	} else {
		watch();
	}
})();
