# dsh-latex

[English](README.md) | 中文

**给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的自包含 LaTeX 工具。**
在对话里直接把 `.tex` 文档或单个公式编译成 PDF —— 引擎是固定版本的
[Tectonic](https://github.com/tectonic-typesetting/tectonic)，**不需要系统装 TeX，
也没有任何 npm 运行时依赖**。

```text
latex_health    引擎装好了吗？资源缓存能离线编译吗？
latex_compile   .tex 文件或内联文档 -> PDF
latex_math      单个公式 -> 紧贴内容的 PDF
```

仓库本体只有几百 KB：20 MB 的引擎二进制和 TeX 资源缓存都放在包外
（`<DSH_HOME>/runtimes/latex-runtime-<平台>-<架构>`），由固定版本 + SHA-256 校验的
脚本下载，这也是新机器唯一需要联网的部分。

---

## 为什么选 Tectonic

| | |
| --- | --- |
| **单文件** | 不用装 TeX Live / MiKTeX，没有 `kpsewhich`、`fmtutil`，不需要管理员权限。 |
| **按需取资源** | 只下载文档真正加载的 TeX Live 文件（通常几 MB），而不是完整发行版的 ~5 GB。 |
| **预热后可离线** | `scripts/warm-cache.mjs` 预填缓存，并用 `--only-cached` 编译自证。 |
| **跨平台** | Windows x64、macOS x64/arm64、Linux x64/arm64（musl 静态链接）。 |
| **MIT** | 与本插件同一许可证族，见 [NOTICE](NOTICE)。 |

---

## 安装

### 随 DSH Windows 便携版（本仓库的使用场景）

**什么都不用做。** `start-dsh.ps1` 每次启动都会校验引擎：首次自动下载，并预热
`minimal` + `chinese` + `common` 三档资源集（约 5–7 分钟，一次即可）；校验失败会隔离
并重下，彻底失败只临时禁用本插件，不影响其他功能。

### 装进任意 DSH profile

```bash
# 1) 让 profile 依赖这个包
cd "$DSH_HOME/profiles/web"
pnpm add link:/path/to/dsh-latex          # 发布到 npm 后可写 pnpm add dsh-latex

# 2) 在 dsh.profile.bundles 里登记，让它自带的 cordis.patch.yml 生效
#    dsh.profile.bundles: [ ..., "dsh-latex" ]
```

然后取引擎、预热缓存：

```bash
node node_modules/dsh-latex/scripts/fetch-runtime.mjs
node node_modules/dsh-latex/scripts/warm-cache.mjs --profile=chinese
```

重启 harness，用 `latex_health` 确认结果。完整步骤（含在干净机器上从零重建）
见 [INSTALL.md](INSTALL.md)。

---

## 工具

### `latex_compile`

```jsonc
{
  "source": "\\documentclass{article}\\begin{document}你好\\end{document}",
  "output_name": "hello"
}
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `source_path` | string | 已存在的 `.tex` 文件（须在会话工作区或 `allowedLocalRoots` 内）。与 `source` 互斥。 |
| `source` | string | 内联完整文档，需含 `\documentclass`。 |
| `output_name` | string | 结果基名（不含扩展名）。默认取源文件名，内联时为 `document`。 |
| `output_path` | string | 显式输出路径。默认与源文件同目录，内联时落在会话工作区。 |
| `output_format` | enum | `pdf`（默认）、`xdv`、`html`、`aux`。 |
| `offline` | boolean | 只用本地缓存编译，缺文件就失败而不是联网取。 |
| `keep_intermediates` | boolean | 额外保留 `.aux`/`.log`/`.toc`。 |
| `synctex` | boolean | 生成 SyncTeX。 |
| `reruns` | integer | 额外编译遍数。 |
| `timeout_ms` | integer | 超时（默认 `defaultTimeoutMs`，180000）。 |
| `search_paths` | string[] | 额外的**已授权**目录，用于解析 `\input`/`\includegraphics`。 |

### `latex_math`

```jsonc
{
  "expression": "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx=\\sqrt{\\pi}",
  "packages": ["physics"],
  "border_pt": 4,
  "output_name": "gaussian"
}
```

内部用 `\documentclass[border=<n>pt,varwidth]{standalone}` 并预载
`amsmath`/`amssymb`/`amsfonts`，页面紧贴公式裁剪。

### `latex_health`

报告 `ready`、引擎路径与版本、运行时目录及其解析来源、缓存目录与文件数/字节数，
以及缓存是否已经足够离线编译。

---

## 配置

```yaml
# dsh-home/profiles/web/cordis.patch.yml
- id: dsh-latex
  config:
    runtimeDir: !!js "process.env.DSH_HOME + '/runtimes/latex-runtime-' + process.platform + '-' + process.arch"
    allowedLocalRoots: []
    offline: false
    allowShellEscape: false
    defaultTimeoutMs: 180000
```

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `runtimeDir` | `<DSH_HOME>/runtimes/latex-runtime-<平台>-<架构>` | 引擎、`manifest.json` 与 `cache/` 所在目录。 |
| `enginePath` | — | 用你自己装的 Tectonic；其所在目录即运行时目录。 |
| `cacheDir` | `<runtimeDir>/cache` | 即 `TECTONIC_CACHE_DIR`，可多机共享。 |
| `offline` | `false` | 让所有调用默认只用缓存。 |
| `untrusted` | `true` | 禁用文档里的 `\write18`。 |
| `allowShellEscape` | `false` | 显式开启 `\write18`（需同时 `untrusted: false`）。 |
| `allowedLocalRoots` | `[]` | 额外可读写 `.tex` 的目录。 |
| `allowWorkspaceFiles` | `true` | 同时授权会话工作区。 |
| `keepIntermediates` | `false` | 默认保留中间文件。 |
| `defaultTimeoutMs` / `maxTimeoutMs` | `180000` / `900000` | 单次超时及其上限。 |
| `maxSourceBytes` | `2000000` | 内联源码大小上限。 |
| `maxOutputChars` | `20000` | 回显给模型的引擎日志上限。 |
| `debug` | `false` | 打印真实引擎参数。 |

环境变量覆盖：`DSH_LATEX_RUNTIME_DIR`、`DSH_LATEX_CACHE_DIR`。

---

## 轻量化重建

```bash
git clone https://github.com/ste1lifex/dsh-latex
cd dsh-latex
node scripts/fetch-runtime.mjs          # 20 MB，SHA-256 校验
node scripts/warm-cache.mjs             # 可选：让离线编译可用
node --test "test/unit/**/*.test.mjs"   # 不需要引擎
```

**没有构建步骤**：纯 ESM JavaScript，无打包器、无 `pnpm install`。唯一要求是
Node `^22.19.0 || >=24.0.0`（DSH 本身也要求这个版本）。

想搬引擎而不是重下：整个 `latex-runtime-<平台>-<架构>` 目录复制走，把 `runtimeDir`
指过去即可；里面的固定版本清单每次启动都会重新校验。

---

## 安全

- **文档默认视为不可信**：除非运维同时设 `untrusted: false` 与
  `allowShellEscape: true`，`\write18` 始终关闭。
- **读写双重授权**：先做词法检查（拒绝 UNC 共享、设备命名空间、目录穿越），
  再做真实路径检查（拒绝符号链接逃逸）。
- **引擎是校验过的，不是被信任的**：下载比对源码中固定的 SHA-256，解出的二进制
  摘要写入 `manifest.json` 并在每次启动时复核。
- **压缩包成员名会被清洗**：自带的 ZIP / `tar.gz` 解包器拒绝绝对路径与穿越名。
- **没有遥测**；除固定下载外不联网（Tectonic 自身的资源拉取可用 `offline: true` 关闭）。

---

## 开发

```bash
node --test "test/unit/**/*.test.mjs"          # 29 个单元测试，不需要引擎
node --test "test/integration/**/*.test.mjs"   # 启动真实 DSH 工具注册表
```

集成测试会把插件挂到真实 cordis 上下文里的 `@deepseek-ai/dsh-tools` 注册表，并通过
`ctx.tools.execute()`（模型调用走的同一条链路）派发，最后断言磁盘上真的产出了 PDF。
没有引擎时它会报告 skip 而不是失败。

模块地图见 [docs/architecture.md](docs/architecture.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)；第三方组件见 [NOTICE](NOTICE)。
