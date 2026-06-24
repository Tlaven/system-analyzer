class Population {
  description = '城市人口。驱动劳动力与消耗基数。住房容量内化于此，超容触发无家可归。'
  name = '人口'
  attrs = {
    总人数: null,
    劳动力总数: null,
    住房总数: null
  }
}
class Food {
  description = '食物库存与供需。产出不足则缺口上升，库存持续下降触发饥饿事件。'
  name = '食物'
  attrs = {
    库存: 0,
    '变化/周': 0
  }
}
class Fuel {
  description = '燃料（煤→油转型期）。开采产出，Generator 燃烧消耗。库存不足→停电。'
  name = '燃料'
  attrs = {
    煤: 0,
    石油: 0,
    天然气: 0
  }
}
class Materials {
  description = '原材料。开采产出，既是库存也是加工链上游：产出→预制件/商品。'
  name = '材料'
  attrs = {
    库存: 0,
    '变化/周': 0
  }
}
class Prefabs {
  description = '预制零部件。材料加工产出，建造 District/Building 消耗。建设阶段核心瓶颈。'
  name = '预制零部件'
  attrs = {
    库存: 40,
    '变化/周': 0
  }
}
class Goods {
  description = '商品。材料加工产出，满足人口需求。缺口触发犯罪率上升。'
  name = '商品'
  attrs = {
    库存: 20,
    '变化/周': 0
  }
}
class Heatstamps {
  description = '暖券。通用货币，来自人口税收+商品满足+法律。建造与研究消耗。'
  name = '暖券'
  attrs = {
    库存: 0,
    '变化/周': 0
  }
}
class Heating {
  description = ''
  attrs = {}
}

const Population_1 = GraphStarter.add(Population)
const Food_1 = GraphStarter.add(Food)
const Fuel_1 = GraphStarter.add(Fuel)
const Materials_1 = GraphStarter.add(Materials)
const Prefabs_1 = GraphStarter.add(Prefabs)
const Goods_1 = GraphStarter.add(Goods)
const Heatstamps_1 = GraphStarter.add(Heatstamps)
const Heating_1 = GraphStarter.add(Heating)
Population_1.总人数 = 8000
Population_1.劳动力总数 = 4800
Population_1.住房总数 = 2631
Population_1.劳动力剩余 = 4800
Population_1.edges = [
    { target: Heatstamps_1, description: '人口税收' },
    {
      target: Food_1,
      description: '劳动力换食物',
      transform: "target['变化/周'] = -source['总人数'] * 7 / 400"
    },
    { target: Fuel_1, description: '劳动力换燃料' },
    { target: Goods_1, description: '劳动力换商品' },
    { target: Prefabs_1, description: '劳动力换预制零部件' },
    { target: Materials_1, description: '劳动力换材料' },
    { target: Materials_1, description: '人口消耗材料' }
  ]
Food_1.库存 = 34871
Food_1.edges = [
    { target: Population_1, description: '人口消耗食物' }
  ]
Fuel_1.edges = [
    { target: Heating_1, description: '供暖消耗燃料' }
  ]
Materials_1.edges = [
    { target: Prefabs_1, description: '加工→预制件' },
    { target: Goods_1, description: '加工→商品' }
  ]
Prefabs_1.库存 = 2500
Prefabs_1.edges = [
    { target: Population_1, description: '住房消耗' }
  ]
Goods_1.库存 = 0
Goods_1.edges = [
    { target: Population_1, description: '商品消耗' }
  ]
Heatstamps_1.库存 = 500
Heatstamps_1.edges = [
    { target: Prefabs_1, description: '建立工厂消耗' },
    { target: Food_1, description: '建立工厂消耗' },
    { target: Fuel_1, description: '建立工厂消耗' },
    { target: Goods_1, description: '建立工厂消耗' },
    { target: Materials_1, description: '建立工厂消耗' }
  ]
Heating_1.name = '供暖'
Heating_1.description = '供暖需求由该系统外部决定'
