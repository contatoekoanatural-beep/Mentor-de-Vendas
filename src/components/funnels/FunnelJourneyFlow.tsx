// ========================================
// Funnel Journey Flowchart Component
// ========================================
// Visualizes the lead journey across funnels with transitions

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    addEdge,
    MarkerType,
    type Connection,
    type Node,
    type Edge,
    type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Save, Trash2, GitBranch, Maximize, Minimize } from 'lucide-react';
import type { Funnel, FunnelTransitionTrigger, FunnelType, DynamicConditionNode } from '../../types';
import { FUNNEL_TRANSITION_LABELS } from '../../types';
import {
    getLocalFunnelTransitions,
    createLocalFunnelTransition,
    deleteLocalFunnelTransition,
    getLocalDynamicConditions,
    createLocalDynamicCondition,
} from '../../services/localStorage';
import { useNavigate } from 'react-router-dom';
import DynamicConditionNodeEditor from './DynamicConditionNodeEditor';

interface FunnelJourneyFlowProps {
    funnels: Funnel[];
    productId: string;
}

// Colors for funnel types
const FUNNEL_TYPE_COLORS: Record<FunnelType, string> = {
    automation: '#3b82f6',
    closing: '#22c55e',
    remarketing: '#f59e0b',
    out_of_route: '#ef4444',
    other: '#9ca3af',
};

// Node style based on funnel type
const getNodeStyle = (type: FunnelType, status: string): CSSProperties => ({
    background: `${FUNNEL_TYPE_COLORS[type]}20`,
    border: `2px solid ${FUNNEL_TYPE_COLORS[type]}`,
    borderRadius: '12px',
    padding: '16px',
    minWidth: 180,
    opacity: status === 'inactive' ? 0.6 : 1,
});

