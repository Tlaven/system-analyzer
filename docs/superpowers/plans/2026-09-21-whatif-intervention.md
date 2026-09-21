# 干预(what-if)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 ADR-011 干预(what-if):逐属性锁定假设层 + 基线/复跑对比 + sparkline 叠加 + 实验对比节。

**Architecture:** 新 `src/whatif.js` 纯逻辑模块(会话层 `state.whatIf`,不落码);panel 消费(锁按钮/假设 badge/写值分支/sparkline 叠加/差异节);input 提供菜单与 window 钩子;不新增模式概念(锁定即实验参数)。

**Tech Stack:** Vanilla JS + Canvas 2D;esbuild 单文件构建;Node 单测 + puppeteer e2e。

**参照文档:** `docs/decisions/adr-011-whatif-intervention.md`(不变量 36-38)、`docs/visualization-modes.md` §12。

---

### Task 1: `src/whatif.js` 纯逻辑模块 + state 假设层

**Files:**
- Create: `src/whatif.js`
- Modify: `src/state.js`(state 对象加 `whatIf`,约 line 146 `influenceDir` 后)
- Test: `scripts/test-whatif.mjs`

- [ ] **Step 1: state.js 加假设层**

在 `state.js` 的 `influenceDir: 'both',` 行后加:

```js
  // ADR-011 干预(what-if)假设层:会话内,不落码(不变量 36-38)
  whatIf: {
    locked: {},     // 'varName\u0000attr' -> true
    params: {},     // 'varName\u0000attr' -> 假设值
    baseline: null, // { traces, values, tickCount, sourceCode }
  },
```

- [ ] **Step 2: 写 `scripts/test-whatif.mjs`(先失败)**

完整文件内容:

