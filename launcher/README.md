# DshHub / DshDesktop —— DeepSeek Harness 图形界面

> **状态**：DshHub 已存档 —— 不再随包分发 `DshHub.exe`（已从仓库删除），源码保留于
> `launcher\DshHub\` 供查阅；如需重建可运行 `build-hub.ps1`。日常使用请用 `DshDesktop.exe`。

双击包根目录下的 `DshDesktop.exe`（桌面版）即可使用。

## DshDesktop（桌面版，推荐日常使用）

把 DSH 主界面**内嵌进原生窗口**（WebView2），像一个原生桌面应用：

* **主区域**：WebView2 内嵌 `http://127.0.0.1:3099` 的 DSH 界面；用户数据在
  `dsh-home\webview2-data`（随包移动，会话/皮肤跟着走）。
* **单行顶栏**：服务状态 + 启动 / 停止 / 重启 / 检查更新 / 立即更新 / 版本信息 / 日志 /
  刷新界面 / 浏览器打开 + 窗口按钮合成一行（46px，原来两行共 90px）；
  窗口窄于 1060 DIP 时自动收起按钮文字只留图标（带悬停提示），最后一条日志挪到底栏。
  顶栏**不放鲸鱼/字标**——网页侧栏紧接着就是同款品牌，叠两层像重复渲染；
  品牌交给网页与任务栏图标，版本号收进「版本信息」面板的「桌面外壳」行。
* **按钮样式对齐网页端**：圆角 8px（网页里最常用的 `border-radius`），深色用
  抬升底色（layer-2/layer-3）、不描边，浅色各层都是白所以留一圈 `border-l2`；
  主操作仍是 DeepSeek 蓝。窗口按钮保持系统标题栏的直角观感。
* **最大化不压任务栏**：`WindowStyle=None` + `WindowChrome` 的窗口默认会把窗口拉到
  整块显示器尺寸（含任务栏那一条），底栏会被任务栏盖住。处理 `WM_GETMINMAXINFO`，
  把最大化位置/尺寸改成当前显示器的**工作区**；所有最大化途径（按钮、双击标题栏、
  Win+↑、拖到顶端）都会经过这条消息，所以一处修好全都正常。
* **右下角余额**：底栏右下角显示 DeepSeek 官方账户余额（如 `余额 ¥76.79`），
  悬停看「总计 / 赠送 / 充值 + 更新时间」，点一下即刷新，每 10 分钟自动刷新一次；
  余额低于 10 或不可用时变琥珀色。密钥只从 `DEEPSEEK_API_KEY` 读，绝不写日志。
* **主题跟随**：外壳（顶栏/底栏/日志区/版本面板/右键菜单/提示/确认弹窗）跟着内嵌界面
  一起浅色/深色 —— 网页端怎么写，外壳就怎么变（详见下方「主题」）。
* **日志可复制**：日志区是只读 `RichTextBox`，支持拖选 / Ctrl+C / Ctrl+A，
  右键菜单「复制 / 全选 / 复制全部日志」，右上角另有「复制全部」按钮。
* 首次启动：自动环境自检（链接修复、.env 模板）→ 自动拉起服务（`-NoOpen`，不弹浏览器）
  → 检测 WebView2 运行时并加载界面。
* **WebView2 运行时**：绝大多数 Win10/11 已内置（与 Edge 同源）。缺失时首次启动会
  提示下载 Microsoft 官方引导器（约 2MB，装到当前用户，无需管理员）。
* 完全离线场景：可预先下载 WebView2 Fixed Version 运行时（约 150MB）解压到
  `dsh-home\webview2-runtime\`，DshDesktop 会优先使用（不安装、随包移动）。

## DshHub（控制台）

纯控制面板：状态、启动/停止/重启、检查/立即更新、打开界面/日志/备份、实时日志。

两者共享同一套引擎（`launcher\DshCore\`）与同一批脚本（start/stop/update/repair-deps），
行为一致、修复同步。

## 功能（DshHub 控制台）

| 功能 | 说明 |
| --- | --- |
| 启动 / 停止 / 重启服务 | 调用包内 `start-dsh.ps1` / `stop-dsh.ps1`，行为与命令行完全一致 |
| 检查更新 | 调用 `update-dsh.ps1 -Check`，只读，不修改任何文件 |
| 立即更新 | 调用 `update-dsh.ps1 -Yes`：自动停止服务 → 备份 → 升级核心与插件 → 启动自检 |
| 打开界面 | 浏览器打开 `http://127.0.0.1:3099` |
| 打开日志 / 备份 / 安装目录 | 资源管理器直达对应目录 |
| 实时日志 | 底部控制台窗口，按内容自动着色，自动滚动，可清空 |

