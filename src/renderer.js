import { state, config, NODE_MIN_W, NODE_MAX_W, NODE_PAD, NODE_RADIUS, PORT_R, ARROW_SZ, getPaletteColors } from './state.js'
import { getNodeRect, getNodeH, getPortPos, edgePts, getEdgeStyle, truncateText, rectEdge } from './utils.js'
import { deriveEdges } from './io.js'

export function drawGrid() {
  const pc = getPaletteColors()
  const dpr = window.devicePixelRatio || 1
  const canvas = document.getElementById('canvas')
  const ctx = canvas.getContext('2d')
  const w = canvas.width / dpr, h = canvas.height / dpr
  const minWx = -state.viewX / state.viewScale, minWy = -state.viewY / state.viewScale
  const maxWx = (w - state.viewX) / state.viewScale, maxWy = (h - state.viewY) / state.viewScale
  let gs = 20
  if (state.viewScale < 0.5) gs = 40
  if (state.viewScale < 0.25) gs = 80
  if (state.viewScale > 2) gs = 10
  if (state.viewScale > 4) gs = 5
  const sx = Math.floor(minWx / gs) * gs, sy = Math.floor(minWy / gs) * gs
  ctx.save()
  ctx.strokeStyle = pc.grid
  ctx.lineWidth = 0.5
  ctx.beginPath()
  for (let wx = sx; wx <= maxWx; wx += gs) { ctx.moveTo(wx, minWy); ctx.lineTo(wx, maxWy) }
  for (let wy = sy; wy <= maxWy; wy += gs) { ctx.moveTo(minWx, wy); ctx.lineTo(maxWx, wy) }
  ctx.stroke()
  ctx.restore()
}

export function updateTooltip() {
  const tip = document.getElementById('tip')
  if (!tip) return
  if (!state.hoverNode || state.mode || state.isDown) { tip.classList.add('hidden'); return }
  const lines = []
  if (state.hoverNode.error) { lines.push('⚠ ' + state.hoverNode.error); lines.push('') }
  lines.push(state.hoverNode.label)
  if (state.hoverNode.description) {
    const d = state.hoverNode.description.length > 80 ? state.hoverNode.description.slice(0, 80) + '…' : state.hoverNode.description
    lines.push(''); lines.push(d)
  }
  tip.textContent = lines.join('\n')
  tip.classList.remove('hidden')
  const tx = Math.min(state.mouseSX + 16, window.innerWidth - 330), ty = Math.min(state.mouseSY + 16, window.innerHeight - 100)
  tip.style.left = tx + 'px'; tip.style.top = ty + 'px'
}

