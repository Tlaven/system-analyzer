// v0.9 核心引擎：sourceCode ↔ runtimeInstances 双向转换
//
// 模型变更（vs v0.8）：
//   - 3 个实例级 class field：description / name / attrs（无 static 前缀）
//   - 删除 class.edges：边不在 class 声明，改为实例级 attrs.edges 数组
//   - 每条边：{ target, description }，target 是另一 inst.attrs，description 按需追加
//   - 一个实例可以有多个 edges（多对一、多对多都支持）
//   - state.classes 字段：description / name / attrs / methods / hasTick / cls
//
// 数据流：
//   sourceCode --runSource--> runtimeInstances + classes
//   runtimeInstances --serializeCode--> sourceCode（仅 UI 模式调）
//   resetRuntime = runSource(state.sourceCode)

import { splitSource } from './parser.js'
import { scanClass } from './scanner.js'
import { getInstanceAttrKeys } from './attrkeys.js'
import { invalidateProbes } from './probe.js'
import { captureAuthorAttrs, authorAttrsOf } from './author.js'

// ============ 派生边视图 + lazy 缓存 ============
//
// v0.13: 从 io.js 迁入。原 io.js 14 处调用每次重算 O(n+m),且与 utils/engine/physics/renderer
// 形成循环依赖。现改为 lazy + dirty flag:读时若 dirty 则重算并清 flag,runSource / 边变更
// 入口调 invalidateEdges() 设 dirty=true。state 参数化(与 runSource 一致),保持 codegraph
// 的 Node-runnable pure 边界(不 import state 单例)。
//
// 失效点(必须覆盖任何改动 runtimeInstances 或 attrs.edges 的入口):
//   - runSource(本文件,自动覆盖 createNode / copyInstance / pasteInstance / load / import)
//   - editor.delInstance / panel.{setEdgeTarget,setEdgeDescription,delCurrentEdge,addInstanceEdge,removeInstanceEdge}
//   - input.createEdgeFromDrag
let _edgesCache = null
let _edgesDirty = true
let _nodeIdxCache = null

export function invalidateEdges() {
  _edgesDirty = true
  _nodeIdxCache = null
  invalidateProbes()  // 结构变更 = 探测边(引用派生)的一部分失效源,一并清(略过度失效,代价为一次 lazy 重算)
}

// varName -> inst 查找索引,与 deriveEdges 共用失效点(实例集合只在 runSource/删改时变)
// 替代热路径上反复的 state.nodes.find(n => n.id === x)(O(边x节点) -> O(1))
export function nodeIndex(state) {
  if (!_nodeIdxCache) {
    _nodeIdxCache = new Map()
    for (const inst of state.runtimeInstances) _nodeIdxCache.set(inst.varName, inst)
  }
  return _nodeIdxCache
}

export function deriveEdges(state) {
  if (!_edgesDirty && _edgesCache) return _edgesCache

  const edges = []
  const insts = state.runtimeInstances
  const attrsToInst = new Map()
  for (const inst of insts) {
    attrsToInst.set(inst.attrs, inst)
  }
  for (const inst of insts) {
    const arr = inst.attrs.edges
    if (!Array.isArray(arr)) continue
    arr.forEach((e, idx) => {
      if (!e || typeof e !== 'object') return
      const refVal = e.target
      if (!refVal || typeof refVal !== 'object') return
      const targetInst = attrsToInst.get(refVal)
      if (!targetInst) return
      edges.push({
        id: inst.varName + '>' + targetInst.varName + '>' + idx,
        source_instance: inst.varName,
        source_node: inst.varName,
        source_ref: '',
        source_port: '',
        target_instance: targetInst.varName,
        target_node: targetInst.varName,
        target_attr: '',
        target_port: '',
        label: '',
        relation: '',
        description: e.description != null ? String(e.description) : '',
        transform: typeof e.transform === 'string' ? e.transform : '',
        weight: 1,
        metadata: {},
      })
    })
  }
  _edgesCache = edges
  _edgesDirty = false
  return edges
}

