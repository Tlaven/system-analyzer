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
