import { state, config, NODE_MIN_W, NODE_MAX_W, NODE_PAD, PORT_R, PORT_HIT, EDGE_HIT, isDark } from './state.js'
import { deriveEdges } from './codegraph.js'

// minimal 模式 → 圆形几何；medium/full → 圆角矩形
function isCircleMode() {
  return config.infoLevel === 'minimal'
}

// 把任意属性值格式化为画布上的简短字符串（消除 [object Object]、数字超长）
export function formatScalar(v) {
  if (v === null) return 'null'
  if (v === undefined) return ''
  if (typeof v === 'number') {
    if (!isFinite(v)) return v > 0 ? '∞' : '-∞'
    const abs = Math.abs(v)
    if (abs !== 0 && (abs >= 1e7 || abs < 1e-4)) return v.toExponential(2)
    if (!Number.isInteger(v)) return v.toFixed(2)
    if (abs >= 1e12) return v.toExponential(2)
    return String(v)
  }
  if (typeof v === 'function') return 'ƒ'
  if (Array.isArray(v)) return '[' + v.length + ']'
  if (typeof v === 'object') {
    const keys = Object.keys(v)
    return keys.length ? '{…}' : '{}'
  }
  return String(v)
}

let _measureCtx = null
function measureCtx() {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d')
  return _measureCtx
}
function measureText(text, font) {
  const ctx = measureCtx()
  ctx.font = font
  return ctx.measureText(text == null ? '' : text).width
}

// minimal 圆形半径：文字宽度自适应 + 连接边数微调，下限 22
export function getNodeRadius(n) {
  const label = n.label || ''
  const w = measureText(label, '14px "Microsoft YaHei",sans-serif')
  const base = Math.max(22, w / 2 + 8)
  let ec = 0
  for (const e of deriveEdges(state)) {
    if (e.source_node === n.varName || e.target_node === n.varName) ec++
  }
  return Math.min(55, base + ec * 2)
}

export function getNodeH(n, estW) {
  if (isCircleMode()) {
    return getNodeRadius(n) * 2
  }
  const pk = Object.keys(n.properties)
  const maxRows = config.infoLevel === 'full' ? 6 : 4
  const shown = Math.min(pk.length, maxRows)
  const overflowRow = pk.length > maxRows ? 1 : 0
  let h = 36
  if (config.infoLevel === 'full') h += 17
  h += shown * 17
  h += overflowRow * 17
  if (config.infoLevel === 'full') {
    if (n.description) h += 17
  }
  return h + 12
}

export function getNodeRect(n) {
  if (isCircleMode()) {
    const r = getNodeRadius(n)
    return { x: n.x - r, y: n.y - r, w: r * 2, h: r * 2 }
  }
  const label = n.label || ''
  let cw = measureText(label, 'bold 13px "Microsoft YaHei",sans-serif')
  if (config.infoLevel === 'full') {
    const subW = measureText(n.varName, '11px "Microsoft YaHei",sans-serif')
    if (subW > cw) cw = subW
  }
  const pk = Object.keys(n.properties)
  const maxRows = config.infoLevel === 'full' ? 6 : 4
  for (const k of pk.slice(0, maxRows)) {
    const v = formatScalar(n.properties[k])
    const rowW = measureText(k + '  ' + v, '11px "Microsoft YaHei",sans-serif')
    if (rowW > cw) cw = rowW
  }
  if (config.infoLevel === 'full') {
    if (n.description) {
      const descW = measureText(n.description, '11px "Microsoft YaHei",sans-serif')
      if (descW > cw) cw = descW
    }
  }
  const dpr = window.devicePixelRatio || 1
  const canvas = document.getElementById('canvas')
  const viewportW = canvas ? (canvas.width / dpr / state.viewScale) : 800
  const maxW = Math.min(viewportW * 0.4, 600)
  const w = Math.max(NODE_MIN_W, Math.min(maxW, cw + NODE_PAD * 2))
  const h = getNodeH(n, w)
  return { x: n.x - w / 2, y: n.y - h / 2, w, h }
}
export function rectEdge(r,tx,ty){
  const cx=r.x+r.w/2,cy=r.y+r.h/2,dx=tx-cx,dy=ty-cy
  if(dx===0&&dy===0)return{x:cx,y:cy}
  if(config.infoLevel==='minimal'){
    const rad=Math.max(r.w,r.h)/2,ang=Math.atan2(dy,dx)
    return{x:cx+rad*Math.cos(ang),y:cy+rad*Math.sin(ang)}
  }
  const adx=Math.abs(dx),ady=Math.abs(dy)
  let sc=1
  if(adx*r.h>ady*r.w)sc=r.w/2/adx;else sc=r.h/2/ady
  return{x:cx+dx*sc,y:cy+dy*sc}
}
// 端口系统：算法层端口（不入 attrs，仅作布线辅助）
// 给定节点 n + 方向 dir，返回 Map<edgeId, {x, y}>
// minimal 不画端口（圆周即端口），返回空 Map
//
// curve 模式：主方向选侧（|dx|>=|dy| 走左右、|dx|<|dy| 走上下）+ 整侧统一等分
//   - source/target 按相对位置面对面对齐（出右入左 / 出左入右 / 出下入上 / 出上入下）
//   - 同侧所有边按对端 y/x 排序后整侧等距排开（不按 target/source 分组）
// 其他模式（straight/polyline）：固定右出左入 + (source,target) 半固定分组（旧规则）
export function computeNodePorts(n, dir) {
  if (config.infoLevel === 'minimal') return new Map()
  const r = getNodeRect(n)
  const edges = deriveEdges(state)
  const related = dir === 'out'
    ? edges.filter(e => e.source_node === n.id)
    : edges.filter(e => e.target_node === n.id)
  if (!related.length) return new Map()

  if (config.edgeStyle === 'curve') {
    return computeNodePortsCurve(n, dir, r)
  }
  return computeNodePortsLegacy(n, dir, r, related)
}

