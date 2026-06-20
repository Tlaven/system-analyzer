# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## [是什么] — 项目定位

**一个 web 端的系统关系可视化工具,作为 AI 的"Web Skill"存在。** 部署形态是单文件 `dist/index.html`,用户和 AI 聊天时 AI 通过 fetch `/llms.txt` 自发现这个工具,按说明生成 graph 代码 + URL hash,输出链接给用户。用户点开看到可视化,可在 UI 上手动调整;调整后复制新 URL 回对话,AI 解码读最新状态继续协作。用完即走——不需要注册、不需要安装、不需要学习。

**典型场景:** 用户和 AI 聊到某个复杂系统(一款游戏的经济循环、一个团队的协作关系、一个 SaaS 的增长模型),AI 识别"这里需要可视化",自己 fetch 工具的 `/llms.txt`,按格式生成 graph 数据,编码到 URL hash,输出链接。用户点开看到 graph,可以拖拽微调、保存、分享。

**做什么:** 节点 + 边 + 属性的可视化编辑,支持 UI 拖拽编辑和 Code 代码编辑双模式,Canvas 渲染(三档信息密度 + 多种布线 + 多种布局)。

**不做什么:** 不做后端服务(纯静态单文件);不做用户系统(无登录无云端同步,localStorage + URL hash 分享);不做实时多人协作;不做时序动画(执行引擎的 step 留作未来 Code 模式 AI 实现方法体后激活)。

## [为什么] — 设计哲学

1. **统一模型优先于扩展** — 当概念有重叠时,合并而非并行(例:v0.9 把边从 class 级迁到实例级 `attrs.edges` 数组,消除"边和属性谁占 attrs"的混淆)。倾向于做减法,而非加并行字段/扩展机制。

2. **sourceCode 是唯一真相源** — 不是数据库,不是 AST,是 sourceCode 字符串。runtimeInstances 是它的派生视图,每次 `runSource` 完全重建。这让 Code 模式和 UI 模式能共享同一份持久化(`sa_data.sourceCode`),URL hash 分享就是 base64 编码 sourceCode。

3. **vibe editing 与 code editing 不能合并** — 用户既要"拖一拖就改图"的体感,又要"写方法体表达任意算法"的能力。两种体感用 segmented control 切,而不是合并成"既能拖又能写"的复杂混合体。详见 [ADR-002](docs/decisions/adr-002-dual-mode-editing.md)。

4. **渲染/路由/布局三层分文档** — 每层关注点不同(画什么/边怎么走/节点放哪),独立讨论不被其他层绑架。详见 `docs/visualization-modes.md` / `docs/edge-routing.md` / `docs/layouts.md`。

5. **AI 通过自发现使用工具** — 不假设用户/AI 提前知道工具的能力,`/llms.txt` 是入口契约,AI fetch 后按说明操作。这让工具能跨对话/跨项目被复用,无需 manual 引导。

## 常用命令

```bash
npm install                            # esbuild (dev) + puppeteer (test) + codemirror (editor)
npm run build                          # bundle src/main.js → dist/index.html (single file)
npm run dev                            # watch + dev server at localhost:8000

node scripts/test-codegraph.mjs        # v0.9 核心引擎单元测试(runSource/serializeCode/resetRuntime)
node scripts/test-roundtrip.mjs        # scanner 静态分析单元测试(无浏览器)
node scripts/test-e2e.mjs              # puppeteer, loads dist/index.html — MUST `npm run build` first
```

No test runner, lint, or typecheck. Verification is manual in the browser, plus the three `.mjs` scripts above.

## 架构

Vanilla JS + Canvas 2D, no framework. ES modules in `src/` are bundled by esbuild into a single `dist/index.html` with inlined `<script>`.

> **详见 [docs/architecture.md](docs/architecture.md)(L2 架构层)** —— 模块清单、双模式编辑 + 实例级 edges 模型、主流程叙述、关键架构决策、架构级不变量。

一句话概要:sourceCode 字符串 → `runSource` 派生 runtimeInstances → `deriveEdges` 派生边视图 → Canvas 渲染。UI 模式 panel 编辑可双向同步回 sourceCode;Code 模式 codeview 编辑触发 `runSource` 重建。

---

## 文档方法论(AI 协作)

本项目采用**三段式 × 4 层**文档方法论。文档是人和 AI 的"共享内存"——写**决策需要的信息**,不写**实现需要的信息**(实现看代码)。

### 三段式(每层文档的内部结构)

```
[是什么]   事实:这一层的内容(模块清单 / 函数清单 / etc)
[为什么]   决策:考虑过的方案 + 选择 + 理由 + 被拒方案
[不变量]   约束:必须满足的条件(功能性 + 非功能性)
```

三者缺一都会让 AI 踩坑:只有事实不知道边界,只有决策不知道现状,只有不变量不知道为什么。

