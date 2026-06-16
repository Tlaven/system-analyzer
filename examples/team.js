class PM {
  static description = "产品经理：定义需求，对齐目标和优先级"
  constructor() { this.requirements = ''; this.next = null }
  process({ dt }) { this.next.input = this.requirements }
}

class Design {
  static description = "设计师：产出设计稿和原型"
  constructor() { this.input = ''; this.next = null }
  process({ dt }) { this.next.input = this.input + ' + 设计稿' }
}

class Dev {
  static description = "开发：实现功能"
  constructor() { this.input = ''; this.next = null }
  process({ dt }) { this.next.input = this.input + ' + 实现' }
}

class QA {
  static description = "测试：验证质量"
  constructor() { this.input = ''; this.next = null }
  process({ dt }) { this.next.input = this.input + ' + 验证通过' }
}

class Release {
  static description = "上线：用户用上新功能"
  constructor() { this.input = '' }
}

const pm = GraphStarter.add(PM)
const design = GraphStarter.add(Design)
const dev = GraphStarter.add(Dev)
const qa = GraphStarter.add(QA)
const release = GraphStarter.add(Release)

pm.requirements = '需求 A'
pm.next = design
design.next = dev
dev.next = qa
qa.next = release

GraphStarter.describe(pm, 'next', '提需求 + 设计要求')
GraphStarter.describe(design, 'next', '交付设计稿')
GraphStarter.describe(dev, 'next', '提交测试')
GraphStarter.describe(qa, 'next', '验收通过')
