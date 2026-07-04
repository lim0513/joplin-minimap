# Joplin Minimap

[Joplin](https://joplinapp.org/) 阅读视图的悬停展开式大纲(ToC minimap)——右侧边缘的标题刻度条,悬停展开为可点击的目录。

[English](README.md) | [日本語](README-JA.md)

## 功能

- **刻度条 Minimap** — 每个标题在阅读视图右侧显示为一根小横线,长短代表标题层级(H1 最长)
- **悬停展开** — 鼠标移上去即展开为完整目录浮层,按层级缩进,超长标题省略号截断
- **点击跳转** — 点击任意条目平滑滚动到对应标题
- **阅读位置** — 当前所在章节自动高亮
- **实时重建** — 切换笔记或编辑内容时自动重建(监听 `joplin-noteDidUpdate`,MutationObserver 兜底)
- **主题自适应** — 自动跟随明暗主题(颜色继承自 `currentColor`)
- **不打扰** — 少于 2 个标题的笔记不显示;打印/导出时不显示;不抢占焦点和键盘输入

## 安装

### 从 Joplin 插件市场(发布后)

1. Joplin → **工具 → 选项 → 插件**
2. 搜索 **Joplin Minimap**
3. 安装并重启 Joplin

### 从文件安装

1. 从 [最新 Release](https://github.com/lim0513/joplin-minimap/releases/latest) 下载 `plugin.jpl`
2. Joplin → **工具 → 选项 → 插件**
3. 点击齿轮图标,选择**从文件安装**
4. 选择下载的 `.jpl` 文件
5. 重启 Joplin

## 使用

在**渲染后的 Markdown 阅读视图**(阅读模式,或分栏编辑的预览侧)打开任意含 2 个以上标题的笔记:

- 右侧边缘出现一列刻度条
- **悬停**展开完整目录
- **点击**条目跳转到对应标题

注意:minimap 只在渲染视图中显示,纯 Markdown 编辑器和富文本编辑器中不显示。

## 实现原理

通过 markdown-it content script 向渲染视图注入两个资源:`minimap-view.js` 在每次渲染后从 `h1`–`h6` 元素动态构建 minimap,`minimap.css` 负责收起/展开样式。不改动 Markdown 渲染本身。

## 可调参数

- `src/minimap-view.js` → `MIN_HEADINGS`:显示 minimap 所需的最少标题数(默认 2)
- `src/minimap.css` → `max-width: 240px`:展开面板宽度;`right: 6px`:距右边缘距离

## 开发

零依赖,无需 `npm install`:

```bash
npm run dist
```

生成 `dist/`(Joplin **Development plugins** 设置指向项目根目录即可加载)和 `publish/`(含 `publish/plugin.jpl`)。

## 许可

MIT