```js
// ADR-011 干预(what-if)单元测试(无浏览器)
// 语义:锁定编辑写 live+params 不写穿作者态;基线深拷贝隔离;
// 复跑 = runSource → applyHypotheses → runTransforms → stepAll × tickCount
import { state } from '../src/state.js'
import { runSource, serializeCode } from '../src/codegraph.js'
import { runTransforms, stepAll } from '../src/engine.js'
import { setAuthorAttr } from '../src/author.js'
import {
  isLocked, toggleLock, lockedCount, setHypothesis, applyHypotheses,
  captureBaseline, replay, clearExperiment, baselineStale, diffSummary, whatIfKey,
} from '../src/whatif.js'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : '') }
}

const SAMPLE = `class Src { attrs = { rate: 1, out: 0 } }
class Mid { attrs = { in: 0, out: 0 } }
class Dst { attrs = { in: 0 } }
const Src_1 = GraphStarter.add(Src, 'Src_1')
const Mid_1 = GraphStarter.add(Mid, 'Mid_1')
const Dst_1 = GraphStarter.add(Dst, 'Dst_1')
Src_1.edges = [{ target: Mid_1, description: 's→m', transform: "target['in'] = source['out']" }]
Mid_1.edges = [{ target: Dst_1, description: 'm→d', transform: "target['in'] = source['in'] + source['out']" }]`

const inst = (v) => state.runtimeInstances.find(i => i.varName === v)
const reset = () => { state.whatIf.locked = {}; state.whatIf.params = {}; state.whatIf.baseline = null }
const load = () => { state.sourceCode = SAMPLE; runSource(SAMPLE, state); reset() }
const runBaseline = (n) => { state.sourceCode = SAMPLE; runSource(SAMPLE, state); runTransforms(); for (let i = 0; i < n; i++) stepAll() }

console.log('\n测试 1:锁定与假设编辑不落码')
{
  load()
  check('初始未锁定', !isLocked(state, 'Src_1', 'rate'))
  toggleLock(state, 'Src_1', 'rate')
  check('锁定后 isLocked=true', isLocked(state, 'Src_1', 'rate'))
  check('lockedCount=1', lockedCount(state) === 1, lockedCount(state))
  setHypothesis(state, 'Src_1', 'rate', 9)
  check('live rate=9', inst('Src_1').attrs.rate === 9, inst('Src_1').attrs.rate)
  check('params 记录 9', state.whatIf.params[whatIfKey('Src_1', 'rate')] === 9, state.whatIf.params)
  check('authorAttrs.rate 仍为 1', state.authorAttrs.get('Src_1').rate === 1, state.authorAttrs.get('Src_1').rate)
  check('serializeCode 不含假设值', !serializeCode(state).includes('Src_1.rate = 9'), serializeCode(state).slice(0, 120))
}

console.log('\n测试 2:解锁恢复作者值 + 清 params')
{
  load()
  toggleLock(state, 'Src_1', 'rate')
  setHypothesis(state, 'Src_1', 'rate', 9)
  toggleLock(state, 'Src_1', 'rate')
  check('解锁后 live rate=1(作者值)', inst('Src_1').attrs.rate === 1, inst('Src_1').attrs.rate)
  check('解锁后 params 清空', Object.keys(state.whatIf.params).length === 0, state.whatIf.params)
  check('解锁后 lockedCount=0', lockedCount(state) === 0, lockedCount(state))
}

console.log('\n测试 3:基线深拷贝隔离')
{
  runBaseline(3); reset()
  const b = captureBaseline(state)
  const len0 = b.traces['Src_1'].rate.length
  setHypothesis(state, 'Src_1', 'rate', 9)
  state.traces['Src_1'].rate.push({ tick: 999, value: 42 })
  check('live 变化不影响 baseline.values', b.values[whatIfKey('Src_1', 'rate')] === 1, b.values[whatIfKey('Src_1', 'rate')])
  check('live traces 变化不影响 baseline.traces', b.traces['Src_1'].rate.length === len0, { base: b.traces['Src_1'].rate.length, live: state.traces['Src_1'].rate.length })
  check('基线记录 tickCount=3', b.tickCount === 3, b.tickCount)
  check('基线记录 sourceCode', b.sourceCode === state.sourceCode, b.sourceCode.slice(0, 40))
}

console.log('\n测试 4:无假设复跑确定性(轨迹一致)')
{
  runBaseline(3); reset()
  captureBaseline(state)
  const baseJson = JSON.stringify(state.traces)
  const r = replay(state)
  check('复跑步数 = 基线 tickCount', r.steps === 3, r)
  check('复跑后 tickCount=3', state.tickCount === 3, state.tickCount)
  check('无假设复跑轨迹与基线一致', JSON.stringify(state.traces) === baseJson, { same: JSON.stringify(state.traces) === baseJson })
}

console.log('\n测试 5:有假设复跑(轨迹差异 + 假设值生效)')
{
  runBaseline(3); reset()
  captureBaseline(state)
  toggleLock(state, 'Src_1', 'rate')
  setHypothesis(state, 'Src_1', 'rate', 9)
  replay(state)
  check('复跑后锁定参数 = 假设值 9', inst('Src_1').attrs.rate === 9, inst('Src_1').attrs.rate)
  const b = state.whatIf.baseline
  const differs = b.traces['Src_1'].rate.some((p, i) => p.value !== state.traces['Src_1'].rate[i].value)
  check('假设轨迹与基线轨迹不同', differs, { base: b.traces['Src_1'].rate[0], cur: state.traces['Src_1'].rate[0] })
  check('未涉及属性轨迹一致(Mid.in 全 0)', state.traces['Mid_1'].in.every(p => p.value === 0), state.traces['Mid_1'].in)
}

console.log('\n测试 6:applyHypotheses 容错(目标缺失跳过)')
{
  load()
  state.whatIf.params[whatIfKey('Ghost_1', 'x')] = 1
  state.whatIf.params[whatIfKey('Src_1', 'rate')] = 5
  const r = applyHypotheses(state)
  check('缺失实例被跳过(applied=1 skipped=1)', r.applied === 1 && r.skipped === 1, r)
  check('存在实例假设生效(rate=5)', inst('Src_1').attrs.rate === 5, inst('Src_1').attrs.rate)
  check('params 不自动清理', Object.keys(state.whatIf.params).length === 2, state.whatIf.params)
}

console.log('\n测试 7:基线过期判据')
{
  runBaseline(0); reset()
  captureBaseline(state)
  setHypothesis(state, 'Src_1', 'rate', 9)
  check('假设编辑不使基线过期', !baselineStale(state))
  state.sourceCode = state.sourceCode + '\n// 改图'
  check('sourceCode 变化 → 基线过期', baselineStale(state))
}

console.log('\n测试 8:diffSummary(差异行/排序/锁定标记)')
{
  runBaseline(0); reset()
  captureBaseline(state)
  toggleLock(state, 'Src_1', 'rate')
  setHypothesis(state, 'Src_1', 'rate', 9)
  setHypothesis(state, 'Mid_1', 'out', 2)
  const rows = diffSummary(state)
  check('列出 2 行差异', rows.length === 2, rows)
  check('锁定参数置顶', rows[0].varName === 'Src_1' && rows[0].attr === 'rate' && rows[0].locked === true, rows)
  check('delta 计算正确(9-1=8)', rows[0].delta === 8, rows[0])
  check('未变化属性不列(Dst.in)', !rows.some(r => r.varName === 'Dst_1'), rows)
}

console.log('\n测试 9:clearExperiment(清空 + 回作者态)')
{
  runBaseline(2); reset()
  captureBaseline(state)
  toggleLock(state, 'Src_1', 'rate')
  setHypothesis(state, 'Src_1', 'rate', 9)
  clearExperiment(state)
  check('锁定/params/基线全清', lockedCount(state) === 0 && Object.keys(state.whatIf.params).length === 0 && !state.whatIf.baseline, state.whatIf)
  check('live 回作者态(rate=1)', inst('Src_1').attrs.rate === 1, inst('Src_1').attrs.rate)
  check('traces 清空(新一局)', Object.keys(state.traces).length === 0, Object.keys(state.traces))
}

console.log('\n测试 10:未锁定编辑仍写穿作者态(不变量 36 边界)')
{
  load()
  setAuthorAttr(state, inst('Src_1'), 'rate', 5)
  check('未锁定编辑:serializeCode 含 override', serializeCode(state).includes('Src_1.rate = 5'), serializeCode(state).slice(0, 120))
  toggleLock(state, 'Src_1', 'rate')
  setHypothesis(state, 'Src_1', 'rate', 7)
  check('锁定编辑:serializeCode 仍为 5', serializeCode(state).includes('Src_1.rate = 5') && !serializeCode(state).includes('= 7'), serializeCode(state).slice(0, 120))
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node scripts/test-whatif.mjs`
Expected: FAIL(`Cannot find module ... src/whatif.js` 或 `does not provide an export named`)

