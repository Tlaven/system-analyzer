// 执行观测单元测试（无浏览器）：A1 属性时序记录 + A3 环成员识别
// 引擎 v0.13 起 pure（无 DOM/render 依赖）；state.js polyfill 有 Node guard。
// 运行：node scripts/test-engine.mjs（直接 import src，无需 build）
import { state } from '../src/state.js'
import { runSource, deriveEdges, serializeCode } from '../src/codegraph.js'
import { stepAll, getCycleMembers, topologicalSort } from '../src/engine.js'
import { deriveProbeEdges } from '../src/probe.js'

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

const PROBE_SAMPLE = `class Node { attrs = { x: 0, ref: null, pool: null, nest: null, loop: null } }
class Hub { attrs = { y: 0 } }

const Hub_1 = GraphStarter.add(Hub)
const Node_1 = GraphStarter.add(Node)
const Node_2 = GraphStarter.add(Node)
Node_1.ref = Hub_1
Node_1.pool = [Hub_1, Hub_1]
Node_1.nest = { deep: { leaf: Hub_1 } }
Node_2.ref = Hub_1
Node_2.nest = { a: { b: { c: { d: Hub_1 } } } }
const cyc = {}
cyc.self = cyc
Node_2.loop = cyc
Node_1.edges = [{ target: Node_2 }]`

console.log('\n测试 7：B-L1 探测边推导(收敛计数 / 实例边界 / 跳过 edges / 防环)')
{
  runSource(PROBE_SAMPLE, state)
  const probes = deriveProbeEdges(state)
  const byId = Object.fromEntries(probes.map(p => [p.id, p]))
  check('探测边收敛为 2 条', probes.length === 2, probes.map(p => p.id))
  check('Node_1→Hub_1 计数 4 + field-path 顺序',
    !!byId['Node_1>Hub_1'] && byId['Node_1>Hub_1'].fields.join(',') === 'ref,pool[0],pool[1],nest.deep.leaf',
    byId['Node_1>Hub_1'])
  check('Node_2→Hub_1 fields = ref(深 5 层被限深丢弃 + 容器环不递归)',
    !!byId['Node_2>Hub_1'] && byId['Node_2>Hub_1'].fields.join(',') === 'ref',
    byId['Node_2>Hub_1'])
  check('声明边不产探测边(Node_1→Node_2)', !byId['Node_1>Node_2'], Object.keys(byId))
  check('lazy 缓存:重复调用返回同一数组', deriveProbeEdges(state) === probes)
}

const BREAK_SAMPLE = `class Breaker {
  attrs = { ref: null }
  tick() { this.ref = null }
}
class Target { attrs = { v: 0 } }

const Target_1 = GraphStarter.add(Target)
const Breaker_1 = GraphStarter.add(Breaker)
Breaker_1.ref = Target_1`

console.log('\n测试 8：B-L1 失效(stepAll 改引用后重算)')
{
  runSource(BREAK_SAMPLE, state)
  check('初始有 Breaker_1→Target_1 探测边',
    deriveProbeEdges(state).some(p => p.id === 'Breaker_1>Target_1'), deriveProbeEdges(state))
  stepAll()
  check('stepAll 清引用后探测边消失',
    !deriveProbeEdges(state).some(p => p.id === 'Breaker_1>Target_1'), deriveProbeEdges(state))
}

console.log('\n测试 9：B-L1 引用序列化(override/容器内引用保持身份 + round-trip)')
{
  runSource(PROBE_SAMPLE, state)
  const code = serializeCode(state)
  const overrides = code.split('\n').filter(l => l.includes('Node_1.') || l.includes('Node_2.'))
  check('ref override 序列化为 varName', code.includes('Node_1.ref = Hub_1'), overrides.slice(0, 6))
  check('数组内引用序列化为 varName', code.includes('Node_1.pool = [Hub_1, Hub_1]'), overrides.slice(0, 6))
  check('嵌套对象内引用序列化为 varName', code.includes('leaf: Hub_1'), overrides.slice(0, 6))
  check('容器环降级 null 不炸', code.includes('self: null'), overrides.slice(0, 6))

  runSource(code, state)
  const byId2 = Object.fromEntries(deriveProbeEdges(state).map(p => [p.id, p]))
  check('round-trip 后探测边仍在且 field 数不变',
    !!byId2['Node_1>Hub_1'] && byId2['Node_1>Hub_1'].fields.length === 4, byId2['Node_1>Hub_1'])
  check('round-trip 后引用身份仍是 attrs(非副本)',
    state.runtimeInstances.find(i => i.varName === 'Node_1').attrs.ref ===
    state.runtimeInstances.find(i => i.varName === 'Hub_1').attrs)
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
