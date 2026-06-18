// 产品研发流水线（Code 模式）：PM → Design → Dev → QA → Release。
// v0.9 边在实例级 attrs.edges，每条 { target, description }。

class PM {
  description = "产品经理：定义需求，对齐目标和优先级"
  name = "PM"
  attrs = { requirements: '' }
  process({ dt }) {
    for (const e of this.edges || []) e.target.input = this.requirements
  }
}

class Design {
  description = "设计师：产出设计稿和原型"
  name = "设计"
  attrs = { input: '' }
  process({ dt }) {
    for (const e of this.edges || []) e.target.input = this.input + ' + 设计稿'
  }
}

class Dev {
  description = "开发：实现功能"
  name = "开发"
  attrs = { input: '' }
  process({ dt }) {
    for (const e of this.edges || []) e.target.input = this.input + ' + 实现'
  }
}

class QA {
  description = "测试：验证质量"
  name = "QA"
  attrs = { input: '' }
  process({ dt }) {
    for (const e of this.edges || []) e.target.input = this.input + ' + 验证通过'
  }
}

class Release {
  description = "上线：用户用上新功能"
  name = "上线"
  attrs = { input: '' }
}

const PM_1 = GraphStarter.add(PM)
const Design_1 = GraphStarter.add(Design)
const Dev_1 = GraphStarter.add(Dev)
const QA_1 = GraphStarter.add(QA)
const Release_1 = GraphStarter.add(Release)

PM_1.requirements = '需求 A'
PM_1.edges = [{ target: Design_1, description: '提需求 + 设计要求' }]
Design_1.edges = [{ target: Dev_1, description: '交付设计稿' }]
Dev_1.edges = [{ target: QA_1, description: '提交测试' }]
QA_1.edges = [{ target: Release_1, description: '验收通过' }]
