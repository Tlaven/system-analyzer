# 通用系统辅助分析平台 — 设计文档

> **v0.4-era 历史文档，已被 v0.7 取代。** 仅作设计思路参考。
>
> 当前实际架构见 `CLAUDE.md` / `AGENTS.md`。v0.7 设计意图见 `docs/v0.7-design.md`。
>
> 版本路线：
> - **v0.4 及更早**：class-based + code-as-truth（本文档描述的模型）
> - **v0.5**：instance-based + 静态扫描（class 库 bundle 内置，删除 codeview）
> - **v0.6**：回归 code-as-truth，emitter-based 边模型
> - **v0.7（当前）**：双模式编辑（UI / Code）+ static edges 容器模型；删除 emitter、GraphStarter.describe、字面 const varName 扫描
>
> 本文档的"L1 注释 + L2 实现统一在 code 里"哲学在 v0.7 仍成立，
> 但实施细节（启动代码、static edges 容器、双模式切换、panel 类型/实例切换）
> 以 `CLAUDE.md` 为准。
>
> 日期：2026-06-14（v0.7 note: 2026-06-17）

---

## 零、核心定位

**一个 web 端的系统关系可视化工具，作为 AI 的"Web Skill"存在。**

用户与 AI 聊天时，AI 通过 fetch `/llms.txt` 自发现这个工具，按说明生成 graph 代码 + URL hash，输出链接给用户。用户点开看到可视化，可在 UI 上手动调整；调整后复制新 URL 回对话，AI 解码读最新状态，继续协作。

**典型使用场景：**

用户和 AI 聊到某个复杂系统（一款游戏的经济循环、一个团队的协作关系、一个 SaaS 的增长模型）。AI 识别"这里需要可视化"，自己 fetch 工具的 `/llms.txt`，按格式生成 graph 数据，编码到 URL hash，输出链接。用户点开看到 graph，可以拖拽微调、保存、分享。用完即走，不需要注册、不需要安装、不需要学习。

**核心翻转（v0.4 → v0.5）**：从"AI 推荐（用户去用）"到"AI 调用（用户看结果 + 微调）"。

---

## 一、核心理念

### 1.1 人和 AI 各管一段，通过 code 协作

- 人写 **L1 注释**（通过 UI 编辑"描述"，背后是改 code 里的注释/docstring）
- AI 读 code（含注释）→ 在注释下填 **L2 实现**（方法体）
- code 是 graph 的**唯一存储**，但人和 AI 看到的"面"不同：
  - 人看 UI = code 的"注释视图"（隐藏 method body）
  - AI 看 code 完整内容（注释 + 实现）

```
       人                  AI
       ↓                  ↓
   UI 编辑描述         读 code（含注释）
       ↓                  ↓
   改 code 注释         填 code 实现方法体
       └── 同一份 code ──┘
              ↓
         URL hash（传输）
```

**单向流转**：人改注释 → AI 在新注释下填实现。不再是"双向同步"。

### 1.2 人负责"是什么"，AI 负责"怎么动"

- 人决定**是什么**：节点叫什么、有哪些字段、字段间的关系是什么（写在注释里）
- AI 决定**怎么动**：根据注释，填出可执行的方法体

人写注释 = 给 AI 写需求文档；AI 填实现 = 按需求实现。

### 1.3 代码是图的主存储格式（L1 注释 + L2 实现都在 code 里）

**code 是 graph 的唯一存储**。L1（注释）和 L2（实现）都在 code 里，**不是两个字段**：

| 能力 | 人（通过 UI 改注释） | AI（通过改实现） |
|------|---------------------|-----------------|
| 增删节点、改字段名 | ✅ | ✅（一样） |
| 写端口关系描述（注释） | ✅ | ✅（一样） |
| 写实现（线性、非线性、条件） | ❌ | ✅ |
| 写被外部调用的方法（L3 仿真） | ❌ | ✅ |
| 写工具函数、helpers | ❌ | ✅ |

**默认是 UI 操作注释**——人用 UI 写需求，code 注释跟着变。**AI 收到 URL 时**：读 code，看哪些方法是空/stale，在注释下填实现。

