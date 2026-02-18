// ========================================
// Flowchart Editor Page
// ========================================

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
    ReactFlow,
    Controls,
    Background,
    addEdge,
    useNodesState,
    useEdgesState,
    MarkerType,
    Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    ArrowLeft,
    Save,
    Trash2,
    Circle,
    Square,
    Diamond,
    Octagon,
    StickyNote,
    Clock,
    RotateCcw,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useProduct } from '../contexts/ProductContext';
import { useAuth } from '../contexts/AuthContext';
import {
    getLocalFlowchart,
    createLocalFlowchart,
    getLocalFlowchartVersions,
    logLocalAudit,
} from '../services/localStorage';
import type { Flowchart, FlowchartNode, FlowchartEdge, FlowchartNodeType, FlowchartScope } from '../types';
import { NODE_TYPE_LABELS } from '../types';

// Custom node styles based on type
const getNodeStyle = (type: FlowchartNodeType) => {
    switch (type) {
        case 'start':
            return {
                background: 'var(--color-success-bg)',
                border: '2px solid var(--color-success)',
                borderRadius: '50%',
            };
        case 'end':
            return {
                background: 'var(--color-error-bg)',
                border: '2px solid var(--color-error)',
                borderRadius: '50%',
            };
        case 'decision':
            return {
                background: 'var(--color-warning-bg)',
                border: '2px solid var(--color-warning)',
                transform: 'rotate(45deg)',
            };
        case 'note':
            return {
                background: 'var(--color-info-bg)',
                border: '2px dashed var(--color-info)',
            };
        default:
            return {
                background: 'var(--color-bg-secondary)',
                border: '2px solid var(--color-border)',
            };
    }
};

// Define node/edge types for React Flow
interface FlowNode {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: { label: string; nodeType: FlowchartNodeType; description: string };
    style?: Record<string, string>;
}

interface FlowEdge {
    id: string;
    source: string;
    target: string;
    label?: string;
    markerEnd?: { type: MarkerType };
    style?: Record<string, string>;
}

