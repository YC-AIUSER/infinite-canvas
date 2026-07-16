import dagre from "@dagrejs/dagre";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../../types/canvas";

export type LayoutPoint = { x: number; y: number };
export type LayoutOptions = { nodeSep?: number; rankSep?: number };

// 组感知的分层流向布局(基于 dagre / Sugiyama,top→bottom 从上往下):
// - 每个组(type==="group" 容器 + 其 groupId 成员)折叠成一个"整块"参与流向布局,
//   块移动后容器与成员按同一位移刚性平移——组内部布局完全不动(那是 app 内 reconcile 的地盘,
//   tidy 若重排组内会与之打架);
// - 组外散节点按 dagre 分层(长边插虚拟点路由、层内降交叉、坐标对齐);
// - 连线端点若落在组成员上,重定向到其所属块;组内边(两端同块)忽略;
// - 纯游离散节点(无任何连线且不属于任何组)收到画布下方一行;dagre 未定位到的节点回退原坐标。
// 无组画布退化为普通散点流向布局,行为不变。
export function computeAutoLayout(nodes: CanvasNodeData[], connections: CanvasConnection[], options: LayoutOptions = {}): Map<string, LayoutPoint> {
    const nodeSep = options.nodeSep ?? 40; // 同层节点横向间距
    const rankSep = options.rankSep ?? 300; // 层间纵向间距(留足呼吸感)

    const byId = new Map(nodes.map((node) => [node.id, node]));
    const result = new Map<string, LayoutPoint>();

    // 组容器与成员归属。
    const containerIds = new Set(nodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id));
    const memberContainer = new Map<string, string>(); // 成员 id -> 容器 id
    const membersOf = new Map<string, string[]>(); // 容器 id -> 成员 id[]
    for (const node of nodes) {
        const groupId = node.metadata?.groupId;
        if (!groupId || node.type === CanvasNodeType.Group || !containerIds.has(groupId)) continue;
        memberContainer.set(node.id, groupId);
        let list = membersOf.get(groupId);
        if (!list) {
            list = [];
            membersOf.set(groupId, list);
        }
        list.push(node.id);
    }
    // 节点所属"块":成员归容器,容器与散节点归自身。
    const blockOf = (id: string) => memberContainer.get(id) ?? id;

    // 每个容器块的当前外接框(容器 + 成员并集),整块作为一个 dagre 节点。
    const blockBounds = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const containerId of containerIds) {
        const container = byId.get(containerId)!;
        let minX = container.position.x;
        let minY = container.position.y;
        let maxX = container.position.x + container.width;
        let maxY = container.position.y + container.height;
        for (const memberId of membersOf.get(containerId) ?? []) {
            const member = byId.get(memberId)!;
            minX = Math.min(minX, member.position.x);
            minY = Math.min(minY, member.position.y);
            maxX = Math.max(maxX, member.position.x + member.width);
            maxY = Math.max(maxY, member.position.y + member.height);
        }
        blockBounds.set(containerId, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    }

    // 边:端点重定向到所属块,去自环(组内边)、去重。
    const seenEdge = new Set<string>();
    const blockHasEdge = new Set<string>();
    const edges: { from: string; to: string }[] = [];
    for (const conn of connections) {
        if (!byId.has(conn.fromNodeId) || !byId.has(conn.toNodeId)) continue;
        const from = blockOf(conn.fromNodeId);
        const to = blockOf(conn.toNodeId);
        if (from === to) continue;
        const key = `${from}->${to}`;
        if (seenEdge.has(key)) continue;
        seenEdge.add(key);
        edges.push({ from, to });
        blockHasEdge.add(from);
        blockHasEdge.add(to);
    }

    // dagre 节点 = 所有容器块 + 有边的散节点;纯游离散节点走下方一行。
    const standalone = nodes.filter((node) => node.type !== CanvasNodeType.Group && !memberContainer.has(node.id));
    const dagreStandalone = standalone.filter((node) => blockHasEdge.has(node.id));
    const isolated = standalone.filter((node) => !blockHasEdge.has(node.id));

    if (containerIds.size > 0 || dagreStandalone.length > 0) {
        const graph = new dagre.graphlib.Graph();
        graph.setGraph({ rankdir: "TB", nodesep: nodeSep, ranksep: rankSep, marginx: 0, marginy: 0 });
        graph.setDefaultEdgeLabel(() => ({}));
        for (const containerId of containerIds) {
            const bounds = blockBounds.get(containerId)!;
            graph.setNode(containerId, { width: bounds.w, height: bounds.h });
        }
        for (const node of dagreStandalone) graph.setNode(node.id, { width: node.width, height: node.height });
        for (const edge of edges) graph.setEdge(edge.from, edge.to);
        dagre.layout(graph);

        // 散节点:dagre 中心坐标换算成左上角。
        for (const node of dagreStandalone) {
            const laid = graph.node(node.id);
            if (laid) result.set(node.id, { x: laid.x - node.width / 2, y: laid.y - node.height / 2 });
        }
        // 容器块:按块位移把容器 + 成员整体刚性平移(不动组内相对布局)。
        for (const containerId of containerIds) {
            const laid = graph.node(containerId);
            const bounds = blockBounds.get(containerId)!;
            if (!laid) continue;
            const dx = laid.x - bounds.w / 2 - bounds.x;
            const dy = laid.y - bounds.h / 2 - bounds.y;
            const container = byId.get(containerId)!;
            result.set(containerId, { x: container.position.x + dx, y: container.position.y + dy });
            for (const memberId of membersOf.get(containerId) ?? []) {
                const member = byId.get(memberId)!;
                result.set(memberId, { x: member.position.x + dx, y: member.position.y + dy });
            }
        }
    }

    // 游离散节点:排到已布局内容下方一行。
    let bottom = 0;
    let left = 0;
    if (result.size > 0) {
        let maxY = -Infinity;
        let minX = Infinity;
        for (const [id, point] of result) {
            const node = byId.get(id)!;
            maxY = Math.max(maxY, point.y + node.height);
            minX = Math.min(minX, point.x);
        }
        bottom = maxY === -Infinity ? 0 : maxY;
        left = minX === Infinity ? 0 : minX;
    }
    let floatX = left;
    const floatY = bottom + nodeSep * 4;
    for (const node of isolated) {
        result.set(node.id, { x: floatX, y: floatY });
        floatX += node.width + rankSep;
    }

    // 兜底:未被定位的节点保留原坐标。
    for (const node of nodes) {
        if (!result.has(node.id)) result.set(node.id, { x: node.position.x, y: node.position.y });
    }

    return result;
}