**关键约束**：UI 改动只动注释，**不重写**整个 code（保留 AI 已写的实现）。

---

## 二、数据模型

### 2.0 三层架构

```
Code 层 (JS Class，含注释+实现)    ← 主存储，source of truth
  ↓ parse()
运行时模型（内存对象）              ← 由 code 派生（含 edges）
  ↓ render()
UI 层 (Canvas + DOM)              ← 用户看到的（只展示注释+拓扑，隐藏实现）
```

代码是图的存储格式。运行时模型由 code 派生（edges 也由 `static outputs` 派生，不再独立存储）。UI 是 code 的视图（注释视图 + 拓扑渲染）。

**v0.6 关键变化**：
- code 是单一存储（L1 注释 + L2 实现都在里面）
- edges 不作为独立字段（派生自 `static outputs`）
- 位置信息不在模型里（视图层独立管理）
- UI 是 code 的注释视图（人编辑描述 = 改注释）

### 2.1 序列化格式（JSON）

graph 的存储与传输格式。**只存节点**（每个节点带完整 code，含注释和实现）；edges、位置、视图状态都不在 JSON 里：

```json
{
  "graphs": [{
    "id": "frostpunk2",
    "title": "Frostpunk 2 系统模型",
    "nodes": [
      {
        "id": "population",
        "label": "人口",
        "group": "stock",
        "code": "class population {\n  /**\n   * 城市人口总量，受出生、死亡、移民影响\n   */\n  current = 350\n  birthRate = 0.02\n\n  /**\n   * 人口越多，住房需求越大，比例约 0.3\n   */\n  static outputs = [{ id: 'housing_demand', target: 'housing', target_port: 'demand' }]\n  housing_demand(inputs) {\n    return this.current * 0.3\n  }\n}",
        "metadata": {}
      }
    ]
  }]
}
```

**注意**：
- 没有 `edges` 数组（运行时由各节点 `static outputs` 派生）
- 没有 `description` 字段（在 code 注释里）
- 没有 `x, y`、`visual`（视图信息，不入模型）
- 没有 `inputs`/`outputs` 字段（在 code 的 `static inputs/outputs` 里）
- 没有 `properties` 字段（在 code 的实例属性里）

加载时，`parseClassCode(code)` 派生出 inputs/outputs/properties/methods 和 edges。

### 2.2 节点模型（序列化字段）

JSON 里只存这些字段。其余（inputs/outputs/properties/description）都在 code 里：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 唯一标识，同时是 Class 名（建议 ASCII） |
| label | string | 是 | 显示名称（可中文） |
| group | string | 否 | 分组/类型 |
| code | string | 是 | JS Class 源码（含 L1 注释和 L2 实现） |
| metadata | dict | 否 | 扩展元信息 |

**code 内部结构派生出的字段**（不直接序列化）：

| 派生字段 | code 里的位置 | 说明 |
|---------|--------------|------|
| description | Class 字段上方的 JSDoc 注释 | 节点的 L1 描述 |
| inputs | `static inputs = [...]` | 输入端口列表 |
| outputs | `static outputs = [...]` | 输出端口列表（含 target/target_port 声明拓扑） |
| properties | 实例属性 `name = value` | 节点状态 |
| methods | Class 方法定义 | L2 实现（边函数、tick、外部调用方法） |

**Port 结构**（在 `static inputs/outputs` 数组里）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 端口唯一标识（节点内唯一） |
| label | string | 否 | 端口显示名称（默认 = id） |
| target | string | 否 | outputs 专用：目标节点 id（声明边的拓扑） |
| target_port | string | 否 | outputs 专用：目标端口 id |

### 2.3 边模型（运行时派生，不存储）

**边不是独立数据结构**。一条边 = source 节点的某个 output 方法 + 该方法的 target 声明：

```
source.code 里：
  static outputs = [{ id: 'housing_demand', target: 'housing', target_port: 'demand' }]
  /**
   * 人口越多，住房需求越大（这是边的 L1）
   */
  housing_demand(inputs) {
    return this.current * 0.3   // 这是边的 L2
  }

→ 派生出 edge: population.housing_demand → housing.demand
```