// curve 模式端口：主方向选侧 + 整侧统一等分
// 关键：in 和 out 边在同侧时共享一组等分位置（否则 N 同侧的 in/out 端口可能落到同位置）
// 所以这里**同时**收集 N 的 in + out 边分组等分，再按 dir 过滤返回
function computeNodePortsCurve(n, dir, r) {
  const allEdges = deriveEdges(state)
  const bySide = { right: [], left: [], top: [], bottom: [] }
  for (const e of allEdges) {
    if (e.source_node !== n.id && e.target_node !== n.id) continue
    const isOut = e.source_node === n.id
    const o = state.nodes.find(x => x.id === (isOut ? e.target_node : e.source_node))
    if (!o) continue
    const dx = o.x - n.x, dy = o.y - n.y
    let side
    if (Math.abs(dx) >= Math.abs(dy)) side = dx >= 0 ? 'right' : 'left'
    else side = dy >= 0 ? 'bottom' : 'top'
    bySide[side].push({ edge: e, dir: isOut ? 'out' : 'in', otherY: o.y, otherX: o.x })
  }
  const portsOut = new Map(), portsIn = new Map()
  for (const side of ['right', 'left', 'top', 'bottom']) {
    const group = bySide[side]
    if (!group.length) continue
    const isHorz = side === 'right' || side === 'left'
    // 排序：水平侧按对端 y、垂直侧按对端 x，让端口顺序与对端位置一致
    group.sort((a, b) => isHorz ? a.otherY - b.otherY : a.otherX - b.otherX)
    const total = group.length
    group.forEach((item, idx) => {
      const t = (idx + 1) / (total + 1)  // 0 < t < 1，整侧等分
      let x, y
      if (side === 'right') { x = r.x + r.w; y = r.y + r.h * t }
      else if (side === 'left') { x = r.x; y = r.y + r.h * t }
      else if (side === 'top') { x = r.x + r.w * t; y = r.y }
      else { x = r.x + r.w * t; y = r.y + r.h }
      const port = { x, y }
      ;(item.dir === 'out' ? portsOut : portsIn).set(item.edge.id, port)
    })
  }
  return dir === 'out' ? portsOut : portsIn
}

