import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Y轴遮挡排序控制器
 * 根据节点的Y坐标动态调整zIndex，实现近大远小的遮挡效果
 * Y值越小（离玩家越近）的节点渲染在上层
 */
@ccclass('ZOrderController')
export class ZOrderController extends Component {
    @property({ type: [Node], tooltip: '需要参与排序的节点列表' })
    sortableNodes: Node[] = [];

    update(dt: number) {
        // 收集所有需要排序的节点及其Y坐标
        const nodesWithY = this.sortableNodes
            .filter(node => node && node.isValid && node.active)
            .map(node => ({ node, y: node.worldPosition.y }))
            .sort((a, b) => b.y - a.y); // Y值大的排前面（远处）

        // 按Y值降序分配zIndex（Y值越小，zIndex越大，渲染越靠上）
        for (let i = 0; i < nodesWithY.length; i++) {
            const { node, y } = nodesWithY[i];
            const zIndex = i * 10; // 使用10的倍数，留出空间
            if (node.zIndex !== zIndex) {
                node.zIndex = zIndex;
            }
        }
    }
}
