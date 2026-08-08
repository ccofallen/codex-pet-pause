# Codex Pet Pause 0.3.0 发布说明

[English](RELEASE-NOTES-0.3.0.md)

发布日期：2026-08-08

## Android 悬浮宠物

- 首次为 Android 9 或更高版本的手机，包括 arm64 设备提供已签名 Android 安装包。
- 通过前台悬浮服务运行宠物，并明确提供通知、悬浮窗、显示宠物、隐藏宠物、设置和
  退出控制。
- 支持提醒队列、自定义提醒、重启恢复、本地宠物导入和受限 Petdex 交接。
- 设置、提醒、活动记录与导入宠物仅保存在本地，不需要账号、云同步或遥测。

侧载前请阅读 [Android 安装与权限指南](ANDROID-INSTALL.zh-CN.md)。

## 发布资产

`v0.3.0` GitHub Release 准备包含：

- `Codex-Pet-Pause-0.3.0-android-universal.apk`
- `Codex-Pet-Pause-0.3.0-android-universal.apk.sha256`
- `Codex-Pet-Pause-0.3.0-mac-arm64.dmg`
- `Codex-Pet-Pause-0.3.0-mac-x64.dmg`
- `Codex-Pet-Pause-0.3.0-windows-x64.exe`
- `Codex-Pet-Pause-0.3.0-linux-x64.AppImage`
- `Codex-Pet-Pause-0.3.0-linux-x64.deb`

Android 工作流构建一个不含原生 `.so` 库的通用纯 JVM/WebView APK，并验证正式证书、
清单身份与版本、网页内容、权限和 SHA-256，且只上传 APK 与校验和。桌面工作流的构建矩阵、打包命令、架构和
资产名称保持不变。

## 发布门槛

本文档是发布候选说明，并不表示 `v0.3.0` 已发布。自动验证、独立审查和 arm64 实体
设备验收清单完成前，不得创建标签或发布 GitHub Release。

### 通用 APK 兼容性

通用 Android APK 不包含任何原生 `.so` 库，是纯 JVM/WebView 软件包；它兼容 arm64 设备，也兼容 Android 运行时和系统 WebView 支持的其他 CPU 架构。
