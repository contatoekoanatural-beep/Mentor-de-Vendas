// Last Unified Patch: 2026-02-06T19:40-03:00 - UI State Persistence Fix
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    ReactFlow,
    Controls,
    Background,
    addEdge,
    useNodesState,
    useEdgesState,
    MarkerType,
    Panel,
    type Connection,
    type Edge,
    type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    Save,
    Trash2,
    FileText,
    GitBranch,
    Zap,
    Layout,
    Wand2,
    Maximize2,
    Minimize2,
    RefreshCw, // Icone para sync
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../../contexts/AuthContext';
import { saveFunnelFlowchart, createScript, updateScript, deleteScript, getScripts } from '../../services/firebase';
import { useToast } from '../../contexts/ToastContext';
import { ConfirmModal } from '../ui/ConfirmModal';
import ScriptNode from '../flowchart/nodes/ScriptNode';
import EventNode from '../flowchart/nodes/EventNode';
import DecisionNode from '../flowchart/nodes/DecisionNode';
import type { FlowchartNodeType, FlowchartNode, FlowchartEdge, Flowchart, Script, DecisionBranch, ConditionRule } from '../../types';

// Local React Flow node/edge typings used within this component
interface FlowNode {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: { label: string; nodeType: FlowchartNodeType; description: string; scriptId?: string | null };
    style?: Record<string, string>;
}


type FlowchartTabProps = {
    funnelId?: string | null;
    productId?: string | null;
    initialData?: Flowchart | null;
    scripts?: Script[];
    onScriptUpdate?: (scriptId: string, patch: Partial<Script>) => Promise<void>;
    onScriptsChange?: () => void;
    onSave?: (flowchart: Flowchart) => void;
};
import { getLayoutedElements } from '../flowchart/utils/autoLayout';

// Helper: Ordenação Topológica para definir ordem sequencial dos scripts
function getTopologicalOrder(nodes: FlowNode[], edges: Edge[]): FlowNode[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    nodes.forEach(node => {
        inDegree.set(node.id, 0);
        adj.set(node.id, []);
    });

    edges.forEach(edge => {
        if (adj.has(edge.source) && adj.has(edge.target)) {
            adj.get(edge.source)!.push(edge.target);
            inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
        }
    });

    const queue: string[] = [];
    nodes.forEach(node => {
        if (inDegree.get(node.id) === 0) {
            queue.push(node.id);
        }
    });

    const result: string[] = [];
    while (queue.length > 0) {
        const u = queue.shift()!;
        result.push(u);

        adj.get(u)!.forEach(v => {
            inDegree.set(v, (inDegree.get(v)! - 1));
            if (inDegree.get(v) === 0) {
                queue.push(v);
            }
        });
    }

    // Se houver ciclos ou nós isolados não alcançados, adicionar ao final
    const processedIds = new Set(result);
    const resultNodes = result.map(id => nodes.find(n => n.id === id)!);

    nodes.forEach(n => {
        if (!processedIds.has(n.id)) {
            resultNodes.push(n);
        }
    });

    return resultNodes;
}