// 旧规则（straight/polyline）：右出左入 + (source,target) 半固定分组
function computeNodePortsLegacy(n, dir, r, related) {
  const groupMap = new Map()
  for (const e of related) {
    const key = dir === 'out' ? e.target_node : e.source_node
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key).push(e)
  }
  const groups = Array.from(groupMap.values())
  const segmentH = r.h / (groups.length + 1)
  const ports = new Map()
  groups.forEach((groupEdges, gi) => {
    const groupY = r.y + segmentH * (gi + 1)
    const total = groupEdges.length
    groupEdges.forEach((e, idxInGroup) => {
      const off = total > 1 ? (idxInGroup - (total - 1) / 2) * 6 : 0
      const y = groupY + off
      const x = dir === 'out' ? r.x + r.w : r.x
      ports.set(e.id, { x, y })
    })
  })
  return ports
}
// 给定节点、边、方向，返回该边的端口位置
export function getPortPos(n, edge, dir) {
  if (config.infoLevel === 'minimal') return null
  return computeNodePorts(n, dir).get(edge.id) || null
}
// v0.10: 边的端点
// - 矩形（medium/full）：算法层端口（半固定 (target/source) 分组），多边同对天然并行
// - 圆形（minimal）：沿两圆心连线，trimmed at perimeters（圆周交点）
//   p1 = src + r·单位向量(tgt-src)，p2 = tgt - r·单位向量(tgt-src)
//   这样箭头落在目标圆周上，永远可见；边沿径向出入，自然垂直于圆周
export function edgePts(src,tgt,e){
  if(config.infoLevel==='minimal'){
    const sr=getNodeRect(src),tr=getNodeRect(tgt)
    const sR=Math.max(sr.w,sr.h)/2,tR=Math.max(tr.w,tr.h)/2
    const dx=tgt.x-src.x,dy=tgt.y-src.y
    const d=Math.hypot(dx,dy)||1
    const ux=dx/d,uy=dy/d
    return{p1:{x:src.x+sR*ux,y:src.y+sR*uy},p2:{x:tgt.x-tR*ux,y:tgt.y-tR*uy}}
  }
  const p1=getPortPos(src,e,'out'),p2=getPortPos(tgt,e,'in')
  if(p1&&p2)return{p1,p2}
  // fallback（理论不会走到，防御性）
  const sr=getNodeRect(src),tr=getNodeRect(tgt)
  return{p1:{x:sr.x+sr.w,y:sr.y+sr.h/2},p2:{x:tr.x,y:tr.y+tr.h/2}}
}
// 拖柄位置：选中节点的 4 个边缘中点（上/右/下/左）
export function getHandlePoints(n){
  const r=getNodeRect(n)
  if(config.infoLevel==='minimal'){
    const rad=Math.max(r.w,r.h)/2
    return[
      {x:n.x,y:n.y-rad},
      {x:n.x+rad,y:n.y},
      {x:n.x,y:n.y+rad},
      {x:n.x-rad,y:n.y},
    ]
  }
  return[
    {x:r.x+r.w/2,y:r.y},
    {x:r.x+r.w,y:r.y+r.h/2},
    {x:r.x+r.w/2,y:r.y+r.h},
    {x:r.x,y:r.y+r.h/2},
  ]
}
export function distSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1,l2=dx*dx+dy*dy
  if(l2===0)return Math.hypot(px-x1,py-y1)
  let t=((px-x1)*dx+(py-y1)*dy)/l2;t=Math.max(0,Math.min(1,t))
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy))
}
export function lineHitsRect(x1,y1,x2,y2,r){
  let tMin=0,tMax=1
  const dx=x2-x1,dy=y2-y1
  const edges=[
    {p:-dx,q:x1-r.x},
    {p:dx,q:r.x+r.w-x1},
    {p:-dy,q:y1-r.y},
    {p:dy,q:r.y+r.h-y1}
  ]
  for(const{p,q}of edges){
    if(p===0){if(q<0)return false}
    else{const t=q/p;if(p<0)tMin=Math.max(tMin,t);else tMax=Math.min(tMax,t)}
  }
  return tMin<=tMax&&tMin<=1&&tMax>=0
}
// curve 单段 cubic 几何：给定端点 P1/P2 算控制点 cp1/cp2，统一供 renderer 和 hitEdge 使用
// 设计：
//   - 单段 cubic（不分前向/反向），端点切线由主方向决定（水平占优→水平切线、垂直占优→垂直切线）
//   - 控制点距离 tCtrl = clamp(dist * 0.4, 30, 120)，让曲率整体相近（短边曲率大、长边曲率小，视觉弯度比例一致）
//   - **端点切线严格垂直优先于中间避让**：cp 沿外法线方向，不加任何 bulge
//     （数学等价：单段 cubic 严格水平端点切线 ⟺ 中点 y 锁死 = (p1.y+p2.y)/2，无法避让 Y）
//   - 中间遮挡由半透明叠加 + hover 高亮吸收（交互层处理复杂度）
//   - 3+ 节点遮挡 → 返回 degrade:true 由调用方降级 straight（密度爆表时 straight 才是对的）
export function computeCurveGeometry(s, t, p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  const dist = Math.hypot(dx, dy) || 1
  // 最小模式（圆形）：先找最深遮挡，然后实际采样验证两侧 bulge 是否撞到其他节点
  //   - 无遮挡 → 直线（degrade:true）
  //   - 有遮挡 → 先试远离最深障碍的一侧，再试另一侧，采样检测确保有效避让
  //   - 两侧都撞 → 降级直线
  if (config.infoLevel === 'minimal') {
    const nodes = state.nodes
    // 预算所有节点半径（避免采样循环里反复计算）
    const radii = new Map()
    for (const n of nodes) radii.set(n.id, getNodeRadius(n))
    // 找最深遮挡（只考虑投影落在 P1↔P2 之间的节点，排除源/目标背后）
    const l2 = dx * dx + dy * dy
    let deepest = null, maxPen = 0
    for (const n of nodes) {
      if (n.id === s.id || n.id === t.id) continue
      const t_ = ((n.x - p1.x) * dx + (n.y - p1.y) * dy) / l2
      if (t_ <= 0 || t_ >= 1) continue
      const d = Math.abs((n.x - p1.x) * dy - (n.y - p1.y) * dx) / dist
      const margin = radii.get(n.id) + 8
      if (d >= margin) continue
      const pen = margin - d
      if (pen > maxPen) { maxPen = pen; deepest = n }
    }
    if (!deepest) return { degrade: true }
    const off = Math.max(30, Math.min(100, Math.min(dist * 0.5, maxPen * 1.6 + 12)))
    const npx = -dy / dist, npy = dx / dist
    // 对给定 bulge 方向采样 cubic，检测是否碰撞其他节点
    const clear = (dir) => {
      const c1x = p1.x + dx * 0.35 + npx * dir * off
      const c1y = p1.y + dy * 0.35 + npy * dir * off
      const c2x = p2.x - dx * 0.35 + npx * dir * off
      const c2y = p2.y - dy * 0.35 + npy * dir * off
      for (let i = 2; i <= 10; i += 2) {
        const t = i / 10, u = 1 - t
        const bx = u*u*u*p1.x + 3*u*u*t*c1x + 3*u*t*t*c2x + t*t*t*p2.x
        const by = u*u*u*p1.y + 3*u*u*t*c1y + 3*u*t*t*c2y + t*t*t*p2.y
        for (const n of nodes) {
          if (n.id === s.id || n.id === t.id) continue
          if (Math.hypot(bx - n.x, by - n.y) < radii.get(n.id) + 8) return false
        }
      }
      return true
    }
    // 优先试远离最深障碍的一侧
    const away = ((deepest.x - p1.x) * dy - (deepest.y - p1.y) * dx) >= 0 ? -1 : 1
    for (const dir of [away, -away]) {
      if (clear(dir)) {
        return {
          cp1: { x: p1.x + dx * 0.35 + npx * dir * off, y: p1.y + dy * 0.35 + npy * dir * off },
          cp2: { x: p2.x - dx * 0.35 + npx * dir * off, y: p2.y - dy * 0.35 + npy * dir * off },
          degrade: false,
        }
      }
    }
    return { degrade: true }
  }
  const isHorz = Math.abs(dx) >= Math.abs(dy)
  const dirX = isHorz ? (Math.sign(dx) || 1) : 0
  const dirY = isHorz ? 0 : (Math.sign(dy) || 1)
  const tCtrl = Math.max(30, Math.min(120, dist * 0.4))
  // 3+ 节点遮挡降级 straight（不强行避让）
  let hitCount = 0
  for (const n of state.nodes) {
    if (n.id === s.id || n.id === t.id) continue
    if (lineHitsRect(p1.x, p1.y, p2.x, p2.y, getNodeRect(n))) {
      hitCount++
      if (hitCount >= 3) return { degrade: true }
    }
  }
  return {
    cp1: { x: p1.x + dirX * tCtrl, y: p1.y + dirY * tCtrl },
    cp2: { x: p2.x - dirX * tCtrl, y: p2.y - dirY * tCtrl },
    degrade: false,
  }
}

