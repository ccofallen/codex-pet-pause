# 部署 Codex Pet Pause

[English](DEPLOYMENT.md)

## 环境要求

请使用 Node.js `>=22.12.0` 和 npm。从干净的检出目录开始，以确保遵循锁文件：

```bash
npm ci
```

## 一次构建，任意静态托管

若网站部署在域名根路径，请生成生产文件：

```bash
npm run build
```

将 `dist/` 中的内容上传至任意静态托管服务。本项目是静态 Vite PWA，不需要应用服务器或数据库。

## GitHub Pages

本仓库包含 [Pages 部署工作流](../.github/workflows/deploy-pages.yml)。每次推送到 `main` 时，它会安装依赖、运行检查、构建 Pages 版本、验证构建并部署 `dist/`。

在仓库中打开 **Settings → Pages**，并将发布来源选择为 **GitHub Actions**。工作流成功后，网站地址为 [https://ccofallen.github.io/codex-pet-pause/](https://ccofallen.github.io/codex-pet-pause/)。

GitHub Pages 会将本项目托管在 `/codex-pet-pause/` 下，因此工作流运行：

```bash
npm run build:pages
```

该构建会设置匹配的 `/codex-pet-pause/` base；不要把根路径构建产物上传到这个子路径。

## Vercel

从本仓库创建 Vercel 项目，并使用以下项目设置：

- Build Command：`npm run build`
- Output Directory：`dist`

当项目位于域名根路径时，应使用这个根路径构建。若有意将它托管在 Vercel 子路径下，请遵循[Nginx 与其他静态服务器](#nginx-与其他静态服务器)中的子路径说明。

## Netlify

从本仓库创建 Netlify 站点，并设置：

- Build command：`npm run build`
- Publish directory：`dist`

根路径部署时，Netlify 可以直接发布生成的文件。子路径部署还需要匹配的构建 base 和主机端回退规则，见下文。

## Nginx 与其他静态服务器

根路径部署时，将 `dist/` 的内容复制到服务器静态目录，并配置单页应用回退：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

上面的配置块**仅适用于根路径部署**。若要部署在 `/breaks/` 等自定义子路径，须通过 Vite 模式或等效配置传入匹配的 `VITE_BASE_PATH`，再为同一个前缀配置对应的 Nginx `location` 和回退。例如，在选定 Vite 模式使用的环境文件中写入 `VITE_BASE_PATH=/breaks/`，重新构建，并使回退指向该子路径的 `index.html`。根路径构建配合子路径回退，或子路径构建部署在根路径，都会请求错误的资源和导航路径。

其他静态服务器也需要同样两项：发布 `dist/` 文件，并将该确切前缀下的客户端路由重写到 `index.html`。

## Windows、Linux 和 macOS 说明

本指南中的 npm 命令可在 PowerShell、命令提示符、macOS Terminal 和 Linux shell 中运行：

```bash
npm ci
npm run build
```

建议使用 Vite 模式或环境文件设置 `VITE_BASE_PATH`，以保持跨平台一致；Windows 和 POSIX shell 的行内环境变量写法不同。base 路径请使用正斜杠，例如 `/breaks/`。

## 更新已有部署

拉取目标版本，重新安装依赖、构建，并替换之前发布的 `dist/` 文件：

```bash
npm ci
npm run build
```

对于 GitHub Pages，将版本推送到 `main`，由内置工作流重新构建和部署。构建 base 必须与已发布 URL 保持一致；`npm run build:pages` 只用于 `/codex-pet-pause/` Pages 目标。

## HTTPS、通知与 PWA 行为

生产部署必须使用 HTTPS。浏览器需要安全上下文才能可靠使用通知、Service Worker 和 PWA 安装；`localhost` 是本地开发例外。用户还必须授予通知权限，浏览器或操作系统的省电策略可能延迟后台工作。

提醒只会在应用仍处于浏览器打开状态时运行。关闭标签页或关闭浏览器后提醒会停止；浏览器关闭后，PWA 不会继续运行后台提醒进程。

## 故障排除

- **子路径下资源或页面返回 404：** 使用与服务前缀完全一致的 `VITE_BASE_PATH` 重新构建，并为该前缀配置静态 location 与 SPA 回退。
- **直接访问页面时服务器返回 404：** 添加上面的根路径 `try_files` 回退，或为已部署子路径添加等效规则。
- **没有收到通知：** 确认 HTTPS，在浏览器中授予权限，并检查系统通知和专注模式设置。
- **仍显示旧版本：** 部署完成后刷新；必要时清除站点缓存数据或注销 Service Worker。
- **Pages 地址不正确：** 确认 Settings → Pages 使用 GitHub Actions，且 Pages 工作流采用 `/codex-pet-pause/` 构建。
