// 骨架验证测试(无浏览器):sourceCode ↔ runtimeInstances 往返的"有效性 + 稳定性"
//
// 验证的骨架声明:
//   1) 主循环:sourceCode → runSource → runtimeInstances → serializeCode → sourceCode
//   2) 派生纪律:派生层(edges/probes/traces)不入序列化产物
//   3) 往返保真:UI 编辑 → 序列化 → 重载 后语义不变(节点/属性/引用/边)
//   4) 稳定性(不动点):serialize(run(S1)) === S1(第二次序列化零漂移)
//
// 手段:确定性样本 + 有种子 fuzz(可复现)+ 编辑风暴 + 边界钉子 + URL 往返 + 性能冒烟。
// 运行:node scripts/test-skeleton.mjs(直接 import src,无需 build)
import { state } from '../src/state.js'
import { runSource, serializeCode, deriveEdges, invalidateEdges } from '../src/codegraph.js'
import { deriveProbeEdges } from '../src/probe.js'
import { runTransforms, stepAll } from '../src/engine.js'
import { setAuthorAttr, deleteAuthorAttr, markEdgesEdited, authorAttrsOf } from '../src/author.js'
import { toB64, fromB64 } from '../src/utils.js'
import { DEFAULT_BOOTSTRAP } from '../src/bootstrap.js'
import { classifySource } from '../src/parser.js'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, detail !== undefined ? '→ ' + JSON.stringify(detail).slice(0, 400) : '') }
}

