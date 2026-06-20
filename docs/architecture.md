# Architecture — L2 架构层

> 本文档定位:让读者在脑里画出"项目骨架图"。
> 三段式:[是什么] / [为什么] / [不变量]。
> 模块层(L3)细节按需在 `docs/modules/`(本项目暂未拆)或现有层级文档(`visualization-modes.md`/`edge-routing.md`/`layouts.md`)中。

---

## [是什么] — 模块清单

| 模块 | 文件 | 定位 |
|---|---|---|
| **入口/编排** | `src/main.js` | init 顺序:URL hash > localStorage > DEFAULT_BOOTSTRAP;装配 state/panel/codeview/renderer |
| **状态** | `src/state.js` | runtimeInstances / sourceCode / visualState / panelMode 等运行时状态(单例) |
| **代码层(真相源)** | `src/codegraph.js` | `runSource` 执行 sourceCode、`serializeCode` 反向构建、`makeBridge` 提供 `GraphStarter.add` |
| **scanner** | `src/scanner.js` | 静态分析 sourceCode 字符串,提取 class 定义(读 `new cls()` 实例的 3 个 class field) |
| **运行时层** | `src/io.js` | `wrapInstance` 加 getter、`deriveEdges` 派生边视图、state 别名 |
| **执行引擎** | `src/engine.js` | `topologicalSort` / `propagate` / `stepAll`(UI 模式 no-op,Code 模式方法体才生效) |
| **持久化** | `src/main.js` 内 `load`/`save` | `sa_data` 存 `{version, sourceCode, visualState, ...}`,URL hash 分享 base64 |
| **渲染** | `src/renderer.js` | Canvas 2D,按 `infoLevel` 三档渲染节点 + 边布线 |
| **路由** | `src/utils.js` (`edgePts` 等) | 边端点 + 控制点几何计算 |
| **布局** | `src/physics.js` | manual/force/circular/hierarchical 四种自动布局 |
| **panel** | `src/panel.js` | 类型/实例 segmented control + 属性/边编辑 |
| **codeview** | `src/codeview.js` | CodeMirror 集成,Code 模式可写,UI 模式只读 |
| **input** | `src/input.js` | HTML ↔ module bridge(`window.<name> =`),键盘事件,拖边交互 |
| **bootstrap** | `src/bootstrap.js` | DEFAULT_BOOTSTRAP(空串)+ 演示图源代码 |

**配套层级文档**(按"画什么"分层的设计文档,跟 `src/` 实现一一对应):

- `docs/visualization-modes.md` — **渲染层**:三档信息密度 + 防溢出 + hover tooltip
- `docs/edge-routing.md` — **路由层**:三种布线 + 端口系统 + 避让算法
- `docs/layouts.md` — **布局层**:四种布局 + grid + 三个感知

---

## [是什么] — 双模式编辑 + 实例级 edges 模型(v0.9)

v0.9 把"边"从 class 级声明彻底迁到**实例级 `attrs.edges` 数组**(每条 `{target, description}`),让多边天然支持、概念归一。

### UI 模式(默认)

声明式 sourceCode(class 含 3 个实例级 class field,**无方法体**)。Panel 可编辑 → `syncCodeFromRuntime()` 双向同步。Codeview 只读。

```js
class Processor {
  description = "处理输入数据并传给下游"
  name = "处理器"
  attrs = {
    speed: 100
  }
}

const Processor_1 = GraphStarter.add(Processor)
const Processor_2 = GraphStarter.add(Processor)
const Database_1 = GraphStarter.add(Database)
Processor_1.edges = [
  { target: Database_1, description: '主数据流' }
]
Processor_2.speed = 200                 // 实例 override
```

### Code 模式

sourceCode 完全自由(含方法体、控制流、参数化)。Codeview 可写 → `commitCode` 触发 `runSource` 派生 runtimeInstances。Panel 只读。

```js
class Processor {
  description = "处理输入数据并传给下游"
  name = "处理器"
  attrs = { speed: 100 }
  process({ dt }) {
    for (const e of this.edges || []) {
      e.target.input = this.speed * dt
    }
  }
}
```