// 创建 GraphStarter bridge。add(cls, explicitName) 内部自动生成 varName `<ClassName>_<n>`，
// 或使用 explicitName。
//
// 关键 trick:add() 返回 **attrs 对象本身**(不是包装器,不是 RuntimeInstance)。这让
// `Source_1.edges = [{ target: Database_1, ... }]` 这种原生 JS 赋值直接 mutate `attrs.edges`。
// 方法体里 `this.edges[i].target.input = ...` 也是直接命中目标 attrs,无需 proxy。
//
// attrs 上挂的 `__instId` 必须满足三个条件,改一处都会炸:
//   1. **不可枚举** — JSON.stringify(attrs) 不会带上它,否则 serializeCode 会循环引用爆栈
//   2. **writable + configurable** — runSource 重建时要能重新定义
//   3. **挂在 attrs 上而非 inst 上** — `target` 引用存的是 attrs,反查 `__instId.varName`
//      才能拿到目标实例身份(deriveEdges / serializeCode 都靠这个反查)
function makeBridge() {
  const instances = []
  const counters = {}

  return {
    _instances: instances,

    add(cls, explicitName) {
      if (typeof cls !== 'function') {
        throw new Error('GraphStarter.add 需要 class 构造器，得到: ' + typeof cls)
      }
      const fresh = new cls()
      const rawAttrs = (fresh.attrs && typeof fresh.attrs === 'object' && !Array.isArray(fresh.attrs))
        ? fresh.attrs
        : {}
      // 过滤 edges 键（class 定义里若误写了 edges，实例化时丢弃；edges 由启动段动态追加）
      const attrsInit = {}
      for (const k of Object.keys(rawAttrs)) {
        if (k === 'edges') continue
        attrsInit[k] = rawAttrs[k]
      }
      const attrs = JSON.parse(JSON.stringify(attrsInit))
      let varName
      if (explicitName && typeof explicitName === 'string') {
        // explicitName 会成为序列化的 `const <name> = ...` 绑定名,必须是合法标识符。
        // 不校验的话 'a b' / 'a-b' 这类名字能跑,但一序列化就产出语法错误的 sourceCode(断链)。
        if (!isValidIdentifier(explicitName)) {
          throw new Error(
            'GraphStarter.add 的 explicitName 必须是合法标识符(序列化要生成 const 绑定),收到: ' + JSON.stringify(explicitName)
          )
        }
        varName = explicitName
      } else {
        counters[cls.name] = (counters[cls.name] || 0) + 1
        varName = cls.name + '_' + counters[cls.name]
      }
      const inst = {
        varName,
        className: cls.name,
        attrs,
        _topoError: null,
        _execError: null,
      }
      Object.defineProperty(attrs, '__instId', {
        value: inst,
        enumerable: false,
        writable: true,
        configurable: true,
      })
      instances.push(inst)
      return attrs
    },
  }
}

// 执行 sourceCode，得到 runtimeInstances + classes
export function runSource(sourceCode, state) {
  state.runtimeInstances.length = 0
  state.classes = {}
  // 演化层清空(ADR-005):重跑源码 = 新一局,旧 trace/时钟不跨局。
  // runtimeGen 供连播守卫用(换图即停,见 input.js startPlay)。
  state.traces = {}
  state.tickCount = 0
  state.runtimeGen = (state.runtimeGen || 0) + 1

  const { classes, bootstrap } = splitSource(sourceCode)

  // eval 每个 class source，scanClass 填 state.classes
  for (const c of classes) {
    let cls
    try {
      cls = new Function('return (' + c.source + ')')()
    } catch (e) {
      const lines = c.source.split('\n')
      const errMsg = e.message
      let hint = ''
      let pos = -1
      const posMatch = errMsg.match(/(?:position|at.*?line)\s*(\d+)/i)
      if (posMatch) {
        pos = parseInt(posMatch[1], 10)
      } else {
        const anonMatch = errMsg.match(/<anonymous>:(\d+):\d+/)
        if (anonMatch) pos = parseInt(anonMatch[1], 10)
      }
      if (pos > 0 && pos <= lines.length) {
        hint = '\n  第 ' + pos + ' 行: ' + lines[pos - 1]?.trim()
      } else {
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim()
          if (trimmed.includes('/') && trimmed.includes(':') && !trimmed.startsWith('//')) {
            hint = '\n  第 ' + (i + 1) + ' 行: ' + trimmed
            break
          }
        }
      }
      throw new Error(`class ${c.name} 解析失败: ${errMsg}` + hint)
    }
    const scan = scanClass(cls, c.source)
    state.classes[c.name] = {
      id: c.name,
      cls,
      label: c.name,
      description: scan.description,
      name: scan.name,
      attrs: scan.attrs,
      methods: scan.methods,
      hasTick: scan.hasTick,
    }
  }

  // 构造 bridge，执行整段 sourceCode（class + bootstrap 都在函数作用域）
  // varName 由 add() 内部生成，不再正则扫字面 const
  const bridge = makeBridge()
  try {
    const fn = new Function('GraphStarter', "'use strict';\n" + sourceCode)
    fn(bridge)
  } catch (e) {
    throw new Error(`sourceCode 执行失败: ${e.message}`)
  }

  state.runtimeInstances.push(...bridge._instances)
  invalidateEdges()
  // 作者态快照(ADR-007):serializeCode 的序列化源。此后 live attrs 的演化
  // (方法体/transform/stepAll)不影响序列化;UI 编辑经 author.js 写穿。
  captureAuthorAttrs(state)
}

