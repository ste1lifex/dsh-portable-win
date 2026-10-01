# DSH Portable · Windows

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 **Windows 便携发行版**：
解压即用、无需安装 Node / Python / .NET，数据全部收在包内 `dsh-home\`，不碰系统目录。

> **English TL;DR** — A self-contained Windows distribution of DeepSeek Harness (an extensible
> LLM agent runtime). This repository holds the *skeleton* (launcher scripts, the WPF desktop
> shell source, dependency manifests + lockfiles, bundled plugin sources and docs). The heavy
> payload (portable Node runtime, offline pnpm store, LaTeX runtime, prebuilt `DshDesktop.exe`)
> is published as **GitHub Release assets** — or can be rebuilt locally with
> `tools\fetch-node.ps1` + `start-dsh.bat`. MIT licensed; DSH itself is MIT by DeepSeek.

---

## 这是什么 / 不是什么

| | |
| --- | --- |
| ✅ | 一套能在任意 Windows 10/11 x64 上跑起来的 **自包含** DSH 环境（自带 Node 运行时、离线依赖缓存、桌面壳） |
| ✅ | **依赖可重建**：锁文件与清单在仓库里，`store\` 缺失时首启自动联网按锁文件重装 |
| ❌ | 本仓库**不含** Node 运行时 / 离线缓存 / 预编译 exe —— 这些体积过大（数百 MB ~ 2GB），按 GitHub 约定放在 Release 资产里 |

版本：`@deepseek-ai/dsh` **0.2.0-rc.2** · `@linxin666/dsh-web-all` **^0.4.4** ·
`dsh-free-search` **0.6.5** · `dsh-pdf-reader` **^0.2.0** · `dsh-computer-use-win` **^0.2.3** ·
`dsh-latex` / `dsh-pet-perlica` / `dsh-endfield-boot`（本地插件，`link:` 随包）·
Node **v24.19.0** · pnpm **11.19.0**

---

## 用法一：下载现成包（推荐给最终用户）

1. 打开本仓库的 **Releases**，下载最新那份 `DSH-portable-<版本>-win-x64.zip`
   （**单包**，已内含离线依赖缓存与全部载荷；资产名、体积与 SHA256 **以 Release 说明为准**，本文件不写死）。
2. 解压到任意目录（例如 `D:\DSH`，路径尽量别有特殊字符；**整个文件夹可随意搬动**）。
3. 任选一个入口启动：
   - 双击 **`DshDesktop.exe`** —— 原生窗口（内嵌 WebView2），带状态/启停/更新/日志/余额；
   - 双击 **`start-dsh.bat`** —— 命令行启动，用系统浏览器打开 `http://127.0.0.1:3099`。
4. 首次启动会在本地离线展开依赖（约 2–5 分钟，不联网）。
5. 首次启动自动生成 `app-npm\.env`，把 `DEEPSEEK_API_KEY=sk-xxxx` 填进去后重启即可用；
   也可以在界面「模型设置」里配置多个 provider（DeepSeek 官方 / 超算平台 / Ollama 本地）。

> 内嵌浏览器需要系统 **Edge WebView2 运行时**（Win11 与带 Edge 的 Win10 已预装）。
> 缺失时可继续用 `start-dsh.bat` + 系统浏览器，功能完整。

## 用法二：从本仓库自行重建（推荐给开发者）

```powershell
# 1) 取运行时的最小集合：官方 Node 便携版 + pnpm（约 130MB，联网）
powershell -ExecutionPolicy Bypass -File tools\fetch-node.ps1

# 2) 启动：首启会按锁文件联网重建依赖（无 store\ 时自动跳过离线缓存）
start-dsh.bat
```

想要「离线优先」或者做完整发行包：

```powershell
# 有离线缓存时（例如从 Release 资产里拿到的 store\），启动会自动优先用它：
#   store\  ← 解压自 Release 资产
start-dsh.bat

# 组装一份可分发目录 / zip（默认单包：把 node + store + 可选 LaTeX 运行时 + exe 一起打包）
powershell -ExecutionPolicy Bypass -File tools\pack-portable.ps1
```

桌面壳 `DshDesktop.exe` 是 WPF 单文件程序，需要 **.NET 9 SDK** 自行编译：

```powershell
powershell -ExecutionPolicy Bypass -File launcher\build-desktop.ps1   # 产出根目录 DshDesktop.exe
```

---

## 目录结构

