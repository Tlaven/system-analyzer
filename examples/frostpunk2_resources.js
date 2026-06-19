// Frostpunk 2 资源层系统对象模型（Code 模式）
// 12 个核心资源对象 + 依赖边 + 模拟方法体
// 人口驱动一切，资源通过边传播缺口/盈余

class Population {
  description = "城市人口。驱动所有资源需求，自然增长 + 移民流入。"
  name = "人口"
  attrs = {
    人数: 350,
    增长率: 0.02
  }
  process({ dt }) {
    for (const e of this.edges || []) {
      if (e.description.includes('住房')) e.target['缺口'] = Math.max(0, this['人数'] - e.target['容量'])
      if (e.description.includes('食物')) e.target['需求量'] = this['人数'] * 0.02
      if (e.description.includes('热量')) e.target['人口需求'] = this['人数'] * 0.15
      if (e.description.includes('劳动力')) e.target['总人口'] = this['人数']
    }
  }
}

class Shelter {
  description = "住房容量。Housing District 提供。每人需 1 单位。不足触发 Cold 问题，是极难最致命瓶颈。"
  name = "住房"
  attrs = {
    容量: 350,
    缺口: 0,
    建造预制件成本: 200,
    建造热币成本: 40
  }
  process({ dt }) {
    const shortage = this['缺口']
    for (const e of this.edges || []) {
      if (e.description.includes('Cold')) e.target['冷度输入'] = shortage
    }
  }
}

class Heat {
  description = "热量供应。Generator 燃烧 Coal/Oil 产出。各区有基准热需求，温度事件会额外加成。"
  name = "热量"
  attrs = {
    供应量: 100,
    区域需求: 80,
    人口需求: 0,
    燃料燃烧率: 8
  }
  process({ dt }) {
    const totalDemand = this['区域需求'] + this['人口需求']
    const deficit = Math.max(0, totalDemand - this['供应量'])
    for (const e of this.edges || []) {
      if (e.description.includes('Cold')) e.target['热缺口'] = deficit
      if (e.description.includes('生产')) e.target['效率惩罚'] = deficit > 20 ? 0.3 : 0
    }
  }
}

class Food {
  description = "食物产出与库存。Food District + Fertile Soil。白幕期产出归零，需大库存缓冲。"
  name = "食物"
  attrs = {
    日产出: 7,
    库存: 100,
    需求量: 0,
    效率惩罚: 0
  }
  process({ dt }) {
    const effectiveOutput = this['日产出'] * (1 - this['效率惩罚'])
    const net = effectiveOutput - this['需求量']
    this['库存'] = Math.max(0, this['库存'] + net * dt)
    const shortage = this['需求量'] > 0 && this['库存'] <= 0 ? 1 : 0
    for (const e of this.edges || []) {
      if (e.description.includes('饥饿')) e.target['饥饿输入'] = shortage
      if (e.description.includes('库存')) e.target['食物缓冲周数'] = this['库存'] / Math.max(0.01, this['需求量'])
    }
  }
}

class Fuel {
  description = "燃料（煤→油中期转型）。Extraction District 开采，Generator 燃烧产热。极难下最大持续消耗。"
  name = "燃料"
  attrs = {
    煤产出: 20,
    油产出: 0,
    库存: 200,
    转油进度: 0
  }
  process({ dt }) {
    for (const e of this.edges || []) {
      if (e.description.includes('产热')) e.target['供应量'] = this['煤产出'] + this['油产出']
    }
  }
}

class Materials {
  description = "原材料。Extraction District 开采 Frozen Forest / Iron Vein。用于维护 District + 生产 Prefabs/Goods。短缺→Squalor。"
  name = "材料"
  attrs = {
    产出: 10,
    库存: 50,
    效率惩罚: 0
  }
  process({ dt }) {
    const effective = this['产出'] * (1 - this['效率惩罚'])
    this['库存'] += effective * dt
    for (const e of this.edges || []) {
      if (e.description.includes('原料')) e.target['原料输入'] = effective
    }
  }
}

class Prefabs {
  description = "预制件。Industrial District 加工 Materials 产出。建 District/Building/Hub 必需。极重要建设货币。"
  name = "预制件"
  attrs = {
    产出: 5,
    库存: 40,
    建造成本: 50,
    原料输入: 0
  }
  process({ dt }) {
    this['产出'] = Math.floor(this['原料输入'] * 0.5)
    this['库存'] += this['产出'] * dt
  }
}

class Heatstamps {
  description = "热币。通用货币，来自人口基数 + Goods 满足 + 法律。建 District / 研究 / 派系交易均需。"
  name = "热币"
  attrs = {
    周收入: 12,
    库存: 200,
    商品加成: 0
  }
  process({ dt }) {
    const totalIncome = this['周收入'] + this['商品加成']
    this['库存'] += totalIncome * dt
  }
}

class Goods {
  description = "商品。Industrial District 加工 Materials 产出（可切换 Prefabs↔Goods）。满足人口需求，不足触发 Crime。"
  name = "商品"
  attrs = {
    产出: 3,
    需求量: 0,
    原料输入: 0
  }
  process({ dt }) {
    this['产出'] = Math.floor(this['原料输入'] * 0.3)
    const shortage = Math.max(0, this['需求量'] - this['产出'])
    for (const e of this.edges || []) {
      if (e.description.includes('热币')) e.target['商品加成'] = this['产出'] >= this['需求量'] ? 5 : 0
      if (e.description.includes('Crime')) e.target['犯罪输入'] = shortage
    }
  }
}

