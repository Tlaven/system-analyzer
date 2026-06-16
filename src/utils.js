import { state, config, NODE_MIN_W, NODE_MAX_W, NODE_PAD, PORT_R, PORT_HIT, EDGE_HIT, isDark } from './state.js'
import { deriveEdges } from './io.js'

export function getNodeH(n,estW){
  const lv=config.infoLevel
  if(lv==='minimal')return 36
  const pk=Object.keys(n.properties)
  if(lv==='medium'){
    if(!pk.length)return 36
    let h=26
    h+=Math.min(pk.length,4)*17
    return h+8
  }
  if(!pk.length)return 36
  let h=26
  h+=Math.min(pk.length,4)*17
  return h+8
}
export function getNodeRect(n) {
  const ctx=document.createElement('canvas').getContext('2d'),lv=config.infoLevel
  ctx.font='14px "Microsoft YaHei",sans-serif'
  let cw=ctx.measureText(n.label).width
  if(lv==='medium'||lv==='full'){
    ctx.font='11px "Microsoft YaHei",sans-serif'
    for(const k of Object.keys(n.properties).slice(0,4)){
      const rw=ctx.measureText(k+'  '+String(n.properties[k])).width
      if(rw>cw)cw=rw
    }
  }
  let extra=0
  if(lv==='full'){
    ctx.font='10px "Microsoft YaHei",sans-serif'
    let mIW=0,mOW=0
    for(const p of n.inputs){const pw=ctx.measureText(p.label||p.id).width;if(pw>mIW)mIW=pw}
    for(const p of n.outputs){const pw=ctx.measureText(p.label||p.id).width;if(pw>mOW)mOW=pw}
    extra=mIW+mOW+24
  }
  const w=Math.max(NODE_MIN_W,Math.min(480,cw+NODE_PAD*2+extra))
  const h=getNodeH(n,w)
  return{x:n.x-w/2,y:n.y-h/2,w,h}
}
export function rectEdge(r,tx,ty){
  const cx=r.x+r.w/2,cy=r.y+r.h/2,dx=tx-cx,dy=ty-cy
  if(dx===0&&dy===0)return{x:cx,y:cy}
  if(config.nodeShape==='circle'){
    const rad=Math.max(r.w,r.h)/2,ang=Math.atan2(dy,dx)
    return{x:cx+rad*Math.cos(ang),y:cy+rad*Math.sin(ang)}
  }
  const adx=Math.abs(dx),ady=Math.abs(dy)
  let sc=1
  if(adx*r.h>ady*r.w)sc=r.w/2/adx;else sc=r.h/2/ady
  return{x:cx+dx*sc,y:cy+dy*sc}
}
export function getPortPos(n,pid,dir){
  const r=getNodeRect(n),arr=dir==='out'?n.outputs:n.inputs,idx=arr.findIndex(p=>p.id===pid)
  if(idx<0)return null
  const y=r.y+r.h*(idx+1)/(arr.length+1)
  if(config.nodeShape==='circle'){
    const rad=Math.max(r.w,r.h)/2,cy=r.y+r.h/2,dy=y-cy
    if(Math.abs(dy)>=rad)return dir==='out'?{x:r.x+r.w,y}:{x:r.x,y}
    const hdx=Math.sqrt(rad*rad-dy*dy)
    return dir==='out'?{x:r.x+r.w/2+hdx,y}:{x:r.x+r.w/2-hdx,y}
  }
  return dir==='out'?{x:r.x+r.w,y}:{x:r.x,y}
}
export function edgePts(src,tgt,e){
  if(e&&e.source_port){const p=getPortPos(src,e.source_port,'out');if(p)return{p1:p,p2:getPortPos(tgt,e.target_port,'in')||rectEdge(getNodeRect(tgt),src.x,src.y)}}
  if(e&&e.target_port){const p=getPortPos(tgt,e.target_port,'in');if(p)return{p1:rectEdge(getNodeRect(src),tgt.x,tgt.y),p2:p}}
  return{p1:rectEdge(getNodeRect(src),tgt.x,tgt.y),p2:rectEdge(getNodeRect(tgt),src.x,src.y)}
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
export function toB64(str){
  try{return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,(_,p1)=>String.fromCharCode(parseInt(p1,16))))}catch(e){return''}
}
export function fromB64(b64){
  try{return decodeURIComponent(atob(b64).split('').map(c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join(''))}catch(e){return''}
}
export function hitNode(x, y) {
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i], r = getNodeRect(n)
    if (config.nodeShape === 'circle') { const rad = Math.max(r.w, r.h) / 2; if (Math.hypot(x - n.x, y - n.y) < rad) return n }
    else if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return n
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