```
dsh-portable-win/
├─ DshDesktop.exe          ← 不在仓库里：Release 资产或自行编译（桌面壳，自包含 .NET）
├─ node/                   ← 不在仓库里：tools\fetch-node.ps1 生成（Node + pnpm）
├─ store/                  ← 不在仓库里：离线依赖缓存（Release 资产；缺失则联网重装依赖）
├─ dsh-home/runtimes/      ← 不在仓库里：仅 dsh-latex 的 Tectonic 引擎与 TeX 资源缓存
│                             （dsh-pdf-reader 无捆绑运行时，用系统 Python 3 + pymupdf）
├─ app-npm/                程序本体清单 + 锁文件（@deepseek-ai/dsh）
├─ dsh-home/               设置 / 补丁 / profiles（web 与 headless 的清单与锁文件）/ 预设
├─ plugins/                本地插件源码（dsh-endfield-boot、dsh-pet-perlica、dsh-latex）
├─ launcher/               桌面壳与共享引擎的 C# 源码 + 构建脚本（DshDesktop / DshHub / DshCore / IconGen）
├─ tools/                  fetch-node.ps1、pack-portable.ps1、pnpm.cmd
├─ docs/                   设计笔记与调研
├─ start-dsh.ps1/.bat      启动（首启自检 + 依赖重建 + 起服务）
├─ stop-dsh.ps1/.bat       停止
├─ repair-deps.ps1         只重建依赖链接，不启动
├─ update-dsh.ps1          检查 / 执行核心与插件升级（含备份与回滚）
├─ rollback-dsh.ps1        回滚到升级前备份
└─ dsh.cmd                 headless CLI 入口
```

---

## 自带插件与工具

| 插件 | 提供的工具 | 额外运行时 |
| --- | --- | --- |
| `dsh-pdf-reader` | `pdf_scan` / `pdf_read_page` / `pdf_render_region`：本地 CPU、PDF 内容感知阅读——正文走 PyMuPDF 文本抽取，图片 / 表格 / 公式按模型图片预算渲染成高清 PNG 交给视觉模型（`read_image`）；不是内置 OCR 引擎 | 无捆绑运行时；唯一外部依赖是系统 Python 3 + `pymupdf` |
| `dsh-free-search` | `web_search` / `advanced_search` / `platform_search` 等联网检索 | 无（纯 JS） |
| `dsh-computer-use-win` | `mcp__wincu__*`：Windows UI 自动化与截图 | 无 |
| **`dsh-latex`** | **`latex_health` / `latex_compile` / `latex_math`：把 `.tex` 或单个公式编译成 PDF** | `dsh-home/runtimes/latex-runtime-win32-x64`（Tectonic 引擎 + TeX 资源缓存） |
| `dsh-pet-perlica` | 桌面宠物（纯前端） | 无 |
| `dsh-endfield-boot` | 启动动画（纯前端） | 无 |

`dsh-latex` 的引擎不在仓库里：`start-dsh.ps1` 每次启动都会校验
`dsh-home\runtimes\latex-runtime-win32-x64`，缺失或校验失败时自动从上游 Release
下载固定版本（SHA-256 校验通过才落盘），并预热 `minimal` + `chinese` + `common`
三档 TeX 资源缓存（首次约 5–7 分钟，实测），让**离线编译**开箱可用（含中文文档）。
想预装更多宏包：

```powershell
& node\bin\node.exe plugins\dsh-latex\scripts\warm-cache.mjs --profile=chinese
```

插件本身的源码、跨平台 fetch/verify/warm 脚本、单元与集成测试都在
[`plugins/dsh-latex/`](plugins/dsh-latex/)（`README.md` / `README.zh-CN.md` /
`INSTALL.md`），可以单独 clone 出去作为独立开源仓库使用。

---

## 安全

- 仓库**不含**任何 API Key、凭证、聊天记录、附件；`app-npm\.env`、`dsh-home\.credentials.yaml`、
  `dsh-home\sessions\`、`dsh-home\storages\`、`dsh-home\attachments\`、`dsh-home\webview2-data\`
  均在 `.gitignore` 中，并且从未入库。
- 首次运行会自行生成 `app-npm\.env` 模板与匿名 ID。
- 默认权限预设为 `danger-full-access`（agent 可直接执行命令）；如需收紧请改
  `dsh-home\settings.yaml` 里的 `permission.defaultPreset`。

## 文档

| 文件 | 内容 |
| --- | --- |
| [`PORTABLE-RELEASE.md`](PORTABLE-RELEASE.md) | 便携包怎么组装、目标机怎么用、离线/联网行为、WebView2、排障 |
| [`launcher/README.md`](launcher/README.md) | 桌面壳（DshDesktop）与图标生成、构建脚本说明 |
| [`docs/web-search-backends-research.md`](docs/web-search-backends-research.md) | 联网搜索后端的实测调研（国内直连可达性） |

## 许可证

本仓库以 **MIT** 发布（见 [`LICENSE`](LICENSE)）；随包与 Release 载荷内含的第三方组件见 [`NOTICE`](NOTICE)。
DSH 本体与随包插件遵循各自许可证 ——
上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 为 MIT。
