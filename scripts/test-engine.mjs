// 执行观测单元测试（无浏览器）：A1 属性时序记录 + A3 环成员识别
// 引擎 v0.13 起 pure（无 DOM/render 依赖）；state.js polyfill 有 Node guard。
// 运行：node scripts/test-engine.mjs（直接 import src，无需 build）
import { state } from '../src/state.js'
import { runSource, deriveEdges } from '../src/codegraph.js'
import { stepAll, getCycleMembers, topologicalSort } from '../src/engine.js'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : '') }
}

const TRACE_SAMPLE = `class Counter {
  attrs = {
    n: 0,
    label: 'x'
  }
  tick() {
    this.n = this.n + 1
  }
}

const Counter_1 = GraphStarter.add(Counter)`

console.log('测试 1：A1 traces 记录（stepAll 写入）')
{
  runSource(TRACE_SAMPLE, state)
  check('runSource 后 traces 为空', Object.keys(state.traces).length === 0, state.traces)
  stepAll()
  const tr = state.traces['Counter_1'] && state.traces['Counter_1'].n
  check('n 记录 1 点', Array.isArray(tr) && tr.length === 1, tr)
  check('点 = {tick:1, value:1}', !!tr && tr[0].tick === 1 && tr[0].value === 1, tr)
  check('非数值属性 label 不记录', !state.traces['Counter_1'].label, state.traces['Counter_1'])
  stepAll(); stepAll()
  check('累计 3 点', state.traces['Counter_1'].n.length === 3, state.traces['Counter_1'].n.length)
  check('值序列 1,2,3', state.traces['Counter_1'].n.map(p => p.value).join(',') === '1,2,3')
  check('tickCount = 3', state.tickCount === 3, state.tickCount)
}

console.log('\n测试 2：环形缓冲上限 200')
{
  runSource(TRACE_SAMPLE, state)
  for (let i = 0; i < 205; i++) stepAll()
  const tr = state.traces['Counter_1'].n
  check('长度封顶 200', tr.length === 200, tr.length)
  check('最早保留 tick = 6（挤出 5 点）', tr[0].tick === 6, tr[0])
  check('最新 tick = 205', tr[199].tick === 205, tr[199])
}

console.log('\n测试 3：runSource 清空 traces + 时钟 + runtimeGen')
{
  runSource(TRACE_SAMPLE, state)
  stepAll(); stepAll()
  const genBefore = state.runtimeGen
  runSource(TRACE_SAMPLE, state)
  check('traces 清空', Object.keys(state.traces).length === 0, state.traces)
  check('tickCount 归零', state.tickCount === 0, state.tickCount)
  check('runtimeGen 递增', state.runtimeGen === genBefore + 1, { genBefore, after: state.runtimeGen })
}

const CYCLE_SAMPLE = `class A { attrs = { v: 0 } }
class B { attrs = { v: 0 } }
class C { attrs = { v: 0 } }

const A_1 = GraphStarter.add(A)
const B_1 = GraphStarter.add(B)
const C_1 = GraphStarter.add(C)
A_1.edges = [{ target: B_1 }]
B_1.edges = [{ target: A_1 }, { target: C_1 }]`

console.log('\n测试 4：A3 环成员识别（A↔B 环 + C 下游）')
{
  runSource(CYCLE_SAMPLE, state)
  const members = Array.from(getCycleMembers()).sort()
  check('环成员 = A_1,B_1（不含下游 C_1）', members.join(',') === 'A_1,B_1', members)
  topologicalSort()
  const errs = {}
  for (const i of state.runtimeInstances) errs[i.varName] = i._topoError
  check('_topoError 仍标全部 3 个（环内+下游，执行跳过语义保留）',
    errs.A_1 && errs.B_1 && errs.C_1, errs)
}

const ACYCLIC_SAMPLE = `class A { attrs = { v: 0 } }
class B { attrs = { v: 0 } }

const A_1 = GraphStarter.add(A)
const B_1 = GraphStarter.add(B)
A_1.edges = [{ target: B_1, description: '带公式', transform: "target['v'] = source['v']" }]`

console.log('\n测试 5：无环图环成员为空 + 派生边携带 transform/description（显示通道数据面）')
{
  runSource(ACYCLIC_SAMPLE, state)
  check('无环 = 空集', getCycleMembers().size === 0, Array.from(getCycleMembers()))
  const ed = deriveEdges(state)[0]
  check('派生边携带 transform', ed && ed.transform === "target['v'] = source['v']", ed)
  check('派生边携带 description', ed && ed.description === '带公式', ed)
}

const SELF_LOOP_SAMPLE = `class S { attrs = { v: 0 } }

const S_1 = GraphStarter.add(S)
S_1.edges = [{ target: S_1 }]`

console.log('\n测试 6：自环算环成员')
{
  runSource(SELF_LOOP_SAMPLE, state)
  const members = Array.from(getCycleMembers())
  check('自环节点在集合内', members.join(',') === 'S_1', members)
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
