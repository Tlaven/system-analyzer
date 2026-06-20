# ADR-001: 边模型从 class 级迁到实例级

## 状态

accepted

## 背景

v0.8 的边通过 `class.edges = [{ name, description }]` 静态字面量声明 + attrs 里的 null 引用槽实现。问题:

1. **多对一 / 多对多 / 同目标多边表达困难** — `class.edges` 是 class 共享的,所有同 class 实例共用一份边声明。无法表达"Processor_1 连 Database,Processor_2 连 Queue,Processor_3 也连 Database(同目标多边)"这种实例级差异。
2. **attrs 里的 null 槽是"占位待填"的隐式契约** — scanner 要特殊处理这些 null,实例化时填入实际引用。容易踩坑:漏填、错填、scanner 漏扫。
3. **"边"和"属性"概念混淆** — attrs 既有数据属性(`speed: 100`)又有 edges 占位(`{ target: null, ... }`),两种语义混在同一字典。
4. **bootstrap 写起来别扭** — `class.edges` 里写的 `name` 是 target 的 className,要靠运行时反查实例;实例化的 null 槽靠运行时填,声明的"边"和实例化的"边"两层概念。

需要一次模型层面的清理。

## 考虑过的方案

### 方案 A: 保持 class.edges,加 instance.edges override(被拒)

- 优点:向后兼容 v0.8 数据
- 缺点:两套机制并存,scanner 必须处理两层覆盖(class 默认 + 实例 override),概念复杂度爆炸
- **拒绝理由**:违反"统一模型优先"哲学(见 `CLAUDE.md` [为什么] 段)。两套机制并存必然有边界情况——"实例 override 是替换还是合并?class 加新边后实例 override 怎么变化?"——每个边界都要单独定义语义,维护成本高。

### 方案 B: 引入独立的 Edge 类(被拒)

- 优点:类型清晰,OO 风格,可以带 id/metadata/port 等附加字段
- 缺点:用户写启动代码时要 `new Edge(src, tgt)`,对 DSL 不友好;GraphStarter.add 要返回能装 Edge 的容器,破坏"返回 attrs 代理"的简洁
- **拒绝理由**:破坏 v0.9 "声明式 sourceCode"的体感。显式构造器是噪音——用户脑子里想的是"Processor 连 Database",而不是"new Edge(Processor, Database)"。Edge 类的附加字段(id/metadata/port)在 v0.9 都用不上——边 id 由 `<srcVar>><tgtVar>>idx` 派生,无需显式声明。

### 方案 C: 边作为实例级 attrs.edges 数组(采纳)

- 优点:概念归一(边就是 attrs 里的一个数组字段,和 `speed: 100` 同一层级),天然支持任意多条;`X.edges = [{ target: Y, ... }]` 是原生 JS 赋值,无需额外抽象
- 缺点:scanner 要从 attrs 里过滤掉 `edges` 键,不当作数据属性(已有先例——`name` / `description` 也是这样过滤)
- 适合场景:声明式 sourceCode + 实例级 mutable model

## 选择

选方案 C。

理由:

1. **概念统一** — 边和属性都是实例 attrs 的字段,只是语义不同。一个实例的"所有边"就是 `inst.attrs.edges`,和 `inst.attrs.speed` 同级。
2. **多边天然支持** — 数组结构,任意条数,任意目标,任意重复。
3. **`GraphStarter.add()` 返回 attrs 代理** — `X.edges = [{ target: Y, ... }]` 是原生 JS 赋值,直接生效在 `X.attrs.edges` 上,无需 proxy 拦截、无需 Edge 类。
4. **`target` 直接是另一 inst.attrs** — 不再需要 className 反查、不再需要 null 槽填充。bootstrap 里 `Database_1` 本身就是 attrs 对象,存到 `attrs.edges[i].target` 即可。

**取舍:** 为了概念统一,放弃了对旧 v0.8 数据的兼容(`sa_data.version !== 6` 直接丢弃)。这是值得的——v0.5→v0.8 的演进里已经积累太多技术债,v0.9 是清理时机。

## 后果

### 正面后果

- **多边表达自然** — 任意 source-target-idx 组合都支持。多对一、多对多、同目标多边、自环(理论支持,UI 不暴露)都无需特殊代码。
- **scanner 简化** — 只扫 `new cls()` 实例上的 3 个 class field(description / name / attrs)。不再扫 static / constructor / class.edges。
- **边 id 天然区分同对多边** — `<srcVar>><tgtVar>>idx`,idx 是 attrs.edges 数组里的位置。`selEdge` 用 id 字符串而非对象引用,活过 `runSource` 重建。
- **bootstrap 直观** — `Processor_1.edges = [{ target: Database_1, description: '主数据流' }]` 一行就建立边,跟读 JSON 一样。
- **方法体内访问下游天然** — `this.edges[i].target.input = ...` 无需 proxy,直接命中目标 attrs。

### 负面后果

- **v0.8 及之前的项目数据无法迁移** — `load()` 检测 `version !== 6` 直接丢弃并清空 `sa_data`。历史分享链接全部失效。
- **文档/CLAUDE.md 大改** — 从 class 模型迁到实例模型,涉及 scanner / serializeCode / panel / 渲染 / drag-edge 全链路重写。
- **class 级边声明不再支持** — 想让所有 Processor 实例都连同一目标,必须在 bootstrap 里逐个写,或在 Code 模式用 `for` 循环。

### 需要跟进的

- ✅ `docs/archive/node-interaction-redesign-v0.8.md` 已归档,标注 v0.9 取代
- ✅ ADR 本条已写(就是本文件)
- 后续若用户反馈"想批量给同 class 实例加同一条边",可在 Code 模式用 `for` 循环表达,无需再改模型

## 关联

- 上游:本决策符合 `CLAUDE.md` [为什么] §1 "统一模型优先" 哲学
- 下游:scanner 简化 / serializeCode 重写 / 边 id 方案 / drag-edge 交互(v0.9 选中后显示拖柄)
- 替代:v0.8 `class.edges` + null 槽(`docs/archive/node-interaction-redesign-v0.8.md` 第 3、4、5、8、9 节)