// cubic bezier 采样点到 (px,py) 的最近距离（N 段线性近似 + distSeg）
export function distToCubic(px, py, p1, cp1, cp2, p2, samples = 20) {
  let minD = Infinity
  let prevX = p1.x, prevY = p1.y
  for (let i = 1; i <= samples; i++) {
    const t = i / samples, u = 1 - t
    const x = u * u * u * p1.x + 3 * u * u * t * cp1.x + 3 * u * t * t * cp2.x + t * t * t * p2.x
    const y = u * u * u * p1.y + 3 * u * u * t * cp1.y + 3 * u * t * t * cp2.y + t * t * t * p2.y
    const d = distSeg(px, py, prevX, prevY, x, y)
    if (d < minD) minD = d
    prevX = x; prevY = y
  }
  return minD
}

// v0.10 orthogonal 走线：找中转垂直段的"空通道"x 坐标
// 默认取 P1/P2 中点；如果中点穿过中间节点，推到节点边缘外（gutter=16px）
// 简化版：只处理第一个相交节点（多次相交时退化为 Z 形，可能仍穿过其他节点）
export function findOrthogonalChannel(P1, P2, s, t) {
  let mx = (P1.x + P2.x) / 2
  const yMin = Math.min(P1.y, P2.y), yMax = Math.max(P1.y, P2.y)
  for (const n of state.nodes) {
    if (n.id === s.id || n.id === t.id) continue
    const r = getNodeRect(n)
    if (mx >= r.x && mx <= r.x + r.w && yMax >= r.y && yMin <= r.y + r.h) {
      const left = r.x - 16, right = r.x + r.w + 16
      const mid = (P1.x + P2.x) / 2
      mx = Math.abs(left - mid) < Math.abs(right - mid) ? left : right
      break
    }
  }
  return mx
}
export function screenToWorld(sx,sy){return{x:(sx-state.viewX)/state.viewScale,y:(sy-state.viewY)/state.viewScale}}
export function cCoords(e){const r=document.getElementById('canvas').getBoundingClientRect();return screenToWorld(e.clientX-r.left,e.clientY-r.top)}
export function getEdgeStyle(rel){
  if(isDark){
    switch(rel){
      case'+':return{color:'#66bb6a',sel:'#4caf50'}
      case'-':return{color:'#ef5350',sel:'#e53935'}
      case'=':return{color:'#42a5f5',sel:'#1e88e5'}
      case'?':return{color:'#ffa726',sel:'#ff9800'}
      default:return{color:'#666',sel:'#64b5f6'}
    }
  }
  switch(rel){
    case'+':return{color:'#2e7d32',sel:'#1b5e20'}
    case'-':return{color:'#c62828',sel:'#b71c1c'}
    case'=':return{color:'#1565c0',sel:'#0d47a1'}
    case'?':return{color:'#e65100',sel:'#bf360c'}
    default:return{color:'#9e9e9e',sel:'#1976d2'}
  }
}
export function wrapText(ctx,text,maxW){
  const lines=[];let line=''
  for(const ch of text){
    if(ctx.measureText(line+ch).width>maxW&&line){lines.push(line);line=ch}else line+=ch
  }
  if(line)lines.push(line)
  return lines
}
export function truncateText(ctx,text,maxW){
  if(ctx.measureText(text).width<=maxW)return text
  while(text.length>0&&ctx.measureText(text+'…').width>maxW)text=text.slice(0,-1)
  return text+'…'
}
export function esc(s){if(s===null||s===void 0)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// v0.7 Phase 2: JS 标识符合法性（class 名 + varName 共用）
export function isValidIdentifier(s) {
  return typeof s === 'string' && /^[A-Za-z_$][\w$]*$/.test(s)
}

// v0.7 Phase 2: 给定 base 名，扫 state.runtimeInstances 已用 varName，返回不冲突的 base 或 base_2、base_3...
// 若 base 本身没冲突，直接返回；否则尝试 base_2, base_3, ... 直到找到空位
export function suggestUniqueVarName(base) {
  const used = new Set(state.runtimeInstances.map(i => i.varName))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(base + '_' + n)) n++
  return base + '_' + n
}
export function toB64(str){
  try{return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,(_,p1)=>String.fromCharCode(parseInt(p1,16))))}catch(e){return''}
}
export function fromB64(b64){
  try{return decodeURIComponent(atob(b64).split('').map(c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join(''))}catch(e){return''}
}
export function hitNode(x, y) {
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i], r = getNodeRect(n)
    if (config.infoLevel === 'minimal') { const rad = Math.max(r.w, r.h) / 2; if (Math.hypot(x - n.x, y - n.y) < rad) return n }
    else if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return n
  }
  return null
}