## 关闭行为（两者一致）

* 点 ✕（或 Alt+F4）关闭时，如果服务正在运行会弹出确认：
  - **停止并退出**：先停服务再关窗口；
  - **仅退出**：只关界面，服务继续后台跑；
  - **取消**：什么都不做。
* 内置崩溃兜底：未处理异常只记录到 `logs\dsh-gui-crash.log`，不会闪退。

## 运行要求

* Windows 10/11 x64
* **无需安装任何运行时**：两个 exe 都是**自包含**单文件（内置 .NET 运行时）。
  首次运行会自动解压内置文件到临时目录（稍慢几秒属正常）。
* DshDesktop 额外需要 WebView2 Runtime（见上，通常已内置/可自动下载）。
* 若弹 SmartScreen“已保护你的电脑”提示，点“更多信息 → 仍要运行”。

## 重新构建

在装有 .NET 9 SDK 的机器上，从本目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File build-hub.ps1       # 生成 DshHub.exe
powershell -ExecutionPolicy Bypass -File build-desktop.ps1   # 生成 DshDesktop.exe
```

脚本会：
1. 用 `IconGen`（WPF）把鲸鱼 favicon 渲染成 `DshHub.ico` / `whale-*.png`；
2. 以 **win-x64 自包含单文件** 方式发布，产出包根目录的 exe
   （DshHub ~57MB，DshDesktop ~57MB，均内置 .NET 运行时，目标电脑免安装）。
   DshDesktop 另引用 `Microsoft.Web.WebView2` NuGet（构建时联网还原）。

## DshDesktop 图标（角色图，跟随深浅色）

窗口/任务栏/exe 图标取自 `IconGen\src\character.jpg`（角色原图，黑底），
由 IconGen 的角色模式生成两套 + 多尺寸 ico：

```powershell
dotnet run --project IconGen -- --character IconGen\src\character.jpg DshDesktop
# 同时生成 macOS 用的 icns 与 Dock 图标（第二段路径可省略）
dotnet run --project IconGen -- --character IconGen\src\character.jpg DshDesktop ..\macos\DSH.app\Contents\Resources
```

产出（`DshDesktop\`）：
* `icon-dark-256/48.png` —— 原图（黑底），Windows 深色模式用；
* `icon-light-256/48.png` —— 从贴边连通的黑底泛洪换成**白底**，浅色模式用
  （人物内部的纯黑——眼睛、发影——不会被误伤）；
* `DshDesktop.ico` —— 16/24/32/48/64/128/256 七个尺寸（深色版），
  csproj 的 `ApplicationIcon` 用它，资源管理器里显示的就是它。

`MainWindow.ApplyWindowIcon()` 在启动时与主题变化时按 `SystemUsesLightTheme`
在深/浅两张 PNG 之间切换（任务栏、Alt+Tab）。

传第三段路径时额外产出 macOS 那套：`DSH.icns`（16@2x…512@2x 共 8 档，深色版，
Finder/Launchpad 用）与 `dock-dark/light.png`（`app.dock.setIcon` 按系统外观切换，
浅色外观换白底版）—— 记得把两个 dock PNG 挪进 `Contents\Resources\app\`。

> 换图后如果任务栏还显示旧图标，是 Windows 的图标缓存没更新：重启 Explorer
> **不够**，要连缓存一起清（`%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache*.db`
> + `thumbcache*.db`，删完再启动 explorer）。macOS 那边换图后要重新 `codesign`。

## 目录结构

```
launcher\
  build-hub.ps1         构建 DshHub.exe（生成图标 + 发布）
  build-desktop.ps1     构建 DshDesktop.exe（发布自包含单文件）
  IconGen\              WPF 小工具：把 whale SVG 路径渲染成多尺寸 .ico / PNG
  DshCore\              共享引擎（路径/脚本执行/环境自检/状态/版本/更新/关闭行为）
  DshHub\               WPF 控制台源码
  DshDesktop\           WPF 桌面版源码（WebView2 内嵌 DSH 界面 + 控制条）
  publish\              发布中间产物（已 gitignore）
  publish-desktop\      桌面版发布中间产物（已 gitignore）
