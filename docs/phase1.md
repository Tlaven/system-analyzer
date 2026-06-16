# 第一阶段实现方案

> 版本：v1.5（历史文档，实际代码已演进到 v0.7+）
> 当前核心函数见 `src/io.js`：`fromCode` / `toCode`（运行时反射，class 名即 label）
> 本文档中 `syncNodeCode` / `parseClassCode` / `nodeToCode` / `updateCommentInCode` 等 v0.6 helper 已被反射模型替代或移除
> 权威指南见 `AGENTS.md`；本文档保留作为 v0.6 阶段的开发期规划记录
> 日期：2026-06-14

---

## 零、阶段目标

**v0.6 已落地**：边作为节点方法、L1 在 code 注释、模型/视图分离、单向 AI 转换。下一轮重点：GitHub Pages 部署 + AI 多轮协作测试。

具体来说：
- 人通过 UI 流畅地拖拽、连线、写注释（背后改 code），构建一张自己能看明白的系统关系图
- 图可以保存、分享、恢复（URL 只含节点 code，不含位置）
- AI 可以通过 fetch `/llms.txt` 自发现工具，读 code 注释 → 填实现 → 输出新 URL
- 模型/视图分离，单一存储（code）

**v1.4 → v1.5 落地完成**：v1.4 把代码彻底转向"代码是 AI 内部产物"——`state.edges` 删除（改为 `deriveEdges()` 派生）、`syncNodeCode` 删除（改用局部修改 helper）、独立 `description` 字段删除（注释在 code 里）、`exportJSON` 不输出 x/y/visual/description/edges、代码面板删除。28/28 puppeteer 测试通过。

完成标准：**一个非技术用户，不经教程，5 分钟内能画出一张包含 10 个节点、15 条边的系统关系图（注释详细）。AI 收到 URL 后能识别空方法、读注释填实现，输出可执行的新 URL。**

---

## 一、当前状态

### 1.1 已实现

| 功能 | 状态 | 说明 |
|------|------|------|
| Canvas 渲染 | ✅ | 节点=圆角矩形，边=带箭头线段 |
| 双击创建节点 | ✅ | 创建"新节点"，自动聚焦名称输入框 |
| 拖拽移动节点 | ✅ | 4px 死区防误触 |
| 端口连线 | ✅ | 选中节点显示 4 个端口，拖到目标节点建边 |
| 节点编辑面板 | ✅ | 名称、分组、描述、动态属性 |
| 边编辑面板 | ✅ | 标签、关系符号、描述、权重 |
| 删除 | ✅ | 面板按钮 + Delete 键 |
| 撤销 | ✅ | Ctrl+Z，50 层 |
| 画布平移 | ✅ | 中键拖拽 / 空格+左键拖拽 |
| 画布缩放 | ✅ | 滚轮缩放，以鼠标位置为中心 |
| 适应画布 | ✅ | 工具栏按钮，一键居中 |
| 节点 group 颜色 | ✅ | 左边框 4px 彩色条，5 种预设颜色 |
| 边 relation 着色 | ✅ | +=绿 -=红 ==蓝 ?=橙 其他=灰 |
| 导出 JSON | ✅ | 含坐标，符合 spec 格式 |
| 导入 JSON | ✅ | 读取坐标，有 fallback |
| localStorage 持久化 | ✅ | 每次修改自动保存 |
| 图标题编辑 | ✅ | 点击标题文字 inline 编辑 |
| 右键平移 | ✅ | 右键拖拽平移画布 |
| 网格背景 | ✅ | 自适应线框网格，随缩放调整间距 |
| 缩放指示 | ✅ | 工具栏显示百分比，点击重置 100% |
| 节点文字截断 | ✅ | 最大宽度 240px，超长显示… |
| hover tooltip | ✅ | 悬停显示完整标签+分组+描述 |
| 撤销不空耗 | ✅ | 仅首次编辑触发 undo 快照 |
| 暗色主题 | ✅ | CSS 变量 + Canvas 适配，持久化偏好 |
| 快速连线（Shift） | ✅ | 按住 Shift 拖端口连线不弹面板 |
| URL 分享 | ✅ | btoa 编码到 URL hash，零依赖 |
| 力导向布局 | ✅ | 弹簧模型，迭代 200 次收敛 |
| 圆形布局 | ✅ | 节点等角分布在圆周 |
| 层次布局 | ✅ | 拓扑排序，同层水平排列 |
| 曲线边 | ✅ | 二次贝塞尔，中点偏移 |
| 折线边 | ✅ | 先水平再垂直的直角折线 |
| 圆形节点 | ✅ | arc 绘制，hit 检测适配 |
| 胶囊节点 | ✅ | roundRect(h/2) 绘制 |
| 样式配置面板 | ✅ | 工具栏弹出，布局/边/形状/信息/位置/动画六选，持久化 |
| 导入容错 | ✅ | 兼容 {graphs:[...]} 和 {nodes:[...]} |
| 卡片式节点 | ✅ | 4 级信息密度：极简/轻量/中等/完整（属性表+描述块+端口摘要内联） |
| 弹性物理模式 | ✅ | 四力引擎（center+charge+link+collide），自动缩放参数，鼠标拉力拖拽 |
| 边动画 | ✅ | 虚线流动 + 粒子流动两种模式 |
| 端口级连线 | ✅ | 边从指定 output 端口位置出发，到 input 端口位置结束 |