// 拖柄 hit（仅 selNode）：检测选中节点的 4 个边缘中点圆点是否被点中
// 返回命中拖柄时返回 selNode；未命中返回 null
export function hitHandle(x, y) {
  const sel = state.selInstance
  if (!sel) return null
  const handles = getHandlePoints(sel)
  for (const h of handles) {
    if (Math.hypot(x - h.x, y - h.y) < PORT_HIT) return sel
  }
  return null
}
export function hitEdge(x, y) {
  const edges = deriveEdges(state)
  const isCurveMode = config.edgeStyle === 'curve'
  for (let i = edges.length - 1; i >= 0; i--) {
    const e = edges[i], s = state.nodes.find(n => n.id === e.source_node), t = state.nodes.find(n => n.id === e.target_node)
    if (!s || !t) continue
    const { p1, p2 } = edgePts(s, t, e)
    if (isCurveMode) {
      const geo = computeCurveGeometry(s, t, p1, p2)
      if (!geo.degrade) {
        if (distToCubic(x, y, p1, geo.cp1, geo.cp2, p2) < EDGE_HIT) return e
        continue
      }
      // degrade（3+ 遮挡）→ 直线 fallback
    }
    if (distSeg(x, y, p1.x, p1.y, p2.x, p2.y) < EDGE_HIT) return e
  }
  return null
}
// v0.10 端口化：算法层端口的 hit 检测（medium/full）
// minimal 模式无显式端口（圆周即端口），返回 null
export function hitPort(x, y) {
  if (config.infoLevel === 'minimal') return null
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i]
    for (const [edgeId, pos] of computeNodePorts(n, 'out')) {
      if (Math.hypot(x - pos.x, y - pos.y) < PORT_HIT) {
        return { node: n, edgeId, dir: 'out', x: pos.x, y: pos.y }
      }
    }
    for (const [edgeId, pos] of computeNodePorts(n, 'in')) {
      if (Math.hypot(x - pos.x, y - pos.y) < PORT_HIT) {
        return { node: n, edgeId, dir: 'in', x: pos.x, y: pos.y }
      }
    }
  }
  return null
}
export function isEditing(){const t=document.activeElement?.tagName;return t==='INPUT'||t==='TEXTAREA'||t==='SELECT'}

