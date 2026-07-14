/* Joplin Minimap — plugin entry (runs in the plugin host, Node context).
 * Registers the settings UI and a markdown-it content script whose only job
 * is to inject the minimap assets (JS + CSS) into the rendered note viewer.
 * The viewer asset fetches settings via webviewApi.postMessage -> onMessage.
 */

// SettingItemType numeric values: Int=1, String=2, Bool=3 (no 'api' import in plain JS)
const TYPE_INT = 1;

// Settings-screen strings, resolved from the app locale at registration time
// (matching Joplin's own restart-on-language-switch behavior).
const SETTINGS_I18N = {
	en_US: {
		minHeadings: 'Minimum headings',
		minHeadingsDesc: 'Hide the minimap when the note has fewer headings than this. Default: 2.',
		panelWidth: 'Expanded panel width (px)',
		panelWidthDesc: 'Maximum width of the hover-expanded table of contents. Default: 240.',
		rightOffset: 'Distance from right edge (px)',
		rightOffsetDesc: 'Gap between the minimap and the right edge of the viewer. Default: 6.',
	},
	zh_CN: {
		minHeadings: '最少标题数',
		minHeadingsDesc: '笔记标题数少于此值时隐藏小地图。默认 2。',
		panelWidth: '展开面板宽度（px）',
		panelWidthDesc: '悬停展开的目录面板最大宽度。默认 240。',
		rightOffset: '距右边缘距离（px）',
		rightOffsetDesc: '小地图与阅读器右边缘的间距。默认 6。',
	},
	zh_TW: {
		minHeadings: '最少標題數',
		minHeadingsDesc: '筆記標題數少於此值時隱藏小地圖。預設 2。',
		panelWidth: '展開面板寬度（px）',
		panelWidthDesc: '懸停展開的目錄面板最大寬度。預設 240。',
		rightOffset: '距右邊緣距離（px）',
		rightOffsetDesc: '小地圖與檢視器右邊緣的間距。預設 6。',
	},
	ru: {
		minHeadings: 'Минимум заголовков',
		minHeadingsDesc: 'Скрывать миникарту, если заголовков в заметке меньше. По умолчанию: 2.',
		panelWidth: 'Ширина развёрнутой панели (px)',
		panelWidthDesc: 'Максимальная ширина оглавления при наведении. По умолчанию: 240.',
		rightOffset: 'Отступ от правого края (px)',
		rightOffsetDesc: 'Зазор между миникартой и правым краем просмотра. По умолчанию: 6.',
	},
	ja_JP: {
		minHeadings: '最小見出し数',
		minHeadingsDesc: 'ノートの見出しがこの数より少ない場合はミニマップを隠します。既定値：2。',
		panelWidth: '展開パネルの幅（px）',
		panelWidthDesc: 'ホバーで展開する目次の最大幅。既定値：240。',
		rightOffset: '右端からの距離（px）',
		rightOffsetDesc: 'ミニマップとビューアー右端の間隔。既定値：6。',
	},
};

function settingsI18n(locale) {
	if (SETTINGS_I18N[locale]) return SETTINGS_I18N[locale];
	const lang = String(locale || '').split('_')[0];
	if (lang === 'zh') return SETTINGS_I18N.zh_CN;
	if (lang === 'ru') return SETTINGS_I18N.ru;
	if (lang === 'ja') return SETTINGS_I18N.ja_JP;
	return SETTINGS_I18N.en_US;
}

joplin.plugins.register({
	onStart: async function () {
		const locale = (await joplin.settings.globalValue('locale')) || 'en_US';
		const t = settingsI18n(locale);

		await joplin.settings.registerSection('minimap', {
			label: 'Joplin Minimap',
			iconName: 'fas fa-list',
		});

		try {
			await joplin.settings.registerSettings({
			'minimapMinHeadings': {
				value: 2,
				minimum: 1,
				type: TYPE_INT,
				section: 'minimap',
				public: true,
				label: t.minHeadings,
				description: t.minHeadingsDesc,
			},
			'minimapPanelWidth': {
				value: 240,
				minimum: 120,
				type: TYPE_INT,
				section: 'minimap',
				public: true,
				label: t.panelWidth,
				description: t.panelWidthDesc,
			},
			'minimapRightOffset': {
				value: 6,
				minimum: 0,
				type: TYPE_INT,
				section: 'minimap',
				public: true,
				label: t.rightOffset,
				description: t.rightOffsetDesc,
			},
			});
		} catch (error) {
			console.error('Joplin Minimap: registerSettings failed:', error);
		}

		await joplin.contentScripts.register(
			'markdownItPlugin',
			'joplin-minimap',
			'./minimapContentScript.js'
		);

		await joplin.contentScripts.onMessage('joplin-minimap', async function (message) {
			if (message === 'getSettings') {
				return {
					minHeadings: await joplin.settings.value('minimapMinHeadings'),
					panelWidth: await joplin.settings.value('minimapPanelWidth'),
					rightOffset: await joplin.settings.value('minimapRightOffset'),
				};
			}
			return null;
		});
	},
});