### 模式切换

工具栏 segmented control `[UI 编辑 | 代码]`。UI → Code 无损;Code → UI 检测 sourceCode 是否含程序化结构(`for (`/`while (`/`if (`/`function`/`=>` 或 class 内非 constructor 方法),含则弹 `confirm` 反向构建(`serializeCode` 重写 sourceCode,丢方法体/控制流)。

### 3 个 class field(实例级,无 static 无 constructor)

- `description` (string):class 默认描述
- `name` (string,可选):class 默认名(空时画布主标题回退到 className)
- `attrs` (`{ key: value, ... }`):class 默认属性字典(**纯数据,无 null 引用槽**)

scanner 读 `new cls()` 实例上的这 3 个字段(不扫 static、不扫 constructor、不扫 edges)。`GraphStarter.add` 只 `deepCopy(fresh.attrs)` 不预填其他字段——实例 attrs 真正可追加。

### 边(实例级 `attrs.edges` 数组)

每条 `{ target, description }`,`target` 指向另一实例的 attrs。一个实例可以有任意多条 edges(多对一 / 多对多 / 同目标多边都支持)。bootstrap 里写 `X.edges = [{ target: Y, description: '...' }]` 即建立一条边。

### 3 类 attrs 字段(panel / 画布按类区分显示)

- **元信息**:`attrs.name` / `attrs.description`(主标题 / 底部说明用,不进属性区)
- **边数组**:`attrs.edges`(派生为画布的边,不进属性区)
- **数据属性**:其他(画布属性行 + panel 属性区)

### 两层模型

- **代码层(真相源)**:sourceCode 字符串
- **运行时层(mutable)**:方法体里 `this.X = ...` 写 self 的变化留在 `attrs`,不入代码。`resetRuntime()` 重新执行 sourceCode 回到初始

### 实例身份 = varName

varName 由 `GraphStarter.add()` 内部自动生成 `<ClassName>_<n>`(或第二参数 explicitName 覆盖)。`for`/数组 push/解构 都能用。varName 不可改(panel 显示但禁用编辑)。

### 边的存在条件

源实例的 `attrs.edges` 数组含 `{ target, description }` 条目,且 `target` 是另一 inst.attrs(含 `__instId` 反查)。`deriveEdges()` in `src/io.js` 遍历所有实例的 `attrs.edges` 派生边视图。边 id = `<srcVar>><tgtVar>>idx`(idx 是 attrs.edges 数组里的位置,区分同对多边)。

### 节点显示 = name + varName

画布双行:主标题 `attrs.name`(兜底链 `attrs.name → cls.name → className → varName`),副标题 varName。底部 description 取 `wrapInstance.description` getter(优先 `inst.attrs.description`,回退 `cls.description`)。

### panel 类型/实例 segmented control

Panel 顶部 `[ 类型 | 实例 ]` 切换:

- **实例模式**(默认):编辑 `inst.attrs` override + `inst.attrs.edges` 数组(加/删/改 target/description)。仅影响当前实例。
- **类型模式**:编辑 `cls.description` / `cls.name` / `cls.attrs[key]`(无 edges,边只在实例级)。影响所有同 class 实例。改默认值时,未 override 的实例自动同步新 default,已 override 的实例保留。

`state.panelMode[varName]` 存内存 map(不入 sourceCode / sa_data)。Code 模式下 segmented control 禁用。

### panel 加/删属性

"+ 加属性"按钮双模式都有:

- 实例模式:modal 收集 key + value → `inst.attrs[key] = value`
- 类型模式:modal 收集 key + value → `cls.attrs[key] = value` + 同步到所有同 class 实例

每个属性行带 🗑 删属性按钮(实例模式从 inst.attrs 删,类型模式从 cls.attrs 删)。

### panel 加/删边(v0.9 改为实例模式独有)

实例模式 panel 含"+ 加边"按钮:

- 加边:modal 收集 target(datalist 选现有实例) + description → push 到 `inst.attrs.edges`
- 删边:每条边显示 target 下拉 + description 输入 + 删除按钮
- 类型模式无边区(边是实例级概念)

### selEdge 存 id 字符串

`state.selEdge` 是 `<srcVar>><tgtVar>>idx` 字符串而非对象引用,活过 `runSource` 重建。点击画布边 = `selectEdge(ed)` + 打开源节点 panel。Code 模式下"+ 加边"按钮不显示。

### 拖边交互(v0.9 选中后显示拖柄)

选中节点后画布上画 4 个拖柄圆点(上/右/下/左中点,圆形节点用直径外接方位点)。mousedown 命中拖柄(`hitHandle` in `src/utils.js`,PORT_HIT 范围)→ `state.mode = 'edge'` + `state.edgeSrcId` → mousemove 显示虚线(从源节点右侧中点出发)→ mouseup 在目标节点上 → 弹 modal 收 description → push `{ target, description }` 到 `srcInst.attrs.edges`。未选中节点时无拖柄,避免视觉拥挤。

### 边的走向(左右水平出线)

`edgePts` in `src/utils.js` 永远返回源节点右侧中点 + 目标节点左侧中点(不再用 `rectEdge` 算矩形交点)。curve 模式用 cubic Bezier `M p1 C p1±curveOff, p2∓curveOff, p2`——curveOff 方向按 `p2.x - p1.x` 符号自动选(目标在右 → S 曲线;目标在左 → 绕外圈,避免穿过节点)。多边同对:按 `(source_node, target_node)` 分组,每对里第 N 条边相对中心的偏移 `idx = seen - (total-1)/2`;curve 模式控制点 y 加 `idx*12` 偏移(曲率错开,2-3 条边都能看清),curveOff 也加 `|idx|*15`;straight 模式端点 y 加 `idx*12`。

### Ctrl+C / Ctrl+V

仅 canvas focus 时拦截(panel 输入框 / codeview 编辑器 focus 时走浏览器原生):

- **Ctrl+C**:`state.clipboard = state.selVarName`
- **Ctrl+V**:从 `state.clipboard` 读源实例,不弹 modal 创建副本。varName `<原>_1` 起,冲突自动 `_2`、`_3` ...;位置 + (40, 40) offset;attrs + description + edges 数组全部继承(edges 里的 target 引用原样保留——指向相同目标实例)

### 属性语义

class 默认值永远保留;实例 override 单独写在启动代码里(每个字段单独一行)。实例能加 class 没有的字段(追加,包括 `edges`),runSource 后保留。

### 双向转换器

- `code → graph`:`runSource(state.sourceCode, state)` in `src/codegraph.js`。`new Function('GraphStarter', sourceCode)(bridge)` 执行,bridge.add(cls, explicitName) 内部自动生成 varName
- `graph → code`:`serializeCode(state)` in `src/codegraph.js`。class 段用实例级 class field 语法(description / attrs 必输出,name 仅在非空时输出,**无 edges 字段**,**不输出方法体**);启动段从 `runtimeInstances` 反向构建(add 调用 + 每个 override 字段单独一行 + `X.edges = [{ target: Y, description: '...' }]` 数组赋值)。**仅 UI 模式调**

---

## [是什么] — 主流程叙述

```
启动:
  main.js init()
    → load() 优先级:URL hash > localStorage(sa_data) > DEFAULT_BOOTSTRAP(空串)
    → 旧版本(version !== 6)硬切换:丢弃 sa_data,走 DEFAULT_BOOTSTRAP
    → runSource(sourceCode) → scanner 提取 class → bridge.add 生成 runtimeInstances + varName
    → deriveEdges() 遍历所有 inst.attrs.edges 派生边视图
    → render() Canvas 绘制(按 infoLevel 三档)

UI 模式交互:
  用户操作(panel 加属性 / 拖边 / Ctrl+V ...)
    → mutate runtimeInstances[i].attrs(或 attrs.edges)
    → syncCodeFromRuntime() 反向写回 sourceCode
    → save() 持久化(sa_data + URL hash)
    → render()

Code 模式交互:
  用户输入 codeview
    → debounce 400ms
    → commitCode() → runSource + save + render
    → Code → UI 切换检测程序化结构,含则 confirm 反向构建
```