const SNAP_THRESH = 8
export function detectSnap(node, others) {
  const r1 = getNodeRect(node)
  const lines = []
  for (const other of others) {
    if (other.id === node.id) continue
    const r2 = getNodeRect(other)
    // X-axis alignments: center, left, right, my-left→their-right, my-right→their-left
    const xTests = [
      { e1: r1.x + r1.w / 2, e2: r2.x + r2.w / 2 },
      { e1: r1.x, e2: r2.x },
      { e1: r1.x + r1.w, e2: r2.x + r2.w },
      { e1: r1.x, e2: r2.x + r2.w },
      { e1: r1.x + r1.w, e2: r2.x },
    ]
    for (const t of xTests) {
      if (Math.abs(t.e1 - t.e2) < SNAP_THRESH) {
        lines.push({ axis: 'x', pos: t.e2, off: t.e2 - t.e1 })
        break
      }
    }
    // Y-axis alignments: center, top, bottom, my-top→their-bottom, my-bottom→their-top
    const yTests = [
      { e1: r1.y + r1.h / 2, e2: r2.y + r2.h / 2 },
      { e1: r1.y, e2: r2.y },
      { e1: r1.y + r1.h, e2: r2.y + r2.h },
      { e1: r1.y, e2: r2.y + r2.h },
      { e1: r1.y + r1.h, e2: r2.y },
    ]
    for (const t of yTests) {
      if (Math.abs(t.e1 - t.e2) < SNAP_THRESH) {
        lines.push({ axis: 'y', pos: t.e2, off: t.e2 - t.e1 })
        break
      }
    }
  }
  return lines
}

export function isBodyEmpty(body) {
  const stripped = body.replace(/\/\/.*$/gm, '').replace(/\s/g, '')
  return !stripped || stripped === 'returnnull' || stripped === 'returnundefined'
}