- [ ] **Step 4: 新建 `src/whatif.js`**

```js
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node scripts/test-whatif.mjs`
Expected: 全绿(35 项)

- [ ] **Step 6: Commit**

```bash
git add src/whatif.js src/state.js scripts/test-whatif.mjs
git commit -m "feat: what-if 假设层模块(ADR-011)——锁定/假设/基线/复跑/差异"
```

---

### Task 2: panel 锁定交互 + 写值分支 + sparkline 叠加

**Files:**
- Modify: `src/panel.js`(imports;`_renderPropField` line 610-668;`_appendSparkline`/`_drawSparkline`/`refreshSparklines` line 670-726)
- Modify: `src/index.html`(CSS,line 121-122 `.trace-spark` 后)
- Test: 手动冒烟 + Task 5 e2e 53

- [ ] **Step 1: index.html CSS**

在 `.trace-spark{display:block;width:100%;height:26px;margin-top:4px}` 后加:

```css
/* ADR-011 干预(what-if):锁按钮 / 假设 badge / 基线叠加 / 差异行 */
.btn-lock-prop{padding:2px 6px;font-size:11px;border:1px solid var(--ibd);background:var(--ibg);border-radius:4px;cursor:pointer;color:var(--flbl);margin-left:4px;line-height:1}
.btn-lock-prop.locked{border-color:var(--ifc2);color:var(--ifc2);background:var(--addp-hbg)}
.whatif-badge{display:inline-block;margin-left:6px;padding:0 5px;font-size:10px;border-radius:3px;background:var(--addp-hbg);color:var(--ifc2);border:1px solid var(--addp-hb)}
.whatif-input{border-color:var(--ifc2) !important;background:var(--addp-hbg) !important}
.whatif-delta{display:block;font-size:11px;color:var(--flbl);margin-top:2px;font-family:monospace}
.whatif-delta b{color:var(--ifc2);font-weight:600}
```

- [ ] **Step 2: panel.js 引入 whatif**

在 `import { computeInfluence, influenceRows } from './influence.js'` 后加:

```js
import { isLocked, toggleLock, setHypothesis, diffSummary, baselineStale, whatIfKey } from './whatif.js'
```

- [ ] **Step 3: `_renderPropField` 的 `writeVal` 加假设分支**

把 `function writeVal(newVal) {` 整体替换为:

```js
  function writeVal(newVal) {
    // ADR-011 假设编辑:写 live + params,不写穿作者态(不变量 36);不改码 → 不 pushUndo
    if (!isType && isLocked(state, inst.varName, propName)) {
      setHypothesis(state, inst.varName, propName, newVal)
      render(); triggerPropagate(inst.varName)
      return
    }
    markUndo()
    if (isType) {
      const oldDefault = cls.attrs[propName]
      cls.attrs[propName] = newVal
      propagateDefaultChange(cls, propName, oldDefault, newVal)
    } else {
      inst.attrs[propName] = newVal
      setAuthorAttr(state, inst, propName, newVal)  // ADR-007 写穿
    }
    syncCodeFromRuntime(); render(); triggerPropagate(inst.varName)
  }
```

- [ ] **Step 4: number 分支加锁按钮与 badge**

把 `if (t === 'number') { ... }` 分支整体替换为:

```js
  if (t === 'number') {
    const locked = !isType && isLocked(state, inst.varName, propName)
    const lockBtn = (!isType && !codeMode)
      ? '<button class="btn-lock-prop' + (locked ? ' locked' : '') + '" data-prop="' + esc(propName) + '" title="' +
        (locked ? '解除锁定(恢复作者值)' : '锁定为实验参数(编辑不落码)') + '">' + (locked ? '🔒' : '🔓') + '</button>'
      : ''
    row.innerHTML = '<span class="fl">' + esc(propName) + esc(labelSuffix) +
      (locked ? '<span class="whatif-badge">假设</span>' : '') + '</span>' +
      '<div style="display:flex;align-items:center">' +
      '<input type="number" step="any" id="np-attr-' + esc(propName) + '" value="' + esc(String(curVal)) + '"' +
      (locked ? ' class="whatif-input"' : '') + (codeMode ? ' disabled' : '') + '>' +
      lockBtn + delBtn + '</div>'
    cont.appendChild(row)
    if (!codeMode) {
      row.querySelector('input').oninput = function() {
        const v = parseFloat(this.value)
        writeVal(isNaN(v) ? 0 : v)
      }
      const lock = row.querySelector('.btn-lock-prop')
      if (lock) {
        lock.onclick = function() {
          toggleLock(state, inst.varName, propName)
          render(); triggerPropagate(inst.varName)
          showNodePanel(inst)
        }
      }
    }
    // A1:有历史时序的数值属性行内嵌 sparkline(stepAll 产点,runSource 清空)
    if (!isType) _appendSparkline(row, inst.varName, propName)
  }
```

