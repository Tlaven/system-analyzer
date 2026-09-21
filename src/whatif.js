// ADR-011 干预(what-if)假设层:会话内,不落码(不变量 36-38)
//
// 定位:锁定属性 = 实验参数;锁定编辑写 live + params,不写穿 authorAttrs
// (ADR-007 不变量 27 的显式例外)。基线 = { traces 深拷贝, values 原始值快照,
// tickCount, sourceCode };复跑 = runSource → applyHypotheses → runTransforms
// → stepAll × tickCount(不 save)。假设只在"锁定编辑"与"复跑"两条路径应用到
// live;其他 runSource 不自动应用、不清除实验(不变量 38)。
import { runSource } from './codegraph.js'
import { stepAll, runTransforms } from './engine.js'
import { authorAttrsOf } from './author.js'

const SEP = '\u0000'  // varName 不含 \0(标识符);attr 任意——取首个 \0 split 安全
export function whatIfKey(varName, attr) { return varName + SEP + attr }
function splitKey(k) {
  const i = k.indexOf(SEP)
  return [k.slice(0, i), k.slice(i + 1)]
}
function findInst(state, varName) {
  return state.runtimeInstances.find(i => i.varName === varName) || null
}
function isPrimitive(v) {
  const t = typeof v
  return t === 'number' || t === 'string' || t === 'boolean'
}

export function isLocked(state, varName, attr) {
  return !!(state.whatIf && state.whatIf.locked[whatIfKey(varName, attr)])
}

export function lockedCount(state) {
  return state.whatIf ? Object.keys(state.whatIf.locked).length : 0
}

// 锁定/解锁。解锁 = 丢弃该假设值,恢复作者值(authorAttrs 优先,回退 class 默认)。
export function toggleLock(state, varName, attr) {
  const k = whatIfKey(varName, attr)
  if (state.whatIf.locked[k]) {
    delete state.whatIf.locked[k]
    delete state.whatIf.params[k]
    restoreAuthorValue(state, varName, attr)
    return false
  }
  state.whatIf.locked[k] = true
  return true
}

// 锁定编辑:写 live + params,不写穿作者态(不变量 36)
export function setHypothesis(state, varName, attr, value) {
  const inst = findInst(state, varName)
  if (!inst) return false
  inst.attrs[attr] = value
  state.whatIf.params[whatIfKey(varName, attr)] = value
  return true
}

function restoreAuthorValue(state, varName, attr) {
  const inst = findInst(state, varName)
  if (!inst) return
  const author = authorAttrsOf(state, inst)
  if (author && Object.prototype.hasOwnProperty.call(author, attr)) {
    inst.attrs[attr] = author[attr]
    return
  }
  const cls = state.classes[inst.className]
  const clsAttrs = (cls && cls.attrs) || {}
  if (Object.prototype.hasOwnProperty.call(clsAttrs, attr)) {
    const dv = clsAttrs[attr]
    inst.attrs[attr] = (dv !== null && typeof dv === 'object') ? JSON.parse(JSON.stringify(dv)) : dv
    return
  }
  delete inst.attrs[attr]
}

// 复跑时应用假设;目标实例已不存在则跳过(容错,不自动清 params)
export function applyHypotheses(state) {
  let applied = 0, skipped = 0
  for (const k of Object.keys(state.whatIf.params)) {
    const [varName, attr] = splitKey(k)
    const inst = findInst(state, varName)
    if (!inst) { skipped++; continue }
    inst.attrs[attr] = state.whatIf.params[k]
    applied++
  }
  return { applied, skipped }
}

// 记录基线(不变量 37):traces 深拷贝 + 原始值快照 + tickCount + sourceCode
export function captureBaseline(state) {
  state.whatIf.baseline = {
    traces: deepCopyTraces(state.traces),
    values: snapshotValues(state),
    tickCount: state.tickCount,
    sourceCode: state.sourceCode,
  }
  return state.whatIf.baseline
}

// 复跑配方固定(不变量 37);UI 包装层负责 wrapAllInstances + render(不 save)
export function replay(state) {
  const b = state.whatIf.baseline
  const n = b ? b.tickCount : 0
  runSource(state.sourceCode, state)
  applyHypotheses(state)
  runTransforms()
  for (let i = 0; i < n; i++) stepAll()
  return { steps: n }
}

// 清除实验:锁定/params/基线全清 + 回作者态
export function clearExperiment(state) {
  state.whatIf.locked = {}
  state.whatIf.params = {}
  state.whatIf.baseline = null
  runSource(state.sourceCode, state)
}

export function baselineStale(state) {
  const b = state.whatIf.baseline
  return !!b && b.sourceCode !== state.sourceCode
}

// 差异行:baseline.values vs 当前 live 原始值;锁定参数置顶,其余 |Δ| 降序
export function diffSummary(state) {
  const b = state.whatIf.baseline
  if (!b) return []
  const rows = []
  for (const inst of state.runtimeInstances) {
    for (const attr of Object.keys(inst.attrs)) {
      if (attr.startsWith('__') || attr === 'edges') continue
      const cur = inst.attrs[attr]
      if (!isPrimitive(cur)) continue
      const k = whatIfKey(inst.varName, attr)
      if (!Object.prototype.hasOwnProperty.call(b.values, k)) continue  // 基线后新增键无参照
      const base = b.values[k]
      if (cur === base) continue
      rows.push({
        varName: inst.varName,
        attr,
        base,
        cur,
        delta: (typeof cur === 'number' && typeof base === 'number') ? cur - base : null,
        locked: !!state.whatIf.locked[k],
      })
    }
  }
  rows.sort((a, b2) => {
    if (a.locked !== b2.locked) return a.locked ? -1 : 1
    const da = a.delta === null ? 0 : Math.abs(a.delta)
    const db = b2.delta === null ? 0 : Math.abs(b2.delta)
    if (db !== da) return db - da
    return (a.varName + a.attr).localeCompare(b2.varName + b2.attr)
  })
  return rows
}

function deepCopyTraces(traces) {
  const out = {}
  for (const varName of Object.keys(traces || {})) {
    const byAttr = traces[varName]
    const o = {}
    for (const attr of Object.keys(byAttr)) {
      o[attr] = byAttr[attr].map(p => ({ tick: p.tick, value: p.value }))
    }
    out[varName] = o
  }
  return out
}

function snapshotValues(state) {
  const out = {}
  for (const inst of state.runtimeInstances) {
    for (const attr of Object.keys(inst.attrs)) {
      if (attr.startsWith('__') || attr === 'edges') continue
      const v = inst.attrs[attr]
      if (!isPrimitive(v)) continue
      out[whatIfKey(inst.varName, attr)] = v
    }
  }
  return out
}