边的语义拆分：
- **拓扑**（source/target/port）：`static outputs` 声明
- **L1 描述**：方法上方的 JSDoc 注释
- **L2 实现**：方法体

运行时由 `parseClassCode` 解析所有节点的 `static outputs`，构造 edges 列表供渲染和执行使用。**不入 JSON**。

### 2.4 关系描述的精度

平台不强制精度，由用户和 AI 按需决定。**所有精度都在同一份 code 里**，区别只是"注释详细度"和"方法体完整度"：

| 精度 | code 里的形态 | 谁来写 | 能不能跑 |
|------|--------------|--------|---------|
| L1 stub | 只有 `static outputs` 声明 + 方法上方注释，方法体空/`return null` | 人拖线+写注释 | 不能 |
| L1+ 部分 | 注释详细，方法体有简单实现 | 人写注释，AI 部分填 | 部分 |
| L2 完整 | 注释 + 完整方法体 | AI 全部填 | 能 |
| L3 扩展 | 加 `tick(dt, inputs)` 或被外部调用的方法 | AI 加 | 能演化 |

### 2.5 代码格式（JS Class）

一个节点就是一个 Class。**注释（L1）和实现（L2）都在 code 里**：

```js
class population {
  /**
   * 城市常住人口，受出生、死亡、移民影响
   */
  current = 350
  birthRate = 0.02

  static inputs = [
    { id: 'immigration', label: '移民配额' },
    { id: 'death_rate', label: '死亡率' }
  ]

  /**
   * 人口越多，住房需求越大，比例约 0.3
   */
  static outputs = [
    { id: 'housing_demand', label: '住房需求', target: 'housing', target_port: 'demand' }
  ]
  housing_demand(inputs) {
    return this.current * 0.3
  }

  /**
   * 人口随时间演化（Level 3）
   */
  tick(dt, inputs) {
    this.current += this.current * this.birthRate * dt
  }
}
```

**注释约定**：
- **JSDoc `/** ... */`**：用于 Class 字段和方法上方的描述（L1 载体）
- 简单 `//`：可用于行内说明（不强制）
- 解析器（`parseClassCode`）提取 JSDoc 作为 description

**L1 状态（只有注释没有实现）**：

```js
class population {
  /**
   * 城市常住人口，受出生、死亡、移民影响
   */
  current = 350
  birthRate = 0.02

  /**
   * 人口越多，住房需求越大，比例约 0.3
   * （AI 还没填实现）
   */
  static outputs = [
    { id: 'housing_demand', target: 'housing', target_port: 'demand' }
  ]
  housing_demand(inputs) {
    // TODO: AI 待填
    return null
  }
}
```

**同构映射**：
- Class 名 → 节点 id
- Class 字段上方的 JSDoc → 节点的 L1 描述
- `static inputs` → 输入端口（视觉用）
- `static outputs` → 输出端口 + 边的拓扑（`target` / `target_port`）
- 实例属性 → 节点状态（properties）
- output id 同名方法 + 上方 JSDoc → 边的 L1（注释）+ L2（方法体）
- `tick(dt, inputs)` → Level 3 时间演化
- 其他方法（如 `helper_xxx()`）→ 被外部调用的能力（Level 3 扩展）

### 2.6 向后兼容

旧格式（v0.2-v0.5）的 JSON 在导入时迁移：

| 旧字段 | 迁移到 |
|--------|--------|
| `node.description` | code 里对应字段的 JSDoc 注释 |
| `node.inputs` / `outputs` | code 的 `static inputs/outputs` |
| `node.properties` | code 的实例属性 |
| `node.x, y` | 丢弃（视图信息） |
| `node.visual` | 丢弃（视图信息） |
| `edges` 数组 | 反向写回各 source 节点的 `static outputs`（target/target_port） |
| `edge.description` | source 节点对应方法的 JSDoc 注释 |

