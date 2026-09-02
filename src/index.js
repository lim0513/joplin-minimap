/* Joplin Minimap — plugin entry (runs in the plugin host, Node context).
 * Registers the settings UI and a markdown-it content script whose only job
 * is to inject the minimap assets (JS + CSS) into the rendered note viewer.
 * The viewer asset fetches settings via webviewApi.postMessage -> onMessage.
 */

// SettingItemType numeric values: Int=1, String=2, Bool=3 (no 'api' import in plain JS)
const TYPE_INT = 1;
const TYPE_STRING = 2;
const TYPE_BOOL = 3;

// Settings-screen strings, resolved from the app locale at registration time
// (matching Joplin's own restart-on-language-switch behavior).
const SETTINGS_I18N = {
	en_US: {
		minHeadings: 'Minimum headings',
		minHeadingsDesc: 'Hide the minimap when the note has fewer headings than this. Default: 2.',
		panelWidth: 'Expanded panel width (px)',
		panelWidthDesc: 'Maximum width of the hover-expanded table of contents. Default: 240.',
		edgeOffset: 'Edge distance (px)',
		edgeOffsetDesc: 'Gap between the minimap and the viewer edge it sits on. Default: 6.',
		side: 'Minimap side',
		sideDesc: 'Which edge of the viewer the minimap sits on. Default: right.',
		sideRight: 'Right',
		sideLeft: 'Left',
		showTodos: 'Show to-do markers',
		showTodosDesc: 'Show a small red dot before a section\'s tick bar when it contains open to-dos. Default: on.',
	},
	zh_CN: {
		minHeadings: '最少标题数',
		minHeadingsDesc: '笔记标题数少于此值时隐藏小地图。默认 2。',
		panelWidth: '展开面板宽度（px）',
		panelWidthDesc: '悬停展开的目录面板最大宽度。默认 240。',
		edgeOffset: '边缘距离（px）',
		edgeOffsetDesc: '小地图与阅读器边缘的间距。默认 6。',
		side: '小地图位置',
		sideDesc: '小地图停靠在阅读器的哪一侧边缘。默认靠右。',
		sideRight: '右侧',
		sideLeft: '左侧',
		showTodos: '显示待办标记',
		showTodosDesc: '当章节内含未完成待办时，在该章节横线前显示一个小红点提醒。默认开启。',
	},
	zh_TW: {
		minHeadings: '最少標題數',
		minHeadingsDesc: '筆記標題數少於此值時隱藏小地圖。預設 2。',
		panelWidth: '展開面板寬度（px）',
		panelWidthDesc: '懸停展開的目錄面板最大寬度。預設 240。',
		edgeOffset: '邊緣距離（px）',
		edgeOffsetDesc: '小地圖與檢視器邊緣的間距。預設 6。',
		side: '小地圖位置',
		sideDesc: '小地圖停靠在檢視器的哪一側邊緣。預設靠右。',
		sideRight: '右側',
		sideLeft: '左側',
		showTodos: '顯示待辦標記',
		showTodosDesc: '當章節內含未完成待辦時，在該章節橫線前顯示一個小紅點提醒。預設開啟。',
	},
	ru: {
		minHeadings: 'Минимум заголовков',
		minHeadingsDesc: 'Скрывать миникарту, если заголовков в заметке меньше. По умолчанию: 2.',
		panelWidth: 'Ширина развёрнутой панели (px)',
		panelWidthDesc: 'Максимальная ширина оглавления при наведении. По умолчанию: 240.',
		edgeOffset: 'Отступ от края (px)',
		edgeOffsetDesc: 'Зазор между миникартой и краем просмотра. По умолчанию: 6.',
		side: 'Сторона миникарты',
		sideDesc: 'У какого края области просмотра располагается миникарта. По умолчанию: справа.',
		sideRight: 'Справа',
		sideLeft: 'Слева',
		showTodos: 'Показывать метки задач',
		showTodosDesc: 'Показывать маленькую красную точку перед линией раздела, если в нём есть открытые задачи. По умолчанию: вкл.',
	},
	ja_JP: {
		minHeadings: '最小見出し数',
		minHeadingsDesc: 'ノートの見出しがこの数より少ない場合はミニマップを隠します。既定値：2。',
		panelWidth: '展開パネルの幅（px）',
		panelWidthDesc: 'ホバーで展開する目次の最大幅。既定値：240。',
		edgeOffset: '端からの距離（px）',
		edgeOffsetDesc: 'ミニマップとビューアー端の間隔。既定値：6。',
		side: 'ミニマップの位置',
		sideDesc: 'ミニマップをビューアーのどちら側の端に表示するか。既定値：右。',
		sideRight: '右',
		sideLeft: '左',
		showTodos: 'ToDoマーカーを表示',
		showTodosDesc: '未完了のToDoを含むセクションの線の前に小さな赤い点を表示します。既定値：オン。',
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
			// Stored key stays 'minimapRightOffset' even though the label is now
			// side-neutral: renaming a setting key orphans the saved value.
			'minimapRightOffset': {
				value: 6,
				minimum: 0,
				type: TYPE_INT,
				section: 'minimap',
				public: true,
				label: t.edgeOffset,
				description: t.edgeOffsetDesc,
			},
			// Enum rather than a bool: 'Left'/'Right' reads unambiguously in the
			// settings screen, and leaves room for a future 'auto' that follows
			// the note's own text direction.
			'minimapSide': {
				value: 'right',
				type: TYPE_STRING,
				isEnum: true,
				options: { right: t.sideRight, left: t.sideLeft },
				section: 'minimap',
				public: true,
				label: t.side,
				description: t.sideDesc,
			},
			'minimapShowTodos': {
				value: true,
				type: TYPE_BOOL,
				section: 'minimap',
				public: true,
				label: t.showTodos,
				description: t.showTodosDesc,
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
					side: await joplin.settings.value('minimapSide'),
					showTodos: await joplin.settings.value('minimapShowTodos'),
				};
			}
			return null;
		});
	},
});