### 1.2 代码概况

```
src/                # ES modules 源码（10 模块，~5500 行总计）
  state.js          # 状态 + 常量 + 工厂
  utils.js          # 纯函数工具集
  renderer.js       # Canvas 渲染
  physics.js        # 物理引擎 + 布局算法
  editor.js         # CRUD + undo
  panel.js          # 侧面板 DOM 操作
  input.js          # 事件处理
  io.js             # 导入导出 + 持久化
  config.js         # 配置 + 主题
  main.js           # 入口
dist/index.html     # 构建产物（单文件，~46KB）
docs/spec.md        # 设计文档 v0.6（L1 注释 + AI 内部产物 + 模型/视图分离）
```

- 零依赖（运行时），vanilla JS + Canvas 2D
- esbuild 构建（开发依赖），源码 ES modules
- Canvas 坐标系统：world 坐标 + viewX/viewY/viewScale 视口变换

### 1.3 v0.6 方向的状态调整（已落地 v1.5）

spec.md v0.6 方向的所有调整已实现：

| 功能 | 位置 | v1.5 状态 |
|------|------|----------|
| 代码面板（人看/改 code） | src/io.js showCodeImport/importFromCode；UI 入口 | **已删除** —— `showCodeImport/importFromCode/hideCodeImport` 已移除；index.html 菜单项和 modal 已删 |
| `syncNodeCode` 全量重写 | src/editor.js | **已移除** —— editor.js 不再定义；panel.js 改用局部修改 helper（`appendPortToCode/updatePortInCode/removePortFromCode/setPropertyInCode/removePropertyFromCode`） |
| 节点 `description` 字段 | src/state.js createNode | **已删除** —— `createNode` 无此字段；UI 通过 `getNodeComment(code)` 读取注释 |
| 节点 `x, y` 字段在 JSON 导出 | src/io.js exportJSON | **已删除** —— `exportJSON` 不输出；运行时仍保留作为视图层 |
| 节点 `visual` 字段 | src/state.js createNode | **已删除** —— 同上（运行时保留作为视图层） |
| `state.edges` 独立数组 | src/state.js, src/io.js | **已迁移** —— `state.edges` 字段已移除；`deriveEdges()` 实时从 nodes.code 的 static outputs 派生 |
| `callAI`（本地代理调 LLM） | src/ai.js | **不存在** —— 代码里从未实现（仅 phase1.md 之前提及） |
| `exportAIPrompt`（生成 prompt 文本） | src/ai.js | **保留** —— 应急手动方案，仍可用 |
| "AI 补全"菜单 | UI 入口 | **不存在** —— 与 callAI 一致，代码从未实现 |
| `extractCodeFromAI`（从 AI 回复提取代码） | src/ai.js | **已删除** —— unused，随 `importFromCode` 一起清理 |
| `compileClass` + `propagate` + `stepAll` | src/engine.js | **保留** —— Level 2/3 执行引擎；改用 `deriveEdges()` |
| URL hash 编解码 | src/io.js shareURL | **保留** —— code 序列化载体 |
| `parseClassCode` | src/io.js | **已扩展** —— 加 `isEmpty` 标记（橙色圆点 UI） |
| `nodeToCode` | src/io.js | **保留** —— 用于 importJSON stub 生成和 exportAIPrompt |
| `importJSON` 兼容旧格式 | src/io.js | **已扩展** —— 加 edges 迁移（反向写回 source code）、auto-layout（位置缺失时调 `applyLayout('force')`） |

