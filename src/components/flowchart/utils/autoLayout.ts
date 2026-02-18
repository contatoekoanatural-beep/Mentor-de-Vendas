
import dagre from 'dagre';
import { type Node, type Edge, Position } from '@xyflow/react';

// Configuração padrão do Dagre
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

// Tamanhos estimados dos nós para layout
const nodeWidth = 250;
const nodeHeight = 100;

/**
 * Aplica o algoritmo de layout Dagre aos nós e arestas.
 * @param nodes Lista de nós do React Flow
 * @param edges Lista de arestas do React Flow
 * @param direction Direção do layout: 'TB' (Top-Bottom) ou 'LR' (Left-Right)
 * @returns Objetos { nodes, edges } com posições atualizadas
 */
export const getLayoutedElements = (
    nodes: Node[],
    edges: Edge[],
    direction = 'TB'
) => {
    const isHorizontal = direction === 'LR';
    dagreGraph.setGraph({ rankdir: direction });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);

        // Ajustando handles baseado na direção (opcional, se trocar dinamicamente)
        const targetPosition = isHorizontal ? Position.Left : Position.Top;
        const sourcePosition = isHorizontal ? Position.Right : Position.Bottom;

        // O Dagre retorna o centro do nó. O React Flow usa o canto superior esquerdo.
        // Ajustamos subtraindo metade da largura/altura.
        return {
            ...node,
            targetPosition,
            sourcePosition,
            position: {
                x: nodeWithPosition.x - nodeWidth / 2,
                y: nodeWithPosition.y - nodeHeight / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
};
