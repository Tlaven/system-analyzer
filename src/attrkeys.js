// 纯函数无依赖:统一 attrs key 过滤,供 Node-runnable 引擎(codegraph.js)和 IO 层(panel.js)共用。
// 单独建文件而非放 utils.js,避免 codegraph.js → utils.js → io.js → editor.js → panel.js → input.js
// 把 Node 测试环境拉进 IO bundle(window undefined)。
//
// `__` 前缀是内部字段约定(如 __instId),edges 是实例级边数组。
// excludeMeta=true 时额外排除 name/description(UI 元字段,transform 里写无意义)。
export function getInstanceAttrKeys(owner, { excludeMeta = false } = {}) {
  const attrs = owner && owner.attrs ? owner.attrs : {}
  let keys = Object.keys(attrs).filter(k => !k.startsWith('__') && k !== 'edges')
  if (excludeMeta) keys = keys.filter(k => k !== 'name' && k !== 'description')
  return keys
}