### 1.4 Level 1 状态总结

Level 1（纯视觉层）已全部完成。已迁移至 ES modules 架构。后续维护：
- 编辑 `src/` 下模块文件，运行 `npm run build` 产出 `dist/index.html`
- 新增逻辑优先放置到对应模块，必要时新增模块

---

## 二、待完成项

### 2.0 v0.6 核心工作（按 spec v0.6 方向）

按 Web as Skill + L1 注释 + 模型/视图分离方向，核心待办如下。已完成的 v1.0-v1.3 工作保留在 2.1-2.4 作为历史记录。

#### P0-a：移除位置/visual 字段（模型/视图分离）

**改动**：
- `src/io.js` 的 `exportJSON()`：删除 `x: n.x, y: n.y` 和 `visual` 字段输出
- `src/state.js` 的 `createNode`：`visual` 字段标记为废弃（保留内部使用，不导出）
- `src/io.js` 的 `importJSON()`：删除 `x: n.x || ...`，改为调用 auto-layout

**影响**：
- URL hash 变短（少了所有节点的 x,y 数值）
- 导入时需要 auto-layout（避免随机位置）

#### P0-b：L1 注释解析与 UI 编辑

**`parseClassCode` 扩展（src/io.js）**：
- 提取 Class 字段上方的 JSDoc `/** ... */` 注释
- 提取方法上方的 JSDoc 注释
- 把注释作为对应字段/方法的 description 暴露给 UI

**UI 编辑注释的局部修改（src/io.js 新增）**：
- 新增 `updateCommentInCode(code, target, newComment)` 函数
- target 可以是字段名或方法名
- 只改对应位置的 JSDoc，不动其他部分（不动方法体、不动其他字段）
- 替代现有的 syncNodeCode 全量重写

**UI 接入（src/panel.js）**：
- 节点描述编辑框 → 调用 `updateCommentInCode(node.code, fieldName, newVal)`
- 边描述编辑框 → 调用 `updateCommentInCode(sourceNode.code, methodName, newVal)`

#### P0-c：单向 AI 转换器（读注释→填实现）

**核心场景**：AI 收到 URL → 解析 code → 识别空/stale 方法 → 在注释下填实现 → 输出新 URL

**实现要点**：
- `parseClassCode` 标识每个方法是空（`return null`/空体）或 stale（注释改了实现没跟上）
- AI 端逻辑（在 llms.txt 里说明，不在 src 实现）
- 浏览器端只需保证 round-trip：URL → 解码 → 编辑 code → 编码 → URL

#### P0-d：Class化迁移（edges 派生）

**改动**：
- `src/state.js`：`state.edges` 改为 getter，从所有节点的 `static outputs` 派生
- `src/io.js`：`exportJSON` 不输出 edges；`importJSON` 把旧 edges 反向写回 source 节点
- `src/engine.js`：topologicalSort 等使用派生的 edges
- `src/renderer.js`：边渲染使用派生的 edges

**迁移逻辑（一次性）**：
- 旧 JSON 的 edges 数组 → 遍历每条 edge → 找到 source_node → 在该节点的 code `static outputs` 加 `{id: source_port, target: target_node, target_port: target_port}` 声明

#### P1：Web as Skill 接入

**更新 `/llms.txt`**（src/llms.txt）：
- 数据格式更新为 v0.6（去 x,y；边在 code 里）
- 强调 AI 核心任务：读 code 注释 → 填实现
- 三个 Level 用注释+实现示例