迁移在 `importJSON` 一次性完成，迁移后内部模型是 v0.6 形态。

### 2.7 单向 AI 转换器

UI 改动和 AI 转换都修改 code，但**方向不同**，不再"双向同步"：

**UI 改 L1 注释（局部修改）**：
- 人通过 UI 编辑"描述" → 调用 `updateComment(code, fieldName, newComment)` 局部修改 code 里对应字段的 JSDoc
- **不重写整个 code**——保留 AI 已写的所有方法体
- 触发 stale 标记：注释改了，对应方法体可能需要 AI 重转

**AI 转 L2 实现（在注释下填）**：
- AI 读 URL 里的 code（含注释） → 识别空/stale 方法 → 在注释下填方法体
- 输出新 URL（含更新后的 code）
- 保留人写的注释不动

**关键函数**（src/io.js）：
- `parseClassCode(code)` —— 解析 code 为结构化字段（含提取 JSDoc 注释）
- `updateCommentInCode(code, target, newComment)` —— 局部改注释（v0.6 新增）
- `nodeToCode(node)` —— 仍保留，用于完全重写场景（如 debug 模式）

**与 v0.5 双向同步的对比**：

| 项 | v0.5（双向同步） | v0.6（单向） |
|----|----------------|------------|
| UI 改字段 | → 全量重写 code | → 局部改注释 |
| AI 改 code | → 全量重 parse | → 在原 code 上局部填实现 |
| 数据丢失风险 | 高（重写易丢超出部分） | 低（局部修改） |
| 同步开销 | 每次 UI 改动跑 nodeToCode | 只在改注释时跑 updateComment |

数据层（结构化字段）和代码层（JS Class）通过两个函数互转。这是 v0.5 的核心机制——让 UI 数据驱动和 AI 代码编辑能共存。

**`nodeToCode(node)`** —— 数据 → 代码

将节点的 `inputs` / `outputs`（含 target/target_port） / `properties` / `code`（含方法体、tick）序列化为完整 JS Class 字符串。AI 拿到的代码必须是完整的、可重新 parse 回原始结构。

**`codeToNode(code)`** —— 代码 → 数据

解析 JS Class 字符串为结构化字段。已有：`src/io.js` 的 `parseClassCode`（行 117-123），需扩展处理 `static outputs` 的 target 字段、边函数体和 `tick` 方法。

**关键约束：**

1. **round-trip 一致**：nodeToCode → codeToNode 应还原原节点的结构化部分（inputs/outputs/properties）
2. **代码可含"超出数据"的部分**：tick 方法、复杂方法体、helpers——这些 UI 看不到，UI 改动也不破坏它们
3. **数据驱动 UI 是默认**：UI 改 → 数据更新 → 代码同步（保留代码里的"超出部分"不被覆盖）
4. **AI 改代码 → 数据更新**：AI 改 `node.code`（通过 URL hash 导入）→ 自动 codeToNode → 更新结构化字段（不丢失 code 字段本身的"超出部分"）

实现位置：`src/io.js`，函数 `nodeToCode` 和扩展后的 `parseClassCode`。

---

## 三、交互设计

### 3.1 两种协作模式

**人模式（默认，写 L1 注释）**：通过 UI 写"需求"，背后是改 code 注释。
- 创建节点、连线、写描述——通过 UI 操作
- 改动只影响 code 的注释部分，**不重写实现**
- 大多数情况，人不需要看 code——UI 是日常的面

**AI 模式（读注释，填实现）**：通过 fetch `/llms.txt` 自发现工具。
- AI 读 URL 里的 code（含注释），识别空/stale 方法
- 在注释下填实现方法体
- AI 可以做 UI 做不到的：复杂方法体、tick 迭代、helpers、外部调用方法
- AI 输出新 URL（含更新后的 code）给用户
- 浏览器端不调 LLM API——CORS 不是问题

**同步模式**：对话式同步（"URL 即 commit"）。
- 用户复制新 URL 回对话 → AI fetch + 解码 → 看到最新 code → 继续改
- 不是 WebSocket 实时同步，是 Git 式的版本协作
- 简单、零状态、纯静态部署可行

