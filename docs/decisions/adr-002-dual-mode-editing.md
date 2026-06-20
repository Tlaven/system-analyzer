# ADR-002: 双模式编辑(UI / Code)

## 状态

accepted

## 背景

系统关系可视化工具天然有两类用户操作:

1. **结构性编辑** — 拖一个新节点、连一条边、改属性值。这些是"图形操作",关心的是拓扑和值,不关心代码语法。
2. **行为性编辑** — 写 `process({ dt })` 方法体表达数据流算法、用 `for` 循环批量建边、参数化生成实例。这些是"代码操作",关心的是逻辑和控制流。

v0.4 早期只有 Code 模式(`code-as-truth`),用户写完整 sourceCode。问题:结构性编辑(加一个节点)要写 5 行代码,门槛高,普通用户用不来。

v0.5 试图纯 UI 化(静态扫描 + class 库 bundle 内置 + 删除 codeview),问题:无法表达任意算法(`process` 方法体、循环建边),表达能力被锁死。

v0.6/v0.7 在两者间摇摆,要么是"AI 写代码用户看",要么是"用户 UI 拖拽 AI 不能改方法体",都有短板。

需要明确:两种体感不能合并,只能并存 + 切换。

## 考虑过的方案

### 方案 A: 纯 UI 模式,扩展 panel 支持"逻辑块"(被拒)

- 思路:在 panel 加"循环 / 条件 / 方法体"的可视化编辑器(类似 Scratch 积木)
- 优点:单一模式,体感统一
- 缺点:可视化逻辑编辑器是个独立的复杂产品(Scratch 花了 10 年才成熟),远超本项目范围;而且任意 JS 算法无法完整可视化(异步、闭包、高阶函数)
- **拒绝理由**:把"代码编辑"塞进 UI 是无底洞。用户真要写复杂算法时,UI 积木反而比直接写代码更难用。

### 方案 B: 纯 Code 模式,加 AI 辅助(被拒)

- 思路:用户和 AI 对话,AI 帮用户写 sourceCode,用户不直接编辑
- 优点:用户不用学语法
- 缺点:每次小改动(改个属性值、连条边)都要和 AI 对话一轮,延迟和 token 成本高;用户失去直接控制感;离线不可用
- **拒绝理由**:违反"用完即走 + 离线可用"的产品定位。v0.4 时代的核心理念是"AI 自发现工具 + 用户直接操作",不是"AI 代用户操作"。

### 方案 C: 双模式 + segmented control 切换(采纳)

- 思路:UI 模式默认(panel 可编辑,codeview 只读);Code 模式(codeview 可写,panel 只读)。segmented control `[UI 编辑 | 代码]` 切换。
- 优点:两种体感都纯净,各自的工作流不被对方污染;切换无损(UI→Code 永远可);反向(Code→UI)检测程序化结构,有则 confirm 重建
- 缺点:用户要理解"我在哪个模式",有学习成本;反向切换会丢方法体(必须 confirm)
- 适合场景:既要 vibe editing 又要 code editing 的工具

## 选择

选方案 C。

理由:

1. **两种体感不能合并** — UI 编辑是"图形操作 → mutate runtimeInstances.attrs → syncCodeFromRuntime";Code 编辑是"写代码 → debounce → commitCode → runSource"。两条数据流方向相反,合并在一个模式必然冲突。
2. **UI 模式作为默认,降低门槛** — 90% 的日常操作(加节点、连边、改属性)在 UI 模式完成,用户不用看代码。
3. **Code 模式作为逃生口** — 高级用户/复杂场景需要表达任意算法,Code 模式不设限。
4. **Code→UI 反向切换的损毁是显式的** — 检测到 `for`/`while`/`if`/`function`/`=>` 或非 constructor 方法,弹 `confirm` 告知"将丢失方法体"。不偷偷丢失。

**取舍:** 接受"用户要理解两个模式"的学习成本。换得两种体感各自的纯净。

## 后果

### 正面后果

- **UI 模式 sourceCode 始终声明式可解析** — 3 个 class field + 启动段赋值,scanner 能稳定提取。
- **Code 模式 sourceCode 可以是任意 JS** — 用户能写方法体、循环、控制流、参数化。
- **切换无损(UI→Code)** — UI 模式的 sourceCode 直接进 Code 模式可读可编辑。
- **持久化统一** — 两种模式都共用 `sa_data.sourceCode`,无需区分存储格式。
- **panel/codeview 职责清晰** — panel 在 UI 模式可编辑、Code 模式只读;codeview 反之。状态切换时 segmented control 禁用对方。

### 负面后果

- **Code→UI 切换会丢方法体** — 必须用户 confirm,但仍是个"危险操作"。用户写了 200 行方法体,切 UI 模式时方法体全没了(只留 class field + 启动段)。
- **用户要理解两个模式** — 第一次用时要搞清楚"我现在在哪个模式,这个操作在哪个模式才能做"。
- **模式状态入 sourceCode** — `editMode` 存在 `sa_data` 里,分享 URL 时带着模式。如果用户在 Code 模式分享,接收者打开就是 Code 模式(只读 panel)。

### 需要跟进的

- ✅ Code→UI 切换有 confirm 提示
- ✅ `editMode` 持久化到 sa_data
- 后续可考虑:UI 模式增加"快速预览生成的代码"功能(已有 codeview 只读),降低学习曲线
- 后续可考虑:Code 模式的 AI 辅助(智能补全方法体),但这不是 v0.9 范围

## 关联

- 上游:本决策符合 `CLAUDE.md` [为什么] §3 "vibe editing 与 code editing 不能合并"
- 下游:scanner 范围限定(UI 模式 sourceCode 必须可扫)、serializeCode 只在 UI 模式调、panel/codeview 的 mode-aware 禁用逻辑
- 历史背景:v0.4 纯 Code(`docs/spec.md`,已删除)、v0.5 纯 UI(已废)、v0.6/v0.7 摇摆、v0.9 明确双模式