// 把当前 runtimeInstances 序列化回 sourceCode 字符串
// v0.9：class 段 3 个实例级 class field（description / name / attrs，name 空时省略）；
//       启动段：add 调用 + attrs override + edges 数组赋值
export function serializeCode(_state) {
  const state = _state
  const classLines = []
  // 活实例集合:悬空引用(实例已删)序列化降级 null,写 varName 会 ReferenceError
  const liveAttrs = new Set(state.runtimeInstances.map(i => i.attrs))

  // class 段：从 state.classes 反向构建
  for (const clsName of Object.keys(state.classes)) {
    const cls = state.classes[clsName]
    classLines.push('class ' + clsName + ' {')
    classLines.push('  description = ' + formatValue(cls.description || ''))
    // name 空时省略（让画布走 className 回退）
    if (cls.name) {
      classLines.push('  name = ' + formatValue(cls.name))
    }
    // 跳过 `__` 前缀键(内部字段约定,如 __instId)+ edges(实例级,在启动段输出)。
    // 新增内部字段时,统一用 `__xxx` 前缀,serializeCode 会自动忽略。
    const attrsEntries = getInstanceAttrKeys(cls).map(k => [k, (cls.attrs || {})[k]])
    const attrsLiteral = attrsEntries.length
      ? '{\n' + attrsEntries.map(([k, v]) => '    ' + (isValidIdentifier(k) ? k : quoteKey(k)) + ': ' + formatValue(v, liveAttrs)).join(',\n') + '\n  }'
      : '{}'
    classLines.push('  attrs = ' + attrsLiteral)
    classLines.push('}')
  }

  const bootLines = []

  // 1. GraphStarter.add 调用（按 runtimeInstances 顺序）
  // 显式名始终输出：不依赖 makeBridge 的计数器顺序，round-trip 后 varName 恒定
  // （visualState / panelMode / clipboard 都按 varName 键，varName 漂移 = 布局颜色丢失）
  for (const inst of state.runtimeInstances) {
    bootLines.push('const ' + inst.varName + ' = GraphStarter.add(' + inst.className + ', ' + formatValue(inst.varName) + ')')
  }

  // 2. attrs override(非 edges、非默认值)+ edges 数组赋值
  // 序列化源 = authorAttrs(ADR-007 作者态快照),不是 live attrs:方法体/transform/stepAll
  // 的演化值不进代码;UI 编辑路径已写穿快照。缺失时 authorAttrsOf 回退 live(仅容错)。
  for (const inst of state.runtimeInstances) {
    const cls = state.classes[inst.className]
    const clsAttrs = (cls && cls.attrs) || {}
    const author = authorAttrsOf(state, inst)

    for (const key of getInstanceAttrKeys({ attrs: author })) {
      const curVal = author[key]
      const defaultVal = clsAttrs[key]
      // 比较"序列化形态"而非 _equal:悬空引用/环/超深会被 formatValue 降级,
      // 用降级后的字面量判断是否与默认一致,保证 serialize(run(S1)) === S1 不动点
      // (例:悬空引用降级 null 且默认也是 null → 首轮就不该输出冗余 override)。
      if (formatValue(curVal, liveAttrs) !== formatValue(defaultVal, liveAttrs)) {
        const keyExpr = isValidIdentifier(key) ? '.' + key : '[' + quoteKey(key) + ']'
        bootLines.push(inst.varName + keyExpr + ' = ' + formatValue(curVal, liveAttrs))
      }
    }

    // edges 数组：每条 { target, description, transform? }，target 序列化为目标 varName
    // 悬空 target（指向已删实例）输出 null——写 varName 会产生 ReferenceError，整图无法加载
    const edges = author.edges
    if (Array.isArray(edges) && edges.length > 0) {
      const items = edges.map(e => {
        const tgtVar = (e && e.target && typeof e.target === 'object' && e.target.__instId && liveAttrs.has(e.target))
          ? e.target.__instId.varName
          : 'null'
        const desc = (e && e.description != null) ? e.description : ''
        const fields = ['target: ' + tgtVar, 'description: ' + formatValue(desc)]
        if (e && typeof e.transform === 'string' && e.transform.length > 0) {
          fields.push('transform: ' + formatValue(e.transform))
        }
        return '    { ' + fields.join(', ') + ' }'
      })
      bootLines.push(inst.varName + '.edges = [\n' + items.join(',\n') + '\n  ]')
    }
  }

  const classSection = classLines.join('\n')
  const bootSection = bootLines.join('\n')
  if (!classSection && !bootSection) return ''
  if (!classSection) return bootSection + '\n'
  if (!bootSection) return classSection + '\n'
  return classSection + '\n\n' + bootSection + '\n'
}