- [ ] **Step 5: sparkline 叠加基线**

把 `_appendSparkline` / `_drawSparkline` / `refreshSparklines`(line 673-726)整体替换为:

```js
const SPARK_H = 26
function _baselinePts(varName, attr) {
  const b = state.whatIf && state.whatIf.baseline
  return (b && b.traces[varName] && b.traces[varName][attr]) || null
}
function _appendSparkline(row, varName, attr) {
  const pts = (state.traces[varName] || {})[attr]
  const bpts = _baselinePts(varName, attr)
  if ((!pts || pts.length < 2) && (!bpts || bpts.length < 2)) return
  const cv = document.createElement('canvas')
  cv.className = 'trace-spark'
  cv.dataset.varName = varName
  cv.dataset.attr = attr
  cv.title = attr + ' · 当前 ' + ((pts && pts.length) || 0) + ' tick' +
    (bpts ? ' · 基线 ' + bpts.length + ' tick' : '')
  row.appendChild(cv)
  _drawSparkline(cv, pts, bpts)
  _appendWhatIfDelta(row, varName, attr)
}

// 行内"基线值 → 当前值 Δ"(仅基线存在且数值有差异时)
function _appendWhatIfDelta(row, varName, attr) {
  const b = state.whatIf && state.whatIf.baseline
  if (!b) return
  const inst = state.runtimeInstances.find(i => i.varName === varName)
  if (!inst) return
  const cur = inst.attrs[attr]
  if (typeof cur !== 'number') return
  const k = whatIfKey(varName, attr)
  if (!Object.prototype.hasOwnProperty.call(b.values, k)) return
  const base = b.values[k]
  if (cur === base) return
  const d = cur - base
  const span = document.createElement('span')
  span.className = 'whatif-delta'
  span.innerHTML = '基线 ' + esc(_fmtNum(base)) + ' → <b>' + esc(_fmtNum(cur)) + '</b> (Δ ' + (d >= 0 ? '+' : '') + esc(_fmtNum(d)) + ')'
  row.appendChild(span)
}
function _fmtNum(v) {
  if (typeof v !== 'number') return String(v)
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)
}

function _drawSparkline(cv, pts, baselinePts) {
  const dpr = window.devicePixelRatio || 1
  const w = cv.clientWidth || 200
  const h = SPARK_H
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  const ctx = cv.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const series = []
  if (baselinePts && baselinePts.length >= 2) series.push(baselinePts)
  if (pts && pts.length >= 2) series.push(pts)
  if (!series.length) return
  let min = Infinity, max = -Infinity, tMin = Infinity, tMax = -Infinity
  for (const s of series) {
    for (const p of s) {
      if (p.value < min) min = p.value
      if (p.value > max) max = p.value
      if (p.tick < tMin) tMin = p.tick
      if (p.tick > tMax) tMax = p.tick
    }
  }
  const vSpan = (max - min) || Math.abs(max) || 1
  const tSpan = (tMax - tMin) || 1
  const pad = 3
  const x = p => pad + (w - pad * 2) * ((p.tick - tMin) / tSpan)
  const y = v => h - pad - (h - pad * 2) * ((v - min) / vSpan)
  const pc = getPaletteColors()
  const draw = (s, color, width, dash) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    if (dash) ctx.setLineDash(dash)
    ctx.beginPath()
    s.forEach((p, i) => { i ? ctx.lineTo(x(p), y(p.value)) : ctx.moveTo(x(p), y(p.value)) })
    ctx.stroke()
    ctx.setLineDash([])
    const last = s[s.length - 1]
    ctx.beginPath()
    ctx.arc(x(last), y(last.value), 2.5, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }
  if (baselinePts && baselinePts.length >= 2) {
    ctx.globalAlpha = 0.55
    draw(baselinePts, pc.text3, 1, [3, 3])
    ctx.globalAlpha = 1
  }
  if (pts && pts.length >= 2) draw(pts, pc.accent, 1.5, null)
}

// sa-tick 时原地重绘 panel 里所有 sparkline(保留 panel 滚动/focus 状态)
export function refreshSparklines() {
  const cvs = panelBody.querySelectorAll('canvas.trace-spark')
  if (!cvs.length) return
  for (const cv of cvs) {
    const pts = (state.traces[cv.dataset.varName] || {})[cv.dataset.attr]
    _drawSparkline(cv, pts, _baselinePts(cv.dataset.varName, cv.dataset.attr))
  }
}
```

- [ ] **Step 6: build + 手动冒烟**

Run: `npm run build`
浏览器打开 `dist/index.html`:选中节点 → 锁一个数值属性 → 改值 → 确认 badge"假设"、输入框 accent 描边、sparkline 无异常;切 Code 模式确认 sourceCode 无假设值。

- [ ] **Step 7: Commit**

