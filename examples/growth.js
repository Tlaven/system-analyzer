class Population {
  static description = "人口随时间指数增长"
  constructor() { this.current = 100; this.growthRate = 0.05 }
  tick({ dt }) { this.current += this.current * this.growthRate * dt }
}

const pop = GraphStarter.add(Population)