**auto-layout on import**（src/io.js 或 src/physics.js）：
- 位置移除后，导入时需要智能布局
- 复用已有的力导向/层次布局算法
- 触发条件：JSON 无 x,y 时

**部署到 GitHub Pages**：
- 仓库设置 → Pages → main 分支 /docs 或 /dist 目录
- 验证 llms.txt 可被 fetch

#### P2：清理

**删除 src/ai.js 的 callAI**：
- 本地代理方向不再是核心
- 一并删除"AI 补全"菜单 UI

**代码面板处理**：
- 删除 src/io.js 的 showCodeImport、importFromCode 入口
- 或藏到 debug 模式（URL 参数 `?debug=1` 才显示）

**exportAIPrompt 处理**：
- 选项 A：保留（应急手动方案）
- 选项 B：删除
- 待定

### 2.1 交互优化

#### 2.1.1 撤销面板打开时的 undo 问题 ✅

**现状**：`showNodePanel()` 和 `showEdgePanel()` 每次打开都 `pushUndo()`，即使没做任何修改也会消耗一个 undo 槽。

**方案**：改为"首次修改时才 push"。在 panel 的 oninput 回调中检查 `panelUndoPushed` 标志，首次触发时 push。

**状态**：已实现。

#### 2.1.2 标题编辑去 prompt ✅

**现状**：编辑图标题仍用 `prompt()` 对话框。

**方案**：改为 inline 编辑。点击标题 → 变成 input → 回车或失焦确认 → 恢复显示。与节点名称编辑体验一致。

**状态**：已实现。

#### 2.1.3 连线体验优化 ✅

**现状**：从端口拖到目标节点松开后，直接创建空标签边，自动打开边面板并聚焦标签输入框。

**方案**：增加"快速连线"模式 —— 按住 Shift 从端口拖线，松开后直接创建空标签边，不打开面板。不按 Shift 时保持现有行为（打开面板编辑）。

**实现**：mouseup 中检查 `e.shiftKey`，true 时只 save() 不 selectEdge。已在 mouseup handler 实现。

#### 2.1.4 节点文字溢出 ✅

**现状**：节点宽度自动适配文字长度，但超长标签会把节点拉得很宽。

**方案**：加最大宽度限制（如 240px），超长文字截断并显示省略号。悬停时用 tooltip 显示完整名称。

**状态**：已实现。

### 2.2 视觉增强

#### 2.2.1 网格背景 ✅

**现状**：纯白/浅灰背景，无参考系。

**方案**：Canvas 上画浅灰线框网格（间距 20px），随平移缩放变化（zoom<0.5→40px，<0.25→80px，>2→10px，>4→5px）。提供视觉参考，帮助对齐。

**状态**：已实现。

#### 2.2.2 节点 hover tooltip ✅

**现状**：hover 节点只改变边框颜色。

**方案**：hover 时在节点下方显示 tooltip，包含 group 标签和 description 的前 80 字。帮助快速浏览节点信息，不用每次都点击打开面板。

**状态**：已实现。拖拽/连线/平移时自动隐藏。

#### 2.2.3 缩放指示 ✅

**现状**：用户不知道当前缩放比例。

**方案**：工具栏显示当前缩放百分比（如 "100%"），点击可重置为 100%。低调、不碍事。

**状态**：已实现。

### 2.3 图形呈现样式 ✅

同一个 graph 数据，用户应能选择不同的呈现方式。数据模型不变，只改渲染层。

#### 2.3.1 布局算法 ✅

**现状**：手动拖拽定位，无自动布局。

**方案**：提供 4 种布局预设，通过工具栏下拉或按钮切换：

| 布局 | 说明 | 适用场景 |
|------|------|---------|
| 手动 | 用户自由拖拽（当前默认） | 精确控制位置 |
| 力导向 | 节点互斥、边吸引，自动平衡 | 探索未知结构 |
| 圆形 | 节点均匀分布在圆周上 | 少量节点、展示关系网 |
| 层次 | 按 DAG 层级从上到下排列 | 有明确依赖关系的系统 |