```bash
git add src/panel.js src/index.html
git commit -m "feat: what-if 锁定交互 + 假设编辑 + sparkline 基线叠加(ADR-011)"
```

---

### Task 3: 实验对比节(panel 顶部)

**Files:**
- Modify: `src/panel.js`(`showNodePanel`,line 396-607)
- Modify: `src/index.html`(CSS)
- Test: Task 5 e2e 54

- [ ] **Step 1: index.html CSS**

在 Task 2 的 `.whatif-delta b` 后加:

```css
.whatif-diff{margin:6px 0 10px;padding:6px 8px;border:1px solid var(--addp-hb);border-radius:5px;background:var(--addpbg)}
.whatif-diff .wd-title{font-size:11px;color:var(--flbl);display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.whatif-diff .wd-warn{color:#e53935;font-size:11px}
.whatif-diff .wd-row{display:flex;justify-content:space-between;gap:8px;padding:3px 4px;border-radius:3px;cursor:pointer;font-size:12px;color:var(--ifc)}
.whatif-diff .wd-row:hover{background:var(--tbtn-hbg)}
.whatif-diff .wd-row .wd-val{font-family:monospace;color:var(--flbl)}
.whatif-diff .wd-row .wd-val b{color:var(--ifc2)}
.whatif-diff .wd-empty{font-size:11px;color:var(--flbl)}
```

- [ ] **Step 2: panel.js 辅助函数**

在 `_renderPropField` 前加:

```js
function _whatIfNodeName(varName) {
  const n = state.runtimeInstances.find(i => i.varName === varName)
  if (!n) return varName
  const c = state.classes[n.className]
  return n.attrs.name || (c && c.name) || varName
}
```

- [ ] **Step 3: `showNodePanel` 插入对比节**

在 `html += '<div class="panel-sub">' + esc(inst.className) + '</div>'` 后加:

```js
  // ADR-011 实验对比节(基线存在时显示;全局差异列表,点行定位)
  const _b = state.whatIf.baseline
  if (_b && !isType) {
    const rows = diffSummary(state)
    const stale = baselineStale(state)
    let h = '<div class="whatif-diff">' +
      '<div class="wd-title"><span>实验对比 · 基线 ' + _b.tickCount + ' tick</span>' +
      (stale ? '<span class="wd-warn">基线可能过期(图已变更)</span>' : '') + '</div>'
    if (!rows.length) {
      h += '<div class="wd-empty">与基线无差异(改假设值或点"复跑")</div>'
    } else {
      for (const r of rows) {
        const dTxt = r.delta === null ? '' : ' (Δ ' + (r.delta >= 0 ? '+' : '') + _fmtNum(r.delta) + ')'
        h += '<div class="wd-row" data-var="' + esc(r.varName) + '" data-attr="' + esc(r.attr) + '">' +
          '<span>' + (r.locked ? '🔒 ' : '') + esc(_whatIfNodeName(r.varName)) + '.' + esc(r.attr) + '</span>' +
          '<span class="wd-val">' + esc(_fmtNum(r.base)) + ' → <b>' + esc(_fmtNum(r.cur)) + '</b>' + esc(dTxt) + '</span>' +
          '</div>'
      }
    }
    h += '</div>'
    html += h
  }
```

- [ ] **Step 4: 点行 handler**

在 `panelBody.innerHTML = html` 与 `panel.classList.remove('hidden')` 之后加:

```js
  // ADR-011 对比行点击:选中该节点(panel 切换);同节点则高亮对应属性行
  panelBody.querySelectorAll('.whatif-diff .wd-row').forEach(el => {
    el.onclick = function() {
      const target = state.runtimeInstances.find(i => i.varName === this.dataset.var)
      if (!target) return
      if (target === inst) {
        const inp = document.getElementById('np-attr-' + this.dataset.attr)
        const rowEl = inp && inp.closest('.field')
        if (rowEl) {
          rowEl.style.background = 'var(--addp-hbg)'
          rowEl.scrollIntoView({ behavior: 'auto', block: 'center' })
        }
        return
      }
      window.selectInstance(target)
      showNodePanel(target)
    }
  })
```

- [ ] **Step 5: build + 手动验证**

Run: `npm run build`
浏览器:锁定 rate → 改值 → 记录基线(菜单,Task 4 未做前可 console 调 `window.__sa_test.whatif`)→ 复跑 → 确认对比节差异行与点行跳转。

- [ ] **Step 6: Commit**

```bash
git add src/panel.js src/index.html
git commit -m "feat: 实验对比节(差异列表 + 点行定位,ADR-011)"
```

---

### Task 4: 实验菜单 + window 钩子 + 测试钩子

**Files:**
- Modify: `src/input.js`(imports line 17-18 区;window 钩子 line 160 区;`toggleMenu` line 464-471)
- Modify: `src/index.html`(工具栏,视图菜单组后 line 147)
- Test: Task 5 e2e 53-54

- [ ] **Step 1: input.js 导入**

在 `import { computeInfluence } from './influence.js'` 后加:

```js
import { captureBaseline, replay, clearExperiment, baselineStale, lockedCount, diffSummary } from './whatif.js'
```

