# Codex Pet Pause

[English](README.md)

> 一款由住在你电脑里的宠物陪伴、轻松有趣且本地优先的休息提醒 PWA。

![Codex Pet Pause 仪表盘](docs/assets/codex-pet-pause.png)

## 为什么选择 Codex Pet Pause？

Codex Pet Pause 让温和的休息不再机械。一位桌面伙伴会帮助你安排望向远处、喝水、起身活动或完整休息的小片刻；无需账号、服务器或云端同步。

## 功能

- 四种预设提醒（目视远方、喝水、起身活动、完整休息），以及可配置的自定义提醒。
- 提醒行动：现在开始、启动可选的行动倒计时、完成、稍后提醒或跳过。
- 可互动的内置猫咪 Momo：可以摸摸它，它会陪伴你的提醒。
- 在内置猫咪之外，本地导入 Codex v1 和 v2 宠物。
- 设置、提醒、宠物数据和活动历史仅保存在本地；无需账号、后端或遥测。
- 可选浏览器通知和提醒音效；通知不可用时仍提供网页内提醒。
- 应用外壳完成缓存后可离线作为 PWA 使用。
- 英语和简体中文界面，以及日间、夜间和跟随系统主题。
- 为交互控件和对话框提供键盘导航与细致的焦点管理。
- 支持减少动态效果，并可关闭界面动画。

## Codex 宠物兼容性

Codex Pet Pause 支持兼容的 Codex 宠物 v1 和 v2 文件。可以导入仅含一个 Codex 宠物的 ZIP（一个 ZIP 中只含一个宠物），也可以选择配套的 `pet.json` 与 WebP 图集作为松散文件。ZIP 可以带外层目录，只会在当前浏览器中解压，不会上传。每个 ZIP 只能包含一个宠物，压缩前后均不得超过 32 MiB，条目不得超过 128 个；清单与图集仍分别受 64 KiB 和 16 MiB 限制。

## 快速开始

环境要求：Node.js 22.12.0 或更高版本，以及 npm。

贡献者本地启动：

```bash
npm install
npm run dev
```

可复现的生产构建和本地预览：

```bash
npm ci
npm run build
npm run preview
```

## 开发

可运行以下检查：

```bash
npm run typecheck
npm run test:run
npm run test:e2e
npm run check
```

首次运行端到端测试前，请为 Playwright 安装 Chromium：

```bash
npx playwright install chromium
```

## 部署

本项目是静态 Vite PWA。公开的 GitHub Pages 地址为 [ccofallen.github.io/codex-pet-pause](https://ccofallen.github.io/codex-pet-pause/)；多数其他静态托管服务应使用根路径构建。生产环境的通知和 PWA 安装需要 HTTPS。

请参阅[中文部署指南](docs/DEPLOYMENT.zh-CN.md)，其中包含 GitHub Pages、Vercel、Netlify 和通用静态服务器的说明。

## 隐私与浏览器限制

- Codex Pet Pause 完全在前端运行，没有账号系统、后端、云同步或遥测。
- 设置、提醒、内置猫咪、本地导入宠物和活动历史会保留在当前浏览器的本地存储与 IndexedDB 中。活动历史最多保留 90 天。
- 浏览器存储或通知功能可能不可用；此时应用会提供受支持的网页内体验，并可能使用刷新后不会保留设置的临时会话。
- 后台计时、系统通知、音效和离线可用性取决于浏览器能力、权限、缓存与节能策略。
- **网页或浏览器完全关闭后，提醒会停止。**

## 贡献

欢迎提交 issue 和 pull request。请让改动保持聚焦，并为行为运行相应检查；不要将私有宠物、本机数据、凭据、构建产物或生成的浏览器文件加入仓库。

## 致谢

内置猫咪提醒音效“Exploring curious kittens meowing”归属 [ElevenLabs](https://elevenlabs.io/zh/sound-effects/kittens-meowing)。其来源、校验和与使用注意事项请参见[公开资源来源说明](docs/ASSET-PROVENANCE.md)。

## 许可证

Codex Pet Pause 以 [MIT 许可证](LICENSE)发布。
