import { state, config } from './state.js'
import { render } from './renderer.js'
import { getNodeRect } from './utils.js'
import { pushUndo } from './editor.js'
import { saveConfig } from './config.js'
import { deriveEdges } from './io.js'

// 给没有位置的实例分配网格位置（导入新图 / 首次启动时调用）
export function spreadUnpositioned() {
  const unpositioned = state.runtimeInstances.filter(inst =>
    !state.visualState.positions[inst.varName]
  )
  if (!unpositioned.length) return
  const cw = window.innerWidth, ch = window.innerHeight
  const n = unpositioned.length
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const spX = 240, spY = 110
  unpositioned.forEach((inst, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    state.visualState.positions[inst.varName] = {
      x: cw / 2 + (col - (cols - 1) / 2) * spX,
      y: ch / 2 + (row - (rows - 1) / 2) * spY,
    }
  })
}

export function fitToView() {
  if(!state.nodes.length){state.viewX=0;state.viewY=0;state.viewScale=1;render();return}
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity
  for(const n of state.nodes){const r=getNodeRect(n);minX=Math.min(minX,r.x);minY=Math.min(minY,r.y);maxX=Math.max(maxX,r.x+r.w);maxY=Math.max(maxY,r.y+r.h)}
  const dpr=window.devicePixelRatio||1,sw=document.getElementById('canvas').width/dpr,sh=document.getElementById('canvas').height/dpr
  const bw=maxX-minX+80,bh=maxY-minY+80
  state.viewScale=Math.min(sw/bw,sh/bh,2)
  state.viewX=sw/2-(minX+maxX)/2*state.viewScale
  state.viewY=sh/2-(minY+maxY)/2*state.viewScale
  render()
}

export function stepPhysics(){
  if(!state.nodes.length)return
  const n=state.nodes.length
  const k=120*Math.sqrt(n)
  const gravity=0.003
  const damp=0.85

  state.nodes.forEach(nd=>{
    if(nd.vx===undefined){nd.vx=0;nd.vy=0;nd.pinned=false}
  })
  const cx=(window.innerWidth/2-state.viewX)/state.viewScale
  const cy=(window.innerHeight/2-state.viewY)/state.viewScale
  const dragActive=state.dragNode&&state.mode==='move'

  state.dragHeat*=0.97
  if(dragActive)state.dragHeat=Math.min(state.dragHeat+0.3,6)

  const baseTemp=Math.max(0,10*Math.exp(-state.physTime*0.015))
  const temp=Math.max(0,baseTemp+state.dragHeat)

  state.nodes.forEach(nd=>{
    if(nd.pinned)return
    let fx=0,fy=0

    fx+=(cx-nd.x)*gravity
    fy+=(cy-nd.y)*gravity

    state.nodes.forEach(o=>{
      if(o.id===nd.id)return
      const rx=nd.x-o.x,ry=nd.y-o.y
      const d=Math.max(Math.hypot(rx,ry),1)
      const f=k*k/d
      fx+=(rx/d)*f
      fy+=(ry/d)*f
    })

    deriveEdges().forEach(e=>{
      if(e.source_node!==nd.id&&e.target_node!==nd.id)return
      const o=state.nodes.find(x=>x.id===(e.source_node===nd.id?e.target_node:e.source_node))
      if(!o)return
      const rx=o.x-nd.x,ry=o.y-nd.y
      const d=Math.max(Math.hypot(rx,ry),1)
      const f=d*d/k
      fx+=(rx/d)*f
      fy+=(ry/d)*f
    })

    if(temp>0.1){
      nd.vx=(nd.vx+fx)*damp
      nd.vy=(nd.vy+fy)*damp
      const v=Math.hypot(nd.vx,nd.vy)
      if(v>temp){nd.vx*=temp/v;nd.vy*=temp/v}
    }else{
      nd.vx*=damp
      nd.vy*=damp
      if(Math.hypot(nd.vx,nd.vy)<0.05){nd.vx=0;nd.vy=0}
    }

    if(dragActive&&nd===state.dragNode){
      nd.vx+=(state.mPos.x-nd.x)*0.12
      nd.vy+=(state.mPos.y-nd.y)*0.12
    }

    nd.x+=nd.vx
    nd.y+=nd.vy
  })
}