```

## 余额（右下角）

`Balance.cs` 调 DeepSeek 官方 `GET https://api.deepseek.com/user/balance`
（`Authorization: Bearer <key>`），取 `balance_infos` 里的人民币那条（官方会同时返回
USD/CNY 两条，USD 通常是 0）。密钥来源：进程环境变量 `DEEPSEEK_API_KEY` →
`app-npm\.env` → 包根 `.env`，只放进请求头，不落日志、不进 tooltip。

显示：`余额 ¥76.79`；悬停显示 `总计 / 赠送 / 充值 / 更新时间`；点一下立刻刷新。

刷新时机：启动查一次 → 之后**每 5 分钟**自动刷新一次 → 切回窗口时若距上次超过
60 秒也会补一次；查询失败（网络抖动 / 401）自动降到**每 1 分钟**重试，成功后回到 5 分钟。
余额 < 10 或 `is_available` 为 false 时数字变琥珀色；没配密钥、401、网络失败时显示
`余额 —`，原因写在悬停提示里（不弹窗、不打断）。

## 主题（外壳如何跟随内嵌界面）

DSH 网页端把深浅色写在 `<body data-ds-dark-theme>`：偏好 `system` 时看
`prefers-color-scheme`（WebView2 默认跟随 Windows 应用主题），也可以在设置里
固定为 light / dark。桌面外壳按下面的顺序取色，保证和网页一致：

1. **页面回传**（权威）：启动时注入一段脚本，用 `MutationObserver` + 1.5s 兜底轮询
   观察该属性，并把 `--dsw-alias-*` 设计令牌（bg-base / label-* / border-* 等）
   通过 `chrome.webview.postMessage` 回传宿主；令牌用「探针元素 + 计算样式」解析，
   所以 `var()` 链、皮肤换色都能拿到真实 rgb 值。
2. **注册表兜底**：页面还没加载完（启动屏阶段）或页面打不开时，读
   `HKCU\...\Themes\Personalize\AppsUseLightTheme`。
3. **窗口/任务栏图标**：始终按 `SystemUsesLightTheme`（图标贴任务栏，跟随系统更稳）。

实现细节：`DshDesktop\Theme.cs` 是唯一调色板来源，XAML 里所有颜色都必须写成
`{DynamicResource Xxx}` —— **WPF 会把 XAML 里声明的画刷冻结**，就地改色不会重绘，
只能通过替换资源值让动态引用重新求值。新增颜色要同时登记到 `Theme.cs` 的
`Palette` 表，否则切主题时它不会变。

调试：`DSH_DESKTOP_THEME=light|dark` 强制主题（同时写死 WebView2 配色方案，
默认会还原成 Auto，不会留下持久状态）；`DSH_DESKTOP_DEBUG_THEME=1`
把页面回传的深浅与令牌打印到日志。

## 设计说明

* GUI 只负责界面与调度，**所有实际操作仍走包内久经验证的 PowerShell 脚本**，
  因此升级流程、依赖修复、身份校验等逻辑不会与脚本分叉。
* 运行方式：GUI 通过 `powershell.exe -Command` 以 UTF-8 输出方式调用脚本，
  实时捕获 stdout/stderr 并在日志窗口按行着色。
* 日志窗口用只读 `RichTextBox`（`FlowDocument`）而不是 `TextBlock` 列表：
  逐行颜色保留的同时，原生支持鼠标拖选与 Ctrl+C / Ctrl+A。
* 确认弹窗（`DshHub\AskDialog.xaml`，关闭确认 / 更新确认共用）复用同一套画刷与按钮样式，
  所以主题、圆角、hover 都和主窗口一致；标题栏也去掉了那块白色鲸鱼底标。
* 图标取自已发布包 `@deepseek-ai/dsh-web-frontend/dist/favicon.svg`（鲸鱼）。
