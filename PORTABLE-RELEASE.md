# DSH 便携版（Windows）—— 打包与部署说明

本文件写给**维护者**：便携包由什么组成、怎么组装、目标机器上会发生什么。

> 最终用户请直接看 [`README.md`](README.md)。

---

## 一、仓库里有什么、Release 里有什么

| | 内容 | 体积 |
| --- | --- | --- |
| **仓库（骨架）** | 启动/停止/升级/回滚脚本、`launcher\` 全部 C# 源码与构建脚本、`app-npm` 与 `profiles\web` 的 `package.json` + `pnpm-lock.yaml`、本地插件源码、图标、文档 | ~4 MB |
| **Release 资产** | 预编译 `DshDesktop.exe`、`node\`（Node v24.19.0 + pnpm 11.19.0）、`store\`（pnpm 离线缓存，含全部 win32-x64 平台包）、`dsh-home\runtimes\dshdoc-runtime-win32-x64\`（CPython + Tesseract）、`vendor\webview2\`（可选，WebView2 离线安装器）、`vendor\native-fixups\`（pnpm 无法重建的原生/下载产物） | 约 2 GB |

GitHub 单文件上限 100 MB，`node.exe`、离线缓存等必然超限，所以**载荷一律走 Release 资产**；
仓库保持轻量，clone 后也能靠 `tools\fetch-node.ps1` + 联网重建依赖跑起来。

## 二、怎么组装一份完整便携包（维护者）

```powershell
# 0) 前置：一台已能跑起来的开发目录（含 node\ store\ vendor\ dsh-home\runtimes\ DshDesktop.exe）

# 1) 桌面壳（在 launcher\ 里，需要 .NET 9 SDK）
powershell -ExecutionPolicy Bypass -File launcher\build-desktop.ps1
#    → 产出根目录 DshDesktop.exe（自包含单文件）

# 2) 组装可分发目录 + zip
powershell -ExecutionPolicy Bypass -File tools\pack-portable.ps1
#    → dist\DSH-portable-win-x64\ 与 dist\DSH-portable-win-x64.zip
```

`tools\pack-portable.ps1` 会把仓库骨架 + `node\` + `store\`（存在时）+ `vendor\`（存在时）
+ `dsh-home\runtimes\`（存在时）+ `DshDesktop.exe`（存在时）一起复制并打包，
再剔除本机数据（`.env`、`sessions`、`storages`、`attachments`、`webview2-data`、`logs` 等）。

不需要离线能力时，去掉 `store\` 即可得到一个**联网首启**的小包（首启按锁文件从 npm registry 重装依赖）。

## 三、目标机器上会发生什么

1. 解压到任意目录，整个文件夹可以随意搬动（脚本用相对路径）。
2. 双击 `DshDesktop.exe`（桌面界面）或 `start-dsh.bat`（浏览器界面）。
3. `start-dsh.ps1` 做自检：
   - `app-npm\node_modules\@deepseek-ai\dsh` 缺失 / 锁文件变化 → 重装核心依赖；
   - `dsh-home\profiles\web\node_modules` 缺失 / 锁文件变化 → 重装插件依赖；
   - 有 `store\` → 先 `pnpm install --offline --frozen-lockfile --store-dir store`；
     失败或没有 `store\` → 直接联网 `pnpm install --frozen-lockfile`；
   - 从 `vendor\native-fixups\` 回填 pnpm 无法重建的原生产物（存在时）；
   - 检查 `dsh-home\runtimes\dshdoc-runtime-win32-x64`（OCR）；
   - 启动核心（端口 3099，`DSH_NO_UPDATE_CHECK=1`），核心自己打开带认证 token 的地址。
4. 首次启动若没有 `app-npm\.env`，从 `.env.example` 生成模板并提示填写 API Key。

### 哪些功能需要联网

| 不需要网络 | 需要网络 |
| --- | --- |
| 启动、会话、文件读写、代码执行、插件加载 | 调用 LLM API（DeepSeek 官方 / 超算平台 / 自建） |
| 依赖重建（有 `store\` 时）/ PDF/Word/Excel/PPT 解析 + OCR | 无 `store\` 时的依赖安装、联网搜索（dsh-free-search）、cloudflared 隧道 |

## 四、WebView2（桌面壳的内嵌浏览器）

`DshDesktop.exe` 依赖系统的 **Edge WebView2 运行时**。Win11 / 带 Edge 的 Win10 已预装；
缺失时：

1. 用 `vendor\webview2\` 里的离线安装器（如果随 Release 提供），或
2. 干脆用 `start-dsh.bat` + 系统浏览器 —— 功能完整，不依赖 WebView2。

## 五、安全与隐私

打包脚本会剔除：`app-npm\.env`、`dsh-home\.credentials.yaml`、`dsh-home\sessions\`、
`dsh-home\storages\`、`dsh-home\attachments\`、`dsh-home\webview2-data\`、
`dsh-home\dsh-usage\`、`dsh-home\llm-deepseek\`、`logs\`、`backups\`、`dsh.pid`。
`tools\pack-portable.ps1` 打包后会再扫一遍，发现 `.env` / 凭证类文件会直接报错中止。

## 六、排障

| 现象 | 处理 |
| --- | --- |
| 首启卡在「正在重建依赖」 | 看 `logs\`；确认 `node\bin\node.exe` 存在（`tools\fetch-node.ps1` 可重建） |
| 提示依赖重建失败 | 有网络时重跑 `start-dsh.bat`；离线机器需补 `store\` 或 `vendor\native-fixups\` |
| 浏览器 401 | 裸地址会被拒；用核心打印的带 token 地址（`logs\dsh-web.out.log` 里 `dsh web:` 那条） |
| 桌面壳白屏 | 大多是 WebView2 缺失/驱动问题：改用 `start-dsh.bat`，或装 WebView2 运行时 |
| 升级后起不来 | `rollback-dsh.ps1 -List` / `-Restore <备份名>` |