export function startPhysics(){
  stopPhysics()
  state.physTime=0
  if(!state.nodes.length)return
  if(!('vx'in state.nodes[0]))state.nodes.forEach(n=>{n.vx=0;n.vy=0;n.pinned=false})
  const step=()=>{
    if(config.positionMode==='elastic')stepPhysics()
    state.physTime++
    const anim=config.edgeAnim
    if(state.physTime%6===0||config.positionMode==='elastic'||anim!=='none')render()
    state.animFrame=requestAnimationFrame(step)
  }
  state.animFrame=requestAnimationFrame(step)
}

export function stopPhysics(){if(state.animFrame){cancelAnimationFrame(state.animFrame);state.animFrame=null}}

export function applyLayout(mode){
  if(mode==='manual'||!state.nodes.length)return
  pushUndo();const cw=window.innerWidth,ch=window.innerHeight
  if(mode==='circular'){
    const cx=cw/2,cy=ch/2,rad=Math.min(cw,ch)*0.3
    state.nodes.forEach((n,i)=>{const a=i/state.nodes.length*Math.PI*2-Math.PI/2;n.x=cx+rad*Math.cos(a);n.y=cy+rad*Math.sin(a)})
  }else if(mode==='force'){
    const rep=8000,att=0.005,damp=0.85,vx={},vy={}
    state.nodes.forEach(n=>{vx[n.id]=0;vy[n.id]=0})
    for(let it=0;it<200;it++){
      state.nodes.forEach(n=>{let fx=0,fy=0;state.nodes.forEach(o=>{if(o.id===n.id)return;const dx=n.x-o.x,dy=n.y-o.y,d=Math.max(Math.hypot(dx,dy),1);fx+=rep*dx/(d*d);fy+=rep*dy/(d*d)});deriveEdges().filter(e=>e.source_node===n.id||e.target_node===n.id).forEach(e=>{const o=state.nodes.find(nd=>nd.id===(e.source_node===n.id?e.target_node:e.source_node));if(!o)return;const dx=o.x-n.x,dy=o.y-n.y,d=Math.max(Math.hypot(dx,dy),1);fx+=dx*att;fy+=dy*att});vx[n.id]=(vx[n.id]+fx)*damp;vy[n.id]=(vy[n.id]+fy)*damp;n.x+=vx[n.id];n.y+=vy[n.id]})
    }
  }else if(mode==='hierarchical'){
    const inDeg={},adj={}
    state.nodes.forEach(n=>{inDeg[n.id]=0;adj[n.id]=[]})
    deriveEdges().forEach(e=>{if(adj[e.source_node])adj[e.source_node].push(e.target_node);if(inDeg[e.target_node]!==undefined)inDeg[e.target_node]++})
    const q=state.nodes.filter(n=>inDeg[n.id]===0).map(n=>n.id),topo=[]
    while(q.length){const id=q.shift();topo.push(id);(adj[id]||[]).forEach(tid=>{inDeg[tid]--;if(inDeg[tid]===0)q.push(tid)})}
    state.nodes.forEach(n=>{if(!topo.includes(n.id))topo.push(n.id)})
    const lv={},lvCnt={}
    topo.forEach(id=>{let mL=0;deriveEdges().filter(e=>e.target_node===id).forEach(e=>{if(lv[e.source_node]!==undefined)mL=Math.max(mL,lv[e.source_node]+1)});lv[id]=mL;lvCnt[mL]=(lvCnt[mL]||0)+1})
    const lvIdx={},spX=180,spY=80
    state.nodes.forEach(n=>{const l=lv[n.id]||0,i=lvIdx[l]||0,c=lvCnt[l]||1;n.x=cw/2+(i-(c-1)/2)*spX;n.y=60+l*spY;lvIdx[l]=i+1})
  }
  config.layout=mode;saveConfig();fitToView()
}
