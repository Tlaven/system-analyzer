class Source {
  static description = "数据源：按 rate 产生数据"
  constructor() { this.rate = 5; this.value = 0; this.target = null }
  process({ dt }) { this.value = this.rate * dt; this.target.input = this.value }
}

class Processor {
  static description = "处理器：放大输入"
  constructor() { this.factor = 3; this.input = 0; this.output = 0; this.target = null }
  process({ dt }) { this.output = this.input * this.factor; this.target.input = this.output }
}

class Database {
  static description = "数据库：累积存储"
  constructor() { this.input = 0; this.storage = 0 }
  tick({ dt }) { this.storage += this.input }
}

const s1 = GraphStarter.add(Source)
const s2 = GraphStarter.add(Source)
s2.rate = 10
const p1 = GraphStarter.add(Processor)
const d1 = GraphStarter.add(Database)

s1.target = p1
s2.target = p1
p1.target = d1

GraphStarter.describe(s1, 'target', '源 1 数据流')
GraphStarter.describe(s2, 'target', '源 2 数据流')
GraphStarter.describe(p1, 'target', '处理后写入数据库')