- [ ] **Step 2: window 钩子**

在 `window.runPropagate = function(instId) { propagate(instId); render() }` 后加:

```js
// ============ ADR-011 干预(what-if)实验菜单动作 ============
window.recordBaseline = function() {
  captureBaseline(state)
  render()
  if (state.selInstance) showNodePanel(state.selInstance)
}
window.replayExperiment = function() {
  stopPlay()  // 复跑自带 stepAll,避免与连播叠加
  const r = replay(state)
  wrapAllInstances()
  render()
  if (state.selInstance) showNodePanel(state.selInstance)
  return r
}
window.clearExperiment = function() {
  clearExperiment(state)
  wrapAllInstances()
  render()
  if (state.selInstance) showNodePanel(state.selInstance)
}
window.__sa_test.whatif = function() {
  const w = state.whatIf
  return {
    locked: Object.keys(w.locked),
    params: { ...w.params },
    hasBaseline: !!w.baseline,
    baselineTick: w.baseline ? w.baseline.tickCount : 0,
    stale: baselineStale(state),
    diffs: diffSummary(state),
    lockedCount: lockedCount(state),
  }
}
```

- [ ] **Step 3: index.html 加"实验 ▾"菜单**

在视图菜单组 `</div>` 之后(样式菜单组之前)加:

```html
  <div class="menu-group">
    <button class="menu-trigger" data-menu="whatif" onclick="toggleMenu('whatif')">实验 ▾</button>
    <div class="dropdown-menu" data-menu="whatif">
      <div class="menu-item" onclick="recordBaseline()">记录基线</div>
      <div class="menu-item" onclick="replayExperiment()">复跑(应用假设)</div>
      <div class="menu-item" onclick="clearExperiment()">清除实验</div>
      <div class="menu-sep"></div>
      <div class="menu-label" id="whatif-status">锁定 0 · 基线 无</div>
    </div>
  </div>
```

- [ ] **Step 4: `toggleMenu` 打开时刷新状态行**

把 `window.toggleMenu` 替换为:

```js
window.toggleMenu = function(name) {
  const trig = document.querySelector(`.menu-trigger[data-menu="${name}"]`)
  const menu = document.querySelector(`.dropdown-menu[data-menu="${name}"]`)
  if (!trig || !menu) return
  const isOpen = menu.classList.contains('open')
  closeAllMenus()
  if (!isOpen) {
    menu.classList.add('open'); trig.classList.add('open')
    // ADR-011:实验菜单状态行(打开时刷新)
    if (name === 'whatif') {
      const el = document.getElementById('whatif-status')
      if (el) {
        const w = state.whatIf
        el.textContent = '锁定 ' + lockedCount(state) + ' · 基线 ' +
          (w.baseline ? w.baseline.tickCount + ' tick' : '无') +
          (w.baseline && baselineStale(state) ? ' · 可能过期' : '')
      }
    }
  }
}
```

- [ ] **Step 5: build + 手动全流程**

Run: `npm run build`
浏览器完整流程:锁定属性 → 改假设值 → 实验菜单记录基线 → 再改假设 → 复跑 → 看 sparkline 叠加与对比节 → 清除实验 → 确认值回作者态。

- [ ] **Step 6: Commit**

```bash
git add src/input.js src/index.html
git commit -m "feat: 实验菜单(记录基线/复跑/清除)+ window 钩子(ADR-011)"
```

---

### Task 5: e2e 53-54 + 全套回归

**Files:**
- Modify: `scripts/test-e2e.mjs`(文件末尾 `await browser.close()` 前插入,line 1469 后)

- [ ] **Step 1: 插入 e2e 53-54**