// 重置运行时：重新执行 sourceCode，丢弃所有运行时 mutation
export function resetRuntime(state) {
  runSource(state.sourceCode, state)
}

// 用于检测实例 override:属性值跟 class 默认是否相等(相等就不输出 override 行)。
// 引用感知:B-L1 起属性值可能是实例引用(attrs 对象),引用只在身份相等时相等(a===b),
// 不深入引用目标——否则目标 attrs 的 edges 环会让 JSON.stringify 抛
// "Converting circular structure to JSON"(serialize / panel / renderer 三处消费者共用)。
// 普通容器深比较(键序无关);非 plain object(Date 等)仍走 JSON.stringify。
export function _equal(a, b) {
  return _deepEqual(a, b, new Map())
}

function _deepEqual(a, b, seen) {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (a.__instId || b.__instId) return false
  const pa = Object.getPrototypeOf(a)
  if (!Array.isArray(a) && pa !== Object.prototype && pa !== null) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  if (seen.has(a)) return seen.get(a) === b
  seen.set(a, b)
  let eq = true
  if (Array.isArray(a) !== Array.isArray(b)) {
    eq = false
  } else if (Array.isArray(a)) {
    if (a.length !== b.length) eq = false
    else for (let i = 0; i < a.length && eq; i++) eq = _deepEqual(a[i], b[i], seen)
  } else {
    const ka = Object.keys(a).filter(k => !k.startsWith('__'))
    const kb = Object.keys(b).filter(k => !k.startsWith('__'))
    if (ka.length !== kb.length) eq = false
    else for (const k of ka) {
      if (!(k in b) || !_deepEqual(a[k], b[k], seen)) { eq = false; break }
    }
  }
  seen.delete(a)
  return eq
}

// 序列化层：判断 class/var/attr key 是否需要加引号。Unicode 版因为 scanner(v0.10 起)
// 允许中文 class 名，序列化必须能识别。**不要**与 utils.js 的 ASCII 版混用——那个是
// UI 创建校验，CLAUDE.md 不变量要求 code identifiers 是 camelCase English，UI 层应拒中文。
function isValidIdentifier(str) {
  return /^[$$_\p{L}][$_\p{L}\d]*$/u.test(str)
}

// 单引号字符串字面量转义(字符串值/attr key 共用)。
// 行终止符(U+000A/U+000D/U+2028/U+2029)必须转义,否则产出语法错误的 sourceCode。
function _escapeSingle(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function quoteKey(k) {
  return "'" + _escapeSingle(k) + "'"
}

// 值 → JS 字面量。B-L1 起支持"实例引用保持身份":
//   - 直接引用(attrs 带 __instId)→ 输出目标 varName
//   - 嵌套容器(array/plain object)里任意深度的引用同样输出 varName
// live 传入 Set<attrs> 时,不在集合内的引用降级 null(实例已删 = 悬空引用,
// 写 varName 会 ReferenceError 整图无法加载;与 edges 悬空 target 降级口径一致)。
// 环/超深(>8)降级 null,保证序列化不炸;非 plain object(Date 等)走 JSON.stringify 旧行为。
// 不做这一步的话:panel 一编辑 → syncCodeFromRuntime → 引用被 JSON 化成副本 → 重载后探测边消失。
export function formatValue(v, live) {
  return _formatValue(v, 0, new Set(), live)
}

function _formatValue(v, depth, seen, live) {
  if (typeof v === 'string') {
    return "'" + _escapeSingle(v) + "'"
  }
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v !== 'object') return String(v)
  if (v.__instId && typeof v.__instId.varName === 'string') {
    if (live && !live.has(v)) return 'null'
    return v.__instId.varName
  }
  const proto = Object.getPrototypeOf(v)
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return JSON.stringify(v)
  if (depth >= 8 || seen.has(v)) return 'null'
  seen.add(v)
  let out
  if (Array.isArray(v)) {
    out = '[' + v.map(x => _formatValue(x, depth + 1, seen, live)).join(', ') + ']'
  } else {
    const entries = Object.keys(v)
      .filter(k => !k.startsWith('__'))
      .map(k => (isValidIdentifier(k) ? k : quoteKey(k)) + ': ' + _formatValue(v[k], depth + 1, seen, live))
    out = entries.length ? '{ ' + entries.join(', ') + ' }' : '{}'
  }
  seen.delete(v)
  return out
}