export default function FunnelJourneyFlow({ funnels, productId }: FunnelJourneyFlowProps) {
    const navigate = useNavigate();
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
    const [showTriggerModal, setShowTriggerModal] = useState(false);
    const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
    const [selectedTrigger, setSelectedTrigger] = useState<FunnelTransitionTrigger>('lead_responded');
    const [customTrigger, setCustomTrigger] = useState('');
    const [saving, setSaving] = useState(false);
    const [showConditionEditor, setShowConditionEditor] = useState(false);
    const [dynamicConditions, setDynamicConditions] = useState<DynamicConditionNode[]>([]);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

    // Auto-fit view when switching to full screen
    useEffect(() => {
        if (rfInstance) {
            setTimeout(() => {
                rfInstance.fitView({ padding: 0.2 });
            }, 100);
        }
    }, [isFullScreen, rfInstance]);

    // Initialize nodes from funnels
    useEffect(() => {
        if (funnels.length === 0) return;

        // Load existing transitions
        const transitions = getLocalFunnelTransitions(productId);

        // Create nodes grid layout
        const COLS = 3;
        const NODE_WIDTH = 250;
        const NODE_HEIGHT = 120;
        const GAP_X = 100;
        const GAP_Y = 80;

        const newNodes: Node[] = funnels.map((funnel, index) => {
            const col = index % COLS;
            const row = Math.floor(index / COLS);

            return {
                id: funnel.id,
                type: 'default',
                position: {
                    x: col * (NODE_WIDTH + GAP_X) + 50,
                    y: row * (NODE_HEIGHT + GAP_Y) + 50,
                },
                data: {
                    label: (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{
                                fontSize: '14px',
                                fontWeight: 600,
                                marginBottom: '4px',
                                color: 'var(--color-text-primary)',
                            }}>
                                {funnel.name}
                            </div>
                            <div style={{
                                fontSize: '11px',
                                color: FUNNEL_TYPE_COLORS[funnel.type],
                                textTransform: 'uppercase',
                            }}>
                                {funnel.type === 'automation' ? '🔄 Automação' :
                                    funnel.type === 'closing' ? '🎯 Fechamento' :
                                        funnel.type === 'remarketing' ? '📢 Remarketing' :
                                            funnel.type === 'out_of_route' ? '⚠️ Fora de Rota' : '📋 Outro'}
                            </div>
                            {funnel.status === 'inactive' && (
                                <div style={{
                                    fontSize: '10px',
                                    color: 'var(--color-text-muted)',
                                    marginTop: '4px',
                                }}>
                                    (Inativo)
                                </div>
                            )}
                        </div>
                    ),
                    funnelId: funnel.id,
                    funnelType: funnel.type,
                    funnelStatus: funnel.status,
                },
                style: getNodeStyle(funnel.type, funnel.status),
            };
        });

        // Create edges from transitions
        const newEdges: Edge[] = transitions.map(t => ({
            id: t.id,
            source: t.fromFunnelId,
            target: t.toFunnelId,
            label: t.trigger === 'custom' ? t.customTrigger : FUNNEL_TRANSITION_LABELS[t.trigger],
            labelStyle: { fontSize: 11, fill: 'var(--color-text-secondary)' },
            labelBgStyle: { fill: 'var(--color-bg-primary)', fillOpacity: 0.9 },
            labelBgPadding: [6, 4] as [number, number],
            labelBgBorderRadius: 4,
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-text-muted)' },
            style: { stroke: 'var(--color-text-muted)', strokeWidth: 2 },
            animated: true,
        }));

        setNodes(newNodes);
        setEdges(newEdges);
    }, [funnels, productId, setNodes, setEdges]);

    // Handle new connection
    const onConnect = useCallback((connection: Connection) => {
        // Show modal to select trigger
        setPendingConnection(connection);
        setShowTriggerModal(true);
    }, []);

    // Handle node click - navigate to funnel details
    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        navigate(`/funis/${node.id}`);
    }, [navigate]);

    // Handle edge click - select for deletion
    const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
        setSelectedEdge(edge.id);
    }, []);

    // Save new transition
    const handleSaveTransition = () => {
        if (!pendingConnection || !pendingConnection.source || !pendingConnection.target) return;

        setSaving(true);

        const newTransition = createLocalFunnelTransition({
            productId,
            fromFunnelId: pendingConnection.source,
            toFunnelId: pendingConnection.target,
            trigger: selectedTrigger,
            customTrigger: selectedTrigger === 'custom' ? customTrigger : undefined,
        });

        // Add edge to graph
        const newEdge: Edge = {
            id: newTransition.id,
            source: pendingConnection.source,
            target: pendingConnection.target,
            label: selectedTrigger === 'custom' ? customTrigger : FUNNEL_TRANSITION_LABELS[selectedTrigger],
            labelStyle: { fontSize: 11, fill: 'var(--color-text-secondary)' },
            labelBgStyle: { fill: 'var(--color-bg-primary)', fillOpacity: 0.9 },
            labelBgPadding: [6, 4] as [number, number],
            labelBgBorderRadius: 4,
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-text-muted)' },
            style: { stroke: 'var(--color-text-muted)', strokeWidth: 2 },
            animated: true,
        };

        setEdges((eds: Edge[]) => addEdge(newEdge, eds));

        // Reset
        setPendingConnection(null);
        setShowTriggerModal(false);
        setSelectedTrigger('lead_responded');
        setCustomTrigger('');
        setSaving(false);
    };

    // Delete selected edge
    const handleDeleteEdge = () => {
        if (!selectedEdge) return;

        deleteLocalFunnelTransition(selectedEdge);
        setEdges((eds: Edge[]) => eds.filter((e: Edge) => e.id !== selectedEdge));
        setSelectedEdge(null);
    };

    if (funnels.length === 0) {
        return (
            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                <h3>Nenhum funil para visualizar</h3>
                <p className="text-muted">Crie funis primeiro para visualizar a jornada do lead.</p>
            </div>
        );
    }

    const containerStyle: CSSProperties = isFullScreen ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 50,
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
    } : {
        height: '500px',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-secondary)',
        transition: 'all 0.3s ease',
    };

    return (
        <div style={containerStyle}>
            {/* Toolbar */}
            <div className="flex items-center justify-between p-3 border-b border-border">
                <div className="flex items-center gap-3">
                    <div className="text-sm text-muted">
                        💡 Arraste entre funis para criar transições
                    </div>
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => setShowConditionEditor(true)}
                    >
                        <GitBranch size={14} />
                        + Condição Dinâmica
                    </button>
                    <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setIsFullScreen(!isFullScreen)}
                        title={isFullScreen ? "Sair da Tela Cheia" : "Tela Cheia"}
                    >
                        {isFullScreen ? <Minimize size={14} /> : <Maximize size={14} />}
                    </button>
                </div>
                {selectedEdge && (
                    <button
                        className="btn btn-sm"
                        style={{ background: 'var(--color-error)', color: 'white' }}
                        onClick={handleDeleteEdge}
                    >
                        <Trash2 size={14} />
                        Remover Transição
                    </button>
                )}
            </div>

            {/* Flow */}
            <div style={{ flex: 1, minHeight: '400px' }}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={handleNodeClick}
                    onEdgeClick={handleEdgeClick}
                    onPaneClick={() => setSelectedEdge(null)}
                    onInit={setRfInstance}
                    fitView
                    fitViewOptions={{ padding: 0.2 }}
                >
                    <Background color="var(--color-border)" gap={20} />
                    <Controls />
                </ReactFlow>
            </div>

            {/* Trigger Selection Modal */}
            {showTriggerModal && (
                <div className="modal-overlay" onClick={() => setShowTriggerModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">Gatilho de Transição</h2>
                            <button className="modal-close" onClick={() => setShowTriggerModal(false)}>
                                ×
                            </button>
                        </div>
                        <div className="modal-body">
                            <p className="text-muted mb-4" style={{ fontSize: 'var(--text-sm)' }}>
                                O que faz o lead passar de um funil para outro?
                            </p>

                            <div className="form-group">
                                <label className="form-label">Gatilho</label>
                                <select
                                    className="form-select"
                                    value={selectedTrigger}
                                    onChange={(e) => setSelectedTrigger(e.target.value as FunnelTransitionTrigger)}
                                >
                                    {Object.entries(FUNNEL_TRANSITION_LABELS).map(([value, label]) => (
                                        <option key={value} value={value}>
                                            {label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {selectedTrigger === 'custom' && (
                                <div className="form-group">
                                    <label className="form-label">Gatilho Personalizado</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Ex: Lead agendou demonstração"
                                        value={customTrigger}
                                        onChange={(e) => setCustomTrigger(e.target.value)}
                                    />
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowTriggerModal(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSaveTransition}
                                disabled={saving || (selectedTrigger === 'custom' && !customTrigger.trim())}
                            >
                                <Save size={14} />
                                Criar Transição
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Dynamic Condition Editor Modal */}
            {showConditionEditor && (
                <div className="modal-overlay" onClick={() => setShowConditionEditor(false)}>
                    <div
                        className="modal"
                        onClick={(e) => e.stopPropagation()}
                        style={{ maxWidth: 600, maxHeight: '90vh', overflow: 'auto' }}
                    >
                        <DynamicConditionNodeEditor
                            funnels={funnels}
                            flowchartNodes={[]}
                            productId={productId}
                            onSave={(nodeData) => {
                                const newCondition = createLocalDynamicCondition(nodeData);
                                setDynamicConditions(prev => [...prev, newCondition]);
                                setShowConditionEditor(false);
                            }}
                            onCancel={() => setShowConditionEditor(false)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