---

## [是什么] — 关键概念

**`GraphStarter.add()` 返回 attrs 代理**,不是 RuntimeInstance 容器。这样 `Source_1.edges = [{ target: Database_1, ... }]` 原生 JS 赋值在 `Source_1.attrs.edges = [...]` 上生效——`Database_1` 本身就是 attrs 对象,存到 `attrs.edges[i].target` 即可。方法体内 `this.edges[i].target.Y = ...` 无需 proxy 直接命中目标 attrs。

**实例虚拟字段(向后兼容)。** `wrapInstance(inst)` in `src/io.js` 给每个 RuntimeInstance 加 getter:`id`/`classId`/`label`/`description`/`name`/`x`/`y`/`properties`/`inputs`/`outputs`/`computed`/`error`。`x`/`y` 实际存取于 `state.visualState.positions[varName]`。`properties` 是合并视图(`{...cls.attrs, ...inst.attrs}` 减 `{name, description, edges}`)。v0.9 `inputs`/`outputs` 永远返回空数组(无命名端口概念,画布不再画端口圆点)。

**state 兼容别名。** `state.instances`/`state.nodes` 是 `runtimeInstances` 的 getter 别名;`state.selInstance`/`state.selNode`/`state.hoverInstance`/`state.hoverNode`/`state.dragInstance`/`state.dragNode` 通过 varName 字符串查找 RuntimeInstance。新代码应直接用 `state.runtimeInstances` + `state.selVarName`。

**HTML ↔ module bridge.** `src/index.html` uses inline `onclick` handlers. Every function called from HTML must be explicitly registered on `window` in `src/input.js`(search for `window.<name> =`)。入口:`window.setEditMode`、`window.toggleCodeView`、`window.commitCodeNow`、`window.resetRuntime`、`window.createNode`、`window.copySelectedNode`、`window.copyInstance`、`window.setPanelMode`、`window.addInstanceEdge`、`window.removeInstanceEdge`、`window.addProperty`、`window.deleteProperty`、`window.selectInstance`。

**数据流 & 渲染。** UI 模式:用户操作 → mutate runtimeInstances.attrs(或 attrs.edges)→ `syncCodeFromRuntime()` + `save()` + `render()`。Code 模式:用户输入 codeview → debounce 400ms → `commitCode()` → `runSource` + `save` + `render()`。

**执行引擎** (`src/engine.js`). `topologicalSort()` 基于 `deriveEdges()` 排序实例;`propagate(startVarName)`/`stepAll()` 按拓扑序调用方法(UI 模式 class 无方法体 → 这些调用是 no-op,等 Code 模式 AI 实现方法体后才有效果)。

**持久化。** `sa_data` 存 `{version:6, sourceCode, visualState, graphId, graphTitle, editMode}`。`sa_config` 存样式 + 主题。URL hash 分享编码 sourceCode(UTF-8 safe base64),上限 24000 字符。

**旧格式硬切换。** v0.9 之前的 `sa_data`(version !== 6,含 v0.5 / v0.6 / v0.7 / v0.8)与 v0.9 不兼容(实例级 edges 模型与历史 class.edges + null 槽风格不兼容)。`load()` 检测到旧版本会丢弃并清空 `sa_data`,返回 false → 走 DEFAULT_BOOTSTRAP(空)。

---

## [为什么] — 架构决策

### 双模式编辑

详见 [ADR-002](decisions/adr-002-dual-mode-editing.md)。一句话:用户既要 vibe editing(UI 拖拽)又要表达任意算法(Code 写方法体),两种体感不能合并,只能 segmented control 切。

### 边模型从 class 级迁到实例级(v0.9 最大转向)