// BFS execution order from a start node id (returns array of nodeIds)
function computeExecutionOrder(startNodeId: string | null | undefined, nodes: FlowNode[], edges: Edge[]): string[] {
    if (!startNodeId) return [];
    const adj = new Map<string, string[]>();
    nodes.forEach(n => adj.set(n.id, []));
    edges.forEach(e => {
        if (adj.has(e.source)) {
            adj.get(e.source)!.push(e.target);
        }
    });

    const q: string[] = [];
    const visited = new Set<string>();
    if (adj.has(startNodeId)) q.push(startNodeId);

    const result: string[] = [];
    while (q.length) {
        const u = q.shift()!;
        if (visited.has(u)) continue;
        visited.add(u);
        result.push(u);
        const neigh = adj.get(u) || [];
        for (const v of neigh) {
            if (!visited.has(v)) q.push(v);
        }
    }
    return result;
}
export default function FlowchartTab({ funnelId, productId, initialData, scripts = [], onScriptUpdate, onScriptsChange, onSave }: FlowchartTabProps) {
    const { user } = useAuth();
    const { addToast } = useToast();
    const lastSavedTimeRef = useRef<string | null>(null);
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
        isDestructive: false,
        confirmText: 'Confirmar'
    });

    const closeConfirm = () => setConfirmModal(prev => ({ ...prev, isOpen: false }));

    const openConfirm = (title: string, message: string, onConfirm: () => void, isDestructive = false, confirmText = 'Confirmar') => {
        setConfirmModal({
            isOpen: true,
            title,
            message,
            onConfirm: () => {
                onConfirm();
                closeConfirm();
            },
            isDestructive,
            confirmText
        });
    };

    // Registrar tipos de nós
    const nodeTypes = useMemo(() => ({
        step: ScriptNode,
        start: EventNode,
        end: EventNode,
        decision: DecisionNode,
        note: ScriptNode,
    }), []);

    const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [isFullScreen, setIsFullScreen] = useState(false);

    const [rfInstance, setRfInstance] = useState<ReactFlowInstance<FlowNode, Edge> | null>(null);

    // Auto-fit view when switching to full screen
    useEffect(() => {
        if (rfInstance) {
            setTimeout(() => {
                rfInstance.fitView({ padding: 0.1 });
            }, 100);
        }
    }, [isFullScreen, rfInstance]);

    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [editLabel, setEditLabel] = useState('');
    const [editDescription, setEditDescription] = useState('');

    // Função para aplicar Auto-Layout
    const onLayout = useCallback((direction = 'TB') => {
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
            nodes,
            edges,
            direction
        );

        setNodes([...layoutedNodes] as unknown as FlowNode[]);
        setEdges([...layoutedEdges]);
    }, [nodes, edges, setNodes, setEdges]);

    // Load initial data
    useEffect(() => {
        const loadFlowchart = () => {
            setLoading(true);
            try {
                const data = initialData;
                console.log(`[FlowchartDebug] initialData recebido:`, data ? {
                    nodes: data.nodes.length,
                    updatedAt: data.updatedAt,
                    version: data.version
                } : 'null');

                if (data) {
                    // Normalizar comparação de tempo (Pode vir como String ISO ou Timestamp do Firebase)
                    const getMs = (val: any) => {
                        // Se for nulo (ex: remount ou dado sem data), retornamos -1 
                        // para garantir que a comparação de remount NUNCA seja menor que 2s.
                        if (!val) return -1;
                        if (typeof val === 'string') return new Date(val).getTime();
                        if (typeof val === 'object') {
                            if ('toMillis' in val && typeof val.toMillis === 'function') return val.toMillis();
                            if ('seconds' in val) return (val.seconds || 0) * 1000;
                            // Se for serverTimestamp pendente no dado recebido
                            return Date.now();
                        }
                        return 0;
                    };

                    const currentDataTime = getMs(data.updatedAt || data.createdAt);
                    const lastSavedTime = getMs(lastSavedTimeRef.current);

                    // Evitar recarregar se for o mesmo dado que acabamos de salvar (margem de 2s para segurança)
                    if (currentDataTime > 0 && Math.abs(currentDataTime - lastSavedTime) < 2000) {
                        setLoading(false);
                        return;
                    }
                    // ... rest of loading logic

                    const rfNodes = data.nodes.map((n) => ({
                        id: n.nodeId,
                        type: n.type === 'start' || n.type === 'end' ? n.type :
                            n.type === 'decision' ? 'decision' :
                                n.type === 'step' ? 'step' : 'default',
                        position: n.position,
                        data: {
                            label: n.title,
                            nodeType: n.type,
                            description: n.description,
                            scriptId: n.scriptId, // Carregar scriptId persistido
                        },
                    }));
                    // Sanitizar nós removendo duplicatas de ID
                    const uniqueRFNodes = Array.from(new Map(rfNodes.map(node => [node.id, node])).values());
                    setNodes(uniqueRFNodes as unknown as FlowNode[]);

                    const rfEdges = data.edges.map((e) => ({
                        id: e.edgeId,
                        source: e.fromNodeId,
                        target: e.toNodeId,
                        sourceHandle: e.sourceHandle,
                        targetHandle: e.targetHandle,
                        label: e.label,
                        type: 'smoothstep', // Forçar visual moderno
                        markerEnd: { type: MarkerType.ArrowClosed },
                        style: { stroke: '#94a3b8', strokeWidth: 2 },
                        animated: true, // Forçar animação para padronizar com as novas
                    }));

                    // Sanitizar arestas removendo duplicatas de ID
                    const uniqueRFEdges = Array.from(new Map(rfEdges.map(edge => [edge.id, edge])).values());
                    setEdges(uniqueRFEdges);
                } else {
                    setNodes([]);
                    setEdges([]);
                }
            } catch (error) {
                console.error('Error loading flowchart:', error);
            }
            setLoading(false);
        };

        if (funnelId) {
            loadFlowchart();
        }
    }, [funnelId, initialData, setNodes, setEdges]);

    // Update edit form when selection changes
    useEffect(() => {
        if (selectedNodeId) {
            const node = nodes.find((n) => n.id === selectedNodeId);
            if (node) {
                setEditLabel(node.data.label);
                setEditDescription(node.data.description);
            }
        } else {
            setEditLabel('');
            setEditDescription('');
        }
    }, [selectedNodeId, nodes]);

    // Smart Connectors: Bézier
    const onConnect = useCallback(
        (params: Connection) => {
            const newEdge = {
                id: uuidv4(),
                source: params.source || '',
                target: params.target || '',
                sourceHandle: params.sourceHandle, // Importante: preservar o handle de origem (esquerda/direita)
                targetHandle: params.targetHandle,
                type: 'smoothstep', // Usar smoothstep para consistência com o resto
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { stroke: '#94a3b8', strokeWidth: 2 },
                animated: true,
                label: params.sourceHandle === 'true' ? 'Sim' : params.sourceHandle === 'false' ? 'Não' : '', // Label automático
                labelStyle: { fill: '#64748b', fontWeight: 600, fontSize: 12, background: 'white' }
            } as Edge;
            setEdges((eds) => addEdge(newEdge, eds));
        },
        [setEdges]
    );

    const addNode = (type: FlowchartNodeType) => {
        const newNode: FlowNode = {
            id: uuidv4(),
            type: type === 'start' || type === 'end' ? type :
                type === 'decision' ? 'decision' :
                    type === 'step' ? 'step' : 'default',
            position: { x: 250, y: 50 }, // Posição inicial será corrigida pelo auto-layout
            data: {
                label: type === 'step' ? 'Novo Script' :
                    type === 'decision' ? 'Nova Decisão' :
                        type === 'start' ? 'Início' : 'Fim',
                nodeType: type,
                description: '',
            },
        };

        setNodes((nds) => {
            // Adiciona pequeno offset aleatório para evitar sobreposição total se adicionar vários rapidamente
            const offset = Math.random() * 50;
            const nodeWithOffset = {
                ...newNode,
                position: { x: 250 + offset, y: 50 + offset }
            };
            return [...nds, nodeWithOffset];
        });
    };

    /**
     * Atualiza o nó selecionado e sincroniza com o script vinculado (se houver)
     */
    const updateSelectedNode = async () => {
        if (!selectedNodeId) return;

        // Encontrar o nó atual para pegar o scriptId
        const currentNode = nodes.find(n => n.id === selectedNodeId);
        const scriptId = currentNode?.data?.scriptId;

        // Atualizar o nó localmente
        setNodes((nds) =>
            nds.map((n) =>
                n.id === selectedNodeId
                    ? {
                        ...n,
                        data: {
                            ...n.data,
                            label: editLabel,
                            description: editDescription,
                        },
                    }
                    : n
            )
        );

        // Sincronizar com o script vinculado (se houver callback e scriptId)
        if (scriptId && onScriptUpdate) {
            try {
                await onScriptUpdate(scriptId, {
                    name: editLabel,
                    content: editDescription,
                });
                onScriptsChange?.();
            } catch (error) {
                console.error('Error syncing script update:', error);
            }
        }
    };

    const deleteSelectedNode = () => {
        if (!selectedNodeId) return;

        setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
        setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
        setSelectedNodeId(null);
    };

    const handleSave = async (silent = false) => {
        if (!funnelId || !user) {
            console.error('[FlowchartDebug] Falha no salvamento: funnelId ou usuário não encontrado');
            return;
        }

        console.log(`[FlowchartDebug] handleSave iniciado para o funil: ${funnelId}. Nós em tela: ${nodes.length}`);
        setSaving(true);
        try {
            const currentNodes = rfInstance ? rfInstance.getNodes() : nodes;
            const currentEdges = rfInstance ? rfInstance.getEdges() : edges;

            const storageNodes: FlowchartNode[] = currentNodes.map((n) => ({
                nodeId: n.id,
                type: (n.data as any)?.nodeType || 'step',
                title: (n.data as any)?.label || '',
                description: (n.data as any)?.description || '',
                position: n.position || { x: 0, y: 0 },
                scriptId: (n.data as any)?.scriptId ?? null,
            }));

            const storageEdges: FlowchartEdge[] = currentEdges.map((e) => ({
                edgeId: e.id,
                fromNodeId: e.source,
                toNodeId: e.target,
                label: (typeof e.label === 'string' ? e.label : '') || '',
                sourceHandle: e.sourceHandle ?? null,
                targetHandle: e.targetHandle ?? null,
            }));

            const userId = user.id;

            const savedId = await saveFunnelFlowchart(funnelId, {
                productIds: productId ? [productId] : [],
                title: initialData?.title || 'Fluxograma do Funil',
                scope: 'detailed',
                changeNote: 'Atualização do fluxograma',
                nodes: storageNodes,
                edges: storageEdges,
                createdBy: userId
            }, userId);

            const flowchartData: Flowchart = {
                id: savedId,
                productIds: productId ? [productId] : [],
                funnelId: funnelId,
                title: initialData?.title || 'Fluxograma do Funil',
                scope: 'detailed',
                changeNote: 'Atualização do fluxograma',
                nodes: storageNodes,
                edges: storageEdges,
                createdBy: userId,
                version: (initialData?.version || 0) + 1,
                createdAt: initialData?.createdAt || null as any,
                updatedAt: new Date().toISOString(),
                startNodeId: storageNodes.find(n => n.type === 'start')?.nodeId || null,
            };

            lastSavedTimeRef.current = flowchartData.updatedAt as string;
            if (onSave) onSave(flowchartData);
            if (!silent) addToast('Fluxograma salvo com sucesso!', 'success');
        } catch (error) {
            console.error('Error saving flowchart:', error);
            if (!silent) addToast('Erro ao salvar fluxograma', 'error');
        } finally {
            setSaving(false);
        }
    };

    /**
     * Gera fluxograma automaticamente baseado nos scripts do funil.
     * Cada script se torna um nó - detecta automaticamente se é decisão (losango) ou conteúdo (retângulo).
     */
    const handleGenerateDraft = async () => {
        const executeGeneration = async () => {

            setGenerating(true);
            try {
                // Usar scripts passados como prop
                if (scripts.length === 0) {
                    addToast('Nenhum script encontrado neste funil. Crie scripts primeiro na aba "Scripts".', 'warning');
                    setGenerating(false);
                    return;
                }

                // Ordenar scripts por ordem (se definida) ou por data de criação
                const sortedScripts = [...scripts].sort((a, b) => {
                    if (a.order !== undefined && b.order !== undefined) {
                        return a.order - b.order;
                    }
                    // Fallback: ordenar por data de criação se disponível
                    return 0;
                });

                // Mapa para buscar nodeId pelo scriptId
                const scriptToNodeMap = new Map<string, string>();
                const newNodes: FlowNode[] = [];
                const newEdges: Edge[] = [];

                // Nó de INÍCIO
                const startId = uuidv4();
                newNodes.push({
                    id: startId,
                    type: 'start',
                    position: { x: 0, y: 0 },
                    data: { label: 'Início', nodeType: 'start', description: 'Início do funil' }
                });

                // Passada 1: Criar nós para todos os scripts
                sortedScripts.forEach((script) => {
                    const nodeId = uuidv4();
                    scriptToNodeMap.set(script.id, nodeId);

                    // Usar nodeType definido no script, ou detectar automaticamente
                    let nodeType: FlowchartNodeType = (script.nodeType as FlowchartNodeType) || 'step';

                    // Compatibilidade: detectar decisão pelo nome se não tiver nodeType definido
                    if (!script.nodeType) {
                        if (/decisão|decisao|pergunta|condição|condicao|se\s|if\s/i.test(script.name)) {
                            nodeType = 'decision';
                        }
                    }

                    const rfNodeType = nodeType === 'decision' ? 'decision'
                        : nodeType === 'link_in' || nodeType === 'link_out' ? 'event'
                            : 'step';

                    const labelPrefix = nodeType === 'link_in' ? '🔵 '
                        : nodeType === 'link_out' ? '🔴 '
                            : '';

                    // Para decisão, mostrar critério na descrição se houver
                    const description = nodeType === 'decision' && script.decisionCriteria
                        ? script.decisionCriteria
                        : script.content;

                    newNodes.push({
                        id: nodeId,
                        type: rfNodeType,
                        position: { x: 0, y: 0 },
                        data: {
                            label: labelPrefix + script.name,
                            nodeType: nodeType,
                            description: description,
                            scriptId: script.id
                        }
                    });
                });

                // Nó de FIM
                const endId = uuidv4();
                newNodes.push({
                    id: endId,
                    type: 'end',
                    position: { x: 0, y: 0 },
                    data: { label: 'Fim', nodeType: 'end', description: 'Fim do funil' }
                });

                // Passada 2: Criar arestas (Edges)

                // Conectar Início ao primeiro script (se houver)
                if (sortedScripts.length > 0) {
                    newEdges.push({
                        id: uuidv4(),
                        source: startId,
                        target: scriptToNodeMap.get(sortedScripts[0].id)!,
                        type: 'smoothstep',
                        markerEnd: { type: MarkerType.ArrowClosed },
                        style: { stroke: '#94a3b8', strokeWidth: 2 }
                    });
                } else {
                    // Se não tem script, inicio -> fim
                    newEdges.push({
                        id: uuidv4(),
                        source: startId,
                        target: endId,
                        type: 'smoothstep',
                        markerEnd: { type: MarkerType.ArrowClosed },
                        style: { stroke: '#94a3b8', strokeWidth: 2 }
                    });
                }

                sortedScripts.forEach((script, index) => {
                    const sourceNodeId = scriptToNodeMap.get(script.id)!;

                    // Se for decisão e tiver branches definidos
                    if (script.nodeType === 'decision' && script.branches && script.branches.length > 0) {
                        script.branches.forEach((branch) => {
                            // Só criar edge se tiver destino e o destino for um script válido deste funil
                            if (branch.targetStepId && scriptToNodeMap.has(branch.targetStepId)) {
                                // Determinar handle de saída baseado no nome do branch
                                let sourceHandle = 'next'; // Default (bottom)
                                if (/sim|s|yes|y|verdadeiro|true/i.test(branch.name)) {
                                    sourceHandle = 'true'; // Right handle
                                } else if (/n[ãa]o|n|no|falso|false/i.test(branch.name)) {
                                    sourceHandle = 'false'; // Left handle
                                }

                                newEdges.push({
                                    id: uuidv4(),
                                    source: sourceNodeId,
                                    sourceHandle: sourceHandle,
                                    target: scriptToNodeMap.get(branch.targetStepId)!,
                                    type: 'smoothstep', // Melhora visualização de branches laterais
                                    label: branch.name,
                                    markerEnd: { type: MarkerType.ArrowClosed },
                                    style: { stroke: '#94a3b8', strokeWidth: 2 },
                                    labelStyle: { fill: '#64748b', fontWeight: 600, fontSize: 12, background: 'white' }
                                });
                            }
                        });
                        // Nota: Se um branch não tiver destino, fica desconectado (correto)
                    } else {
                        // Script normal ou decisão sem branches configurados -> Segue o fluxo linear
                        if (index < sortedScripts.length - 1) {
                            const nextScript = sortedScripts[index + 1];
                            newEdges.push({
                                id: uuidv4(),
                                source: sourceNodeId,
                                target: scriptToNodeMap.get(nextScript.id)!,
                                type: 'smoothstep',
                                markerEnd: { type: MarkerType.ArrowClosed },
                                style: { stroke: '#94a3b8', strokeWidth: 2 }
                            });
                        } else {
                            // Último script -> Fim
                            newEdges.push({
                                id: uuidv4(),
                                source: sourceNodeId,
                                target: endId,
                                type: 'smoothstep',
                                markerEnd: { type: MarkerType.ArrowClosed },
                                style: { stroke: '#94a3b8', strokeWidth: 2 }
                            });
                        }
                    }
                });

                // Aplicar auto-layout
                const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
                    newNodes,
                    newEdges,
                    'TB'
                );

                setNodes([...layoutedNodes] as unknown as FlowNode[]);
                setEdges([...layoutedEdges]);

                addToast(`Fluxograma gerado com ${sortedScripts.length} etapas (scripts)!`, 'success');

            } catch (error) {
                console.error('Error generating draft:', error);
                addToast('Erro ao gerar fluxograma', 'error');
            }
            setGenerating(false);
        };

        openConfirm(
            'Gerar Rascunho',
            'Isso substituirá o fluxograma atual pelos scripts existente. Deseja continuar?',
            executeGeneration,
            true, // Destructive
            'Substituir'
        );
    };

    // --- Nova Função: Sincronizar Fluxograma -> Scripts ---
    const handleSyncToScripts = async () => {
        if (!user) {
            addToast('Você precisa estar logado para sincronizar.', 'error');
            return;
        }

        const executeSync = async () => {
            setSaving(true);
            try {
                // Auto-save silencioso para garantir persistência dos nós atuais antes de recarregar
                await handleSave(true);

                // PASSO 0: Deletar TODOS os scripts do funnel (reset completo)
                try {
                    const allScripts = await getScripts(productId ?? undefined, funnelId ?? undefined);
                    let deletedCount = 0;
                    
                    for (const script of allScripts) {
                        try {
                            await deleteScript(script.id);
                            deletedCount++;
                        } catch (err) {
                            console.error('Erro ao deletar script:', script.id, err);
                        }
                    }
                    
                    console.log(`[FlowchartSync] Deletados ${deletedCount} scripts totais`);
                } catch (err) {
                    console.error('Erro ao buscar/deletar scripts:', err);
                }

                // 1. Identificar nó de início e calcular ordem de execução a partir dele
                const startNode = nodes.find(n => n.type === 'start');
                const startNodeId = startNode?.id;
                
                if (!startNodeId) {
                    addToast('Erro: Nenhum nó de início (start) encontrado no fluxograma!', 'error');
                    return;
                }
                
                // Executar BFS a partir do nó de início para garantir ordem correta
                const executionOrder = computeExecutionOrder(startNodeId, nodes, edges);
                
                const nodeScriptMap = new Map<string, string>();

                // 2. Criar NOVOS scripts para cada nó válido (na ordem de execução + nós start/link_out)
                // Adiciona o nó de início no começo
                if (startNodeId && !executionOrder.includes(startNodeId)) {
                    executionOrder.unshift(startNodeId);
                }
                
                // Adiciona nós de link_out que não estejam na execução
                const linkOutNodes = nodes.filter(n => n.type === 'link_out').map(n => n.id);
                for (const nodeId of linkOutNodes) {
                    if (!executionOrder.includes(nodeId)) {
                        executionOrder.push(nodeId);
                    }
                }
                
                for (const nodeId of executionOrder) {
                    const node = nodes.find(n => n.id === nodeId);
                    if (!node || (node.type !== 'start' && node.type !== 'step' && node.type !== 'decision' && node.type !== 'link_out')) continue;
                    
                    const isDecision = node.type === 'decision';
                    
                    const newScriptData: any = {
                        name: node.data.label || (isDecision ? 'Nova Decisão' : node.type === 'start' ? 'Início' : node.type === 'link_out' ? 'Saída' : 'Nova Etapa'),
                        content: node.data.description || '',
                        productIds: [productId],
                        funnelId: funnelId,
                        tags: [],
                        createdBy: user.id,
                        nodeType: node.type === 'start' ? 'start' : node.type === 'link_out' ? 'link_out' : isDecision ? 'decision' : 'step',
                        order: 999,
                        flowchartNodeId: node.id,
                        // Se este nó for link_out, propagar o targetFunnelId (se configurado no nó)
                        targetFunnelId: (node.data as any).targetFunnelId || (node.data as any).target?.funnelId || null,
                    };

                    let scriptId: string;
                    try {
                        scriptId = await createScript(newScriptData);
                        node.data.scriptId = scriptId;
                        setNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, scriptId } } : n));
                    } catch (err) {
                        console.error('Erro ao criar novo script para nó:', node.id, err);
                        throw err;
                    }

                    nodeScriptMap.set(node.id, scriptId);
                }

                // 3. Atualizar scripts com conexões e branches (mantendo ordem de execução)
                let orderIndex = 1;
                for (const nodeId of executionOrder) {
                    const scriptId = nodeScriptMap.get(nodeId);
                    if (!scriptId) continue;
                    
                    const node = nodes.find(n => n.id === nodeId);
                    if (!node || (node.type !== 'start' && node.type !== 'step' && node.type !== 'decision' && node.type !== 'link_out')) continue;
                    
                    const isDecision = node.type === 'decision';

                    // Determine nextSteps (all outgoing targets)
                    const outEdges = edges.filter(e => e.source === node.id);
                    const nextStepIds: string[] = [];
                    outEdges.forEach(e => {
                        const targetNodeId = e.target;
                        const targetScriptId = nodeScriptMap.get(targetNodeId);
                        if (targetScriptId) nextStepIds.push(targetScriptId);
                    });

                    const updateData: any = {
                        name: node.data.label,
                        content: node.data.description,
                        order: orderIndex,
                        executionOrder: orderIndex,
                        nodeType: node.type === 'start' ? 'start' : node.type === 'link_out' ? 'link_out' : isDecision ? 'decision' : 'step',
                        branches: null,
                        nextSteps: nextStepIds,
                        conditions: null,
                    };

                    // Só inclua targetFunnelId no patch se este nó for link_out —
                    // evitar enviar `undefined` ao Firestore (gerava erro)
                    if (node.type === 'link_out') {
                        updateData.targetFunnelId = ((node.data as any).targetFunnelId || (node.data as any).target?.funnelId || null);
                    }

                    if (isDecision) {
                        const branches: DecisionBranch[] = [];
                        const conditions: ConditionRule[] = [];

                        outEdges.forEach(edge => {
                            const targetNodeId = edge.target;
                            const targetScriptId = nodeScriptMap.get(targetNodeId);

                            if (targetScriptId) {
                                const branchName = (typeof edge.label === 'string' ? edge.label : '') ||
                                    (edge.sourceHandle === 'true' ? 'Sim' :
                                        edge.sourceHandle === 'false' ? 'Não' : 'Caminho');

                                branches.push({
                                    id: edge.id,
                                    name: branchName,
                                    targetStepId: targetScriptId,
                                    nextScriptId: targetScriptId,
                                });

                                // Create a simple condition rule derived from the branch label
                                conditions.push({
                                    id: edge.id,
                                    operator: 'equals',
                                    value: branchName,
                                    priority: 1,
                                    action: {
                                        type: 'goto_node',
                                        targetNodeId: targetNodeId,
                                    }
                                } as ConditionRule);
                            }
                        });

                        updateData.branches = branches;
                        updateData.decisionCriteria = node.data.description;
                        updateData.conditions = conditions;
                    }
                    await updateScript(scriptId, updateData);
                    orderIndex++;
                }

                onScriptsChange?.();
                addToast('Etapas sincronizadas com sucesso! O fluxograma agora é a referência.', 'success');

            } catch (error) {
                console.error('Error syncing to scripts:', error);
                addToast('Erro ao sincronizar etapas: ' + (error as Error).message, 'error');
            } finally {
                setSaving(false);
            }
        };

        openConfirm(
            'Sincronizar Etapas',
            'Isso criará/atualizará as Etapas baseadas no desenho atual do fluxograma. Certifique-se de salvar o fluxograma antes. Deseja continuar?',
            executeSync,
            false,
            'Sync Etapas'
        );
    };

    if (loading) {
        return <div className="p-8 text-center text-muted">Carregando editor...</div>;
    }

    const containerStyle = isFullScreen ? {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        backgroundColor: 'var(--color-bg-primary)',
        borderRadius: 0,
        border: 'none',
        display: 'flex',
        flexDirection: 'column' as const
    } : {
        height: '600px',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column' as const
    };

    return (
        <div style={containerStyle}>
            <div className="flex items-center justify-between p-2 border-b border-border bg-bg-secondary">
                <div className="flex gap-2 isolate">
                    <button className="btn btn-sm btn-secondary" onClick={() => addNode('step')} title="Script (Texto)">
                        <FileText size={14} /> <span className="hidden sm:inline">Texto</span>
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => addNode('decision')} title="Decisão">
                        <GitBranch size={14} /> <span className="hidden sm:inline">Decisão</span>
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => addNode('start')} title="Evento/Webhook">
                        <Zap size={14} /> <span className="hidden sm:inline">Evento</span>
                    </button>

                    <div className="w-px h-6 bg-border mx-2" />

                    <button className="btn btn-sm btn-ghost text-primary" onClick={() => onLayout('TB')} title="Auto Layout Vertical">
                        <Layout size={14} /> <span className="hidden sm:inline">Organizar</span>
                    </button>

                    <button
                        className="btn btn-sm btn-ghost text-error"
                        onClick={deleteSelectedNode}
                        disabled={!selectedNodeId}
                        title="Excluir"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
                <div className="flex gap-2">
                    <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setIsFullScreen(!isFullScreen)}
                        title={isFullScreen ? "Sair da Tela Cheia" : "Tela Cheia"}
                    >
                        {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>

                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={handleGenerateDraft}
                        disabled={generating}
                        title="Sobrescrever fluxograma com base nas Etapas"
                    >
                        <Wand2 size={14} />
                        Gerar Auto
                    </button>
                    <button
                        className="btn btn-sm btn-secondary text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100"
                        onClick={handleSyncToScripts}
                        disabled={saving}
                        title="Atualizar Etapas com base neste Fluxograma"
                    >
                        <RefreshCw size={14} />
                        Sync Etapas
                    </button>
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleSave(false)}
                        disabled={saving}
                    >
                        <Save size={14} />
                        {saving ? 'Salvar' : 'Salvar'}
                    </button>
                </div>
            </div>

            <div className="flex-1 relative flex overflow-hidden" style={{ height: '100%', minHeight: isFullScreen ? '0' : '500px' }}>
                <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                    <ReactFlow<FlowNode>
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypes as any}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                        onPaneClick={() => setSelectedNodeId(null)}
                        onInit={setRfInstance}
                        fitView
                        defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
                    >
                        <Background color="var(--color-border)" gap={20} />
                        <Controls />
                        <Panel position="top-right">
                            <div className="bg-white/80 p-2 rounded text-xs border border-border shadow-sm backdrop-blur-sm">
                                <div className="font-semibold mb-1 text-muted">Legenda</div>
                                <div className="flex items-center gap-1 mb-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Texto (Script)</div>
                                <div className="flex items-center gap-1 mb-1"><div className="w-2 h-2 rounded-full bg-purple-500"></div> Decisão (Lógica)</div>
                                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-500"></div> Evento (Webhook)</div>
                            </div>
                        </Panel>
                    </ReactFlow>
                </div>

                <ConfirmModal
                    isOpen={confirmModal.isOpen}
                    title={confirmModal.title}
                    message={confirmModal.message}
                    onConfirm={confirmModal.onConfirm}
                    onCancel={closeConfirm}
                    isDestructive={confirmModal.isDestructive}
                    confirmText={confirmModal.confirmText}
                />

                {selectedNodeId && (
                    <div className="w-80 border-l border-border bg-bg-secondary p-4 overflow-y-auto shadow-xl z-10 h-full">
                        <div className="flex justify-between items-center mb-4">
                            <h4 className="font-semibold text-sm">Editar Nó</h4>
                            <button onClick={() => setSelectedNodeId(null)} className="btn btn-icon btn-ghost btn-xs"><Minimize2 size={12} /></button>
                        </div>

                        <div className="form-group mb-4">
                            <label className="form-label text-xs">Título</label>
                            <input
                                type="text"
                                className="form-input"
                                value={editLabel}
                                onChange={(e) => {
                                    setEditLabel(e.target.value);
                                }}
                                onBlur={updateSelectedNode}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') updateSelectedNode();
                                }}
                            />
                        </div>

                        <div className="form-group mb-4">
                            <label className="form-label text-xs">Descrição / Conteúdo</label>
                            <textarea
                                className="form-textarea"
                                value={editDescription}
                                onChange={(e) => {
                                    setEditDescription(e.target.value);
                                }}
                                onBlur={updateSelectedNode}
                                rows={10}
                            />
                        </div>

                        <div className="mt-4 p-3 bg-blue-50/50 rounded border border-blue-100/50 text-xs text-muted">
                            <p className="font-medium mb-1 text-blue-600">Dica:</p>
                            <p>Clique em "Organizar" na barra superior para realinhar todo o fluxograma automaticamente.</p>
                            <p className="mt-2">Em tela cheia (botão no topo direita), você tem mais espaço para visualizar fluxos complexos.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