实现要点：
- 力导向：简易弹簧模型，迭代 200 次收敛
- 圆形：按节点数组顺序等角分布
- 层次：拓扑排序，同层节点水平排列
- 切换布局后自动 `pushUndo()`，Ctrl+Z 可撤销
- 切换到"手动"模式时保持当前坐标不变

#### 2.3.2 边的绘制样式 ✅

**现状**：直线 + 实心三角箭头。

**方案**：提供 3 种边样式：

| 样式 | 说明 |
|------|------|
| 直线 | 当前实现 |
| 曲线 | 二次贝塞尔曲线，中点偏移 25% |
| 折线 | 直角折线，先水平再垂直 |

边的样式作为全局设置，所有边统一应用。在工具栏"样式"面板中选择。

#### 2.3.3 节点形状 ✅

**现状**：圆角矩形。

**方案**：提供 3 种节点形状：

| 形状 | 说明 | 渲染 |
|------|------|------|
| 圆角矩形 | 当前实现 | roundRect |
| 圆形 | 以标签宽度为直径 | arc |
| 胶囊 | 两端半圆的矩形 | roundRect(h/2) |

形状作为全局设置统一应用。圆形下隐藏分组色条。hitNode 按弧线检测。

#### 2.3.4 样式配置 UI ✅

**方案**：在工具栏新增"样式"按钮，点击弹出下拉面板：

```
┌─────────────────────┐
│ 布局    [手动 ▾]     │
│ 边样式  [直线 ▾]     │
│ 节点形状 [圆角矩形 ▾] │
└─────────────────────┘
```

三个下拉框，改了立即生效。配置持久化到 localStorage（sa_config key）。点击面板外自动关闭。

### 2.4 数据与分享

#### 2.4.1 URL 分享 ✅

**现状**：只能通过 JSON 文件分享。

**方案**：
- 工具栏加"分享链接"按钮
- 将 exportJSON() 结果用 UTF-8 safe btoa 编码到 URL hash
- 打开带 hash 的 URL 时自动解码加载图数据
- 图太大数据量超 2000 字节时提示"图太大，请使用 JSON 文件分享"

**实现**：零依赖，使用原生 btoa/atob + encodeURIComponent/decodeURIComponent

#### 2.4.2 导入容错 ✅

**现状**：导入 JSON 只接受 `{graphs:[{...}]}` 格式，格式不对直接报错。

**方案**：
- 尝试多种格式：`{graphs:[...]}`, `{nodes:[...], edges:[...]}`, 直接 `{nodes:[...]}`
- 缺少 edges 时默认空数组
- 节点缺少字段时用默认值填充（已有此逻辑）

**实现**：importJSON 现在先尝试 `data.graphs[0]`，其次尝试 `data.nodes`，都失败则抛错。已在 importJSON handler 实现。

---

## 三、架构决策

### 3.0 三层数据架构（v0.3 新增）

```
Code 层 (JS Class)        ← 主存储，source of truth
  ↓ parse()
Data 层 (JSON)            ← 运行时模型，序列化交换
  ↓ render()
Visual 层 (Canvas)        ← 用户看到的
```

**核心转变**（v0.2 → v0.3）：
- v0.2：JSON 是主存储，代码是生成的（辅助）
- v0.3：代码是主存储，JSON 是序列化格式（派生）

**对当前实现的影响**：
- Level 1 用户不写代码，纯拖拽。此时 Data 层仍是实际工作层
- 节点新增 `inputs[]`、`outputs[]` 端口声明
- 边从 `source → target` 改为 `source_node + source_port → target_node + target_port`
- 端口为空时退化为节点级连接（向后兼容）
- Level 2 AI 介入时，AI 生成带端口的 JS Class，parse 后导入 Data 层

**参考**：Ryven（Python）、Rete.js（JS）均采用类似模式——类定义声明端口，可视化只是渲染。

### 3.1 模块化策略（v1.0 已实施）

**当前结构**：ES modules（`src/`）+ esbuild 构建 → `dist/index.html` 单文件部署。

开发时多文件模块化（10 个模块），部署时合并为单文件 HTML。理由：
- "用完即走"的产品定位要求零安装 → 构建产物 `dist/index.html` 仍是打开即用
- 代码量已超 1000 行，Level 2 将推至 3000+ 行 → 模块化是必须的
- share URL 仍依赖单文件 → 构建产物不改变这一能力

