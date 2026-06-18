export const DEFAULT_BOOTSTRAP = `class Sensor {
  description = "采集系统指标并产生原始数据"
  name = "传感器"
  attrs = {
    interval: 5,
    unit: "ms"
  }
}

class Filter {
  description = "过滤异常值并平滑数据"
  name = "过滤器"
  attrs = {
    threshold: 0.8,
    window: 10
  }
}

class Storage {
  description = "持久化存储处理后的时序数据"
  name = "存储"
  attrs = {
    retention: 30,
    engine: "内存"
  }
}

class Dashboard {
  description = "可视化展示实时指标"
  name = "仪表盘"
  attrs = {
    refresh: 1,
    theme: "暗色"
  }
}

const Sensor_1 = GraphStarter.add(Sensor)
const Filter_1 = GraphStarter.add(Filter)
const Storage_1 = GraphStarter.add(Storage)
const Dashboard_1 = GraphStarter.add(Dashboard)
Sensor_1.edges = [
  { target: Filter_1, description: "原始数据" }
]
Filter_1.edges = [
  { target: Storage_1, description: "清洗后数据" }
]
Storage_1.edges = [
  { target: Dashboard_1, description: "查询展示" }
]
Sensor_1.interval = 10
`
