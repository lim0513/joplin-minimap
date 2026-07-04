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
				return [
					{ name: 'minimap.css' },
					{ name: 'minimap-view.js' },
				];
			},
		};
	},
};
