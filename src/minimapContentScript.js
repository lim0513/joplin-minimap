/* Content script: no markdown transformation needed.
 * We only ship two assets into the rendered viewer:
 *   - minimap-view.js  builds the minimap from the rendered DOM
 *   - minimap.css      collapsed tick bars + hover-expanded ToC panel
 */
module.exports = {
	default: function (_context) {
		return {
			plugin: function (_markdownIt, _options) {
				// intentionally empty — rendering is untouched
			},
			assets: function () {
				// CSS is injected by minimap-view.js itself (see ensureStyle) so
				// that a re-render which drops asset stylesheets cannot leave an
				// unstyled nav in the document flow.
				return [
					{ name: 'minimap-view.js' },
				];
			},
		};
	},
};