export default function FlowchartEditor() {
    const { id } = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { activeProduct } = useProduct();
    const { user, isOwner } = useAuth();

    const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);

    const [flowchart, setFlowchart] = useState<Flowchart | null>(null);
    const [versions, setVersions] = useState<Flowchart[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [showVersions, setShowVersions] = useState(false);
    const [changeNote, setChangeNote] = useState('');
    const [title, setTitle] = useState('');
    const [selectedNode, setSelectedNode] = useState<string | null>(null);

    const isNew = id === 'new';
    const scope = (searchParams.get('scope') as FlowchartScope) || 'detailed';
    const funnelId = searchParams.get('funnelId') || undefined;

    // Load flowchart data
    useEffect(() => {
        if (!activeProduct) return;

        const fetchData = () => {
            setLoading(true);
            try {
                if (isNew) {
                    // New flowchart - initialize with start node
                    const startNode = {
                        id: uuidv4(),
                        type: 'default',
                        position: { x: 250, y: 50 },
                        data: {
                            label: 'Início',
                            nodeType: 'start' as FlowchartNodeType,
                            description: '',
                        },
                        style: getNodeStyle('start'),
                    };
                    setNodes([startNode] as FlowNode[]);
                    setTitle(scope === 'general' ? 'Fluxo Geral do Produto' : 'Fluxo do Funil');
                } else if (id) {
                    const data = getLocalFlowchart(id);
                    if (data) {
                        setFlowchart(data);
                        setTitle(data.title);

                        // Convert stored nodes to React Flow nodes
                        const rfNodes = data.nodes.map((n) => ({
                            id: n.nodeId,
                            type: 'default',
                            position: n.position,
                            data: {
                                label: n.title,
                                nodeType: n.type,
                                description: n.description,
                            },
                            style: getNodeStyle(n.type),
                        }));
                        setNodes(rfNodes as FlowNode[]);

                        // Convert stored edges to React Flow edges
                        const rfEdges = data.edges.map((e) => ({
                            id: e.edgeId,
                            source: e.fromNodeId,
                            target: e.toNodeId,
                            label: e.label,
                            markerEnd: { type: MarkerType.ArrowClosed },
                            style: { stroke: 'var(--color-text-muted)' },
                        }));
                        setEdges(rfEdges as FlowEdge[]);

                        // Get version history
                        const versionData = getLocalFlowchartVersions(
                            activeProduct.id,
                            data.funnelId,
                            data.scope
                        );
                        setVersions(versionData);
                    }
                }
            } catch (error) {
                console.error('Error loading flowchart:', error);
            }
            setLoading(false);
        };

        fetchData();
    }, [id, activeProduct, isNew, scope, setNodes, setEdges]);

    // Handle edge connection
    const onConnect = useCallback(
        (params: { source: string | null; target: string | null }) => {
            if (!params.source || !params.target) return;
            const newEdge = {
                id: uuidv4(),
                source: params.source,
                target: params.target,
                markerEnd: { type: MarkerType.ArrowClosed },
                label: '',
                style: { stroke: 'var(--color-text-muted)' },
            };
            setEdges((eds) => addEdge(newEdge, eds));
        },
        [setEdges]
    );

    // Add new node
    const addNode = (type: FlowchartNodeType) => {
        const newNode = {
            id: uuidv4(),
            type: 'default',
            position: { x: 250, y: nodes.length * 100 + 50 },
            data: {
                label: NODE_TYPE_LABELS[type],
                nodeType: type,
                description: '',
            },
            style: getNodeStyle(type),
        };
        setNodes((nds) => [...nds, newNode as FlowNode]);
    };

    // Delete selected node
    const deleteSelectedNode = () => {
        if (!selectedNode) return;
        setNodes((nds) => nds.filter((n) => n.id !== selectedNode));
        setEdges((eds) =>
            eds.filter((e) => e.source !== selectedNode && e.target !== selectedNode)
        );
        setSelectedNode(null);
    };

    // Update node label
    const updateNodeLabel = (nodeId: string, label: string) => {
        setNodes((nds) =>
            nds.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, label } } : n
            )
        );
    };

    // Save flowchart
    const handleSave = () => {
        if (!activeProduct || !user || !changeNote.trim()) return;

        setSaving(true);
        try {
            // Convert React Flow nodes to storage format
            const storageNodes: FlowchartNode[] = nodes.map((n) => ({
                nodeId: n.id,
                type: n.data.nodeType as FlowchartNodeType,
                title: n.data.label as string,
                description: n.data.description as string,
                position: n.position,
            }));

            // Convert React Flow edges to storage format
            const storageEdges: FlowchartEdge[] = edges.map((e) => ({
                edgeId: e.id,
                fromNodeId: e.source,
                toNodeId: e.target,
                label: (e.label as string) || '',
            }));

            const newFlowchart = createLocalFlowchart(
                {
                    productIds: [activeProduct.id],
                    funnelId,
                    scope,
                    title,
                    nodes: storageNodes,
                    edges: storageEdges,
                    changeNote,
                    createdBy: user.id,
                    previousFlowchartId: flowchart?.id || null,
                },
                flowchart?.id
            );

            logLocalAudit(
                user.id,
                user.name,
                isNew ? 'create' : 'update',
                'flowchart',
                newFlowchart.id,
                title
            );

            setShowSaveModal(false);
            navigate(`/flowchart/${newFlowchart.id}`);
        } catch (error) {
            console.error('Error saving flowchart:', error);
            alert('Erro ao salvar fluxograma');
        }
        setSaving(false);
    };

    // Restore version
    const handleRestoreVersion = (versionId: string) => {
        navigate(`/flowchart/${versionId}`);
    };

    if (loading) {
        return (
            <div className="loading-page">
                <div className="loading-spinner" />
                <p className="text-muted">Carregando fluxograma...</p>
            </div>
        );
    }

    return (
        <div style={{ height: 'calc(100vh - 100px)' }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                    <button
                        className="btn btn-icon btn-ghost"
                        onClick={() => navigate(-1)}
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="form-input"
                            style={{
                                fontSize: 'var(--text-xl)',
                                fontWeight: 600,
                                background: 'transparent',
                                border: 'none',
                                padding: 0,
                            }}
                        />
                        <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                            {flowchart ? `Versão ${flowchart.version}` : 'Novo fluxograma'} •{' '}
                            {scope === 'general' ? 'Fluxo Geral' : 'Fluxo Detalhado'}
                        </p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        className="btn btn-secondary"
                        onClick={() => setShowVersions(!showVersions)}
                    >
                        <Clock size={16} />
                        Histórico
                    </button>
                    {isOwner && (
                        <button
                            className="btn btn-primary"
                            onClick={() => setShowSaveModal(true)}
                        >
                            <Save size={16} />
                            Salvar Nova Versão
                        </button>
                    )}
                </div>
            </div>

            {/* Editor */}
            <div style={{ height: 500, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={(_, node) => setSelectedNode(node.id)}
                    onPaneClick={() => setSelectedNode(null)}
                    fitView
                    style={{ background: 'var(--color-bg-tertiary)' }}
                >
                    <Controls />
                    <Background color="var(--color-border)" gap={20} />

                    {/* Toolbar Panel */}
                    <Panel position="top-left">
                        <div style={{
                            display: 'flex',
                            gap: 8,
                            background: 'var(--color-bg-secondary)',
                            padding: 8,
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)'
                        }}>
                            <button
                                className="btn btn-icon btn-secondary"
                                onClick={() => addNode('start')}
                                title="Adicionar Início"
                            >
                                <Circle size={16} />
                            </button>
                            <button
                                className="btn btn-icon btn-secondary"
                                onClick={() => addNode('step')}
                                title="Adicionar Etapa"
                            >
                                <Square size={16} />
                            </button>
                            <button
                                className="btn btn-icon btn-secondary"
                                onClick={() => addNode('decision')}
                                title="Adicionar Decisão"
                            >
                                <Diamond size={16} />
                            </button>
                            <button
                                className="btn btn-icon btn-secondary"
                                onClick={() => addNode('end')}
                                title="Adicionar Fim"
                            >
                                <Octagon size={16} />
                            </button>
                            <button
                                className="btn btn-icon btn-secondary"
                                onClick={() => addNode('note')}
                                title="Adicionar Nota"
                            >
                                <StickyNote size={16} />
                            </button>
                            <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />
                            <button
                                className="btn btn-icon btn-ghost"
                                onClick={deleteSelectedNode}
                                disabled={!selectedNode}
                                title="Excluir Selecionado"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </Panel>

                    {/* Node Editor Panel */}
                    {selectedNode && (
                        <Panel position="top-right">
                            <div
                                className="card"
                                style={{ width: 250, padding: 'var(--space-4)' }}
                            >
                                <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
                                    Editar Nó
                                </h4>
                                <div className="form-group">
                                    <label className="form-label">Título</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={(nodes.find((n) => n.id === selectedNode)?.data?.label as string) || ''}
                                        onChange={(e) => updateNodeLabel(selectedNode, e.target.value)}
                                    />
                                </div>
                            </div>
                        </Panel>
                    )}
                </ReactFlow>
            </div>

            {/* Version History Sidebar */}
            {showVersions && versions.length > 0 && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: 320,
                        background: 'var(--color-bg-secondary)',
                        borderLeft: '1px solid var(--color-border)',
                        padding: 'var(--space-6)',
                        overflowY: 'auto',
                        zIndex: 100,
                    }}
                >
                    <div className="flex items-center justify-between mb-4">
                        <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>
                            Histórico de Versões
                        </h3>
                        <button
                            className="btn btn-icon btn-ghost"
                            onClick={() => setShowVersions(false)}
                        >
                            ×
                        </button>
                    </div>

                    <div className="flex flex-col gap-3">
                        {versions.map((v) => (
                            <div
                                key={v.id}
                                className="card"
                                style={{
                                    background:
                                        v.id === flowchart?.id
                                            ? 'var(--color-accent-primary)'
                                            : 'var(--color-bg-tertiary)',
                                    padding: 'var(--space-3)',
                                }}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span
                                        style={{
                                            fontWeight: 600,
                                            color: v.id === flowchart?.id ? 'white' : 'inherit',
                                        }}
                                    >
                                        Versão {v.version}
                                    </span>
                                    {v.id !== flowchart?.id && (
                                        <button
                                            className="btn btn-sm btn-ghost"
                                            onClick={() => handleRestoreVersion(v.id)}
                                        >
                                            <RotateCcw size={14} />
                                        </button>
                                    )}
                                </div>
                                <p
                                    style={{
                                        fontSize: 'var(--text-xs)',
                                        color: v.id === flowchart?.id ? 'rgba(255,255,255,0.8)' : 'var(--color-text-muted)',
                                    }}
                                >
                                    {v.changeNote || 'Sem descrição'}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Save Modal */}
            {showSaveModal && (
                <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Salvar Nova Versão</h2>
                            <button
                                className="modal-close"
                                onClick={() => setShowSaveModal(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="modal-body">
                            <p className="text-muted mb-4">
                                Uma nova versão será criada. A versão anterior será preservada no
                                histórico.
                            </p>

                            <div className="form-group">
                                <label className="form-label required">
                                    Descreva as alterações
                                </label>
                                <textarea
                                    className="form-textarea"
                                    placeholder="Ex: Adicionei etapa de follow-up após objeção de preço"
                                    value={changeNote}
                                    onChange={(e) => setChangeNote(e.target.value)}
                                    rows={3}
                                />
                            </div>
                        </div>

                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowSaveModal(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSave}
                                disabled={!changeNote.trim() || saving}
                            >
                                {saving ? (
                                    <div className="loading-spinner" style={{ width: 18, height: 18 }} />
                                ) : (
                                    <>
                                        <Save size={16} />
                                        Salvar Versão
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