```js
const WHATIF_SAMPLE = `class Src { attrs = { rate: 1, out: 0 } }
class Mid { attrs = { in: 0, out: 0 } }
class Dst { attrs = { in: 0 } }
const Src_1 = GraphStarter.add(Src, 'Src_1')
const Mid_1 = GraphStarter.add(Mid, 'Mid_1')
const Dst_1 = GraphStarter.add(Dst, 'Dst_1')
Src_1.edges = [{ target: Mid_1, description: 's→m', transform: "target['in'] = source['out']" }]
Mid_1.edges = [{ target: Dst_1, description: 'm→d', transform: "target['in'] = source['in'] + source['out']" }]`

console.log('\n测试 53：ADR-011 锁定编辑不落码 + 假设 badge')
{
  await page.evaluate((src) => {
    window.__sa_test.importJSON({ sourceCode: src, title: 'whatif' })
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Src_1')
    window.showNodePanel(s1)
    window.setPanelMode('instance')
  }, WHATIF_SAMPLE)
  await new Promise(r => setTimeout(r, 120))
  const before = await page.evaluate(() => window.state.sourceCode)
  await page.evaluate(() => {
    document.querySelector('.btn-lock-prop[data-prop="rate"]').click()
  })
  await new Promise(r => setTimeout(r, 60))
  await page.evaluate(() => {
    const inp = document.getElementById('np-attr-rate')
    inp.value = '9'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await new Promise(r => setTimeout(r, 450))  // 等 triggerPropagate debounce
  const r = await page.evaluate(() => {
    const body = document.getElementById('panel-body')
    return {
      src: window.state.sourceCode,
      rate: window.state.runtimeInstances.find(i => i.varName === 'Src_1').attrs.rate,
      hasBadge: !!body.querySelector('.whatif-badge'),
      hasLockedBtn: !!body.querySelector('.btn-lock-prop.locked'),
      w: window.__sa_test.whatif(),
    }
  })
  check('锁定编辑:live rate=9', r.rate === 9, r.rate)
  check('锁定编辑:sourceCode 不变', r.src === before, { changed: r.src !== before })
  check('行上"假设"badge + 锁按钮态', r.hasBadge && r.hasLockedBtn, r)
  check('whatif 状态:锁定 1 · params 记录', r.w.lockedCount === 1 && r.w.params['Src_1\u0000rate'] === 9, r.w)
}

console.log('\n测试 54：ADR-011 基线/复跑对比 + 清除实验')
{
  // 解锁(恢复作者值)→ 等 debounce → 记录基线
  await page.evaluate(() => { document.querySelector('.btn-lock-prop[data-prop="rate"]').click() })
  await new Promise(r => setTimeout(r, 400))
  await page.evaluate(() => window.recordBaseline())
  await new Promise(r => setTimeout(r, 60))
  // 重新锁定并改假设 9 → 复跑
  await page.evaluate(() => { document.querySelector('.btn-lock-prop[data-prop="rate"]').click() })
  await new Promise(r => setTimeout(r, 60))
  await page.evaluate(() => {
    const inp = document.getElementById('np-attr-rate')
    inp.value = '9'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await new Promise(r => setTimeout(r, 450))
  const rep = await page.evaluate(() => window.replayExperiment())
  await new Promise(r => setTimeout(r, 120))
  const r = await page.evaluate(() => {
    const body = document.getElementById('panel-body')
    const rows = [...body.querySelectorAll('.wd-row')].map(el => el.textContent)
    return {
      rate: window.state.runtimeInstances.find(i => i.varName === 'Src_1').attrs.rate,
      w: window.__sa_test.whatif(),
      hasDiff: !!body.querySelector('.whatif-diff'),
      rows,
    }
  })
  check('复跑步数 = 基线 tick(0)', rep.steps === 0, rep)
  check('复跑应用假设(live rate=9)', r.rate === 9, r.rate)
  check('对比节存在且列出差异行', r.hasDiff && r.rows.length >= 1, r)
  check('差异行含 Src_1.rate 1 → 9', r.rows.some(t => t.includes('Src_1.rate') && t.includes('1 → 9')), r.rows)
  await page.evaluate(() => window.clearExperiment())
  await new Promise(r => setTimeout(r, 100))
  const c = await page.evaluate(() => ({
    rate: window.state.runtimeInstances.find(i => i.varName === 'Src_1').attrs.rate,
    w: window.__sa_test.whatif(),
    hasDiff: !!document.getElementById('panel-body').querySelector('.whatif-diff'),
  }))
  check('清除实验:rate 回作者值 1', c.rate === 1, c.rate)
  check('清除实验:锁定/基线清空 + 对比节消失', c.w.lockedCount === 0 && !c.w.hasBaseline && !c.hasDiff, c)
}
```

- [ ] **Step 2: build + 跑全套**

```bash
npm run build
node scripts/test-codegraph.mjs
node scripts/test-engine.mjs
node scripts/test-roundtrip.mjs
node scripts/test-skeleton.mjs
node scripts/test-influence.mjs
node scripts/test-whatif.mjs
node scripts/test-e2e.mjs
```

Expected: 全部通过;e2e 205 → 213(e2e 53-54 共 8 项检查);`test-whatif` 35 项。

- [ ] **Step 3: Commit**

```bash
git add scripts/test-e2e.mjs
git commit -m "test: e2e 53-54 what-if 全流程(ADR-011)"
```

---

### Task 6: 文档同步(CHANGELOG/README/CLAUDE)

**Files:**
- Modify: `CHANGELOG.md`(line 9 前,`[Unreleased]` Added 顶部)
- Modify: `README.md`(测试清单 line 42 后 + line 46 计数 + ADR 列表补齐)
- Modify: `CLAUDE.md`(常用命令 line 38 后 + line 42 six→seven + [是什么] 段落 + 一句话概要 + [不变量] 加 bullet)
- Verify: `docs/architecture.md` 不变量 36-38、`docs/visualization-modes.md` §12 已在 ADR 批次写好,无需改

- [ ] **Step 1: CHANGELOG 顶部插入**

在 `## [Unreleased]` → `### Added` 后第一条(影响解析)之前插入:

```md
- **干预(what-if)(ADR-011)**:逐属性锁定假设层(锁定编辑写 live + 会话层 params,不写穿作者态;解锁恢复作者值)+ 基线四元组(traces 深拷贝/原始值快照/tickCount/sourceCode)+ 一键复跑(`runSource → applyHypotheses → runTransforms → stepAll × tickCount`,不 save)+ 对比视图(sparkline 基线灰 ghost 叠加 + panel 实验对比节差异列表,点行定位);新 `src/whatif.js` 纯函数 + 第七套测试 `scripts/test-whatif.mjs`(35 项)+ e2e 53-54
```

