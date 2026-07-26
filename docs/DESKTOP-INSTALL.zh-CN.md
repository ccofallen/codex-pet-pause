# Codex Pet Pause 桌面版下载与安装

[README](../README.zh-CN.md) | [English](DESKTOP-INSTALL.md)

请从 [Codex Pet Pause GitHub Releases
发布页](https://github.com/ccofallen/codex-pet-pause/releases) 下载桌面伴侣。
首批公开安装包未签名。请选择与你的操作系统和处理器架构匹配的安装包，
然后按照下面对应的说明操作。

## macOS

### 选择正确的 DMG

- Apple Silicon Mac（M1、M2、M3、M4 或更新型号）应下载文件名以
  `-mac-arm64.dmg` 结尾的文件，例如 `Codex-Pet-Pause-0.2.0-mac-arm64.dmg`。
- Intel Mac 应下载文件名以 `-mac-x64.dmg` 结尾的文件，例如
  `Codex-Pet-Pause-0.2.0-mac-x64.dmg`。

如果不确定 Mac 的类型，请打开 Apple 菜单 > 关于本机；芯片或处理器信息会
显示你使用的是 Apple Silicon 还是 Intel。

### 安装并打开

1. 打开下载的 DMG。
2. 将 `Codex Pet Pause` 拖入 DMG 窗口中的 `Applications`（应用程序）文件夹；
   不再需要 DMG 时可以将它推出。
3. 首批安装包未签名，因此 macOS Gatekeeper 可能会阻止直接双击启动。在 Finder
   中打开 `Applications`（应用程序），按住 Control 键点按 `Codex Pet Pause`，
   选择 **打开**，然后在确认对话框中再次选择 **打开**。
4. 如果 macOS 仍然阻止启动，请打开**系统设置 > 隐私与安全性**，找到关于
   `Codex Pet Pause` 的提示并选择**仍要打开**。按要求完成验证，然后确认**打开**。

对于这个未签名版本，Gatekeeper 通常只会在首次启动时要求确认。

## Windows

请下载 x64 NSIS 安装程序，即文件名以 `-windows-x64.exe` 结尾的文件，例如
`Codex-Pet-Pause-0.2.0-windows-x64.exe`。运行安装程序并按提示安装、启动
Codex Pet Pause。

由于安装程序未签名，Windows SmartScreen 可能显示“Windows 已保护你的电脑”。
如果确认文件来自 GitHub Release 发布页，请选择 **More info > Run anyway**（更多信息 >
仍要运行），然后继续安装。

## Linux

Linux 安装包面向 x64。你可以选择便携式 AppImage 或 DEB 安装包。

### AppImage

下载以 `.AppImage` 结尾的文件，例如
`Codex-Pet-Pause-0.2.0-linux-x86_64.AppImage`。首次启动前，请使用以下任一方式
将它标记为可执行：

- 在文件管理器中打开文件属性，启用**允许将文件作为程序执行**（不同桌面环境的
  文案可能不同），然后关闭属性窗口。
- 在包含该文件的目录中打开终端并运行
  `chmod +x Codex-Pet-Pause-0.2.0-linux-x86_64.AppImage`。

然后双击 AppImage，或从文件管理器启动它。

### DEB

下载以 `.deb` 结尾的文件，例如
`Codex-Pet-Pause-0.2.0-linux-amd64.deb`。使用桌面软件包管理器打开它，选择**安装**；
如果系统要求，请输入密码。安装后，从应用程序菜单启动 Codex Pet Pause。

## 本地数据、更新与卸载

Codex Pet Pause 以本地优先为原则。桌面应用中的网页界面会将设置和提醒状态存储在
`localStorage` 中；导入的宠物和活动历史存储在 `IndexedDB` 中。Electron 会将窗口和
停靠状态存储在 `app.getPath("userData")` 对应的目录中。这些都是本地应用数据存储，
不是账号或云端服务。

发布和安装流程不会上传或同步这些数据。这个未签名发行版不提供自动更新。要更新，
请从 [GitHub Releases 发布页](https://github.com/ccofallen/codex-pet-pause/releases)
下载较新的安装包，并将它安装到现有的 Codex Pet Pause 应用上，保持相同的应用身份。
更新时不要删除现有的应用数据。

卸载程序不会有意上传或同步本地数据。卸载会移除已安装的程序；根据操作系统和软件包
管理器的不同，本地数据可能仍保留在系统的应用数据目录中。只有在你也希望彻底删除
这些数据时，才需要另外删除本地应用数据。
