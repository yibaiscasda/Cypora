# 第三方组件声明

Cypora 使用以下开源组件。Cypora 自身的 MIT 许可证不替代各组件的许可证和版权声明。

| 组件 | 当前版本 | 许可证 | 项目 |
| --- | --- | --- | --- |
| Electron | 41.1.0 | MIT；Chromium 等第三方组件另见运行时声明 | https://github.com/electron/electron |
| Vditor | 3.11.2 | MIT | https://github.com/Vanessa219/vditor |
| MathJax | 4.1.0 | Apache-2.0 | https://github.com/mathjax/MathJax |
| MathJax New Computer Modern | 4.1.0 | Apache-2.0；字体包内附额外声明 | https://github.com/mathjax/MathJax-fonts |
| Lucide | 随源码附带的图标片段 | ISC | https://github.com/lucide-icons/lucide |
| rcedit | 5.0.2，构建工具 | MIT | https://github.com/electron/rcedit |

完整依赖版本以 `package-lock.json` 为准。Vditor 自带的编辑、高亮和渲染资源包含其他组件，各资源原始许可证与声明保留在依赖包中。

Windows 发布包保留 Electron 根目录的 `LICENSE`、`LICENSES.chromium.html`，以及 `resources/app/node_modules` 中随各依赖发布的许可证。Lucide 声明位于 `assets/LUCIDE-LICENSE.txt`。

本项目支持读取 Codex 对话文件和在本机 Typora 中打开 Markdown，这些产品名称仅用于说明兼容功能；本项目不代表这些产品的官方发行版。
