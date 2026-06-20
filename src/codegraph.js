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
}

// 把当前 runtimeInstances 序列化回 sourceCode 字符串
// v0.9：class 段 3 个实例级 class field（description / name / attrs，name 空时省略）；
//       启动段：add 调用 + attrs override + edges 数组赋值
export function serializeCode(_state) {
  const state = _state
  const classLines = []

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
    const attrsEntries = Object.entries(cls.attrs || {}).filter(([k]) => !k.startsWith('__') && k !== 'edges')
    const attrsLiteral = attrsEntries.length
      ? '{\n' + attrsEntries.map(([k, v]) => '    ' + (isValidIdentifier(k) ? k : quoteKey(k)) + ': ' + formatValue(v)).join(',\n') + '\n  }'
      : '{}'
    classLines.push('  attrs = ' + attrsLiteral)
    classLines.push('}')
  }

  const bootLines = []

  // 1. GraphStarter.add 调用（按 runtimeInstances 顺序）
  for (const inst of state.runtimeInstances) {
    bootLines.push('const ' + inst.varName + ' = GraphStarter.add(' + inst.className + ')')
  }

  // 2. attrs override（非 edges、非默认值）+ edges 数组赋值
  for (const inst of state.runtimeInstances) {
    const cls = state.classes[inst.className]
    const clsAttrs = (cls && cls.attrs) || {}

    for (const key of Object.keys(inst.attrs)) {
      if (key.startsWith('__')) continue
      if (key === 'edges') continue   // edges 单独处理（下方）
      const curVal = inst.attrs[key]
      const defaultVal = clsAttrs[key]
      if (!_equal(defaultVal, curVal)) {
        const keyExpr = isValidIdentifier(key) ? '.' + key : '[' + quoteKey(key) + ']'
        bootLines.push(inst.varName + keyExpr + ' = ' + formatValue(curVal))
      }
    }

    // edges 数组：每条 { target, description }，target 序列化为目标 varName
    const edges = inst.attrs.edges
    if (Array.isArray(edges) && edges.length > 0) {
      const items = edges.map(e => {
        const tgtVar = (e && e.target && typeof e.target === 'object' && e.target.__instId)
          ? e.target.__instId.varName
          : 'null'
        const desc = (e && e.description != null) ? e.description : ''
        return '    { target: ' + tgtVar + ', description: ' + formatValue(desc) + ' }'
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
// 用 JSON.stringify 比对象有两个边界要注意:
//   - 键序敏感:`{a:1,b:2}` ≠ `{b:2,a:1}`(实际场景里同一赋值路径不会乱序,但不保证)
//   - `undefined` 会被 JSON 丢弃:`{a:undefined}` 序列化成 `{}`,跟 `{}` 相等
// 实际场景下基本准,但加新属性类型(如 Symbol / 函数)时要想到这里的近似性。
export function _equal(a, b) {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

function isValidIdentifier(str) {
  return /^[$_\p{L}][$_\p{L}\d]*$/u.test(str)
}

function quoteKey(k) {
  return "'" + k.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

export function formatValue(v) {
  if (typeof v === 'string') {
    const escaped = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
    return "'" + escaped + "'"
  }
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
