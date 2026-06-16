// v0.6 默认初始 sourceCode
// 新建图时塞进 state.sourceCode，用户可在此基础上编辑

export const DEFAULT_BOOTSTRAP = `class Source {
  static description = "数据源：按 rate 产生数据，推送到下游"
  constructor() {
    this.name = ''
    this.rate = 1
    this.value = 0
    this.target = null
  }
  process({ dt }) {
    this.value = this.rate * dt
    this.target.input = this.value
  }
}

class Processor {
  static description = "处理器：读取 input，乘以 factor，写入下游"
  constructor() {
    this.name = ''
    this.factor = 2
    this.input = 0
    this.output = 0
    this.target = null
  }
  process({ dt }) {
    this.output = this.input * this.factor
    this.target.input = this.output
  }
}

class Database {
  static description = "数据库：作为数据汇，被其他节点写入"
  constructor() {
    this.name = ''
    this.input = 0
    this.storage = 0
  }
}

class Sink {
  static description = "接收端：累加 input 到 received"
  constructor() {
    this.name = ''
    this.input = 0
    this.received = 0
  }
  process({ dt }) {
    this.received += this.input
  }
}

const s1 = GraphStarter.add(Source)
const p1 = GraphStarter.add(Processor)
const d1 = GraphStarter.add(Database)
s1.target = p1
p1.target = d1
GraphStarter.describe(s1, 'target', '源数据流向处理器')
GraphStarter.describe(p1, 'target', '处理结果写入数据库')
`
