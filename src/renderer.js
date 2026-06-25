import { state, config, NODE_MIN_W, NODE_MAX_W, NODE_PAD, NODE_RADIUS, PORT_R, ARROW_SZ, getPaletteColors } from './state.js'
import { getNodeRect, getNodeH, computeCurveGeometry, findOrthogonalChannel, edgePts, getHandlePoints, getEdgeStyle, truncateText, rectEdge, formatScalar } from './utils.js'
import { deriveEdges } from './codegraph.js'

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
  if (state.mode || state.isDown) { tip.classList.add('hidden'); return }
  let title = '', desc = '', err = ''
  if (state.hoverEdge) {
    const e = deriveEdges(state).find(ed => ed.id === state.hoverEdge)
    if (e) {
      // v0.9：边没有 ref 名，标题显示 `源 → 目标`，描述是 per-edge description
      title = (e.source_instance || '') + ' → ' + (e.target_instance || '')
      desc = e.description || ''
    }
  } else if (state.hoverNode) {
    if (state.hoverNode.error) err = state.hoverNode.error
    title = state.hoverNode.label || ''
    const d = state.hoverNode.description
    if (d) desc = d
  }
  if (!title && !desc && !err) { tip.classList.add('hidden'); return }
  const lines = []
  if (err) { lines.push('⚠ ' + err); lines.push('') }
  if (title) lines.push(title)
  if (desc) {
    const d = desc.length > 80 ? desc.slice(0, 80) + '…' : desc
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
    for (const e of deriveEdges(state)) {
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

  // 多边同对的并行由端口分配处理（edgePts → getPortPos → computeNodePorts）
  const _allEdges = deriveEdges(state)

  for (const e of _allEdges) {
    const s = state.nodes.find(n => n.id === e.source_node), t = state.nodes.find(n => n.id === e.target_node)
    if (!s || !t) continue
    const { p1, p2 } = edgePts(s, t, e), isSel = state.selEdge === e.id
    const isHovered = state.hoverEdge === e.id
    const es = getEdgeStyle(e.relation)
    const es2 = config.edgeStyle
    const isCurve = es2 === 'curve'
    const isHighlighted = isDimmed() && hoverConnectedEdgeIds.has(e.id)
    const ec = isSel ? es.sel : (isHovered ? es.sel : es.color)
    ctx.strokeStyle = ec
    ctx.lineWidth = isSel ? 2.5 : (isHovered || isHighlighted) ? 3.0 : 1.8
    // alpha：hoverNode dim 时相关边全实、无关边 DIM；否则 curve 默认半透明（sel/hover 时全实），其他模式全实
    let alpha = 1.0
    if (isDimmed()) alpha = isHighlighted ? 1.0 : DIM
    else if (isSel || isHovered) alpha = 1.0
    else if (isCurve) alpha = 0.55
    ctx.globalAlpha = alpha

    // P1/P2 已由端口分配处理多边同对并行
    const P1 = p1, P2 = p2

    // Edge routing: avoid path clipping through own source/target nodes
    let route = null
    let curveCubic = null
    let curveDegrade = false
    const gap = 16
    const sr = getNodeRect(s)
    const tr = getNodeRect(t)
    if (es2 === 'polyline') {
      const isBackward = P2.x < P1.x - gap
      if (isBackward) {
        // 反向边：U 形外圈（绕到节点上方或下方）
        const d = Math.max(40, Math.abs(P2.x - P1.x) + gap)
        const p1Up = P1.y < sr.y + sr.h / 2, p2Up = P2.y < tr.y + tr.h / 2
        const wy = (p1Up && p2Up) ? Math.min(sr.y, tr.y) - gap : Math.max(sr.y + sr.h, tr.y + tr.h) + gap
        route = [P1, { x: P1.x + d, y: P1.y }, { x: P1.x + d, y: wy }, { x: P2.x - d, y: wy }, { x: P2.x - d, y: P2.y }, P2]
      } else if (Math.abs(P1.y - P2.y) < 4) {
        // 同行：直接水平线
        route = [P1, P2]
      } else {
        // Z 形 + 空通道查找（避开中间节点）
        const mx = findOrthogonalChannel(P1, P2, s, t)
        route = [P1, { x: mx, y: P1.y }, { x: mx, y: P2.y }, P2]
      }
    } else if (isCurve) {
      const geo = computeCurveGeometry(s, t, P1, P2)
      if (geo.degrade) curveDegrade = true
      else {
        curveCubic = geo
        // minimal 模式平行边：同对多边沿垂直方向散开
        if (config.infoLevel === 'minimal') {
          const pair = _allEdges.filter(ed => ed.source_node === e.source_node && ed.target_node === e.target_node)
          if (pair.length > 1) {
            const idx = pair.indexOf(e)
            const mid = (pair.length - 1) / 2
            const off = (idx - mid) * 14
            const nx = -(P2.y - P1.y), ny = (P2.x - P1.x)
            const nl = Math.hypot(nx, ny) || 1
            curveCubic.cp1.x += nx / nl * off
            curveCubic.cp1.y += ny / nl * off
            curveCubic.cp2.x += nx / nl * off
            curveCubic.cp2.y += ny / nl * off
          }
        }
      }
    }

    if (route) {
      ctx.beginPath(); ctx.moveTo(route[0].x, route[0].y)
      for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, route[i].y)
      ctx.stroke()
    } else if (isCurve && curveCubic) {
      // 单段 cubic：P1 → cp1 → cp2 → P2
      ctx.beginPath()
      ctx.moveTo(P1.x, P1.y)
      ctx.bezierCurveTo(curveCubic.cp1.x, curveCubic.cp1.y, curveCubic.cp2.x, curveCubic.cp2.y, P2.x, P2.y)
      ctx.stroke()
    } else {
      // straight 或 curve 降级（3+ 节点遮挡，强行绕只会更乱）
      ctx.beginPath(); ctx.moveTo(P1.x, P1.y); ctx.lineTo(P2.x, P2.y); ctx.stroke()
    }

    // 箭头方向：polyline 用 route 末段切线；curve 用 cp2→P2 切线；straight 用基线方向
    const ang = route
      ? Math.atan2(p2.y - route[route.length-2].y, p2.x - route[route.length-2].x)
      : (isCurve && curveCubic)
        ? Math.atan2(p2.y - curveCubic.cp2.y, p2.x - curveCubic.cp2.x)
        : Math.atan2(p2.y - p1.y, p2.x - p1.x)
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

    ctx.globalAlpha = 1
  }

  if (state.mode === 'edge' && state.tempEnd) {
    const s = state.nodes.find(n => n.id === state.edgeSrcId)
    if (s) {
      // 拖边虚线：从源节点边缘出发
      // 不走 edgePts —— state.tempEnd 是 {x,y} 不是节点，edgePts 内部 getNodeRect 会抛错
      const sr = getNodeRect(s)
      const p1 = config.infoLevel === 'minimal'
        ? (() => {
            const sR = Math.max(sr.w, sr.h) / 2
            const dx = state.tempEnd.x - s.x, dy = state.tempEnd.y - s.y
            const d = Math.hypot(dx, dy) || 1
            return { x: s.x + sR * dx / d, y: s.y + sR * dy / d }
          })()
        : { x: sr.x + sr.w, y: sr.y + sr.h / 2 }
      ctx.beginPath(); ctx.setLineDash([6, 4])
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(state.tempEnd.x, state.tempEnd.y)
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
    const vis = n.visual || {}
    const customBg = vis.color
    const nodeBg = customBg || pc.nodeBg
    const nodeTc = customBg ? (() => { const r=parseInt(customBg.slice(1,3),16),g=parseInt(customBg.slice(3,5),16),b=parseInt(customBg.slice(5,7),16); return (0.299*r+0.587*g+0.114*b)/255>0.5?'#2d3436':'#f0f0f0' })() : null
    const hc = nodeTc || pc.text
    const tc = nodeTc || pc.text2
    const sc = nodeTc || pc.text3

    const lv = config.infoLevel
    const isCircle = lv === 'minimal'

    if (isSel) { ctx.shadowColor = pc.accent + '40'; ctx.shadowBlur = 10 }
    if (isCircle) {
      const rad = Math.max(r.w, r.h) / 2
      ctx.beginPath(); ctx.arc(n.x, n.y, rad, 0, Math.PI * 2)
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

    const contL = r.x + 8, contR = r.x + r.w - 8, contW = contR - contL

    if (isCircle) {
      const radius = r.w / 2
      let fontSize = Math.max(10, Math.min(16, Math.round(radius * 0.35)))
      const label = n.label || ''
      const maxW = Math.max(contW, NODE_PAD * 2)
      ctx.font = fontSize + 'px "Microsoft YaHei",sans-serif'
      while (fontSize > 10 && ctx.measureText(label).width > maxW) {
        fontSize--
        ctx.font = fontSize + 'px "Microsoft YaHei",sans-serif'
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillStyle = hc
      ctx.fillText(truncateText(ctx, label, maxW), n.x, n.y)
    } else {
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip()
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'

      ctx.fillStyle = hc; ctx.font = 'bold 13px "Microsoft YaHei",sans-serif'
      ctx.fillText(truncateText(ctx, n.label, contW), contL, r.y + 7)

      let iy = r.y + 28
      if (lv === 'full') {
        ctx.font = '11px "Microsoft YaHei",sans-serif'
        ctx.fillStyle = sc
        ctx.fillText(truncateText(ctx, n.varName, contW), contL, iy)
        iy += 17
      }

      const pk = Object.keys(n.properties)
      const maxRows = lv === 'full' ? 6 : 4
      const shown = pk.slice(0, maxRows)
      if (shown.length) {
        ctx.font = '11px "Microsoft YaHei",sans-serif'
        const halfW = Math.max(20, contW / 2 - 4)
        for (const k of shown) {
          const v = formatScalar(n.properties[k])
          ctx.fillStyle = sc; ctx.textAlign = 'left'
          ctx.fillText(truncateText(ctx, k, halfW), contL, iy)
          ctx.fillStyle = tc; ctx.textAlign = 'right'
          ctx.fillText(truncateText(ctx, v, halfW), contR, iy)
          iy += 17
        }
        if (pk.length > maxRows) {
          ctx.fillStyle = sc; ctx.textAlign = 'left'
          ctx.fillText('… +' + (pk.length - maxRows), contL, iy)
        }
      }

      if (lv === 'full') {
        const desc = n.description
        if (desc) {
          ctx.font = 'italic 11px "Microsoft YaHei",sans-serif'
          ctx.fillStyle = sc; ctx.textAlign = 'left'
          ctx.fillText(truncateText(ctx, desc, contW), contL, r.y + r.h - 18)
        }
      }
      ctx.restore()
    }

    // 端口圆点不画——端口是抽象的几何概念（边的出入点），不需要可见标记
    // 拖柄（选中节点时显示）是创建边的入口，仍然保留
    const pcol = pc.accent
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
    // v0.9：选中节点画 4 个拖柄圆点（上右下左中点）— 拖出边的入口
    // 圆形 / 矩形都画；不再依赖 inputs/outputs（v0.9 无端口概念）
    if (isSel) {
      const handles = getHandlePoints(n)
      for (const h of handles) {
        ctx.beginPath(); ctx.arc(h.x, h.y, PORT_R, 0, Math.PI * 2)
        ctx.fillStyle = pcol; ctx.fill()
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  const emptyHint = document.getElementById('empty-hint')
  if (state.nodes.length === 0) {
    emptyHint.innerHTML = '空画布<br><span style="font-size:13px;opacity:.85">点击 <kbd>+</kbd> 加节点 / 双击空白新建<br>或切到 <kbd>代码</kbd> 模式写 sourceCode</span>'
    emptyHint.style.display = 'block'
  } else if (state.selInstance && state.editMode === 'ui') {
    emptyHint.innerHTML = '<span style="font-size:13px;opacity:.85">拖节点边缘圆点 → 落到目标节点 = 建边</span>'
    emptyHint.style.display = 'block'
    // 不阻挡画布交互（pointer-events:none in CSS）
  } else {
    emptyHint.style.display = 'none'
  }
  const zd = document.getElementById('zoom-display')
  if (zd) zd.textContent = Math.round(state.viewScale * 100) + '%'
}