详见 [ADR-001](decisions/adr-001-instance-level-edges.md)。一句话:多对一 / 多对多 / 同目标多边表达困难,attrs 占位槽是"占位待填"的隐式契约,scanner 要特殊处理——统一到实例级数组,概念归一。

### `GraphStarter.add` 返回 attrs 代理,不返回 RuntimeInstance

为了让 `X.edges = [{ target: Y, ... }]` 这种**原生 JS 赋值**直接生效在 `X.attrs.edges` 上。如果返回 RuntimeInstance 容器,就要 `X.runtime.attrs.edges = ...`,破坏声明式 sourceCode 的体感。

### 渲染 / 路由 / 布局三层分文档

每层关注点不同:渲染层管"画什么",路由层管"边怎么走",布局层管"节点放哪"。三个独立设计文档让每层的设计取舍能独立讨论,不被其他层的约束绑架。详见各层级文档。

### `inputs`/`outputs` getter 永远返回 `[]`

v0.6/v0.8 时代的"命名端口"被 v0.9 砍掉——边是实例级数组,端口不需要独立存在。但 getter 保留返回空数组,向后兼容 v0.8 代码引用。端口作为**几何产物**在路由层动态分配(详见 `edge-routing.md` §2.1)。

---

## [不变量] — 架构级约束

### 真相源不变量

1. **sourceCode 字符串是唯一真相源**。runtimeInstances 是它的派生视图。`runSource` 是单向重建,不可逆。
2. **UI 模式 sourceCode 必须可被 scanner 解析**(声明式 + 3 个 class field + 无方法体)。Code 模式可以任意 JS,但 UI 切换时会反向构建。
3. **varName 一旦生成就不可改**。改 varName 涉及 sourceCode 全文重写 + URL hash 重编码 + selVarName/hoverVarName 同步,复杂度高,v0.9 不做(panel 显示但禁用)。

### 边模型不变量

4. **边只在实例级**。无 class.edges 字段。一个实例的 edges 数组定义它的所有出边。
5. **`attrs.edges[i].target` 必须是另一 inst.attrs**(含 `__instId` 反查),不能是 varName 字符串、不能是 RuntimeInstance、不能是 cls。
6. **边 id = `<srcVar>><tgtVar>>idx`**。idx 是 attrs.edges 数组里的位置,区分同对多边。`selEdge` 用 id 字符串而非对象引用,活过 `runSource` 重建。

### scanner 不变量

7. **scanner 只读 `new cls()` 实例上的 3 个 class field**(description / name / attrs)。**不**扫 static、**不**扫 constructor、**不**扫 class.edges(v0.8 残留)。scanner 还会从 attrs 里过滤掉误写的 `edges` 键。
8. **`GraphStarter.add` 只 `deepCopy(fresh.attrs)`** 不预填其他字段。实例 attrs 真正可追加(包括 `edges`)。

### 数据流不变量

9. **UI 模式:用户操作 → mutate runtimeInstances → `syncCodeFromRuntime()` → `save()` → `render()`**。四步顺序不可乱(尤其是 syncCodeFromRuntime 必须在 save 前)。
10. **Code 模式:用户输入 → debounce 400ms → `commitCode()` → `runSource` + `save` + `render()`**。debounce 防抖是硬约束。

### 持久化不变量

11. **`sa_data.version` 必须是 6**。其他版本(v0.5/v0.6/v0.7/v0.8)硬切换丢弃。
12. **URL hash 上限 24000 字符**(UTF-8 safe base64)。超限不分享。

### 技术栈锁定

13. **Vanilla JS + Canvas 2D,无框架**(esbuild 仅 dev)。部署产物是单文件 `dist/index.html`。
14. **class 定义写在 sourceCode 字符串里**(启动时 `new Function` 执行),不在 bundle 中作为 module import。
15. **Class method bodies forbid `fetch` / `XMLHttpRequest` / `import` / `require`**(文档约定,无运行时强制)。仅在 Code 模式存在;UI 模式 serializeCode 永不输出方法体。
16. **UI labels are in Chinese; code identifiers are camelCase English.**