### 3.2 人在 UI 上的主要操作

| 操作 | 方式 | 影响 code |
|------|------|---------|
| 创建节点 | 双击画布 | 生成空 Class 框架（含字段 stub） |
| 连接节点 | 从端口拉线到另一个端口 | 在 source 的 `static outputs` 加 target 声明 |
| 描述节点/字段 | 点击节点，填写描述 | 改 code 里对应字段的 JSDoc |
| 描述关系 | 点击边，输入描述 | 改 source 对应方法的 JSDoc |
| 编辑属性 | 点击节点，改属性值 | 改 code 实例属性 |
| 查看详情 | 悬停或点击 | 弹出详情（从 code 解析展示） |

### 3.3 AI 的操作（读 code，填实现）

| 操作 | 方式 | 说明 |
|------|------|------|
| 读取当前 graph | fetch URL → 解码 hash → parse | 用户复制 URL 回对话时 |
| 识别空/stale 方法 | parseClassCode 后检查方法体 | 找需要填的 L2 |
| 填实现 | 在注释下生成方法体 | 不动人写的注释 |
| 输出新 URL | 重新序列化 code → URL hash | 多轮对话中持续修改 |
| 执行（Level 2） | 生成含方法体的 JS Class | 浏览器端 compileClass + propagate |

### 3.4 分层体验

**Level 1：注释 only（人主操作）**
- 拖拽、连线、写注释
- code 形态：`static outputs` 声明 + 方法上方 JSDoc + 空方法体（`return null`）
- 目标：人看明白系统结构
- 图就是思考工具

**Level 2：注释 + 实现（AI 介入）**
- AI 读注释，在下面填方法体
- code 形态：完整 JS Class
- 用户改一个值，沿关系推送影响
- AI 保证 code 能跑

**Level 3：注释 + 实现 + 外部调用方法（AI 介入）**
- AI 加 `tick(dt, inputs)` 或被外部调用的方法
- code 形态：完整 Class + 迭代/外部方法
- 多个 tick 演化，或被事件触发执行
- 时序图展示结果

---

## 四、技术选型

```
形态:    单页 Web 应用，作为 AI 的 Web Skill
渲染:    Canvas / SVG
UI:      vanilla JS（无框架依赖）
存储:    JS Class（唯一存储，含 L1 注释 + L2 实现）
         JSON（序列化，只存节点 code + metadata）
         URL hash（传输，UTF-8 safe base64）
         localStorage（本地持久化，模型 + 视图状态分离）
AI:      AI 通过 fetch /llms.txt 自发现
         AI 读 code 注释 → 填实现 → 输出新 URL
         浏览器端不调 LLM API，CORS 不再是阻塞
分享:    URL 编码（只含节点 code，不含位置）
部署:    静态托管，GitHub Pages 零成本
         无需后端服务器、无需 MCP server、无需客户端预装
```

---

## 四.x LLM 集成与 Web as Skill 模式

### v0.5 核心转变：CORS 不再是阻塞（v0.6 沿用）

spec v0.4 把 LLM CORS 当墙，方案一手动搬运。**Web as Skill 模式下这个限制不再阻塞**——AI 在客户端 fetch llms.txt + 读 code + 填实现 + 输出 URL，浏览器端不调 LLM API。

### v0.6 核心任务：AI 读注释 → 填实现

AI 收到 URL 后，核心任务是 **从 L1 注释转 L2 实现**：

1. fetch URL → 解码 hash → 拿到 JSON（只含节点 code）
2. parseClassCode 提取每个节点的结构 + 注释
3. 识别空/stale 方法（有注释但方法体为空/`return null`/与注释不符）
4. **读方法上方的 JSDoc 注释**，理解关系语义
5. **在注释下生成方法体**，保留人写的注释
6. 重新序列化 code → 输出新 URL

### Web as Skill 工作流