(若 `node scripts/test-whatif.mjs` 实际项数不是 35,按实际输出改。)

- [ ] **Step 2: README 测试清单**

在 `node scripts/test-influence.mjs` 行后加:

```bash
node scripts/test-whatif.mjs       # what-if 干预单元测试(锁定/假设/基线/复跑/差异,无浏览器)
```

把 `无 test runner / lint / typecheck。验证靠上面四个 `.mjs` 脚本 + 浏览器手动验证。` 改为 `验证靠上面七个 `.mjs` 脚本 + 浏览器手动验证。`

- [ ] **Step 3: README ADR 列表补齐**

把 `ADR 列表:` 下现有 3 条替换为完整列表:

```md
- [ADR-001 边模型从 class 级迁到实例级](docs/decisions/adr-001-instance-level-edges.md)
- [ADR-002 双模式编辑(UI / Code)](docs/decisions/adr-002-dual-mode-editing.md)
- [ADR-003 边级 transform 表达式(轻量响应式)](docs/decisions/adr-003-edge-transform-expressions.md)
- [ADR-004 中文标识符分层支持](docs/decisions/adr-004-unicode-identifiers.md)
- [ADR-005 执行观测立柱(step 推进激活)](docs/decisions/adr-005-execution-observation.md)
- [ADR-006 双层边(探测边)L1](docs/decisions/adr-006-probe-edges-l1.md)
- [ADR-007 编辑快照层(演化值不自动固化)](docs/decisions/adr-007-author-snapshot-layer.md)
- [ADR-008 外部导入执行闸门(白名单分类 + 确认 + CSP)](docs/decisions/adr-008-import-execution-gate.md)
- [ADR-009 AI 传输契约(代码块主通道,URL 降级)](docs/decisions/adr-009-ai-transport-contract.md)
- [ADR-010 影响解析(选中触发 + 闭包分层 + 探测边依赖方向)](docs/decisions/adr-010-influence-analysis.md)
- [ADR-011 干预(what-if):假设层 + 基线/复跑对比](docs/decisions/adr-011-whatif-intervention.md)
```

- [ ] **Step 4: CLAUDE.md 常用命令 + six→seven**

在 `node scripts/test-influence.mjs` 行后加:

```bash
node scripts/test-whatif.mjs           # what-if 干预单元测试(锁定/假设/基线/复跑/差异,无浏览器)
```

把 `plus the six `.mjs` scripts above` 改为 `plus the seven `.mjs` scripts above`。

- [ ] **Step 5: CLAUDE.md 定位/概要/不变量**

- [是什么] 段落(探测边句后)追加:`干预(what-if)已立(ADR-011):逐属性锁定假设层 + 基线/复跑对比,假设不落码。`
- 一句话概要末尾追加:`干预:逐属性锁定假设 + 基线/复跑对比(ADR-011)。`
- [不变量] 在 ADR-009 bullet 后加:

```md
- **干预假设不落码(ADR-011)**——锁定属性的编辑只写 live + 会话层 `state.whatIf`,不写穿作者态、不入 sourceCode/URL/localStorage;复跑配方固定 `runSource → applyHypotheses → runTransforms → stepAll × 基线 tickCount`;锁定/基线不持久化。
```

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md README.md CLAUDE.md
git commit -m "docs: what-if 实现记录(CHANGELOG/README/CLAUDE 第七套测试)"
```

---

## Self-Review 记录

- **Spec coverage**:ADR-011 决策 1-8 全覆盖——形态(Task 1/3/4)、逐属性锁定(Task 2)、假设层不落码(Task 1 单测 + e2e 53)、基线四元组(Task 1)、复跑配方(Task 1/4 + e2e 54)、应用路径两条(Task 1 测试 6/7)、对比视图(Task 2/3)、模块边界(Task 1);不变量 36-38 由 test-whatif 测试 1/3/4/5/7/8/9/10 + e2e 53/54 钉住。
- **Placeholder scan**:无 TBD/TODO;每个代码步完整代码;唯一"按实际输出"是 CHANGELOG 测试项数(附验证命令)。
- **Type consistency**:`whatIfKey`/`isLocked`/`toggleLock`/`setHypothesis`/`applyHypotheses`/`captureBaseline`/`replay`/`clearExperiment`/`baselineStale`/`diffSummary`/`lockedCount` 在 Task 1 定义,Task 2-6 引用一致;`state.whatIf.{locked,params,baseline}` 形状一致;`_fmtNum` 在 panel 定义(Task 2)Task 3 复用。
- **已知风险**:`toggleMenu` 替换需保持与原实现一致(计划给完整替换体);e2e 依赖 panel 重建后的 `data-prop` 选择器(已用属性名定位,避免"第一个锁按钮"歧义)。
- **明确不做**(ADR-011):参数扫描 / 多基线 / 实验持久化 / 非数值锁定 / 基线自动重录 / llms.txt 改动(AI 面无需知 what-if)。
