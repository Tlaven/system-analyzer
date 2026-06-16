import inspect
import networkx as nx
from pyvis.network import Network
from typing import List, Tuple, Any, Callable
import weakref

class GraphRegistry:
    """中央注册器"""
    _nodes = {}      # node_id -> node_info
    _edges = []      # list of (source_id, target_id, label, metadata)

    @classmethod
    def register_node(cls, node_id: int, info: dict):
        cls._nodes[node_id] = info

    @classmethod
    def register_edge(cls, source_id: int, target: Any, label: str, **metadata):
        target_id = id(target)
        cls._edges.append((source_id, target_id, label, metadata))

    @classmethod
    def get_graph_data(cls):
        return cls._nodes, cls._edges

    @classmethod
    def clear(cls):
        cls._nodes.clear()
        cls._edges.clear()


class GraphNodeBase:
    """所有参与系统图的类的基类"""
    
    def __init__(self, name: str = None):
        self.name = name or self.__class__.__name__
        self._node_id = id(self)
        
        # 主动注册节点自身信息（来自属性）
        self._register_node_info()
        
        # 主动注册输出边（来自特定内部函数）
        self._register_outgoing_edges()

    def _register_node_info(self):
        """节点信息 = class 的属性（可自定义过滤）"""
        info = {
            "name": self.name,
            "type": self.__class__.__name__,
            "id": self._node_id,
        }
        
        # 收集所有非私有属性（可根据需要调整过滤逻辑）
        for attr_name, attr_value in vars(self).items():
            if not attr_name.startswith('_'):  # 排除私有属性
                info[attr_name] = self._safe_value(attr_value)
        
        GraphRegistry.register_node(self._node_id, info)

    def _safe_value(self, value: Any) -> Any:
        """避免不可序列化值"""
        if callable(value) or isinstance(value, (list, dict, tuple, set)):
            return str(value)[:200]  # 简化
        return value

    def _register_outgoing_edges(self):
        """查找并执行 class 中特定形式的输出边函数"""
        for name, method in inspect.getmembers(self, predicate=inspect.ismethod):
            if hasattr(method, '_is_outgoing_edge'):  # 通过装饰器标记
                method()  # 执行该方法，让它主动注册边

    def get_node_id(self):
        return self._node_id


# ==================== 装饰器：标记输出边函数 ====================
def outgoing_edge(label: str = "influences"):
    """装饰器：把方法标记为输出边生成器"""
    def decorator(func: Callable):
        func._is_outgoing_edge = True
        func._edge_label = label
        return func
    return decorator


# ==================== 使用示例 ====================
class Processor(GraphNodeBase):
    def __init__(self, name: str):
        super().__init__(name)
        self.input_data = None
        self.output_buffer = []
        self.next_stage = None   # 示例属性

    @outgoing_edge(label="processes_to")
    def emit_to_next(self):
        """特定形式的输出边函数"""
        if self.next_stage:
            GraphRegistry.register_edge(
                self.get_node_id(),
                self.next_stage,
                label="processes_to",
                description="数据处理后流向",
                weight=1.0
            )

    @outgoing_edge(label="depends_on")
    def declare_dependency(self):
        """可以有多个输出边函数"""
        # 可以动态逻辑，例如读取配置决定目标
        if hasattr(self, 'db'):
            GraphRegistry.register_edge(
                self.get_node_id(), self.db, "depends_on", reason="需要数据库"
            )


class Database(GraphNodeBase):
    def __init__(self, name: str):
        super().__init__(name)
        self.tables = []

    # 可以不定义任何 @outgoing_edge


# ==================== 系统启动后统一生成图 ====================
def build_system_graph(output_html="system_graph.html"):
    GraphRegistry.clear()  # 可选
    
    # === 这里模拟所有实例启动 ===
    db = Database("MainDB")
    proc1 = Processor("ProcessorA")
    proc2 = Processor("ProcessorB")
    
    proc1.next_stage = db
    proc2.next_stage = db
    # proc1.db = db   # 如果需要

    # === 收集并生成图 ===
    nodes, edges = GraphRegistry.get_graph_data()
    
    G = nx.DiGraph()
    for nid, info in nodes.items():
        label = f"{info['name']}\n({info['type']})"
        G.add_node(nid, label=label, title=str(info))
    
    for src, tgt, label, meta in edges:
        G.add_edge(src, tgt, label=label, **meta)
    
    # 生成交互式 HTML 系统图
    net = Network(directed=True, height="1000px", width="100%", bgcolor="#1e1e1e", font_color="#ffffff")
    net.from_nx(G)
    net.show(output_html)
    print(f"系统图已生成: {output_html}")


# 使用
if __name__ == "__main__":
    build_system_graph()