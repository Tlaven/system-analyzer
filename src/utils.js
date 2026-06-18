import { state, config, NODE_MIN_W, NODE_MAX_W, NODE_PAD, PORT_R, PORT_HIT, EDGE_HIT, isDark } from './state.js'
import { deriveEdges } from './io.js'

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

// minimal 圆形半径：文字宽度自适应，封顶 40，下限 22
export function getNodeRadius(n) {
  const label = n.label || ''
  const w = measureText(label, '14px "Microsoft YaHei",sans-serif')
  return Math.min(40, Math.max(22, w / 2 + 8))
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
export function getPortPos(n,pid,dir){
  if(config.infoLevel==='minimal') return null
  const r=getNodeRect(n),arr=dir==='out'?n.outputs:n.inputs,idx=arr.findIndex(p=>p.id===pid)
  if(idx<0)return null
  const y=r.y+r.h*(idx+1)/(arr.length+1)
  if(config.infoLevel==='minimal'){
    const rad=Math.max(r.w,r.h)/2,cy=r.y+r.h/2,dy=y-cy
    if(Math.abs(dy)>=rad)return dir==='out'?{x:r.x+r.w,y}:{x:r.x,y}
    const hdx=Math.sqrt(rad*rad-dy*dy)
    return dir==='out'?{x:r.x+r.w/2+hdx,y}:{x:r.x+r.w/2-hdx,y}
  }
  return dir==='out'?{x:r.x+r.w,y}:{x:r.x,y}
}
// v0.9: 左右水平出线 — 源节点右侧中点出，目标节点左侧中点入（电路图/流程图风格）
// 圆形节点用直径的最右/最左点；矩形节点用 right-mid / left-mid
export function edgePts(src,tgt,e){
  const sr=getNodeRect(src),tr=getNodeRect(tgt)
  if(config.infoLevel==='minimal'){
    const sR=Math.max(sr.w,sr.h)/2,tR=Math.max(tr.w,tr.h)/2
    return{p1:{x:src.x+sR,y:src.y},p2:{x:tgt.x-tR,y:tgt.y}}
  }
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
  const edges = deriveEdges()
  for (let i = edges.length - 1; i >= 0; i--) {
    const e = edges[i], s = state.nodes.find(n => n.id === e.source_node), t = state.nodes.find(n => n.id === e.target_node)
    if (!s || !t) continue
    const { p1, p2 } = edgePts(s, t, e)
    if (distSeg(x, y, p1.x, p1.y, p2.x, p2.y) < EDGE_HIT) return e
  }
  return null
}
export function hitPort(x, y) {
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i]
    for (const p of n.inputs) { const pp = getPortPos(n, p.id, 'in'); if (pp && Math.hypot(x - pp.x, y - pp.y) < PORT_HIT) return { node: n, port: p, dir: 'in', x: pp.x, y: pp.y } }
    for (const p of n.outputs) { const pp = getPortPos(n, p.id, 'out'); if (pp && Math.hypot(x - pp.x, y - pp.y) < PORT_HIT) return { node: n, port: p, dir: 'out', x: pp.x, y: pp.y } }
  }
  if (!state.selNode) return null
  const sr = getNodeRect(state.selNode)
  if (!state.selNode.inputs.length && !state.selNode.outputs.length) {
    for (const p of [{ x: sr.x + sr.w / 2, y: sr.y }, { x: sr.x + sr.w, y: sr.y + sr.h / 2 }, { x: sr.x + sr.w / 2, y: sr.y + sr.h }, { x: sr.x, y: sr.y + sr.h / 2 }]) {
      if (Math.hypot(x - p.x, y - p.y) < PORT_HIT) return { node: state.selNode, port: null, dir: '', x: p.x, y: p.y }
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
