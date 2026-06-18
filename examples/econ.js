// 简单两节点影响链（Code 模式）：人口 → 住房需求。

class Population {
  description = "城市常住人口"
  name = "人口"
  attrs = {
    current: 350
  }
  process({ dt }) {
    for (const e of this.edges || []) e.target.demand = this.current * 0.3
  }
}

class Housing {
  description = "住房供应与需求"
  name = "住房"
  attrs = {
    demand: 0,
    supply: 100
  }
}

const Population_1 = GraphStarter.add(Population)
const Housing_1 = GraphStarter.add(Housing)

Population_1.edges = [{ target: Housing_1, description: '人口越多住房需求越大' }]