详见 `docs/modularization.md`（设计方案）和 `docs/modularization-plan.md`（实施计划）。

### 3.2 坐标系统

当前：world 坐标系 + viewX/viewY/viewScale 视口变换。

```
屏幕坐标 → world坐标: (sx - viewX) / viewScale
world坐标 → 屏幕坐标: wx * viewScale + viewX
```

所有节点位置、hitTest、边计算都在 world 坐标下进行。只有 hover tooltip、空状态提示等 DOM 元素需要用屏幕坐标定位。

### 3.3 渲染策略

当前：每次状态变化调用 `render()` 全量重绘。

对于当前规模（<100 节点）完全够用。不引入 dirty rect 或离屏缓存等优化。

### 3.4 数据流

```
用户操作 → 修改 nodes/edges → pushUndo() + save() + render()
```

- save()：同步写 localStorage，无 debounce（数据量小，不卡）
- undo：恢复 nodes/edges 引用，重新 render

---

## 四、AI 接入点设计（Level 2 预留）

### 4.1 Web as Skill 工作流（v0.5 核心）

详见 spec.md §四.x。AI 通过 fetch `/llms.txt` 自发现工具，按格式生成 graph + URL hash，输出链接给用户。

**关键**：浏览器端不调 LLM API。CORS 不是问题。

### 4.2 AI 如何读取数据（反向同步）

用户复制 URL 回对话时，AI fetch URL → 拿到含 hash 的链接 → 解码 hash → parse JSON。

```js
// AI 端伪代码
const url = 'https://your-site.github.io/#eyJncmFwaHM...'
const hash = url.split('#')[1]
const json = decodeBase64(hash)
const data = JSON.parse(json)
```

每个 node 只含 `id` / `label` / `code` / `metadata`，其他信息都在 code 里（注释 + static 声明 + 实例属性 + 方法体）。

### 4.3 AI 如何写入数据（生成 URL）

AI 读 URL 拿到 code 后，**核心任务是读注释 → 填实现**：

```js
// AI 端伪代码
const data = decodeAndParse(url)
for (const node of data.graphs[0].nodes) {
  const parsed = parseClassCode(node.code)
  for (const method of parsed.methods) {
    if (isEmpty(method.body) || isStale(method.comment, method.body)) {
      method.body = generateImplementationFromComment(method.comment)
    }
  }
  node.code = serializeClass(parsed)
}
const newUrl = encodeUrl(data)
// 输出 newUrl 给用户
```

人写的注释不动，AI 只在注释下填/改方法体。

### 4.4 执行引擎

Level 2/3 的核心流程：

1. 解析每个节点的 code → 派生 inputs/outputs/properties/methods/edges
2. 编译方法体为可执行函数（`compileClass`）
3. **Level 2**（传播）：调用每个 output 对应方法，沿 `static outputs` 声明的 target 流到下游 input
4. **Level 3**（演化）：调用 `tick(dt, inputs)` 或其他被外部触发的方法
5. 渲染节点状态变化

**Level 3 不限于 `tick(dt)`**——任何 Class 方法都可以被外部调用（事件触发、其他节点调用、定时器），都属于 Level 3 的"演化"。

### 4.5 LLM CORS（v0.5+ 已不阻塞）

**v0.4 误解**：以为 CORS 是墙，只能手动搬运。

**v0.5+ 修正**：Web as Skill 模式下，AI 在客户端 fetch llms.txt + 读 code + 填实现 + 输出 URL，浏览器端不调 LLM API。CORS 不再是阻塞。

补充方案（仍可用，但非核心）：
- 手动搬运（src/ai.js 的 exportAIPrompt）—— v1.5 保留
- 本地代理（src/ai.js 的 callAI）—— v1.5 已确认从未实现，仅历史文档提及

详见 spec.md §四.x。

---

## 五、实现优先级