### 4 层(粒度递进,L4 默认不写)

| 层 | 文件 | 何时写 |
|---|---|---|
| L1 整体定位 | 本文件 | 项目立项 |
| L2 架构层 | `docs/architecture.md` | 架构设计 |
| L3 模块/层级详细 | `docs/visualization-modes.md` / `docs/edge-routing.md` / `docs/layouts.md` / `docs/modules/<name>.md` | 每模块开发前 |
| L4 核心代码 | (按需,默认不写) | core 函数沉淀后 |

本项目用"**层级文档**"(渲染/路由/布局三档)替代传统的"模块文档",因为关注点天然按层而非按文件分。如某模块独立复杂度高(如 `codegraph.js` 的双向转换器),按需建 `docs/modules/codegraph.md`。

### 铁律

1. **先文档,再代码** — 大改动前先更新对应层文档,文档是设计的契约
2. **ADR 即时记录** — 决策当下就在 `docs/decisions/` 写一条,事后补 90% 会丢
3. **被拒方案是金矿** — 拒绝的方案要记"为什么不",一年后 AI 提同样方案时是唯一挡箭牌
4. **写决策需要的信息,不写实现需要的信息** — 细节让 AI 现场读代码
5. **不变量优先级最高** — 三段里"不变量"最不能省,它是 AI 改代码时的护栏

### 分层加载(AI 协作时按需读取)

| 场景 | 加载哪几层 |
|---|---|
| 平时对话 / 选方向 | 本文件(自动加载) |
| 改某模块 / 层级工作 | + `docs/architecture.md` + 对应 L3 |
| 改 core 函数 | + L4(若有) |
| 讨论架构变更 | + L2 的"为什么"和"不变量"段 + 相关 ADR |
| 讨论性能 / 质量 | + 各层"不变量"段 |
| 排查 bug | L2 主流程叙述 + 相关 L3 + L4 |

---

## [不变量] — 项目级硬约束

> 架构级不变量详见 `docs/architecture.md` 末段。这里只列最顶层的项目级约束。

- **No frameworks, bundlers (besides esbuild for dev), or backend services.** 部署产物是单文件 `dist/index.html`。
- **class 定义写在 sourceCode 字符串里**(启动时 `new Function` 执行),不在 bundle 中作为 module import。
- **Class method bodies forbid `fetch` / `XMLHttpRequest` / `import` / `require`**(文档约定,无运行时强制)。仅在 Code 模式存在;UI 模式 serializeCode 永不输出方法体。
- **v0.9 scanner 读 `new cls()` 实例上的 3 个 class field**(description / name / attrs)。**不再**扫 `static edges = [...]` 字面量;**不再**扫 constructor 字段;**不再**扫 class.edges(v0.8 残留);scanner 还会从 attrs 里过滤掉误写的 `edges` 键。
- **边是实例级 `attrs.edges` 数组**(`[{ target, description }, ...]`)。`target` 是另一 inst.attrs(含 `__instId` 反查)。`makeBridge.add` 不预填 `attrs.edges`,需用户在 bootstrap 显式赋值。
- **`sa_data.version` 必须是 6**。其他版本(v0.5–v0.8)与 v0.9 实例级 edges 模型不兼容,`load()` 检测到旧版本会丢弃并清空 `sa_data`,走 DEFAULT_BOOTSTRAP(空串)。
- **UI labels are in Chinese; code identifiers are camelCase English.**

## Documentation

- `src/llms.txt` — AI-facing onboarding doc,copied to `dist/` on build(AI 自发现的入口契约)
- `docs/architecture.md` — **L2 架构层**:模块清单、双模式编辑 + 实例级 edges 模型、主流程叙述、关键决策、架构不变量
- `docs/visualization-modes.md` — **渲染层 L3**:画布三档信息密度(minimal 圆 / medium/full 圆角矩形)+ 防溢出 + hover tooltip + 边可视化哲学
- `docs/edge-routing.md` — **路由层 L3**:三种布线(straight 不绕 / curve 软绕 / orthogonal 硬绕)+ 端口系统(算法层端口重新引入)+ 避让算法 + 落地次序
- `docs/layouts.md` — **布局层 L3**:四种布局(manual/force/circular/hierarchical)重做方向 + grid 新增 + 三个感知(拓扑/方向/模式)+ 与端口方向联动
- `docs/decisions/` — **ADR 决策记录**:重大架构决策 + 被拒方案。当前包含:
  - [ADR-001 边模型从 class 级迁到实例级](docs/decisions/adr-001-instance-level-edges.md)
  - [ADR-002 双模式编辑(UI / Code)](docs/decisions/adr-002-dual-mode-editing.md)
- `docs/archive/` — 历史文档归档(v0.8 及之前的设计文档,设计意图参考,不维护)
