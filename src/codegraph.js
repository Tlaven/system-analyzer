// v0.6 核心引擎：sourceCode ↔ runtimeInstances 双向转换
//
// 数据流：
//   sourceCode --runSource--> runtimeInstances + classes
//   runtimeInstances --serializeCode--> sourceCode
//   resetRuntime = runSource(state.sourceCode)

import { splitSource } from './parser.js'
import { scanClass } from './scanner.js'

const VAR_DECL_RE = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*GraphStarter\.add\s*\(/g

// 创建 GraphStarter bridge。add() 返回 attrs（含不可枚举 __instId 反查），
// 这样 bootstrap 里 `p1.next_stage = d1` 原生赋值在 attrs 层生效，
// 方法体 `this.X.Y = ...` 无需 proxy 直接命中目标 attrs。
function makeBridge() {
  const instances = []
  const describes = []

  return {
    _instances: instances,
    _describes: describes,

    add(cls) {
      if (typeof cls !== 'function') {
        throw new Error('GraphStarter.add 需要 class 构造器，得到: ' + typeof cls)
      }
      const fresh = new cls()
      const attrs = {}
      for (const k of Object.keys(fresh)) {
        if (k.startsWith('_')) continue
        const v = fresh[k]
        attrs[k] = (v !== null && typeof v === 'object')
          ? JSON.parse(JSON.stringify(v))
          : v
      }
      const inst = {
        varName: null,
        className: cls.name,
        attrs,
        edgeMeta: {},
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

    describe(srcAttrs, refName, text, opts = {}) {
      if (!srcAttrs || typeof srcAttrs !== 'object') return
      const inst = srcAttrs.__instId
      if (!inst) return
      inst.edgeMeta[refName] = { description: text, ...opts }
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
      throw new Error(`class ${c.name} 解析失败: ${e.message}`)
    }
    const scan = scanClass(cls)
    state.classes[c.name] = {
      id: c.name,
      cls,
      label: c.name,
      description: cls.description || '',
      properties: scan.properties,
      references: scan.references,
      emitters: scan.emitters,
      methods: scan.methods,
      hasTick: scan.hasTick,
      defaults: scan.defaults,
    }
  }

  // 静态扫 bootstrap 拿 varName 顺序（与 add() push 顺序一致）
  const varNames = []
  VAR_DECL_RE.lastIndex = 0
  let m
  while ((m = VAR_DECL_RE.exec(bootstrap))) {
    varNames.push(m[1])
  }

  // 构造 bridge，执行整段 sourceCode（class + bootstrap 都在函数作用域）
  const bridge = makeBridge()
  try {
    const fn = new Function('GraphStarter', "'use strict';\n" + sourceCode)
    fn(bridge)
  } catch (e) {
    throw new Error(`sourceCode 执行失败: ${e.message}`)
  }

  // varName 对应到 instances
  if (varNames.length !== bridge._instances.length) {
    throw new Error(
      `varName 数 (${varNames.length}) 与 GraphStarter.add 调用数 (${bridge._instances.length}) 不匹配。` +
      `每个 GraphStarter.add() 必须以 const <varName> = ... 形式调用。`
    )
  }
  for (let i = 0; i < bridge._instances.length; i++) {
    bridge._instances[i].varName = varNames[i]
  }

  state.runtimeInstances.push(...bridge._instances)
}

// 把当前 runtimeInstances 序列化回 sourceCode 字符串
// class 段原样保留（从 state.sourceCode 切出），启动代码段机器生成
export function serializeCode(state) {
  const { classes } = splitSource(state.sourceCode)
  const classSection = classes.map(c => c.source).join('\n\n')

  const lines = []

  // 1. GraphStarter.add 调用（按 runtimeInstances 顺序）
  for (const inst of state.runtimeInstances) {
    lines.push(`const ${inst.varName} = GraphStarter.add(${inst.className})`)
  }

  // 2. override + 引用赋值
  for (const inst of state.runtimeInstances) {
    const cls = state.classes[inst.className]
    if (!cls) continue
    for (const prop of cls.properties) {
      if (cls.references.includes(prop)) {
        const target = inst.attrs[prop]
        if (target && target.__instId) {
          lines.push(`${inst.varName}.${prop} = ${target.__instId.varName}`)
        }
      } else {
        const defaultVal = cls.defaults[prop]
        const curVal = inst.attrs[prop]
        if (!_equal(defaultVal, curVal)) {
          lines.push(`${inst.varName}.${prop} = ${formatValue(curVal)}`)
        }
      }
    }
  }

  // 3. describe 调用
  for (const inst of state.runtimeInstances) {
    for (const [refName, meta] of Object.entries(inst.edgeMeta)) {
      if (!meta) continue
      const text = meta.description ?? ''
      const extras = []
      if (meta.label && meta.label !== text) extras.push(`label: ${formatValue(meta.label)}`)
      if (meta.relation) extras.push(`relation: ${formatValue(meta.relation)}`)
      if (meta.weight !== undefined && meta.weight !== 1) extras.push(`weight: ${formatValue(meta.weight)}`)
      const opts = extras.length ? ', {' + extras.join(', ') + '}' : ''
      if (text || extras.length) {
        lines.push(`GraphStarter.describe(${inst.varName}, '${refName}', ${formatValue(text)}${opts})`)
      }
    }
  }

  const bootstrapSection = lines.join('\n')
  return classSection + '\n\n' + bootstrapSection + '\n'
}

// 重置运行时：重新执行 sourceCode，丢弃所有运行时 mutation
export function resetRuntime(state) {
  runSource(state.sourceCode, state)
}

function _equal(a, b) {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

function formatValue(v) {
  if (typeof v === 'string') {
    const escaped = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
    return `'${escaped}'`
  }
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