export function render() {
  const pc = getPaletteColors()
  const canvas = document.getElementById('canvas')
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1, w = canvas.width / dpr, h = canvas.height / dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.translate(state.viewX, state.viewY)
  ctx.scale(state.viewScale, state.viewScale)
  drawGrid()

  // Snap alignment guides
  if (state.snapLines.length) {
    ctx.save()
    ctx.strokeStyle = pc.accent
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.globalAlpha = 0.7
    const vw = w / state.viewScale, vh = h / state.viewScale
    const ox = -state.viewX / state.viewScale, oy = -state.viewY / state.viewScale
    ctx.beginPath()
    for (const sl of state.snapLines) {
      if (sl.axis === 'x') {
        ctx.moveTo(sl.pos, oy); ctx.lineTo(sl.pos, oy + vh)
      } else {
        ctx.moveTo(ox, sl.pos); ctx.lineTo(ox + vw, sl.pos)
      }
    }
    ctx.stroke()
    ctx.restore()
  }

  ctx.font = '14px "Microsoft YaHei",sans-serif'

  // Hover highlight context
  let hoverConnectedEdgeIds = null, hoverNeighborNodeIds = null
  if (state.hoverNode && !state.mode && !state.isDown && !state.selNode) {
    hoverConnectedEdgeIds = new Set()
    hoverNeighborNodeIds = new Set()
    for (const e of deriveEdges()) {
      if (e.source_node === state.hoverNode.id || e.target_node === state.hoverNode.id) {
        hoverConnectedEdgeIds.add(e.id)
        if (e.source_node === state.hoverNode.id) hoverNeighborNodeIds.add(e.target_node)
        if (e.target_node === state.hoverNode.id) hoverNeighborNodeIds.add(e.source_node)
      }
    }
  }

  // Dimmed alpha for unrelated elements during hover
  const DIM = 0.35
  const isDimmed = () => hoverConnectedEdgeIds !== null

  for (const e of deriveEdges()) {
    const s = state.nodes.find(n => n.id === e.source_node), t = state.nodes.find(n => n.id === e.target_node)
    if (!s || !t) continue
    const { p1, p2 } = edgePts(s, t, e), isSel = state.selEdge === e
    const es = getEdgeStyle(e.relation), ec = isSel ? es.sel : es.color
    const isHighlighted = isDimmed() && hoverConnectedEdgeIds.has(e.id)
    ctx.strokeStyle = ec; ctx.lineWidth = isSel ? 2.5 : isHighlighted ? 3.0 : 1.8
    if (isDimmed() && !isHighlighted) ctx.globalAlpha = DIM
    const es2 = config.edgeStyle
    const isCurve = es2 === 'curve'

    // Edge routing: avoid path clipping through own source/target nodes
    let route = null
    let curveOff = null
    const gap = 16
    const sr = getNodeRect(s)
    const tr = getNodeRect(t)
    if (es2 === 'polyline') {
      const isBackward = p2.x < p1.x - gap
      if (isBackward) {
        const d = Math.max(40, Math.abs(p2.x - p1.x) + gap)
        const p1Up = p1.y < sr.y + sr.h / 2, p2Up = p2.y < tr.y + tr.h / 2
        const wy = (p1Up && p2Up) ? Math.min(sr.y, tr.y) - gap : Math.max(sr.y + sr.h, tr.y + tr.h) + gap
        route = [p1, { x: p1.x + d, y: p1.y }, { x: p1.x + d, y: wy }, { x: p2.x - d, y: wy }, { x: p2.x - d, y: p2.y }, p2]
      } else {
        const mx = (p1.x + p2.x) / 2
        route = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2]
      }
    } else if (isCurve) {
      const dx = p2.x - p1.x, dy = p2.y - p1.y, dist = Math.hypot(dx, dy)
      curveOff = Math.max(20, Math.min(dist * 0.4, 60))
      if (p2.x < p1.x) curveOff = Math.max(curveOff, Math.abs(p2.x - p1.x) * 0.6 + 20)
    }

    if (route) {
      ctx.beginPath(); ctx.moveTo(route[0].x, route[0].y)
      for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, route[i].y)
      ctx.stroke()
    } else if (isCurve) {
      const cp1x = p1.x + curveOff, cp1y = p1.y, cp2x = p2.x - curveOff, cp2y = p2.y
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y); ctx.stroke()
    } else {
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke()
    }

    const ang = route ? Math.atan2(p2.y - route[route.length-2].y, p2.x - route[route.length-2].x) : isCurve ? 0 : Math.atan2(p2.y - p1.y, p2.x - p1.x)
    if (config.edgeAnim === 'dashFlow') {
      ctx.save()
      ctx.setLineDash([8, 6]); ctx.lineDashOffset = -state.physTime * 0.8
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
      ctx.strokeStyle = ec; ctx.lineWidth = isSel ? 2.5 : 1.8; ctx.stroke()
      ctx.restore()
    }
    if (config.edgeAnim === 'particleFlow') {
      const t = ((state.physTime * 0.05) % 1 + 1) % 1
      const px = p1.x + (p2.x - p1.x) * t, py = p1.y + (p2.y - p1.y) * t
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fillStyle = ec; ctx.fill()
    }
    ctx.fillStyle = ec
    ctx.beginPath(); ctx.moveTo(p2.x, p2.y)
    ctx.lineTo(p2.x - ARROW_SZ * Math.cos(ang - Math.PI / 6), p2.y - ARROW_SZ * Math.sin(ang - Math.PI / 6))
    ctx.lineTo(p2.x - ARROW_SZ * Math.cos(ang + Math.PI / 6), p2.y - ARROW_SZ * Math.sin(ang + Math.PI / 6))
    ctx.closePath(); ctx.fill()

    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
    let lb = ''
    if (e.relation) lb += '[' + e.relation + '] '
    if (e.label) lb += e.label
    if (lb) {
      ctx.save()
      ctx.font = '12px "Microsoft YaHei",sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
      ctx.fillStyle = isSel ? es.sel : es.color
      ctx.fillText(lb, mx, my - 5)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  if (state.mode === 'edge' && state.tempEnd) {
    const s = state.nodes.find(n => n.id === state.edgeSrcId)
    if (s) {
      const r = getNodeRect(s), st = rectEdge(r, state.tempEnd.x, state.tempEnd.y)
      ctx.beginPath(); ctx.setLineDash([6, 4])
      ctx.moveTo(st.x, st.y); ctx.lineTo(state.tempEnd.x, state.tempEnd.y)
      ctx.strokeStyle = state.hoverNode ? pc.accent : pc.accent
      ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([])
    }
  }

  for (const n of state.nodes) {
    const r = getNodeRect(n), isSel = state.selNode === n, isHov = state.hoverNode === n, isNbr = isDimmed() && hoverNeighborNodeIds.has(n.id)
    const isSearchActive = !!state.searchQuery
    const searchMatch = !isSearchActive || (n.label || '').toLowerCase().includes(state.searchQuery.toLowerCase())
    const isSearchMatch = isSearchActive && searchMatch
    const matchAlpha = isSearchActive && !searchMatch ? 0.25 : 1
    const isRelated = !isDimmed() || isHov || isNbr
    if (matchAlpha < 1) ctx.globalAlpha = matchAlpha
    else if (isDimmed() && !isRelated) ctx.globalAlpha = DIM
    const ns = config.nodeShape
    const vis = n.visual || {}
    const customBg = vis.color
    const nodeBg = customBg || pc.nodeBg
    const nodeTc = customBg ? (() => { const r=parseInt(customBg.slice(1,3),16),g=parseInt(customBg.slice(3,5),16),b=parseInt(customBg.slice(5,7),16); return (0.299*r+0.587*g+0.114*b)/255>0.5?'#2d3436':'#f0f0f0' })() : null
    const hc = nodeTc || pc.text
    const tc = nodeTc || pc.text2
    const sc = nodeTc || pc.text3

    if (isSel) { ctx.shadowColor = pc.accent + '40'; ctx.shadowBlur = 10 }
    if (ns === 'circle') {
      const rad = Math.max(r.w, r.h) / 2
      ctx.beginPath(); ctx.arc(n.x, n.y, rad, 0, Math.PI * 2)
    } else if (ns === 'capsule') {
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2)
    } else {
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, NODE_RADIUS)
    }
    ctx.fillStyle = nodeBg
    ctx.fill()
    ctx.shadowBlur = 0

    const nb = pc.nodeBorder, nbAccent = pc.accent
    ctx.strokeStyle = isSel ? nbAccent : (isHov || isNbr || isSearchMatch) ? nbAccent : nb
    ctx.lineWidth = isSel ? 2 : (isHov || isNbr || isSearchMatch) ? 2 : 1.2
    ctx.stroke()

    const lv = config.infoLevel
    // Compute content area (accounts for port label space in full mode)
    let mIW = 0, mOW = 0
    if (lv === 'full') {
      ctx.font = '10px "Microsoft YaHei",sans-serif'
      for (const p of n.inputs) { const pw = ctx.measureText(p.label || p.id).width; if (pw > mIW) mIW = pw }
      for (const p of n.outputs) { const pw = ctx.measureText(p.label || p.id).width; if (pw > mOW) mOW = pw }
    }
    const portPad = lv === 'full' && (n.inputs.length || n.outputs.length)
    const contL = r.x + (portPad ? mIW + 12 : 8), contR = r.x + r.w - (portPad ? mOW + 12 : 8), contW = contR - contL

    ctx.font = '14px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = hc
    const displayLabel = truncateText(ctx, n.label, Math.max(contW, NODE_PAD * 2))

    if (lv === 'minimal') {
      ctx.fillText(displayLabel, n.x, n.y)
    } else {
      const pk = Object.keys(n.properties)
      const hasContent = lv === 'full'
        ? (pk.length || n.inputs.length || n.outputs.length)
        : (pk.length)

      if (!hasContent) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillStyle = hc; ctx.font = '14px "Microsoft YaHei",sans-serif'
        ctx.fillText(truncateText(ctx, n.label, contW), n.x, n.y)
      } else {
        ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip()
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        ctx.fillStyle = hc; ctx.font = 'bold 13px "Microsoft YaHei",sans-serif'
        ctx.fillText(truncateText(ctx, n.label, contW), contL, r.y + 7)

        let iy = r.y + 26
        if (pk.length) {
          ctx.font = '11px "Microsoft YaHei",sans-serif'
          const halfW = Math.max(20, contW / 2 - 4)
          pk.slice(0, 4).forEach(k => {
            const v = String(n.properties[k]); ctx.fillStyle = sc; ctx.fillText(k, contL, iy); ctx.textAlign = 'right'; ctx.fillStyle = tc; ctx.fillText(truncateText(ctx, v, halfW), contR, iy); ctx.textAlign = 'left'; iy += 17
          })
        }

        if (lv === 'full') {
          // description intentionally omitted
        }
        ctx.restore()
      }
    }

    const pcol = pc.accent
    const pConnected = (dir, pid) => deriveEdges().some(e => dir === 'in' ? e.target_node === n.id && e.target_port === pid : e.source_node === n.id && e.source_port === pid)
    if (n.inputs.length && lv !== 'minimal') {
      ctx.font = '10px "Microsoft YaHei",sans-serif'
      n.inputs.forEach((p, i) => {
        const py = r.y + r.h * (i + 1) / (n.inputs.length + 1)
        ctx.beginPath(); ctx.arc(r.x, py, PORT_R, 0, Math.PI * 2)
        if (pConnected('in', p.id)) { ctx.fillStyle = pcol; ctx.fill() }
        ctx.strokeStyle = pcol; ctx.lineWidth = 1.5; ctx.stroke()
        if (lv === 'full') {
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = pc.text3
          ctx.fillText(truncateText(ctx, p.label || p.id, mIW + 8), r.x + 4, py)
        }
        const cv = n.computed && n.computed[p.id]
        if (cv !== undefined) {
          ctx.textAlign = 'left'; ctx.fillStyle = pc.accent; ctx.fillText(truncateText(ctx, (p.label || p.id) + ': ' + (typeof cv === 'number' ? cv.toFixed(2) : cv), 80), r.x + 6, py - 11); ctx.textAlign = 'right'
        }
      })
    }
    if (n.outputs.length && lv !== 'minimal') {
      ctx.font = '10px "Microsoft YaHei",sans-serif'
      n.outputs.forEach((p, i) => {
        const py = r.y + r.h * (i + 1) / (n.outputs.length + 1)
        ctx.beginPath(); ctx.arc(r.x + r.w, py, PORT_R, 0, Math.PI * 2)
        if (pConnected('out', p.id)) { ctx.fillStyle = pcol; ctx.fill() }
        ctx.strokeStyle = pcol; ctx.lineWidth = 1.5; ctx.stroke()
        if (lv === 'full') {
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = pc.text3
          ctx.fillText(truncateText(ctx, p.label || p.id, mOW + 8), r.x + r.w - 4, py)
        }
        const cv = n.computed && n.computed[p.id]
        if (cv !== undefined) {
          ctx.textAlign = 'right'; ctx.fillStyle = pc.accent; ctx.fillText(truncateText(ctx, (p.label || p.id) + ': ' + (typeof cv === 'number' ? cv.toFixed(2) : cv), 80), r.x + r.w - 6, py - 11); ctx.textAlign = 'left'
        }
      })
    }
    // Error display
    if (n.error) {
      ctx.save()
      ctx.font = '10px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
      const ey = r.y + r.h + 12 * (n.outputs.length + 1)
      ctx.fillStyle = '#e53935'; ctx.fillText('⚠ ' + truncateText(ctx, n.error, r.w - 16), r.x + 8, Math.min(ey, window.innerHeight))
      ctx.restore()
    }
    // isEmpty stub indicator (orange dot — AI should fill implementation)
    if (n.compiled && n.compiled.methods) {
      let hasEmpty = false
      for (const method of Object.values(n.compiled.methods)) {
        if (method.isEmpty) { hasEmpty = true; break }
      }
      if (hasEmpty) {
        ctx.save()
        ctx.beginPath(); ctx.arc(r.x + r.w - 6, r.y + 6, 4, 0, Math.PI * 2)
        ctx.fillStyle = '#ff9800'; ctx.fill()
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke()
        ctx.restore()
      }
    }
    if (isSel && !n.inputs.length && !n.outputs.length && lv !== 'minimal') {
      for (const p of [{ x: r.x + r.w / 2, y: r.y }, { x: r.x + r.w, y: r.y + r.h / 2 }, { x: r.x + r.w / 2, y: r.y + r.h }, { x: r.x, y: r.y + r.h / 2 }]) {
        ctx.beginPath(); ctx.arc(p.x, p.y, PORT_R, 0, Math.PI * 2)
        ctx.fillStyle = pcol; ctx.fill()
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  const emptyHint = document.getElementById('empty-hint')
  if (state.nodes.length === 0) {
    emptyHint.innerHTML = '点击左侧 class 库面板<br>实例化 class 到画布'
    emptyHint.style.display = 'block'
  } else {
    emptyHint.style.display = 'none'
  }
  const zd = document.getElementById('zoom-display')
  if (zd) zd.textContent = Math.round(state.viewScale * 100) + '%'
}