class Workforce {
  description = "可用劳动力。占总人口约 60%。分配到各 District。Disease 导致有效劳动力↓，触发全系统产出下降。"
  name = "劳动力"
  attrs = {
    可用: 210,
    总人口: 350,
    比例: 0.6,
    患病率: 0
  }
  process({ dt }) {
    this['可用'] = Math.floor(this['总人口'] * this['比例'] * (1 - this['患病率']))
    for (const e of this.edges || []) {
      if (e.description.includes('食物')) e.target['效率惩罚'] = this['患病率']
      if (e.description.includes('开采')) e.target['效率惩罚'] = this['患病率']
      if (e.description.includes('加工')) e.target['效率惩罚'] = this['患病率']
    }
  }
}

class Cores {
  description = "蒸汽核心。仅 Frostland 探索获得，不可生产。用于高级建筑 + Generator 升级。最稀有资源。"
  name = "核心"
  attrs = {
    数量: 0,
    升级所需: 5,
    已发现: 0
  }
}

class FrostlandTeams {
  description = "霜地探索队。Logistics District 产出，每区 10 队。派出探索资源点/前哨站/殖民地。"
  name = "霜地队伍"
  attrs = {
    数量: 10,
    每区队伍数: 10,
    远征中: 0
  }
  process({ dt }) {
    const free = this['数量'] - this['远征中']
    for (const e of this.edges || []) {
      if (e.description.includes('探索') && free > 0) e.target['已发现'] = 1
    }
  }
}

// ===== 实例化 =====
const Population_1 = GraphStarter.add(Population)
const Shelter_1 = GraphStarter.add(Shelter)
const Heat_1 = GraphStarter.add(Heat)
const Food_1 = GraphStarter.add(Food)
const Fuel_1 = GraphStarter.add(Fuel)
const Materials_1 = GraphStarter.add(Materials)
const Prefabs_1 = GraphStarter.add(Prefabs)
const Heatstamps_1 = GraphStarter.add(Heatstamps)
const Goods_1 = GraphStarter.add(Goods)
const Workforce_1 = GraphStarter.add(Workforce)
const Cores_1 = GraphStarter.add(Cores)
const FrostlandTeams_1 = GraphStarter.add(FrostlandTeams)

// ===== 初始覆盖值 =====
Population_1['人数'] = 350
Shelter_1['容量'] = 350
Heat_1['供应量'] = 100
Food_1['日产出'] = 7
Food_1['库存'] = 100
Fuel_1['煤产出'] = 20
Fuel_1['库存'] = 200
Materials_1['产出'] = 10
Materials_1['库存'] = 50
Prefabs_1['产出'] = 5
Prefabs_1['库存'] = 40
Heatstamps_1['周收入'] = 12
Heatstamps_1['库存'] = 200
Goods_1['产出'] = 3
Workforce_1['可用'] = 210
Workforce_1['总人口'] = 350
FrostlandTeams_1['数量'] = 10
Cores_1['数量'] = 0

// ===== 依赖边（单向，从驱动者指向受影响的资源） =====
Population_1.edges = [
  { target: Shelter_1, description: '住房需求：每人需 1 容量' },
  { target: Food_1, description: '食物消耗：0.02/人/天' },
  { target: Heat_1, description: '热量需求：人口推高总需求' },
  { target: Workforce_1, description: '劳动力供应：60% 人口可用' },
  { target: Heatstamps_1, description: '热币基数：∝ 人口规模' },
  { target: Goods_1, description: '商品消耗：0.01/人/天' }
]

Shelter_1.edges = [
  { target: Population_1, description: '住房充足→Cold↓→增长支持' }
]

Heat_1.edges = [
  { target: Food_1, description: '热量→Cold↓→生产效率↑' },
  { target: Materials_1, description: '热量→Cold↓→开采效率↑' },
  { target: Workforce_1, description: '热量不足→Cold→Disease→劳动力↓' }
]

Food_1.edges = [
  { target: Population_1, description: '食物充足→增长；饥饿→死亡' },
  { target: Heat_1, description: '库存数据反馈给决策' }
]

Fuel_1.edges = [
  { target: Heat_1, description: '燃烧产热：Coal+Oil→Supply' }
]

Materials_1.edges = [
  { target: Prefabs_1, description: '加工原料→预制件' },
  { target: Goods_1, description: '加工原料→商品' }
]

Prefabs_1.edges = [
  { target: Shelter_1, description: '建 Housing District 需 200 预制件' },
  { target: Food_1, description: '建 Food District 需 200 预制件' },
  { target: Fuel_1, description: '建 Extraction 需 150 预制件' },
  { target: Materials_1, description: '建 Extraction 需 150 预制件' }
]

Heatstamps_1.edges = [
  { target: Shelter_1, description: '建区耗 40 热币' },
  { target: Food_1, description: '建区耗 40 热币' },
  { target: Fuel_1, description: '建区耗 40 热币' },
  { target: Materials_1, description: '建区耗 40 热币' },
  { target: Prefabs_1, description: '研究 Idea 耗热币' }
]

Goods_1.edges = [
  { target: Heatstamps_1, description: '商品满足→热币收入+5' },
  { target: Population_1, description: '商品不足→Crime→人口稳定↓' }
]

Workforce_1.edges = [
  { target: Food_1, description: 'Food District 需 600 劳动力' },
  { target: Fuel_1, description: 'Extraction 需 600 劳动力' },
  { target: Materials_1, description: 'Extraction 需 600 劳动力' },
  { target: Prefabs_1, description: 'Industrial 需 600 劳动力' },
  { target: Goods_1, description: 'Industrial 需 600 劳动力' }
]

FrostlandTeams_1.edges = [
  { target: Cores_1, description: '探索 Frostland 发现核心' }
]

Cores_1.edges = [
  { target: Heat_1, description: 'Generator 升级需核心' },
  { target: Fuel_1, description: '高级钻井需核心' }
]
