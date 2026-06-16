class Population {
  static description = "城市常住人口"
  constructor() { this.current = 350; this.housing = null }
  process({ dt }) { this.housing.demand = this.current * 0.3 }
}

class Housing {
  static description = "住房供应与需求"
  constructor() { this.demand = 0; this.supply = 100 }
}

const pop = GraphStarter.add(Population)
const housing = GraphStarter.add(Housing)

pop.housing = housing
GraphStarter.describe(pop, 'housing', '人口越多住房需求越大')