// ============================================================
// 公共工具:语义签名(独立于 formatValue 实现,避免"用被测物检验被测物")
// ============================================================
function mulberry32(seed) {
  return function () {
    let t = seed += 0x6D2B79F5
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]
const lit = v => JSON.stringify(v)  // 测试生成用字面量;故意用双引号风格,与生产 formatValue(单引号)解耦

function normVal(v, liveAttrs, depth = 0, seen = new Set()) {
  if (v === null) return ['null']
  if (v === undefined) return ['undefined']
  const t = typeof v
  if (t === 'number') {
    if (Number.isNaN(v)) return ['num', 'NaN']
    if (!Number.isFinite(v)) return ['num', String(v)]
    return ['num', v === 0 ? 0 : v]  // -0 归一(见边界区:formatValue(-0) → '0' 是已接受降级)
  }
  if (t === 'string' || t === 'boolean') return [t, v]
  if (t !== 'object') return [t, String(v)]
  if (v.__instId && typeof v.__instId.varName === 'string') {
    // 悬空引用序列化降级 null,归一成 null 使"删实例后往返"守恒(文档化降级)
    return liveAttrs.has(v) ? ['ref', v.__instId.varName] : ['null']
  }
  if (depth > 12) return ['deep']
  if (seen.has(v)) return ['cyclic']
  seen.add(v)
  let out
  if (Array.isArray(v)) {
    out = ['arr', v.map(x => normVal(x, liveAttrs, depth + 1, seen))]
  } else {
    const keys = Object.keys(v).filter(k => !k.startsWith('__')).sort()
    out = ['obj', keys.map(k => [k, normVal(v[k], liveAttrs, depth + 1, seen)])]
  }
  seen.delete(v)
  return out
}

function sig(st) {
  const live = new Set(st.runtimeInstances.map(i => i.attrs))
  const classes = {}
  for (const name of Object.keys(st.classes).sort()) {
    const c = st.classes[name]
    classes[name] = { description: c.description, name: c.name, attrs: normVal(c.attrs || {}, live) }
  }
  const insts = st.runtimeInstances.map(inst => {
    const attrs = {}
    for (const k of Object.keys(inst.attrs)) {
      if (k === 'edges' || k.startsWith('__')) continue
      attrs[k] = normVal(inst.attrs[k], live)
    }
    const edges = (Array.isArray(inst.attrs.edges) ? inst.attrs.edges : []).map(e => ({
      // 非活引用(悬空/删除/非法)统一归一:序列化写 null,重载即 null
      target: e && e.target && e.target.__instId
        ? (live.has(e.target) ? e.target.__instId.varName : '__dangling__')
        : '__dangling__',
      description: e && e.description != null ? e.description : '',
      transform: e && typeof e.transform === 'string' ? e.transform : '',
    }))
    return { varName: inst.varName, className: inst.className, attrs, edges }
  })
  return JSON.stringify({ classes, insts })
}

function probeSig() {
  return JSON.stringify(deriveProbeEdges(state)
    .map(p => ({ id: p.id, fields: p.fields }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// 失败诊断:结构化定位首个差异(供 fuzz/storm 报告用)
function diffJson(a, b, path = '', out = []) {
  if (out.length >= 8) return out
  if (a === b) return out
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    out.push(path + ': ' + JSON.stringify(a) + ' → ' + JSON.stringify(b))
    return out
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) diffJson(a[k], b[k], path + '.' + k, out)
  return out
}
function firstCharDiff(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return { i, a: a.slice(Math.max(0, i - 30), i + 80), b: b.slice(Math.max(0, i - 30), i + 80) }
}

// 往返:返回 [S1, S2]
function roundTrip(code) {
  runSource(code, state)
  const s1 = serializeCode(state)
  runSource(s1, state)
  const s2 = serializeCode(state)
  return [s1, s2]
}

// ============================================================
console.log('\n=== 区 1:默认图 + 确定性样本的不动点与语义守恒 ===')
{
  runSource(DEFAULT_BOOTSTRAP, state)
  const before = sig(state)
  const [s1, s2] = roundTrip(DEFAULT_BOOTSTRAP)
  check('默认图:serialize(run(S1)) === S1', s1 === s2)
  check('默认图:一次往返语义守恒', before === sig(state))
  check('默认图:无派生层泄漏(__instId/traces)', !s1.includes('__instId') && !s1.includes('traces'))
}

const SAMPLE_REFS = `class Hub {
  description = "中心"
  attrs = { load: 0 }
}
class Node {
  description = "节点"
  attrs = { x: 1, ref: null, pool: null, nest: null }
}
const Hub_1 = GraphStarter.add(Hub, 'Hub_1')
const Node_1 = GraphStarter.add(Node, 'Node_1')
const Node_2 = GraphStarter.add(Node, 'Node_2')
Node_1.ref = Hub_1
Node_1.pool = [Hub_1, Hub_1, { deep: { leaf: Hub_1 } }]
Node_1.nest = { a: { b: [Hub_1] } }
Node_2.ref = Node_1
Hub_1.back = Node_2
Node_1.edges = [
  { target: Hub_1, description: '显式依赖', transform: "target['load'] = source['x']" },
  { target: Node_2, description: "quote' desc", transform: "target['x'] = source['x'] + 1" }
]
Node_2.edges = [{ target: Node_1 }]`

{
  runSource(SAMPLE_REFS, state)
  const before = sig(state)
  const [s1, s2] = roundTrip(SAMPLE_REFS)
  check('引用/容器/环:固定点稳定', s1 === s2)
  check('引用/容器/环:语义守恒', before === sig(state))
  check('引用双向环重载后仍是 attrs 身份',
    state.runtimeInstances.find(i => i.varName === 'Hub_1').attrs.back.__instId.varName === 'Node_2')
  check('transform 字符串含引号经历重载不坏',
    deriveEdges(state).some(e => e.transform === "target['load'] = source['x']"))
}

// ============================================================
console.log('\n=== 区 2:有种子 fuzz(随机图:不动点 + 语义守恒 + 派生稳定)===')
{
  const rng = mulberry32(20260919)
  const KEYS = ['速度', 'count', 'flag', 'a-b', 'has space', "quo'te", 'back\\slash', 'a\nb', '0', '🔑']
  const NAMES = ['alice', 'bob', "it's", '值', 'x\nY']

  function genScalar() {
    switch (Math.floor(rng() * 9)) {
      case 0: return Math.floor(rng() * 100)
      case 1: return Math.round(rng() * 1000) / 100
      case 2: return -Math.floor(rng() * 50)
      case 3: return pick(rng, NAMES)
      case 4: return '中文/emoji 🚀 ' + Math.floor(rng() * 10)
      case 5: return 'line1\nline2\rline3'
      case 6: return rng() < 0.5
      case 7: return null
      case 8: return '\u2028\u2029'
    }
  }
  function genNested() {
    if (rng() < 0.5) return [genScalar(), genScalar()]
    return { [pick(rng, KEYS)]: genScalar(), inner: [genScalar()] }
  }
  // 启动段值:可含实例引用(裸 varName 标识符),容器内可嵌套引用
  function genCodeVal(insts, depth) {
    const r = rng()
    if (r < 0.22) return pick(rng, insts)  // 裸引用
    if (r < 0.5 || depth >= 2) return lit(rng() < 0.7 ? genScalar() : genNested())
    if (r < 0.75) {
      const n = Math.floor(rng() * 3)
      const items = []
      for (let i = 0; i < n; i++) items.push(genCodeVal(insts, depth + 1))
      return '[' + items.join(', ') + ']'
    }
    const n = Math.floor(rng() * 3)
    const pairs = []
    for (let i = 0; i < n; i++) pairs.push(lit(pick(rng, KEYS)) + ': ' + genCodeVal(insts, depth + 1))
    return '{ ' + pairs.join(', ') + ' }'
  }

  function genGraph() {
    const nc = 1 + Math.floor(rng() * 3)
    const classDefs = []
    for (let ci = 0; ci < nc; ci++) {
      const keys = [...KEYS].sort(() => rng() - 0.5).slice(0, Math.floor(rng() * 4))
      classDefs.push({ name: 'K' + ci, attrs: keys.map(k => [k, rng() < 0.5 ? genScalar() : genNested()]) })
    }
    const ni = 2 + Math.floor(rng() * 4)
    const insts = []
    for (let i = 0; i < ni; i++) insts.push({ name: 'N' + i, cls: pick(rng, classDefs).name })
    const names = insts.map(i => i.name)

    let code = ''
    for (const c of classDefs) {
      code += 'class ' + c.name + ' {\n'
      code += '  description = ' + lit('类' + c.name) + '\n'
      code += '  name = ' + lit(c.name) + '\n'
      code += '  attrs = {\n'
      for (const [k, v] of c.attrs) code += '    ' + lit(k) + ': ' + lit(v) + ',\n'
      code += '  }\n}\n\n'
    }
    for (const i of insts) code += 'const ' + i.name + ' = GraphStarter.add(' + i.cls + ', ' + lit(i.name) + ')\n'
    for (const i of insts) {
      const ne = Math.floor(rng() * 3)
      if (!ne) continue
      const items = []
      for (let e = 0; e < ne; e++) {
        const fields = ['target: ' + pick(rng, names)]
        if (rng() < 0.6) fields.push('description: ' + lit(pick(rng, NAMES)))
        if (rng() < 0.4) {
          const srcKey = pick(rng, KEYS), tgtKey = pick(rng, KEYS)
          fields.push('transform: ' + lit(
            pick(rng, [
              "target[" + lit(tgtKey) + "] = source[" + lit(srcKey) + "] + 1",
              "if (source[" + lit(srcKey) + "] > 0) { target[" + lit(tgtKey) + "] = 1 }",
              "target[" + lit(tgtKey) + "] = 'it\\'s ok'\nsource[" + lit(srcKey) + "] = 0",
            ])
          ))
        }
        items.push('    { ' + fields.join(', ') + ' }')
      }
      code += i.name + '.edges = [\n' + items.join(',\n') + '\n]\n'
    }
    for (const i of insts) {
      const no = Math.floor(rng() * 4)
      for (let o = 0; o < no; o++) {
        const key = pick(rng, KEYS)
        const isIdent = /^[$_\p{L}][$_\p{L}\d]*$/u.test(key)
        code += i.name + (isIdent ? '.' + key : '[' + lit(key) + ']') + ' = ' + genCodeVal(names, 0) + '\n'
      }
    }
    return code
  }

  const N = 80
  let runFail = null, fixFail = null, semFail = null, leakFail = null, probeFail = null, edgeFail = null
  for (let i = 0; i < N && !(runFail && fixFail && semFail && leakFail && probeFail && edgeFail); i++) {
    const code = genGraph()
    let ok = true
    runSource(code, state)
    const before = sig(state)
    const pBefore = probeSig()
    const eBefore = deriveEdges(state).length
    let s1, s2
    try {
      s1 = serializeCode(state)
      runSource(s1, state)
      s2 = serializeCode(state)
    } catch (e) { runFail = runFail || { i, msg: e.message, code: code.slice(0, 300) }; ok = false }
    if (!ok) continue
    if (s1 !== s2) fixFail = fixFail || { i, s1: s1.slice(0, 300), s2: s2.slice(0, 300) }
    if (before !== sig(state)) semFail = semFail || { i, code: code.slice(0, 300) }
    if (s1.includes('__instId') || s1.includes('traces')) leakFail = leakFail || { i }
    if (pBefore !== probeSig()) probeFail = probeFail || { i, before: pBefore }
    if (eBefore !== deriveEdges(state).length) edgeFail = edgeFail || { i, before: eBefore, after: deriveEdges(state).length }
  }
  check(N + ' 个随机图:全部执行成功', !runFail, runFail)
  check(N + ' 个随机图:serialize(run(S1)) === S1', !fixFail, fixFail)
  check(N + ' 个随机图:一次往返语义守恒(含引用/容器/Unicode/转义)', !semFail, semFail)
  check(N + ' 个随机图:无派生层泄漏', !leakFail, leakFail)
  check(N + ' 个随机图:探测边跨重载稳定', !probeFail, probeFail)
  check(N + ' 个随机图:声明边数跨重载稳定', !edgeFail, edgeFail)
}

// ============================================================
console.log('\n=== 区 3:编辑风暴(模拟 UI 反复改运行时 → 序列化 → 重载)===')
{
  const rng = mulberry32(424242)
  const STORMS = 4, OPS = 40
  const NEW_KEYS = ['新键', 'tmp', 'v2', 'a\nb']
  const STRS = ['数据', "quo'te", 'back\\slash', '多行\n第二行', 'emoji 🎯', '\r回车']

  function applyRandomEdit() {
    const insts = state.runtimeInstances
    if (insts.length < 2) return
    const inst = pick(rng, insts)
    const op = Math.floor(rng() * 10)
    // 镜像 UI 编辑路径:live attrs 与作者态快照同步写穿(ADR-007 不变量 27)
    if (op === 0) {
      const k = pick(rng, NEW_KEYS), v = Math.floor(rng() * 100)
      inst.attrs[k] = v; setAuthorAttr(state, inst, k, v)
    } else if (op === 1) {
      const k = pick(rng, NEW_KEYS), v = pick(rng, STRS)
      inst.attrs[k] = v; setAuthorAttr(state, inst, k, v)
    } else if (op === 2) {
      const k = pick(rng, NEW_KEYS), v = pick(rng, insts).attrs
      inst.attrs[k] = v; setAuthorAttr(state, inst, k, v)
    } else if (op === 3) {
      const k = pick(rng, NEW_KEYS)
      const v = [pick(rng, insts).attrs, { x: pick(rng, insts).attrs, y: 1 }]
      inst.attrs[k] = v; setAuthorAttr(state, inst, k, v)
    } else if (op === 4) {
      // 镜像 panel.deleteProperty 实例模式:class 默认键 = 重置回默认;额外键 = 真删除
      const ks = Object.keys(inst.attrs).filter(k => k !== 'edges' && !k.startsWith('__'))
      if (ks.length) {
        const key = pick(rng, ks)
        const clsAttrs = (state.classes[inst.className] || {}).attrs || {}
        if (key in clsAttrs) {
          const dv = clsAttrs[key]
          inst.attrs[key] = (dv !== null && typeof dv === 'object') ? JSON.parse(JSON.stringify(dv)) : dv
          setAuthorAttr(state, inst, key, inst.attrs[key])
        } else {
          delete inst.attrs[key]
          deleteAuthorAttr(state, inst, key)
        }
      }
    } else if (op === 5) {
      if (!Array.isArray(inst.attrs.edges)) inst.attrs.edges = []
      const e = { target: pick(rng, insts).attrs }
      if (rng() < 0.5) e.description = pick(rng, STRS)
      if (rng() < 0.4) e.transform = "target['v'] = (source['v'] || 0) + 1"
      inst.attrs.edges.push(e)
      markEdgesEdited(state, inst)
    } else if (op === 6) {
      if (Array.isArray(inst.attrs.edges) && inst.attrs.edges.length) {
        inst.attrs.edges.splice(Math.floor(rng() * inst.attrs.edges.length), 1)
        markEdgesEdited(state, inst)
      }
    } else if (op === 7) {
      if (Array.isArray(inst.attrs.edges) && inst.attrs.edges.length) {
        const e = pick(rng, inst.attrs.edges)
        if (e) { e.target = pick(rng, insts).attrs; markEdgesEdited(state, inst) }
      }
    } else if (op === 8) {
      if (Array.isArray(inst.attrs.edges) && inst.attrs.edges.length) {
        const e = pick(rng, inst.attrs.edges)
        if (e) { e.description = pick(rng, STRS); markEdgesEdited(state, inst) }
      }
    } else {
      if (insts.length > 2) insts.splice(insts.indexOf(inst), 1)  // 制造悬空引用
    }
  }

  let mismatch = null, fixMismatch = null, crashed = null, classifyBad = null
  let ops = 0
  for (let s = 0; s < STORMS && !(mismatch && fixMismatch && crashed); s++) {
    // 用一个确定性基础图(复用 fuzz 风格:手写小而全)
    runSource(SAMPLE_REFS, state)
    for (let op = 0; op < OPS; op++) {
      applyRandomEdit()
      invalidateEdges()
      // 不跑 runTransforms:ADR-007 起 transform 结果是演化值,本就不该跨重载守恒
      // (其"不固化"性质由区 4.13 单独验证);storm 比对的 before 即作者态语义
      const before = sig(state)
      let code
      try {
        code = serializeCode(state)
        if (classifySource(code) !== 'declarative' && !classifyBad) {
          classifyBad = { s, op, code: code.slice(0, 200) }
        }
        runSource(code, state)
      } catch (e) { crashed = crashed || { s, op, msg: e.message, code: code && code.slice(0, 300) }; break }
      const after = sig(state)
      ops++
      if (before !== after && !mismatch) {
        mismatch = { s, op, diff: diffJson(JSON.parse(before), JSON.parse(after)), code: code.slice(0, 200) }
      }
      const again = serializeCode(state)
      if (again !== code && !fixMismatch) fixMismatch = { s, op, diff: firstCharDiff(code, again) }
    }
  }
  check('编辑风暴 ' + ops + ' 次操作:无异常', !crashed, crashed)
  check('编辑风暴 ' + ops + ' 次操作:往返语义守恒', !mismatch, mismatch)
  check('编辑风暴 ' + ops + ' 次操作:二次序列化零漂移', !fixMismatch, fixMismatch)
  check('编辑风暴 ' + ops + ' 次操作:序列化产物必为 declarative', !classifyBad, classifyBad)
}

// ============================================================
console.log('\n=== 区 4:边界与已知行为钉子 ===')
{
  // 4.1 CR / U+2028 字符串
  runSource("class C { attrs = { s: '' } }\nconst C_1 = GraphStarter.add(C, 'C_1')\nC_1.s = 'a\\rb\\u2028c\\u2029d'", state)
  try {
    const code = serializeCode(state)
    runSource(code, state)
    const v = state.runtimeInstances[0].attrs.s
    check('CR/U+2028/U+2029 字符串往返保真', v === 'a\rb\u2028c\u2029d', JSON.stringify(v))
  } catch (e) { check('CR/U+2028/U+2029 字符串往返保真', false, e.message) }

  // 4.2 换行 attr key
  runSource("class C { attrs = { s: 1 } }\nconst C_1 = GraphStarter.add(C, 'C_1')\nC_1['a\\nb'] = 2", state)
  try {
    const code = serializeCode(state)
    runSource(code, state)
    check('换行 attr key 往返保真', state.runtimeInstances[0].attrs['a\nb'] === 2)
  } catch (e) { check('换行 attr key 往返保真', false, e.message) }

  // 4.3 非法 explicitName 必须显式报错(序列化会长出 const a b → 断链)
  let nameThrew = false, nameMsg = ''
  try {
    runSource("class C { attrs = { v: 1 } }\nconst X = GraphStarter.add(C, 'a b')", state)
  } catch (e) { nameThrew = true; nameMsg = e.message }
  check('非法 explicitName 显式报错(不静默产出坏代码)', nameThrew && /标识符/.test(nameMsg), nameMsg)

  // 4.4 容器内普通对象环 → 重复引用点降级 null(已文档化)
  runSource("class C { attrs = { o: null } }\nconst C_1 = GraphStarter.add(C, 'C_1')\nconst cyc = {}\ncyc.self = cyc\nC_1.o = cyc", state)
  {
    const code = serializeCode(state)
    runSource(code, state)
    const v = state.runtimeInstances[0].attrs.o
    check('普通对象环在重复引用点降级 null(文档化行为)', v && v.self === null, v)
  }

  // 4.5 悬空边 target → null,重载不炸
  runSource(SAMPLE_REFS, state)
  state.runtimeInstances.splice(state.runtimeInstances.findIndex(i => i.varName === 'Hub_1'), 1)
  invalidateEdges()
  {
    const code = serializeCode(state)
    runSource(code, state)
    const n1 = state.runtimeInstances.find(i => i.varName === 'Node_1')
    const n2 = state.runtimeInstances.find(i => i.varName === 'Node_2')
    check('悬空边 target 降级 null,重载成功且边保留',
      code.includes('target: null') && n1.attrs.edges.length === 2 && n1.attrs.edges[0].target === null && n2.attrs.edges.length === 1,
      { hasNull: code.includes('target: null'), n1: n1.attrs.edges, n2: n2.attrs.edges })
  }

  // 4.6 同对重复边保留
  const REPEAT_SAMPLE = "class A { attrs = { v: 0 } }\nclass B { attrs = { v: 0 } }\nconst A_1 = GraphStarter.add(A, 'A_1')\nconst B_1 = GraphStarter.add(B, 'B_1')\nA_1.edges = [{ target: B_1 }, { target: B_1 }]"
  runSource(REPEAT_SAMPLE, state)
  {
    const [s1, s2] = roundTrip(REPEAT_SAMPLE)
    check('同对重复边固定点稳定', s1 === s2)
    runSource(s1, state)
    check('同对重复边数量保留(2 条)', state.runtimeInstances.find(i => i.varName === 'A_1').attrs.edges.length === 2)
  }

  // 4.7 空图
  {
    const [s1, s2] = roundTrip('')
    check('空图:serialize 空串且固定点稳定', s1 === '' && s2 === '')
  }

  // 4.8 NaN/Infinity 运行时值往返;class 默认 Infinity 走 JSON 克隆降级 null
  runSource("class C { attrs = { n: 0, inf: Infinity } }\nconst C_1 = GraphStarter.add(C, 'C_1')\nC_1.n = NaN", state)
  {
    check('class 默认 Infinity 经 JSON 克隆降级 null(文档化行为)', state.runtimeInstances[0].attrs.inf === null)
    const code = serializeCode(state)
    runSource(code, state)
    check('运行时 NaN 往返保真', Number.isNaN(state.runtimeInstances[0].attrs.n))
  }

  // 4.9 -0 降级 0(文档化)
  runSource("class C { attrs = { n: 1 } }\nconst C_1 = GraphStarter.add(C, 'C_1')\nC_1.n = -0", state)
  {
    const code = serializeCode(state)
    check('-0 序列化为 0(已知降级)', !code.includes('-0'))
  }

  // 4.10 UI 模式序列化丢弃方法体(Code 模式职责,importSource 有警告)
  runSource("class C {\n  attrs = { n: 0 }\n  tick() { this.n = this.n + 1 }\n}\nconst C_1 = GraphStarter.add(C, 'C_1')", state)
  {
    const code = serializeCode(state)
    check('UI 序列化不保留方法体(ADR-002 职责划分,已知)', !code.includes('tick()'))
  }

  // 4.11 编辑快照层(ADR-007):演化值不固化;被编辑键固化;重载恢复作者态
  runSource("class C {\n  attrs = { n: 0, label: 'x' }\n  tick() { this.n = this.n + 1 }\n}\nconst C_1 = GraphStarter.add(C, 'C_1')", state)
  {
    stepAll(); stepAll(); stepAll()
    const inst = state.runtimeInstances[0]
    inst.attrs.label = 'edited'                 // 模拟一次 panel 编辑
    setAuthorAttr(state, inst, 'label', 'edited')  // ADR-007 写穿
    const code = serializeCode(state)
    check('步进演化值不固化(n = 3 不在代码)', !/\.n\s*=\s*3/.test(code), code.split('\n').filter(l => l.includes('.n')).join('|'))
    check('被编辑键固化(label = edited)', /C_1\.label\s*=\s*'edited'/.test(code), code.split('\n').filter(l => l.includes('label')).join('|'))
    runSource(code, state)
    check('重载即作者态(n 回 0,label 保留)',
      state.runtimeInstances[0].attrs.n === 0 && state.runtimeInstances[0].attrs.label === 'edited',
      state.runtimeInstances[0].attrs)
  }

  // 4.13 transform 结果不固化(演化值,重载后回到作者态)
  runSource("class S { attrs = { v: 1 } }\nclass T { attrs = { v: 0 } }\nconst S_1 = GraphStarter.add(S, 'S_1')\nconst T_1 = GraphStarter.add(T, 'T_1')\nS_1.edges = [{ target: T_1, transform: \"target['v'] = source['v'] + 1\" }]", state)
  {
    runTransforms()
    const liveV = state.runtimeInstances.find(i => i.varName === 'T_1').attrs.v
    const code = serializeCode(state)
    check('transform 执行生效(live v = 2)', liveV === 2, liveV)
    check('transform 结果不固化(T_1.v 不在代码)', !/T_1\.v\s*=/.test(code), code.split('\n').filter(l => l.includes('T_1.')).join('|'))
    runSource(code, state)
    check('重载后 T_1.v 回到作者态 0', state.runtimeInstances.find(i => i.varName === 'T_1').attrs.v === 0)
  }

  // 4.14 方法体原地改写嵌套对象 → 也不固化(证明快照是深拷贝)
  runSource("class N {\n  attrs = { o: { x: 0 } }\n  tick() { this.o.x = this.o.x + 1 }\n}\nconst N_1 = GraphStarter.add(N, 'N_1')", state)
  {
    stepAll()
    const liveX = state.runtimeInstances[0].attrs.o.x
    const code = serializeCode(state)
    check('方法体原地改写生效(live x = 1)', liveX === 1, liveX)
    check('嵌套对象演化不固化(x: 1 不在代码)', !/x:\s*1/.test(code), code.split('\n').filter(l => l.includes('x:')).join('|'))
  }

  // 4.12 删除语义(panel.deleteProperty 实例模式模型不变量):
  // 默认键"重置回默认"→ 不再输出 override 且跨重载稳定;额外键真删除不复活
  runSource("class C { attrs = { v: 5, o: { a: 1 } } }\nconst C_1 = GraphStarter.add(C, 'C_1')\nC_1.extra = 1", state)
  {
    const inst = state.runtimeInstances[0]
    inst.attrs.v = 9
    setAuthorAttr(state, inst, 'v', 9)  // ADR-007 写穿
    const code1 = serializeCode(state)
    check('override 值输出', code1.includes('C_1.v = 9'), code1.split('\n').filter(l => l.includes('.v =')))
    runSource(code1, state)
    state.runtimeInstances[0].attrs.v = 5  // panel 删默认键 = 重置回默认
    setAuthorAttr(state, state.runtimeInstances[0], 'v', 5)
    delete state.runtimeInstances[0].attrs.extra
    deleteAuthorAttr(state, state.runtimeInstances[0], 'extra')
    const code2 = serializeCode(state)
    check('重置默认键后不再输出 override', !code2.includes('C_1.v = '), code2.split('\n').filter(l => l.includes('.v =')))
    const [s1, s2] = roundTrip(code2)
    check('删除语义:固定点稳定', s1 === s2)
    runSource(s1, state)
    check('额外键删除后不复活', !('extra' in state.runtimeInstances[0].attrs))
  }
}

// ============================================================
console.log('\n=== 区 5:URL/分享 hash 往返 ===')
{
  const rng = mulberry32(7)
  let b64Fail = null
  for (let i = 0; i < 200; i++) {
    let s = ''
    const n = Math.floor(rng() * 40)
    for (let j = 0; j < n; j++) s += String.fromCodePoint(0x20 + Math.floor(rng() * 0x1000), 0x1F300 + Math.floor(rng() * 100), '中'.codePointAt(0))
    if (fromB64(toB64(s)) !== s) { b64Fail = { i, s }; break }
  }
  check('base64 hash 编解码 200 组随机 Unicode 字符串无损', !b64Fail, b64Fail)

  runSource(SAMPLE_REFS, state)
  const payload = JSON.stringify({
    version: 6,
    sourceCode: serializeCode(state),
    visualState: { positions: {}, colors: {} },
    graphId: 'g_test',
    title: '骨架验证',
  })
  const hash = toB64(payload)
  const back = JSON.parse(fromB64(hash))
  const [s1, s2] = roundTrip(back.sourceCode)
  check('URL 载荷往返:sourceCode 编码解码无损', back.sourceCode === JSON.parse(payload).sourceCode)
  check('URL 载荷往返:重载固定点稳定', s1 === s2)
  check('URL 载荷:24000 字符预算内(' + hash.length + ')', hash.length < 24000, hash.length)
}

// ============================================================
console.log('\n=== 区 6:性能冒烟(大图 + 全套派生不退化)===')
{
  const N = 150
  let code = 'class P {\n  description = "节点"\n  attrs = { v: 0, r: null }\n}\n'
  for (let i = 0; i < N; i++) code += 'const P_' + i + " = GraphStarter.add(P, 'P_" + i + "')\n"
  for (let i = 0; i < N; i++) {
    const lines = []
    for (let k = 0; k < 2; k++) lines.push('    { target: P_' + ((i + k + 1) % N) + ", description: 'e', transform: \"target['v'] = source['v'] + 1\" }")
    code += 'P_' + i + '.edges = [\n' + lines.join(',\n') + '\n]\n'
  }
  const t0 = Date.now()
  let outSize = 0, probeCount = 0, edgeCount = 0
  for (let i = 0; i < 10; i++) {
    runSource(code, state)
    outSize = serializeCode(state).length
    edgeCount = deriveEdges(state).length
    probeCount = deriveProbeEdges(state).length
  }
  const ms = Date.now() - t0
  check('150 节点/300 边 × 10 轮 run+serialize+derive 在预算内(' + ms + 'ms)', ms < 8000, ms)
  check('派生数量正确(边 300)', edgeCount === 300, edgeCount)
  check('派生数量正确(探测边 0:无隐式引用)', probeCount === 0, probeCount)
  console.log('  ℹ️ 单轮约 ' + Math.round(ms / 10) + 'ms,序列化产物 ' + outSize + ' 字符')
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
