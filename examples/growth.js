// 单节点时间演化（Code 模式）：无 edges，靠 tick() 让 self.current 指数增长。

class Population {
  description = "人口随时间指数增长"
  name = "人口"
  attrs = {
    current: 100,
    growthRate: 0.05
  }
  tick({ dt }) { this.current += this.current * this.growthRate * dt }
}

const Population_1 = GraphStarter.add(Population)
