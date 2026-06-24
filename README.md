# System Analyzer

> Web 端的系统关系可视化工具。把复杂系统拆成节点和关系,看清结构,甚至让系统"跑起来"做仿真。单文件部署,人能用,AI 能自发现。

## 这是什么

一个纯静态的 web 工具,部署形态是单文件 `dist/index.html`。用户和 AI 聊天时,AI 识别"这里需要可视化",自己 fetch 工具的 `/llms.txt`,按格式生成 graph 数据,编码到 URL hash,输出链接给用户。用户点开看到 graph,可以拖拽微调,改完复制新 URL 回对话,AI 解码读最新状态继续协作。

**典型场景:** 用户和 AI 聊到某个复杂系统——一款游戏的经济循环、一个团队的协作关系、一个 SaaS 的增长模型——AI 识别"这里需要可视化",输出链接,用户点开即用。

用完即走:不需要注册、不需要安装、不需要学习。

## 特性

- **节点 + 边 + 属性** 的可视化编辑
- **UI / Code 双模式编辑** — 拖一拖就改图,或写方法体表达任意算法(详见 [ADR-002](docs/decisions/adr-002-dual-mode-editing.md))
- **边级 transform 表达式** — 边上写 JS 语句片段,改上游 attr 自动重算下游,像 Excel formula(详见 [ADR-003](docs/decisions/adr-003-edge-transform-expressions.md))
- **Canvas 渲染** — 三档信息密度 / 多种布线 / 多种布局
- **中文/Unicode 全栈支持** — class name、attr key、varName 都可以是中文
- **AI 自发现** — 通过 `/llms.txt` 入口契约被 AI 跨对话/跨项目复用,无需 manual 引导
- **零后端** — localStorage + URL hash 分享,纯静态托管

## 快速开始

```bash
npm install        # esbuild (build) + puppeteer (test) + codemirror (editor)
npm run dev        # watch + dev server at localhost:8000
npm run build      # bundle src/main.js → dist/index.html (single file)
```

### 测试

```bash
node scripts/test-codegraph.mjs    # 核心引擎单元测试(runSource/serializeCode/resetRuntime)
node scripts/test-roundtrip.mjs    # scanner 静态分析单元测试(无浏览器)
node scripts/test-e2e.mjs          # puppeteer e2e(loads dist/index.html — MUST build first)
```

无 test runner / lint / typecheck。验证靠上面三个 `.mjs` 脚本 + 浏览器手动验证。

## 怎么用

打开 `dist/index.html`(或 `npm run dev` 后访问 localhost:8000):

- **UI 模式**(默认):声明式 sourceCode(class 含 3 个实例级 class field,**无方法体**)。Panel 可编辑,Codeview 只读
- **Code 模式**:sourceCode 完全自由(含方法体、for/if/参数化)。Codeview 可写,Panel 只读

如果想从代码生成 graph 并分享,看 [src/llms.txt](src/llms.txt) 的 sourceCode 格式和 URL 编码说明——那是给 AI 的入口契约,人也能照着写。

## 文档

| 文件 | 内容 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | L1 整体定位、设计哲学、铁律、文档方法论 |
| [docs/architecture.md](docs/architecture.md) | L2 架构层:模块清单、双模式编辑 + 实例级 edges 模型、主流程、关键决策、架构不变量 |
| [docs/visualization-modes.md](docs/visualization-modes.md) | 渲染层 L3:画布三档信息密度 + 防溢出 + hover tooltip |
| [docs/edge-routing.md](docs/edge-routing.md) | 路由层 L3:三种布线 + 端口系统 + 避让算法 |
| [docs/layouts.md](docs/layouts.md) | 布局层 L3:四种布局 + 三个感知 |
| [docs/decisions/](docs/decisions/) | ADR 决策记录 |
| [src/llms.txt](src/llms.txt) | AI 入口契约(自发现的说明书) |

ADR 列表:

- [ADR-001 边模型从 class 级迁到实例级](docs/decisions/adr-001-instance-level-edges.md)
- [ADR-002 双模式编辑(UI / Code)](docs/decisions/adr-002-dual-mode-editing.md)
- [ADR-003 边级 transform 表达式(轻量响应式)](docs/decisions/adr-003-edge-transform-expressions.md)

## 示例

`examples/` 目录有几个完整 graph,可直接复制粘贴到 Code 模式体验:

- `frostpunk2_resources.js` — 冰汽时代 2 资源循环(含 transform 公式)
- `econ.js` / `growth.js` — 经济/增长模型
- `team.js` — 团队协作关系
- `comprehensive.js` — 综合演示

## 设计哲学

1. **统一模型优先于扩展** — 概念重叠时合并,而非加并行字段/扩展机制
2. **sourceCode 是唯一真相源** — 不是数据库,不是 AST,是 sourceCode 字符串。runtimeInstances 是派生视图,每次 `runSource` 完全重建
3. **vibe editing 与 code editing 不能合并** — 既要"拖一拖就改图"又要"写方法体表达任意算法",两种体感用 segmented control 切
4. **渲染/路由/布局三层分文档** — 关注点不同(画什么/边怎么走/节点放哪),独立讨论不被其他层绑架
5. **AI 通过自发现使用工具** — 不假设用户/AI 提前知道能力,`/llms.txt` 是入口契约

详见 [CLAUDE.md](CLAUDE.md)。

## 技术栈

Vanilla JS + Canvas 2D, no framework。ES modules in `src/` 由 esbuild 打包成单文件 `dist/index.html`,内联 `<script>`。

- esbuild — dev/build
- puppeteer — e2e 测试
- codemirror — Code 模式编辑器

## 部署

```bash
npm run build
```

产物是 `dist/index.html`(单文件,纯静态)。直接放到任何静态托管即可:

- GitHub Pages
- Cloudflare Pages / Workers
- Vercel / Netlify
- 自家 nginx / Caddy

URL hash 分享 = base64 编码 sourceCode(UTF-8 safe),上限 24000 字符。

## License

[MIT](LICENSE) © Tlaven
