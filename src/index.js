/* Joplin Minimap — plugin entry (runs in the plugin host, Node context).
 * Registers the settings UI and a markdown-it content script whose only job
 * is to inject the minimap assets (JS + CSS) into the rendered note viewer.
 * The viewer asset fetches settings via webviewApi.postMessage -> onMessage.
 */

// SettingItemType numeric values: Int=1, String=2, Bool=3 (no 'api' import in plain JS)
const TYPE_INT = 1;

joplin.plugins.register({
	onStart: async function () {
		await joplin.settings.registerSection('minimap', {
			label: 'Minimap',
			iconName: 'fas fa-list',
		});

		await joplin.settings.registerSettings({
			'minimap.minHeadings': {
				value: 2,
				minimum: 1,
				type: TYPE_INT,
				section: 'minimap',
				public: true,
				label: 'Minimum headings',
				description: 'Hide the minimap when the note has fewer headings than this. Default: 2.',
			},
			'minimap.panelWidth': {
				value: 240,
				minimum: 120,
				type: TYPE_INT,
				section: 'minimap',
				public: true,
				label: 'Expanded panel width (px)',
				description: 'Maximum width of the hover-expanded table of contents. Default: 240.',
			},
			'minimap.rightOffset': {
				value: 6,
				minimum: 0,
				type: TYPE_INT,
				section: 'minimap',
				public: true,
				label: 'Distance from right edge (px)',
				description: 'Gap between the minimap and the right edge of the viewer. Default: 6.',
			},
		});

		await joplin.contentScripts.register(
			'markdownItPlugin',
			'joplin-minimap',
			'./minimapContentScript.js'
		);

		await joplin.contentScripts.onMessage('joplin-minimap', async function (message) {
			if (message === 'getSettings') {
				return {
					minHeadings: await joplin.settings.value('minimap.minHeadings'),
					panelWidth: await joplin.settings.value('minimap.panelWidth'),
					rightOffset: await joplin.settings.value('minimap.rightOffset'),
				};
			}
			return null;
		});
	},
});
