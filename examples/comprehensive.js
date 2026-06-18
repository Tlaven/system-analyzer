// 多源汇聚（Code 模式）：两个数据源 → 一个处理器 → 一个数据库。
// v0.9 边是实例级 attrs.edges：每条 { target, description }，多边天然支持。

class Source {
  description = "数据源：按 rate 产生数据"
  name = "数据源"
  attrs = {
    rate: 5,
    value: 0
  }
  process({ dt }) {
    this.value = this.rate * dt
    for (const e of this.edges || []) e.target.input = this.value
  }
}

class Processor {
  description = "处理器：放大输入"
  name = "处理器"
  attrs = {
    factor: 3,
    input: 0,
    output: 0
  }
  process({ dt }) {
    this.output = this.input * this.factor
    for (const e of this.edges || []) e.target.input = this.output
  }
}

class Database {
  description = "数据库：累积存储"
  name = "数据库"
  attrs = {
    input: 0,
    storage: 0
  }
  tick({ dt }) { this.storage += this.input }
}

const Source_1 = GraphStarter.add(Source)
const Source_2 = GraphStarter.add(Source)
Source_2.rate = 10
const Processor_1 = GraphStarter.add(Processor)
const Database_1 = GraphStarter.add(Database)

Source_1.edges = [{ target: Processor_1, description: '源数据流' }]
Source_2.edges = [{ target: Processor_1, description: '源数据流（高 rate）' }]
Processor_1.edges = [{ target: Database_1, description: '处理后写入下游' }]