| 优先级 | 项目 | 工作量 | 状态 |
|--------|------|--------|------|
| P0 | 撤销逻辑修正 | 小 | ✅ |
| P0 | 标题 inline 编辑 | 小 | ✅ |
| P0 | 右键平移 | 小 | ✅ |
| P1 | 节点文字溢出截断 | 小 | ✅ |
| P1 | 缩放指示 | 小 | ✅ |
| P1 | 网格背景 | 小 | ✅ |
| P1 | hover tooltip | 中 | ✅ |
| P2 | 快速连线（Shift） | 小 | ✅ |
| P2 | URL 分享（btoa hash） | 中 | ✅ |
| P2 | 图形样式：布局算法 | 中 | ✅ |
| P2 | 图形样式：边绘制样式 | 小 | ✅ |
| P2 | 图形样式：节点形状 | 小 | ✅ |
| P2 | 图形样式：配置 UI | 小 | ✅ |
| P3 | 导入容错 | 小 | ✅ |
| P1 | 暗色主题 | 中 | ✅ |
| **P0** | **端口系统：节点 inputs/outputs 数据模型** | **中** | **✅** |
| **P0** | **端口系统：边 source_port/target_port** | **中** | **✅** |
| **P1** | **端口系统：节点面板端口编辑 UI** | **中** | **✅** |
| **P1** | **端口系统：端口渲染（左入右出）** | **中** | **✅** |
| **P1** | **端口系统：端口级连线交互** | **中** | **✅** |
| **P2** | **端口系统：旧格式 JSON 兼容导入** | **小** | **✅** |
| **P2** | **端口系统：JS Class 解析器** | **中** | **✅** |
| **P1** | **节点卡片式信息密度** | **中** | **✅** |
| **P1** | **弹性物理模式（含碰撞/拖拽修复）** | **中** | **✅** |
| **P1** | **节点卡片式信息密度（4 级形态）** | **中** | **✅** |
| **P1** | **边流动动画 + 端口级端点定位** | **中** | **✅** |

端口系统已完成。Level 1 体验增强已完成。

### 5.1 v0.6 待办（按 spec v0.6）

| 优先级 | 项目 | 工作量 | 状态 |
|--------|------|--------|------|
| P0-a | 移除 `x, y` 和 `visual` 字段（exportJSON） | 小 | ✅ |
| P0-b | `parseClassCode` 提取 JSDoc 注释 | 中 | ✅ |
| P0-b | `updateCommentInCode` 局部改注释（新增） | 中 | ✅ |
| P0-b | UI 编辑描述接入局部改 code（panel.js） | 中 | ✅ |
| P0-c | isEmpty 检测（橙色标记，简化版） | 中 | ✅ |
| P0-d | edges 迁移到节点方法（Class化） | 大 | ✅ |
| P0-d | 旧 JSON edges 反向迁移到 static outputs | 中 | ✅ |
| P1 | 更新 `/llms.txt`（强调 L1→L2 转换） | 中 | ✅（上轮文档更新完成） |
| P1 | auto-layout on import（位置移除后） | 中 | ✅（importJSON 调 applyLayout('force')） |
| P1 | 部署到 GitHub Pages | 小 | ❌（用户未指示） |
| P2 | 删除 src/ai.js 的 `callAI`（实际未实现） | 小 | ✅（清理 unused extractCodeFromAI） |
| P2 | 删除/隐藏代码面板（showCodeImport） | 小 | ✅ |
| P2 | 移除 syncNodeCode 全量重写 | 小 | ✅ |
| P2 | 移除节点 `description` 字段 | 小 | ✅ |
| P2 | `exportAIPrompt` 处理 | 小 | ✅ 保留（作为应急手动方案） |

> v0.6 代码改动已完整落地（v1.5），28/28 puppeteer 测试通过。剩余 ❌ 仅 P1 GitHub Pages 部署。

---

## 六、验证方式

每个功能完成后在浏览器中手动测试：

