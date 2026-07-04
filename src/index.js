/* Joplin Minimap — plugin entry.
 * Registers a markdown-it content script whose only job is to inject
 * the minimap assets (JS + CSS) into the rendered note viewer.
 */
joplin.plugins.register({
	onStart: async function () {
		await joplin.contentScripts.register(
			'markdownItPlugin',
			'joplin-minimap',
			'./minimapContentScript.js'
		);
	},
});
