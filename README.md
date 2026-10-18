# dsh-plugin-screenshot

**DeepSeek Harness 截图插件** — 输入框一键截图，隐藏 / 保留本窗口、窗口边缘自动吸附框选、截图直接插入对话框。

Windows 专用（依赖 PowerShell + Win32）；实测于 DSH `0.2.0-rc.2` 与 `0.2.1-rc.2`。

> **反馈 / 报问题**：<https://github.com/Durandalw/dsh-plugin-screenshot/issues>
> 崩溃类问题请附 `%APPDATA%\@deepseek-ai\dsh-desktop\logs\` 下对应的日志。

---

## 功能

| 功能 | 说明 |
|---|---|
| **输入框入口** | 在 `+` 号那一行加入截图按钮，旁边有 `▾` 选择默认行为 |
| **隐藏本窗口截图** | 截图时先把 DSH 窗口隐藏，成品里不含自己 |
| **保留本窗口截图** | 需要连 DSH 界面一起截时使用 |
| **窗口边缘自动吸附** | 拖拽选框靠近窗口边界即贴合；也可直接点一下窗口选中整个窗口 |
| **截图直接插入对话框** | 框选完成后图片自动进入输入框，不必手动 `Ctrl+V` |
| **顶部避让** | 截图界面顶部留出 48px，露出 DSH 的菜单栏（可正常点击） |
| **多显示器** | 使用 `SystemInformation.VirtualScreen`，整个虚拟桌面都在一张图里 |

## 安装

```powershell
# 在你的 DSH profile 目录下
cd $env:USERPROFILE\.dsh\profiles\desktop
npm install dsh-plugin-screenshot
```

然后把 `dsh-plugin-screenshot` 加进该 profile `package.json` 的 `dsh.profile.bundles` 数组，重启 DeepSeek Harness。

> **依赖提示**：本插件的 `peerDependencies` 钉在 `^0.2.0-rc.1`。npm 上 `@deepseek-ai/dsh-tools` 的 `latest` 标签指向陈旧的 `0.0.1-rc.1`，请勿用 `@latest` 安装 DSH 核心包，否则 API 不匹配。需要 DSH `>= 0.2.0-rc.1`。

## 操作

| 操作 | 效果 |
|---|---|
| **左键点截图按钮** | 按当前默认行为截图 |
| **点 `▾` 箭头** | 打开菜单选择默认行为（会记住） |
| **拖拽** | 框选；靠近窗口边缘自动吸附 |
| **单击窗口** | 直接选中整个窗口 |
| **拖 8 个手柄** | 改变选区大小（四角 / 四边中点，光标会变成缩放箭头） |
| **在选区内拖动** | 整体移动选区 |
| **方向键** | 微调位置 1px；`Ctrl+方向键` 改大小；`Alt` 每次 10px |
| `Shift` + 拖拽 | 本次临时关闭吸附 |
| `S` | 开关吸附 |
| `Enter` / `Ctrl+C` | 完成（图片进对话框） |
| `Esc` / 右键 | 取消 |
| `Alt` + 点截图按钮 | 临时用另一种隐藏模式 |

## 实现要点

```
lib/index.js      宿主半身：PowerShell 调用、7 条 HTTP 路由、2 个模型工具
lib/client.js     浏览器半身：composer 按钮 + 全屏框选覆盖层
scripts/snip.ps1  隐藏 → 截图 → 恢复，单进程完成
scripts/win.ps1   枚举窗口、显示 / 隐藏窗口、读窗口矩形
scripts/shot.ps1  全屏 / 单窗口(PrintWindow) / 区域截图
scripts/crop.ps1  按矩形裁切
scripts/clip.ps1  写入剪贴板（需 -STA）
```

* **通信**：持久化插件包的浏览器半身跑在完整模块系统里，因此走 **HTTP 路由**（`ctx.webServer.register`），而不是动态包才有的 `host.call`。
* **坐标系**：所有脚本第一步都调 `SetProcessDPIAware()`，所以窗口矩形、截图范围、框选坐标都在同一套真实屏幕像素里。
* **隐藏原理**：隐藏、截图、恢复三步都在 `snip.ps1` **一个进程内**完成。分成三次
  `pwsh` 调用时每次启动约 1.1s，窗口要消失一秒多，而且恢复若单独失败窗口会一直隐藏；
  合并后窗口不可见时间降到 **~380ms**，恢复写在 `finally` 里，异常也不会漏掉。
  恢复用 `SW_RESTORE` + 顶层重排 + `SetForegroundWindow`，否则隐藏过的窗口会被其它窗口压到后面。
* **插入原理**：composer 是 Lexical 编辑器，其自身 paste 处理器读取 `event.clipboardData.items`。本插件构造标准 `ClipboardEvent` 派发给编辑器，走的是和手动 `Ctrl+V` 完全相同的代码路径，未触碰任何 DSH 内部 API。

## 已知限制

1. **长截图尚未实现** —— `cordis.patch.yml` 里已有 `longShotScrollRatio` / `longShotMaxFrames` 配置位，但滚动驱动、帧重叠检测与拼接还没写。
2. **仅 Windows** —— `os: ["win32"]`，依赖 PowerShell 与 Win32 API。
3. **截图时窗口必定短暂消失** —— 想截出不含本窗口的图，窗口的像素就不能出现在屏幕上，
   两者不可兼得（`SetWindowDisplayAffinity` 对非属主进程返回"拒绝访问"，是系统安全设计）。
   本插件把这段时间压到约 380ms。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖：

```yaml
- id: dsh-plugin-screenshot
  name: 'dsh-plugin-screenshot'
  config:
    snapThreshold: 12            # 吸附阈值（屏幕像素）
    ignoreWindowPatterns:        # 不参与吸附的窗口
      - 'NVIDIA'
      - 'TextInputHost'
    longShotScrollRatio: 0.8     # 长截图（预留）
    longShotMaxFrames: 40        # 长截图（预留）