1. **撤销修正**：打开面板不修改 → Ctrl+Z → 确认无空操作
2. **标题编辑**：点击标题 → 输入新名称 → 回车确认 → 标题更新
3. **右键平移**：右键拖拽 → 画布平移
4. **文字截断**：创建超长名称节点 → 确认宽度有上限、hover 显示全名
5. **缩放指示**：滚轮缩放 → 工具栏百分比变化 → 点击重置为 100%
6. **网格**：平移画布 → 网格跟着动
7. **URL 分享**：点分享 → URL 变化 → 新标签打开 → 图还原
8. **导入容错**：导入 `{nodes:[...]}` 格式 → 正常加载
9. **布局切换**：切力导向 → 节点自动排列 → Ctrl+Z 可撤销 → 切手动 → 坐标不变
10. **边样式**：切曲线 → 所有边变贝塞尔 → 切折线 → 所有边变直角
11. **节点形状**：切圆形 → 所有节点变圆 → 切胶囊 → 变胶囊
12. **样式持久化**：选好样式 → 刷新页面 → 样式保持

### 6.1 v0.6 方向验证（v1.5 已落地）

**自动化测试**（`npm run build && node scripts/test-e2e.mjs`，28/28 通过）：
- 旧格式迁移：v0.5 JSON（含 edges/x/y/description）→ importJSON → 派生 edges 正确
- Level 2 propagate：population.housing_demand = 500*0.3 = 150 → 流到 housing.demand
- Level 3 stepAll：tick 让 current 按 growthRate 演化（100→105→110.25）
- JSON 规范化：parseClassCode 同步 inputs/outputs/properties
- exportJSON 字段：无 x/y/visual/description/edges 数组
- isEmpty 检测：`return null` 方法被识别
- updateCommentInCode：注释更新后方法体保留

**手动 UI 验证清单**（用户在浏览器 `dist/index.html` 走一遍）：

| # | 操作 | 预期结果 |
|---|------|---------|
| 1 | 双击画布创建节点 | 新节点出现；面板自动打开；名称输入框聚焦 |
| 2 | 从 source output 端口拖到 target input 端口 | 边出现；source code 的 `static outputs` 加 `target/target_port` 声明；target code 加 input 端口 |
| 3 | 无端口节点连线（从 4 端口位置拖） | source 和 target code 自动生成 default 端口；边出现 |
| 4 | 节点面板改"描述"textarea | code 里 class 上方加 JSDoc；其他字段不动 |
| 5 | 边面板改"描述"textarea | source code 里 output 方法上方加 JSDoc；方法不存在时先创建 stub（`return null`） |
| 6 | 面板点端口的 − 按钮 | 端口从 code 移除；关联边自动消失（deriveEdges 不再返回） |
| 7 | 选中边按 Delete | source code 里对应 `static outputs` 声明移除 |
| 8 | 改属性 key/value | code 里对应字段值更新；其他字段注释保留 |
| 9 | 节点含 `return null` 方法 | 节点右上角橙色小圆点 |
| 10 | 文件 → 导出 JSON | JSON 含 `code`、`label`；不含 `x/y/visual/description/edges` |
| 11 | 文件 → 分享 | URL hash 比之前短（少了 x/y/edges）；新标签打开自动加载 |
| 12 | 文件 → 导入 JSON（v0.5 格式含 x/y 和 edges） | 自动迁移；edges 派生正确；无位置时自动布局（力导向） |
| 13 | 样式 → 执行模式 manual → 改 current → 点面板"传播" | `population.housing_demand` 流到 `housing.demand` |
| 14 | 样式 → 执行模式 step → 点工具栏"下一步" | 每个 tick 让 current 按 growthRate 增长 |
| 15 | Ctrl+Z 撤销 | 恢复到上一个状态（含 code 修改） |
| 16 | localStorage 持久化（编辑后刷新） | 节点 code 和位置都保留 |

**剩余待测试**（需 P1 部署后）：
- **AI 转换流程**：手动给 AI 一个含空方法的 URL（带详细注释）→ AI 应能在注释下填实现 → 输出新 URL → 加载后能跑
- **AI 模拟测试**：把 `/llms.txt` + 一个具体需求给 LLM，看它能否读懂"读注释→填实现"的核心任务
- **反向同步**：UI 改注释 → 复制 URL → AI 解码 → 看到 AI 视角
- **GitHub Pages 部署**：`https://<user>.github.io/<repo>/llms.txt` 可被 fetch；`#hash` 解码加载正常