```
1. 用户和 AI 聊："Frostpunk 2 经济系统是怎样的？"

2. AI 知道有这个工具（系统提示/搜索/用户告知）

3. AI 主动 fetch https://your-site.github.io/llms.txt
   拿到说明书：
   - 这是什么：系统关系可视化工具
   - 数据格式：spec v0.6（节点 code，含注释）
   - URL 编码：JSON → UTF-8 safe base64 → hash
   - 你的核心任务：读 code 注释 → 填实现

4. AI 在自己上下文里生成 graph：
   - 写 Class 字段（带 JSDoc 注释）
   - 写 static outputs 声明拓扑
   - 填方法体（或留 stub 让用户后续填）

5. 编码到 URL hash，输出最终链接

6. 用户点开 → 静态站加载 → 解码 → 渲染

7. 用户在 UI 上改注释（描述），不动实现

8. 用户复制新 URL 回对话 → AI 解码 → 看到注释变了 → 重新填实现
```

### 与传统 Skill 的对比

| 维度 | 传统 Skill（MCP / Claude Code Skills） | Web as Skill |
|------|---------------------------------------|--------------|
| 存储位置 | 客户端本地配置 | 互联网上的 URL |
| 发现方式 | 用户预先安装 | AI 自己 fetch |
| 调用方式 | 协议化（MCP/stdio） | HTTP fetch + URL 生成 |
| 用户配置 | 必须装 | 零配置 |
| 兼容 AI | 限支持该协议的 | 任何能 WebFetch 的 |
| 部署 | 用户端 | 服务端（静态即可） |

### 现实瓶颈：生态，不是技术

llms.txt 解决"AI 怎么用"，但不解决"AI 怎么知道"。需要：
- 系统提示推荐（Anthropic / OpenAI 把它列进推荐工具）
- 用户主动告诉 AI
- AI 搜索发现

这一步是生态问题，不是技术问题。早期靠用户告诉 AI，后期靠生态。

### 补充方案（仍可用，但非核心）

- **手动搬运**：导出 JSON → 粘贴给 AI → 粘回代码（src/ai.js 的 exportAIPrompt + importFromCode）
- **本地代理**：src/ai.js 的 callAI（默认 localhost:3847）

但不再是核心路径。

---

## 五、第一版范围

**核心工作（按 v0.6 方向）**：

1. **L1 注释解析与编辑**：`parseClassCode` 提取 JSDoc 注释；UI 编辑"描述"局部改 code 注释（不重写）
2. **单向 AI 转换器**：AI 读 code → 识别空/stale 方法 → 在注释下填实现 → 输出新 URL
3. **模型/视图分离**：JSON 移除 `x, y`、`visual`；位置信息只在 localStorage 视图层
4. **Class化迁移**：edges 不作为独立数据结构；运行时由 `static outputs` 派生
5. **`/llms.txt` 更新**：告诉 AI 核心任务是读注释 → 填实现
6. **auto-layout on import**：位置移除后需要智能布局算法

**不做的**：
- 代码面板（人看/改 code）—— 藏到 debug 模式或移除
- UI ↔ code 双向同步 —— 改为单向（UI 改注释、AI 填实现）
- 工具内 AI 入口（"AI 补全"菜单）—— 方向反了
- 实时双向同步（WebSocket / MCP）—— 用对话式同步替代
- 多 AI 客户端适配（先支持能 WebFetch 的：Claude / ChatGPT / Cursor）
- 后端服务、注册登录、预设领域模型

---

## 六、边界

### 做
- 人通过 UI 写 L1 注释 / AI 读注释填 L2 实现 / code 是 AI 内部产物
- 静态部署、零安装、零服务器
- 对话式同步（URL 即 commit）
- 单页离线可运行
- 轻量、即用即走
- 模型/视图分离（JSON 不含位置）

### 不做
- 代码面板（人直接看/改 code）—— debug 模式除外
- UI ↔ code 双向同步（单向：UI 改注释、AI 填实现）
- 工具内 AI 入口（"AI 补全"菜单方向反了）
- 实时双向同步（WebSocket / MCP）
- 后端服务（API 代理、数据库、认证等）
- 注册 / 登录
- 预设领域模型
- 强制用户写代码
