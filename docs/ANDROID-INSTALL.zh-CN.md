# 在 Android 上安装 Codex Pet Pause

[English](ANDROID-INSTALL.md)

## 系统要求

- Android 9 或更高版本。
- 受支持的 Android 手机，包括 arm64 设备。
- 允许用于下载的浏览器或文件管理器安装 APK。

## 下载并验证

打开 [Codex Pet Pause GitHub Releases 发布页](https://github.com/ccofallen/codex-pet-pause/releases)，
从同一个 `v0.3.0` 发布版本下载：

- `Codex-Pet-Pause-0.3.0-android-universal.apk`
- `Codex-Pet-Pause-0.3.0-android-universal.apk.sha256`

安装前验证校验和：

```bash
sha256sum -c Codex-Pet-Pause-0.3.0-android-universal.apk.sha256
```

在 macOS 上：

```bash
shasum -a 256 Codex-Pet-Pause-0.3.0-android-universal.apk
cat Codex-Pet-Pause-0.3.0-android-universal.apk.sha256
```

两条命令显示的十六进制值必须完全一致。

## 侧载 APK

1. 从“下载”或文件管理器打开 APK。
2. 若 Android 阻止安装，请进入系统提供的“安装未知应用”页面，只为当前浏览器或
   文件管理器允许“来自此来源的应用”。
3. 返回 APK 并选择“安装”。
4. 如果平时不侧载应用，安装后可再次关闭“允许来自此来源”。

由于 APK 不是从 Google Play 安装，Android 可能显示 Play Protect 检查。继续前，
请确认文件名与 SHA-256 均来自 GitHub Release。

## 首次启动与权限

Codex Pet Pause 会在需要时解释权限，不会在启动时一次请求全部权限：

1. Android 13 或更高版本上允许通知。提醒和前台服务控制需要通知权限。
2. 选择“启用悬浮宠物”并阅读说明。
3. 打开 Android 的“显示在其他应用上层”页面，允许 Codex Pet Pause。
4. 返回应用。应用会重新检查授权，确认成功后才启动悬浮宠物。

拒绝任一权限后，设置页面仍可使用，之后可选择“重新授权”。如果悬浮窗权限被撤销，
宠物会从其他应用上层移除，直到重新授权。

## 常驻通知与宠物控制

悬浮宠物服务运行时，Android 要求显示常驻通知。这是预期行为，也能让后台运行保持
透明。可通过应用和通知中的控制执行“显示宠物”“隐藏宠物”、打开设置或“退出”。
“退出”会停止服务，并移除悬浮宠物和常驻通知。

如果希望提醒与重启恢复继续工作，请不要强制停止应用。

## 本地数据、升级与备份

设置、提醒、活动记录和导入宠物仅保存在手机本地。Codex Pet Pause 没有账号、云同步
或遥测。只要新 APK 使用同一正式密钥签名，直接覆盖安装即可保留本地数据。除非希望
删除全部应用数据，否则升级前不要卸载。

Android 更新通过 [GitHub Releases](https://github.com/ccofallen/codex-pet-pause/releases)
提供，不会静默自动更新。下载新 APK、验证校验和，然后覆盖安装当前版本。

## 电池与后台运行建议

部分厂商会主动停止后台服务。如果提醒延迟或宠物消失：

- 取消 Codex Pet Pause 的电池限制，或将电池使用设为“不受限制”。
- 如果系统提供相关选项，请允许后台活动和自动启动。
- 保持通知开启，不要禁用常驻服务通知。
- 系统更新后重新打开应用，并确认悬浮窗权限仍然有效。

不同品牌的菜单名称可能不同。可在系统设置中搜索“电池优化”“后台活动”“自动启动”
或“显示在其他应用上层”。

## 故障排除

- **APK 无法安装：**确认设备为 arm64 且系统不低于 Android 9，重新下载两个文件并
  验证 SHA-256。
- **宠物只在设置页内显示：**允许“显示在其他应用上层”，返回应用并选择“显示宠物”。
- **没有提醒：**开启通知、检查勿扰模式，并按照上面的电池建议调整设置。
- **升级后仍是旧版本：**不要卸载，直接安装新版已签名 APK。如果 Android 报告签名
  冲突，请停止安装并从官方 GitHub Release 重新获取 APK。

## 维护者签名设置

正式构建缺少任一签名配置时会立即失败；调试构建仍可直接运行
`npm run android:apk:debug`。

本地密钥库与凭据只能保存在已被 Git 忽略的 `.signing/` 目录。如果还没有密钥，
请按照[英文指南中的无回显生成命令](ANDROID-INSTALL.md#maintainer-signing-setup)
生成 4096 位 RSA、有效期 100 年的 JKS 密钥，并将密钥库与
`signing.properties` 权限设为 `600`。

**发布前必须把两个文件备份到加密且访问受控的位置。**密钥库或凭据丢失后，将无法以
同一 Android 应用身份提供覆盖升级。绝不要提交这些文件，也不要把密码粘贴到 issue、
日志、工作流 YAML 或发布说明中。

本地构建与验证：

```bash
npm ci
npm run android:apk:release
mkdir -p .artifacts/android
cp android/app/build/outputs/apk/release/app-release.apk \
  .artifacts/android/Codex-Pet-Pause-0.3.0-android-universal.apk
(
  cd .artifacts/android
  shasum -a 256 Codex-Pet-Pause-0.3.0-android-universal.apk \
    > Codex-Pet-Pause-0.3.0-android-universal.apk.sha256
)
npm run check:android-release
```

已登录并确认仓库权限后，可使用英文指南中的四条
[`gh secret set` 命令](ANDROID-INSTALL.md#maintainer-signing-setup)直接从忽略文件
设置 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`
和 `ANDROID_STORE_PASSWORD`，命令不会在终端显示凭据。

推送 `v0.3.0` 会同时启动 Android 和桌面 GitHub Actions 工作流。Android 工作流执行
干净的 arm64 正式构建并验证签名，只上传精确命名的 APK 与校验和；桌面工作流继续发布
macOS arm64 与 x64、Windows x64、Linux x64 资产，清理过滤器不会删除 Android 资产。
自动检查、独立审查和实体设备验收全部完成前，不要创建标签。

### 通用 APK 兼容性

通用 Android APK 不包含任何原生 `.so` 库，是纯 JVM/WebView 软件包；它兼容 arm64 设备，也兼容 Android 运行时和系统 WebView 支持的其他 CPU 架构。