```

## 变更记录

### 0.3.5

**修复「大窗口盖住小窗口时吸附到小窗口」** —— 这个问题有三个独立成因，只修一个不够。

* **成因 1（主因）：大窗口被面积过滤误伤。**
  客户端原本丢弃「面积 ≥ 屏幕 85%」的窗口，本意是排除桌面与全屏 overlay。但一台
  2560x1600 屏幕上最大化的窗口是 2582x1550 = **97.7%**，于是**正常的最大化窗口直接
  不在吸附列表里** —— 鼠标移上去找不到目标，只能落到剩下的小窗口。桌面窗口本来就不
  会进入列表（无标题或属 tool window），这道保险其实只需挡住真正铺满全屏的东西，
  阈值改为 0.995。
* **成因 2：边缘吸附会吸到被遮挡的窗口。**
  `findSnap` 只比较边缘距离。当小窗口的矩形整个落在大窗口内部（很常见的布局），
  在可见窗口里拖框时，框边往往离被遮住的小窗口边缘更近，于是吸附过去。
  现在**指针在哪个窗口内，就只允许那个窗口参与吸附**；指针在空白处时才退回全量最近边缘。
* **成因 3：窗口命中按面积而非层叠顺序。**
  `findWindowAt` 原本「优先选面积最小的窗口」，指针在大的上层窗口上时仍会被
  被盖住的小窗口抢走。改为按 **Z 序**取第一个真正包含该点的窗口；`EnumWindows`
  的顺序就是 Z 序（最上层在前），已用 `GetTopWindow` + `GW_HWNDNEXT` 与
  `WindowFromPoint` 交叉验证（9/9 一致）。
* 新增 `scripts/verify-zorder.mjs`：从发布包中提取真实的 `findWindowAt` 与
  `findSnap`，16 个用例覆盖堆叠/部分遮挡/同尺寸重叠/容差回退/被遮挡窗口不参与吸附/缩放。
* **调试记录（值得记下来）**：0.3.5 第一版只修了成因 3，用户反馈"还是小窗口"。
  用真实数据（`GET /windows`）算出那个大窗口占比 97.7% 才定位到成因 1；
  再用 `WindowFromPoint` 对照数组顺序，才发现 `findWindowAt` 本来是对的、
  真正还在错的是 `findSnap`。**三个成因里有两个不在最初假设的方向上。**

### 0.3.4

* **元数据**：补上 `repository` / `bugs` / `homepage`，源码托管到
  <https://github.com/Durandalw/dsh-plugin-screenshot>。
  npm 页面因此出现 **Repository** 与 **Issues** 链接，反馈终于有了入口 ——
  此前这个包没有任何可留言的地方，用户只能另想办法转达问题。
* README 顶部加了反馈指引，并注明崩溃类问题要附的事件日志路径。
* 代码与 0.3.3 完全相同，仅元数据和文档变化。

### 0.3.3

**严重修复：0.3.2 会让 DSH 0.2.1-rc.2 启动崩溃。**

* **根因**：`dependencies` 里写了两个**宿主提供**的客户端模块
  （`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-conversation`）。
  用 pnpm（`nodeLinker: hoisted`）安装时，它们会被装成 `0.2.0-rc.2` 的**副本**，
  与宿主内置的 `0.2.1-rc.2` 同名并存。双份客户端模块使 web boot 无法激活宿主自己的
  `dsh-client-ui-skill` / `-reference` / `-secret-mask` / `-goal` 四个条目，
  直接抛 `web boot: 4 entries did not activate`，界面进不去。
* **修复**：两者移到 `peerDependencies`，`dependencies` 清空。
  这两包本来就不被代码 import（客户端只 `require("react")`，宿主只 import `dsh-tools`），
  它们只作为 `dsh.client.inject` 的服务声明存在，理应由宿主提供。
* **验证**（干净 profile，`nodeLinker: hoisted` + `autoInstallPeers: false`）：

  | | 安装结果 | `node_modules/@deepseek-ai/` |
  |---|---|---|
  | `0.3.2` | `Packages: +6` | 出现 `dsh-client-ui-slots` `dsh-client-ui-conversation` 副本 |
  | `0.3.3` | `Packages: +1` | **不存在** |

  装完只剩插件本身，`lib/`、`scripts/`、`cordis.patch.yml` 均完整。
* **防复发**：`scripts/verify-package.mjs` 增加一项检查 ——
  `dependencies` 里出现任何 `@deepseek-ai/*` 即判定失败，发布前直接拦下。
  已做回归验证：故意注入依赖时该检查以退出码 1 报"依赖泄漏"，恢复后通过。
* 安装时会看到 `missing peer @deepseek-ai/...` 警告，这是**预期**的
  （`autoInstallPeers: false` 不装 peer，由宿主提供），比装出副本导致崩溃好得多。

### 0.3.2

性能报告指出：点截图后框选界面已出现，但**要等约 6 秒才能吸附** —— 因为吸附目标列表是
overlay 挂载后才异步拉取的，请求返回前数组是空的，鼠标移动不会产生任何高亮。

* **优化**：`win.ps1` 枚举窗口时逐个调用 `Get-Process -Id` 取进程名（44 个窗口约 1.4s），
  改为**一次性建立进程名表**再查表（约 50ms）。实测单次枚举：
  PowerShell 5.1 **4826ms → 1708ms**，pwsh 7 **2085ms → 1678ms**。
* **优化**：`/windows` 路由先枚举一次，紧接着 `findOwnWindow()` 内部又枚举一次 —— 纯重复。
  现在把已有结果传进去复用（`findOwnWindow(windows)`），参数可选，其余调用点不受影响。
* **优化**：客户端在**发起截图的同时并行预取**窗口列表。截图本身要数秒，
  足够覆盖窗口枚举，因此吸附目标在 overlay 出现时通常已经就绪，感知延迟接近 0。
* 附带收益：`/capture` 内部同样调用 `findOwnWindow()`，点一次截图也少等一次枚举。

### 0.3.1

四个缺陷的报告来自一台**只有 Windows PowerShell 5.1、没有 PowerShell 7** 的机器，
以及不同的 DWM 合成时序。感谢那份逐行定位的报告。

* **修复（致命）**：`snip.ps1` 没有加载 `System.Drawing` 程序集，却使用了它的类型。
  PowerShell 7 会自动加载，5.1 **不会**，于是该脚本在无 pwsh 的机器上直接失败：
  `snip.ps1 failed: [System.Drawing.Imaging.PixelFormat]`。已补上显式 `Add-Type`。
* **修复**：shell 候选表里的裸名 `pwsh.exe` / `powershell.exe` **不做存在性检查**，
  在没有 PowerShell 7 的机器上会选中不存在的 `pwsh.exe` 并抛出 `spawn pwsh.exe ENOENT`，
  反而永远走不到确实存在的 `powershell.exe`。现在只探测绝对路径，找不到时给出说明性错误；
  另新增 `config.shellPath` 供部署方显式指定解释器。
* **修复**：隐藏本窗口的截图里窗口仍有残影或撕裂。`ShowWindow(SW_HIDE)` 只清掉
  `WS_VISIBLE`，真正把像素从屏幕上抹掉是 DWM 异步完成的；原先 50ms 的等待在另一台机器上
  会抓到合成中间帧。现在先 `DwmFlush()` 阻塞到 DWM 完成一次合成，再留 250ms 余量。
* **修复**：隐藏模式下出现"虚空吸附框"。UWP 应用被 shell 挂起后，其窗口对象仍在且
  `IsWindowVisible` 仍返回 true，但它被 DWM cloak（`DWMWA_CLOAKED != 0`）、屏幕上并不存在。
  这类窗口会成为看不见的吸附目标。现在枚举时按 `DWMWA_CLOAKED` 过滤。
  客户端的"覆盖全屏"判定也从**逐轴 90%** 改为**面积占比 85%** —— 逐轴判定太脆：
  2560x1400 的窗口在 2560x1600 屏幕上高度只占 87.5%，能躲过检查却仍覆盖近九成桌面。

### 0.3.0

* **新增**：框选完成后可以调整，不必重画。
  * 拖动 **8 个手柄**（四角 / 四边中点）改变大小，鼠标移到手柄上会变成对应的缩放箭头。
  * 在选区**内部拖动**可整体移动。
  * **方向键**微调位置，`Ctrl+方向键` 改大小，按住 `Alt` 每次 10px。
* **修复**：手柄拖到屏幕边缘后继续拖，选区会从另一头反向变化。现在被拖动的边在
  图像边界处停住，不再翻折；单边压到对面时最小保留 1px。
* 选区位置与大小受图像范围约束 —— 越界的框被宿主裁剪时会产生与屏幕所见不一致的结果。

### 0.2.0

* **性能**：隐藏本窗口截图时，隐藏 / 截图 / 恢复三步合并进 `scripts/snip.ps1` 单进程完成。
  窗口不可见时间由 **~1100ms 降到 ~380ms**，总耗时由 ~2600ms 降到 ~1680ms。
* **修复**：恢复步骤原本是独立的第三次调用，若其失败窗口会一直隐藏。现在恢复位于
  `finally` 块中，与隐藏同进程，不可能被跳过。
* 窗口 / 区域截图改为从整屏截图裁剪，隐藏与恢复时序因此只有一处实现。

### 0.1.2

* **文档**：移除上一版 README 中引用的"自检脚本"章节 —— 那些脚本属于开发工具，不在
  发布包内，照文档执行会报找不到文件。

### 0.1.1

* **修复**：客户端 bundle 的模块 id 与包名不一致 —— `__ModuleLoader__.load({ id })` 仍是改名前的
  `dsh-screenshot`，触发 `client-modules: duplicate factory registration`，整个 entry 加载失败。
  **0.1.0 不可用，请使用 0.1.1 或更高版本。**

### 0.1.0

* 首次发布（含上述缺陷，请勿使用）。

## License

MIT
