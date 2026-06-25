import { state, config } from './state.js'
import { render } from './renderer.js'
import { getNodeRect } from './utils.js'
import { pushUndo } from './editor.js'
import { saveConfig } from './config.js'
import { deriveEdges } from './codegraph.js'

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

    deriveEdges(state).forEach(e=>{
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
    // v0.10 circular 重做：Cuthill-McKee BFS 排序让相邻节点靠近，半径按节点数+尺寸联动
    const nodes = state.nodes
    if (nodes.length) {
      const edges = deriveEdges(state)
      const adj = {}, inDeg = {}
      nodes.forEach(n => { adj[n.id] = []; inDeg[n.id] = 0 })
      edges.forEach(e => {
        if (adj[e.source_node]) adj[e.source_node].push(e.target_node)
        if (inDeg[e.target_node] !== undefined) inDeg[e.target_node]++
      })
      // Cuthill-McKee 风格 BFS：从入度 0 节点开始，邻居按 degree 排序
      const visited = new Set(), order = []
      const queue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id)
      // 加入孤立节点（无边）作为 BFS 起点
      nodes.forEach(n => { if (adj[n.id].length === 0 && inDeg[n.id] === 0 && !queue.includes(n.id)) queue.push(n.id) })
      while (queue.length) {
        const id = queue.shift()
        if (visited.has(id)) continue
        visited.add(id); order.push(id)
        const neighbors = (adj[id] || []).filter(nid => !visited.has(nid))
        neighbors.sort((a, b) => (adj[a]?.length || 0) - (adj[b]?.length || 0))
        neighbors.forEach(nid => { if (!visited.has(nid)) queue.push(nid) })
      }
      // 未访问（环上）追加
      nodes.forEach(n => { if (!visited.has(n.id)) order.push(n.id) })

      const cx = cw / 2, cy = ch / 2, nn = order.length
      // 半径按节点数 + 平均半径联动：每个节点占直径 + 20px 间距
      const avgR = nodes.reduce((s, n) => s + Math.max(getNodeRect(n).w, getNodeRect(n).h) / 2, 0) / nn
      const circumference = nn * (avgR * 2 + 20)
      const rad = Math.max(Math.min(cw, ch) * 0.3, circumference / (2 * Math.PI))
      const nodeById = {}
      nodes.forEach(n => { nodeById[n.id] = n })
      order.forEach((id, i) => {
        const node = nodeById[id]
        if (!node) return
        const a = i / nn * Math.PI * 2 - Math.PI / 2
        node.x = cx + rad * Math.cos(a)
        node.y = cy + rad * Math.sin(a)
      })
    }
  }else if(mode==='grid'){
    // v0.10 grid 新增：同 class 占连续行，class 间留空行（minimal 鸟瞰专用）
    const nodes = state.nodes
    if (nodes.length) {
      const classMap = {}
      nodes.forEach(node => {
        const cn = node.classId || '_anon'
        if (!classMap[cn]) classMap[cn] = []
        classMap[cn].push(node)
      })
      const classNames = Object.keys(classMap)
      const colSpacing = 120, rowSpacing = 80, classGap = 40
      const cx = cw / 2
      let yPos = 0
      classNames.forEach(cn => {
        const arr = classMap[cn]
        const cols = Math.max(1, Math.ceil(Math.sqrt(arr.length)))
        const totalW = (cols - 1) * colSpacing
        arr.forEach((node, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          node.x = cx - totalW / 2 + col * colSpacing
          node.y = yPos + row * rowSpacing
        })
        const rows = Math.ceil(arr.length / cols)
        yPos += rows * rowSpacing + classGap
      })
      // 整体垂直居中
      let minY = Infinity, maxY = -Infinity
      nodes.forEach(n => { minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y) })
      const offsetY = ch / 2 - (minY + maxY) / 2
      nodes.forEach(n => { n.y += offsetY })
    }
  }else if(mode==='force'){
    // v0.10 force 重做：参数和 stepPhysics 统一 + 退火 + 同 class 聚类力 + gravity
    const nodes = state.nodes, edges = deriveEdges(state)  // deriveEdges 只调一次
    if (nodes.length) {
      const nn = nodes.length
      const k = 120 * Math.sqrt(nn)  // 理想距离（和 stepPhysics 一致）
      const center = { x: cw / 2, y: ch / 2 }
      const gravity = 0.05  // 向中心弱吸引，防图飞走
      const damp = 0.85
      const clusterK = 0.1  // 同 class 聚类力系数（弱吸引）

      // 按 class 分组（classId 是 getter，缓存）
      const classMap = {}
      nodes.forEach(node => {
        const cn = node.classId || ''
        if (!classMap[cn]) classMap[cn] = []
        classMap[cn].push(node)
      })

      // 迭代数自适应（log 缩放）
      const iters = Math.max(100, Math.min(500, Math.round(30 * Math.log(nn + 1))))
      const vx = {}, vy = {}
      nodes.forEach(node => { vx[node.id] = 0; vy[node.id] = 0 })

      // 边的邻接索引（避免每次循环 find）
      const nodeById = {}
      nodes.forEach(n => { nodeById[n.id] = n })

      for (let it = 0; it < iters; it++) {
        // temperature schedule：线性从 1.0 衰减到 0.05
        const temp = 1.0 - 0.95 * (it / iters)

        // 算每 class 的 centroid（聚类力用）
        const classCentroid = {}
        for (const cn in classMap) {
          const arr = classMap[cn]
          if (arr.length < 2) continue
          let sx = 0, sy = 0
          arr.forEach(nd => { sx += nd.x; sy += nd.y })
          classCentroid[cn] = { x: sx / arr.length, y: sy / arr.length }
        }

        const fxMap = {}, fyMap = {}
        nodes.forEach(node => { fxMap[node.id] = 0; fyMap[node.id] = 0 })

        // 1. 节点间斥力（Fruchterman-Reingold: f = k²/d）
        for (let i = 0; i < nn; i++) {
          for (let j = i + 1; j < nn; j++) {
            const a = nodes[i], b = nodes[j]
            const dx = a.x - b.x, dy = a.y - b.y
            const d = Math.max(Math.hypot(dx, dy), 1)
            const f = (k * k) / d
            const ux = dx / d, uy = dy / d
            fxMap[a.id] += ux * f; fyMap[a.id] += uy * f
            fxMap[b.id] -= ux * f; fyMap[b.id] -= uy * f
          }
        }

        // 2. 边的引力（胡克: f = d²/k，吸引到理想长度 k）
        edges.forEach(e => {
          const a = nodeById[e.source_node], b = nodeById[e.target_node]
          if (!a || !b) return
          const dx = b.x - a.x, dy = b.y - a.y
          const d = Math.max(Math.hypot(dx, dy), 1)
          const f = (d * d) / k
          const ux = dx / d, uy = dy / d
          fxMap[a.id] += ux * f; fyMap[a.id] += uy * f
          fxMap[b.id] -= ux * f; fyMap[b.id] -= uy * f
        })

        // 3. Gravity：所有节点向画布中心弱吸引
        nodes.forEach(node => {
          fxMap[node.id] += (center.x - node.x) * gravity
          fyMap[node.id] += (center.y - node.y) * gravity
        })

        // 4. 同 class 聚类力：每个节点向自己 class 的 centroid 吸引
        nodes.forEach(node => {
          const cn = node.classId || ''
          const c = classCentroid[cn]
          if (!c) return
          const dx = c.x - node.x, dy = c.y - node.y
          const d = Math.max(Math.hypot(dx, dy), 1)
          const f = d * clusterK
          fxMap[node.id] += (dx / d) * f
          fyMap[node.id] += (dy / d) * f
        })

        // 积分（带退火）
        const maxV = k * temp * 0.5
        nodes.forEach(node => {
          vx[node.id] = (vx[node.id] + fxMap[node.id]) * damp
          vy[node.id] = (vy[node.id] + fyMap[node.id]) * damp
          const v = Math.hypot(vx[node.id], vy[node.id])
          if (v > maxV) {
            vx[node.id] = (vx[node.id] / v) * maxV
            vy[node.id] = (vy[node.id] / v) * maxV
          }
          node.x += vx[node.id]
          node.y += vy[node.id]
        })
      }
    }
  }else if(mode==='hierarchical'){
    // v0.10 Sugiyama 简化版：Kahn 拓扑 + barycenter 交叉最小化 + 节点尺寸感知 + LR/TB
    const nodes = state.nodes, edges = deriveEdges(state)
    const adj = {}, reverseAdj = {}, inDeg = {}
    nodes.forEach(n => { adj[n.id] = []; reverseAdj[n.id] = []; inDeg[n.id] = 0 })
    edges.forEach(e => {
      if (adj[e.source_node]) adj[e.source_node].push(e.target_node)
      if (reverseAdj[e.target_node]) reverseAdj[e.target_node].push(e.source_node)
      if (inDeg[e.target_node] !== undefined) inDeg[e.target_node]++
    })
    // Kahn 拓扑排序
    const q = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id), topo = []
    while (q.length) {
      const id = q.shift(); topo.push(id)
      ;(adj[id] || []).forEach(tid => { if (--inDeg[tid] === 0) q.push(tid) })
    }
    nodes.forEach(n => { if (!topo.includes(n.id)) topo.push(n.id) })  // 环成员塞末尾
    // 分层：lv[id] = max(lv[predecessor] + 1)
    const lv = {}
    topo.forEach(id => {
      let mL = 0
      ;(reverseAdj[id] || []).forEach(pid => { if (lv[pid] !== undefined) mL = Math.max(mL, lv[pid] + 1) })
      lv[id] = mL
    })
    const maxLayer = nodes.reduce((m, n) => Math.max(m, lv[n.id] || 0), 0)
    const layers = {}
    for (let l = 0; l <= maxLayer; l++) layers[l] = []
    nodes.forEach(n => layers[lv[n.id] || 0].push(n.id))
    // barycenter 交叉最小化（3 轮：向下用上层邻居排序，向上用下层邻居排序）
    const bary = (id, dir) => {
      const neighbors = dir === 'down' ? (reverseAdj[id] || []) : (adj[id] || [])
      if (!neighbors.length) return 0
      let sum = 0, count = 0
      neighbors.forEach(nid => {
        const pos = layers[lv[nid]] ? layers[lv[nid]].indexOf(nid) : -1
        if (pos >= 0) { sum += pos; count++ }
      })
      return count ? sum / count : 0
    }
    for (let iter = 0; iter < 3; iter++) {
      for (let l = 1; l <= maxLayer; l++) {
        if (layers[l]) layers[l].sort((a, b) => bary(a, 'down') - bary(b, 'down'))
      }
      for (let l = maxLayer - 1; l >= 0; l--) {
        if (layers[l]) layers[l].sort((a, b) => bary(a, 'up') - bary(b, 'up'))
      }
    }
    // 坐标分配：节点实际尺寸 + LR/TB 方向（主轴 = 层方向，交叉轴 = 同层节点排列方向）
    const isLR = config.layoutDirection === 'LR'
    const gutter = 60, layerGap = 80
    const layerData = []
    for (let l = 0; l <= maxLayer; l++) {
      const layerNodes = (layers[l] || []).map(id => nodes.find(n => n.id === id)).filter(Boolean)
      if (!layerNodes.length) continue
      const maxW = layerNodes.reduce((m, n) => Math.max(m, getNodeRect(n).w), 0)
      const maxH = layerNodes.reduce((m, n) => Math.max(m, getNodeRect(n).h), 0)
      layerData.push({ nodes: layerNodes, maxW, maxH })
    }
    const sumMain = layerData.reduce((s, ld) => s + (isLR ? ld.maxW : ld.maxH), 0) + layerGap * Math.max(0, layerData.length - 1)
    let mainPos = (isLR ? cw : ch) / 2 - sumMain / 2
    for (const ld of layerData) {
      const mainSize = isLR ? ld.maxW : ld.maxH
      const crossSizes = ld.nodes.map(n => isLR ? getNodeRect(n).h : getNodeRect(n).w)
      const sumCross = crossSizes.reduce((s, v) => s + v, 0) + gutter * Math.max(0, ld.nodes.length - 1)
      let crossPos = (isLR ? ch : cw) / 2 - sumCross / 2
      ld.nodes.forEach((n, i) => {
        const crossSize = crossSizes[i]
        if (isLR) { n.x = mainPos + mainSize / 2; n.y = crossPos + crossSize / 2 }
        else { n.x = crossPos + crossSize / 2; n.y = mainPos + mainSize / 2 }
        crossPos += crossSize + gutter
      })
      mainPos += mainSize + layerGap
    }
  }
  config.layout=mode;saveConfig();fitToView()
}
