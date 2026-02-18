// ========================================
// Funil Detalhe Page - Detalhes do Funil
// ========================================

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    GitBranch,
    FileText,
    Plus,
    Edit2,
    Trash2,
    Copy,
    Check,
    Play,
    Sparkles,
} from 'lucide-react';
import { useProduct } from '../contexts/ProductContext';
import { useAuth } from '../contexts/AuthContext';
import {
    getFunnel,
    getScripts,
    getActiveFunnelFlowchart,
    saveFunnelFlowchart,
    createScript,
    updateScript,
    deleteScript,
    logAudit,
} from '../services/firebase';
import type { Funnel, Flowchart, Script, FlowchartNode, FlowchartEdge, ScriptNodeType, DecisionBranch } from '../types';
import { SCRIPT_NODE_TYPE_LABELS } from '../types';
import FlowchartTab from '../components/funnels/FlowchartTab';
import { v4 as uuidv4 } from 'uuid';
import FunnelCopilot from '../components/funnels/FunnelCopilot';
import type { CopilotAction } from '../services/ai/FunnelCopilotService';

type TabType = 'flowchart' | 'scripts';

export default function FunilDetalhe() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { activeProduct } = useProduct();
    const { user, isOwner } = useAuth();

    const [funnel, setFunnel] = useState<Funnel | null>(null);
    const [scripts, setScripts] = useState<Script[]>([]);
    const [flowchartNodes, setFlowchartNodes] = useState<FlowchartNode[]>([]);
    const [fullFlowchartData, setFullFlowchartData] = useState<Flowchart | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabType>('flowchart');
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Modal state for scripts/etapas
    const [showScriptModal, setShowScriptModal] = useState(false);
    const [editingScript, setEditingScript] = useState<Script | null>(null);
    const [scriptName, setScriptName] = useState('');
    const [scriptContent, setScriptContent] = useState('');
    const [scriptNodeId, setScriptNodeId] = useState('');
    const [scriptNodeType, setScriptNodeType] = useState<ScriptNodeType>('step');
    const [deleteScriptConfirm, setDeleteScriptConfirm] = useState<string | null>(null);

    // Decision-specific state
    const [decisionCriteria, setDecisionCriteria] = useState('');
    const [branches, setBranches] = useState<DecisionBranch[]>([
        { id: uuidv4(), name: 'Sim', targetStepId: '' },
        { id: uuidv4(), name: 'Não', targetStepId: '' }
    ]);

    // Copilot State
    const [showCopilot, setShowCopilot] = useState(false);

    // Load data
    useEffect(() => {
        if (!id || !activeProduct) return;

        const loadData = async () => {
            setLoading(true);
            try {
                // Load funnel
                const funnelData = await getFunnel(id);
                setFunnel(funnelData);

                // Load scripts for this funnel
                const scriptData = await getScripts(activeProduct.id, id);
                setScripts(scriptData);
            } catch (error) {
                console.error('Error loading funnel data:', error);
            }
            // Load flowchart from Firebase
            try {
                console.log(`[FlowchartDebug] FunilDetalhe: Carregando fluxograma do servidor para funnelId: ${id}`);
                const flowchartData = await getActiveFunnelFlowchart(id);
                if (flowchartData) {
                    console.log(`[FlowchartDebug] FunilDetalhe: Fluxograma recebido v${flowchartData.version}`, flowchartData.updatedAt);
                    setFlowchartNodes(flowchartData.nodes);
                    setFullFlowchartData(flowchartData);
                } else {
                    console.log(`[FlowchartDebug] FunilDetalhe: Nenhum fluxograma encontrado para ${id}`);
                    setFlowchartNodes([]);
                    setFullFlowchartData(null);
                }
            } catch (error) {
                console.error('Error loading flowchart nodes:', error);
            }
            setLoading(false);
        };

        loadData();
    }, [id, activeProduct]);

    const loadScripts = async () => {
        if (!activeProduct || !id) return;
        const scriptData = await getScripts(activeProduct.id, id);
        setScripts(scriptData);
    };

    const handleOpenScriptModal = (script?: Script) => {
        if (script) {
            setEditingScript(script);
            setScriptName(script.name);
            setScriptContent(script.content);
            setScriptNodeId(script.flowchartNodeId || '');
            setScriptNodeType(script.nodeType || 'step');
            // Carregar dados de decisão
            setDecisionCriteria(script.decisionCriteria || '');
            setBranches(script.branches && script.branches.length > 0
                ? script.branches
                : [
                    { id: uuidv4(), name: 'Sim', targetStepId: '' },
                    { id: uuidv4(), name: 'Não', targetStepId: '' }
                ]
            );
        } else {
            setEditingScript(null);
            setScriptName('');
            setScriptContent('');
            setScriptNodeId('');
            setScriptNodeType('step');
            // Resetar dados de decisão
            setDecisionCriteria('');
            setBranches([
                { id: uuidv4(), name: 'Sim', targetStepId: '' },
                { id: uuidv4(), name: 'Não', targetStepId: '' }
            ]);
        }
        setShowScriptModal(true);
    };

    const handleCloseScriptModal = () => {
        setShowScriptModal(false);
        setEditingScript(null);
    };

    const handleSubmitScript = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeProduct || !user || !id) return;

        try {
            // Preparar dados base
            const isDecision = scriptNodeType === 'decision';

            if (editingScript) {
                // Build update data without undefined values
                const updateData: any = {
                    name: scriptName,
                    nodeType: scriptNodeType,
                };

                // Campos específicos por tipo
                if (isDecision) {
                    updateData.decisionCriteria = decisionCriteria;
                    updateData.branches = branches;
                    updateData.content = decisionCriteria; // Manter content para compatibilidade
                } else {
                    updateData.content = scriptContent;
                    updateData.decisionCriteria = null;
                    updateData.branches = null;
                }

                // Validation: Ensure flowchartNodeId is never passed as undefined
                // If scriptNodeId is present, use it. If empty/undefined, set to null (removes link).
                if (scriptNodeId === undefined) {
                    updateData.flowchartNodeId = null;
                } else {
                    updateData.flowchartNodeId = scriptNodeId || null;
                }

                await updateScript(editingScript.id, updateData);
                logAudit(user.id, user.name, 'update', 'script', editingScript.id, scriptName);
            } else {
                const createData: any = {
                    name: scriptName,
                    productIds: [activeProduct.id],
                    funnelId: id,
                    tags: [],
                    createdBy: user.id,
                    nodeType: scriptNodeType,
                };

                // Campos específicos por tipo
                if (isDecision) {
                    createData.decisionCriteria = decisionCriteria;
                    createData.branches = branches;
                    createData.content = decisionCriteria; // Manter content para compatibilidade
                } else {
                    createData.content = scriptContent;
                }

                // Validation: Ensure flowchartNodeId is never passed as undefined
                createData.flowchartNodeId = scriptNodeId || null;

                const scriptId = await createScript(createData);
                logAudit(user.id, user.name, 'create', 'script', scriptId, scriptName);
            }

            handleCloseScriptModal();
            loadScripts();
        } catch (error) {
            console.error('Error saving script:', error);
            alert('Erro ao salvar script');
        }
    };

    const handleDeleteScript = async (scriptId: string) => {
        if (!user) return;

        try {
            const script = scripts.find(s => s.id === scriptId);
            await deleteScript(scriptId);
            if (script) {
                logAudit(user.id, user.name, 'delete', 'script', scriptId, script.name);
            }
            setDeleteScriptConfirm(null);
            loadScripts();
        } catch (error) {
            console.error('Error deleting script:', error);
            alert('Erro ao excluir script');
        }
    };

    const handleCopyScript = async (content: string, scriptId: string) => {
        await navigator.clipboard.writeText(content);
        setCopiedId(scriptId);
        setTimeout(() => setCopiedId(null), 2000);
    };

    /**
     * Callback para atualizar um script quando editado via FlowchartTab.
     * Chamado quando edita título/descrição de um nó vinculado a um script.
     */
    const handleScriptUpdateFromFlowchart = async (scriptId: string, updates: { name?: string; content?: string }) => {
        // ... (código existente)
        try {
            await updateScript(scriptId, {
                // Se receber name, atualiza name. Se content, content.
                ...(updates.name && { name: updates.name }),
                ...(updates.content && { content: updates.content })
            });

            // Log é importante
            if (user) {
                logAudit(user.id, user.name, 'update', 'script', scriptId, 'Atualização direta pelo Fluxograma');
            }
        } catch (error) {
            console.error('Erro ao atualizar script do fluxograma:', error);
            throw error;
        }
    };

    const handleFlowchartSave = (data: Flowchart) => {
        setFullFlowchartData(data);
    };



    // =========================================================================
    // Copilot Action Handlers
    // =========================================================================

    const handleCopilotAction = async (action: CopilotAction) => {
        if (!activeProduct || !user || !id) return;

        console.log('Executing Copilot Action:', action);

        switch (action.type) {
            case 'create_script': {
                const data = action.payload;
                try {
                    const scriptId = await createScript({
                        name: data.name,
                        content: data.content,
                        productIds: [activeProduct.id],
                        funnelId: id,
                        tags: [],
                        createdBy: user.id
                    });
                    logAudit(user.id, user.name, 'create', 'script', scriptId, `AI: ${data.name}`);
                    await loadScripts();
                    setActiveTab('scripts');
                } catch (e) {
                    console.error('AI Create Script Error', e);
                    throw e;
                }
                break;
            }

            case 'update_script': {
                const data = action.payload; // expects { scriptId, content }
                try {
                    await updateScript(data.scriptId, { content: data.content });
                    logAudit(user.id, user.name, 'update', 'script', data.scriptId, 'AI Update');
                    await loadScripts();
                } catch (e) {
                    console.error('AI Update Script Error', e);
                    throw e;
                }
                break;
            }

            case 'update_flowchart': {
                // Similar to existing handleApplyFlow but simplified
                const draft = action.payload; // expects { steps: [...] } similar structure
                try {
                    // Convert Draft Steps -> Flowchart Nodes
                    const nodes: FlowchartNode[] = draft.steps.map((step: any, index: number) => ({
                        nodeId: uuidv4(),
                        type: step.type || (index === 0 ? 'start' : index === draft.steps.length - 1 ? 'end' : 'step'),
                        title: step.title || step.name,
                        description: step.description || `Objetivo: ${step.goal}`,
                        position: { x: 250, y: 50 + (index * 150) },
                    }));

                    // Create simple Edges
                    const edges: FlowchartEdge[] = [];
                    for (let i = 0; i < nodes.length - 1; i++) {
                        edges.push({
                            edgeId: uuidv4(),
                            fromNodeId: nodes[i].nodeId,
                            toNodeId: nodes[i + 1].nodeId,
                            label: '',
                        });
                    }

                    const flowchartId = await saveFunnelFlowchart(id, {
                        productIds: [activeProduct.id],
                        scope: 'detailed',
                        title: 'Estrutura Gerada por IA',
                        nodes,
                        edges,
                        changeNote: 'Gerado pelo Funnel Copilot',
                        createdBy: user.id
                    }, user.id);

                    const newFlowchartData: Flowchart = {
                        id: flowchartId,
                        productIds: [activeProduct.id],
                        funnelId: id,
                        scope: 'detailed',
                        title: 'Estrutura Gerada por IA',
                        nodes,
                        edges,
                        changeNote: 'Gerado pelo Funnel Copilot',
                        createdBy: user.id,
                        version: (fullFlowchartData?.version || 0) + 1,
                        createdAt: null as any,
                        updatedAt: new Date().toISOString()
                    } as Flowchart;

                    setFullFlowchartData(newFlowchartData);
                    setFlowchartNodes(nodes);
                    setActiveTab('flowchart');

                } catch (e) {
                    console.error('AI Flowchart Error', e);
                    throw e;
                }
                break;
            }
        }
    };


    if (loading) {
        return (
            <div className="loading-page">
                <div className="loading-spinner" />
                <p className="text-muted">Carregando funil...</p>
            </div>
        );
    }

    if (!funnel) {
        return (
            <div className="empty-state">
                <h3>Funil não encontrado</h3>
                <button className="btn btn-primary" onClick={() => navigate('/funis')}>
                    Voltar para Funis
                </button>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <button
                        className="btn btn-icon btn-ghost"
                        onClick={() => navigate('/funis')}
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="page-title" style={{ marginBottom: 0 }}>
                            {funnel.name}
                        </h1>
                        <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                            {funnel.description || 'Sem descrição'}
                        </p>
                    </div>
                </div>

                <button
                    className="btn btn-secondary border-primary text-primary"
                    onClick={() => setShowCopilot(true)}
                >
                    <Sparkles size={16} />
                    Funnel Copilot
                </button>
            </div>

            {/* Tabs */}
            <div className="tabs-container" style={{ marginBottom: 'var(--space-6)' }}>
                <div className="flex gap-2" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)' }}>
                    <button
                        className={`btn ${activeTab === 'flowchart' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setActiveTab('flowchart')}
                    >
                        <GitBranch size={16} />
                        Fluxograma
                    </button>
                    <button
                        className={`btn ${activeTab === 'scripts' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setActiveTab('scripts')}
                    >
                        <FileText size={16} />
                        Etapas ({scripts.length})
                    </button>
                </div>
            </div>

            {/* Flowchart Tab */}
            {activeTab === 'flowchart' && (
                <div style={{ marginBottom: 'var(--space-8)' }}>
                    {activeProduct && (
                        <FlowchartTab
                            funnelId={id!}
                            productId={activeProduct.id}
                            initialData={fullFlowchartData}
                            scripts={scripts}
                            onScriptUpdate={handleScriptUpdateFromFlowchart}
                            onScriptsChange={loadScripts}
                            onSave={handleFlowchartSave}
                        />
                    )}
                </div>
            )}

            {/* Etapas Tab */}
            {activeTab === 'scripts' && (
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>
                            Etapas do Funil
                        </h2>
                        {isOwner && (
                            <button
                                className="btn btn-primary"
                                onClick={() => handleOpenScriptModal()}
                            >
                                <Plus size={16} />
                                Nova Etapa
                            </button>
                        )}
                    </div>

                    {scripts.length === 0 ? (
                        <div className="empty-state">
                            <FileText size={48} strokeWidth={1.5} />
                            <h3>Nenhuma etapa</h3>
                            <p>Adicione etapas para definir o fluxo do funil.</p>
                            {isOwner && (
                                <button
                                    className="btn btn-primary"
                                    onClick={() => handleOpenScriptModal()}
                                >
                                    <Plus size={16} />
                                    Criar Etapa
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {scripts
                                .sort((a, b) => {
                                    // Ordenar por executionOrder se existir, senão por order, senão manter original
                                    const aOrder = a.executionOrder ?? a.order ?? 999;
                                    const bOrder = b.executionOrder ?? b.order ?? 999;
                                    return aOrder - bOrder;
                                })
                                .map((script) => {
                                const linkedNode = flowchartNodes.find(n => n.nodeId === script.flowchartNodeId);
                                return (
                                    <div
                                        key={script.id}
                                        className="card"
                                        style={{ padding: 'var(--space-4)' }}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                                                    {script.name}
                                                </h3>
                                                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                                                    <span
                                                        className={`badge ${
                                                            script.nodeType === 'decision' ? 'badge-warning' :
                                                            script.nodeType === 'start' ? 'badge-warning' :
                                                            script.nodeType === 'link_out' ? 'badge-warning' :
                                                            script.nodeType === 'link_in' ? 'badge-info' :
                                                            'badge-secondary'
                                                        }`}
                                                    >
                                                        {SCRIPT_NODE_TYPE_LABELS[script.nodeType || 'step']}
                                                    </span>
                                                    {linkedNode && (
                                                        <span className="badge badge-info" style={{ marginRight: 'var(--space-2)' }}>
                                                            <Play size={10} style={{ marginRight: 4 }} />
                                                            {linkedNode.title}
                                                        </span>
                                                    )}
                                                    <span className="badge badge-secondary">
                                                        v{script.version}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    className="btn btn-sm btn-ghost text-primary"
                                                    onClick={() => setShowCopilot(true)}
                                                    title="Analisar com IA"
                                                >
                                                    <Sparkles size={14} style={{ marginRight: 4 }} />
                                                    IA
                                                </button>
                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => handleCopyScript(script.content, script.id)}
                                                >
                                                    {copiedId === script.id ? (
                                                        <>
                                                            <Check size={14} />
                                                            Copiado!
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Copy size={14} />
                                                            Copiar
                                                        </>
                                                    )}
                                                </button>
                                                {isOwner && (
                                                    <>
                                                        <button
                                                            className="btn btn-sm btn-ghost"
                                                            onClick={() => handleOpenScriptModal(script)}
                                                        >
                                                            <Edit2 size={14} />
                                                        </button>
                                                        <button
                                                            className="btn btn-sm btn-ghost"
                                                            onClick={() => setDeleteScriptConfirm(script.id)}
                                                            style={{ color: 'var(--color-error)' }}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        <div
                                            style={{
                                                background: 'var(--color-bg-tertiary)',
                                                padding: 'var(--space-3)',
                                                borderRadius: 'var(--radius-md)',
                                                whiteSpace: 'pre-wrap',
                                                fontSize: 'var(--text-sm)',
                                                maxHeight: 200,
                                                overflowY: 'auto',
                                            }}
                                        >
                                            {script.content}
                                        </div>

                                        {/* Delete Confirmation */}
                                        {deleteScriptConfirm === script.id && (
                                            <div
                                                style={{
                                                    marginTop: 'var(--space-3)',
                                                    padding: 'var(--space-3)',
                                                    background: 'var(--color-error-bg)',
                                                    borderRadius: 'var(--radius-md)',
                                                }}
                                            >
                                                <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                                                    Excluir este script?
                                                </p>
                                                <div className="flex gap-2">
                                                    <button
                                                        className="btn btn-sm btn-secondary"
                                                        onClick={() => setDeleteScriptConfirm(null)}
                                                    >
                                                        Cancelar
                                                    </button>
                                                    <button
                                                        className="btn btn-sm"
                                                        style={{ background: 'var(--color-error)', color: 'white' }}
                                                        onClick={() => handleDeleteScript(script.id)}
                                                    >
                                                        Excluir
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Etapa Modal */}
            {showScriptModal && (
                <div className="modal-overlay" onClick={handleCloseScriptModal}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {editingScript ? 'Editar Etapa' : 'Nova Etapa'}
                            </h2>
                            <button className="modal-close" onClick={handleCloseScriptModal}>
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleSubmitScript}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label required">Nome da Etapa</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Ex: Abertura - Apresentação"
                                        value={scriptName}
                                        onChange={(e) => setScriptName(e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label required">Tipo de Registro</label>
                                    <select
                                        className="form-select"
                                        value={scriptNodeType}
                                        onChange={(e) => setScriptNodeType(e.target.value as ScriptNodeType)}
                                        required
                                    >
                                        {(Object.keys(SCRIPT_NODE_TYPE_LABELS) as ScriptNodeType[]).map((type) => (
                                            <option key={type} value={type}>
                                                {SCRIPT_NODE_TYPE_LABELS[type]}
                                            </option>
                                        ))}
                                    </select>
                                    <p className="form-hint">
                                        Define como este registro aparece no fluxograma
                                    </p>
                                </div>

                                {flowchartNodes.length > 0 && (
                                    <div className="form-group">
                                        <label className="form-label">Vincular ao Nó do Fluxograma</label>
                                        <select
                                            className="form-select"
                                            value={scriptNodeId}
                                            onChange={(e) => setScriptNodeId(e.target.value)}
                                        >
                                            <option value="">Nenhum (script geral)</option>
                                            {flowchartNodes.map((node) => (
                                                <option key={node.nodeId} value={node.nodeId}>
                                                    {node.title} ({node.type})
                                                </option>
                                            ))}
                                        </select>
                                        <p className="form-hint">
                                            Vincule o script a uma etapa específica do fluxograma
                                        </p>
                                    </div>
                                )}

                                {/* Campos condicionais baseados no tipo */}
                                {scriptNodeType === 'decision' ? (
                                    <>
                                        {/* Campo: Critério da Decisão */}
                                        <div className="form-group">
                                            <label className="form-label required">Critério da Decisão</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="Ex: O lead enviou o endereço?"
                                                value={decisionCriteria}
                                                onChange={(e) => setDecisionCriteria(e.target.value)}
                                                required
                                            />
                                            <p className="form-hint">
                                                Pergunta ou condição que determina qual caminho seguir
                                            </p>
                                        </div>

                                        {/* Campo: Caminhos de Saída */}
                                        <div className="form-group">
                                            <label className="form-label required">Caminhos de Saída</label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                                {branches.map((branch, index) => (
                                                    <div
                                                        key={branch.id}
                                                        style={{
                                                            display: 'flex',
                                                            gap: 'var(--space-2)',
                                                            alignItems: 'center',
                                                            padding: 'var(--space-3)',
                                                            background: 'var(--bg-secondary)',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: '1px solid var(--border-default)'
                                                        }}
                                                    >
                                                        <input
                                                            type="text"
                                                            className="form-input"
                                                            placeholder="Nome (ex: Sim)"
                                                            value={branch.name}
                                                            onChange={(e) => {
                                                                const newBranches = [...branches];
                                                                newBranches[index].name = e.target.value;
                                                                setBranches(newBranches);
                                                            }}
                                                            style={{ flex: 1 }}
                                                            required
                                                        />
                                                        <select
                                                            className="form-select"
                                                            value={branch.targetStepId || ''}
                                                            onChange={(e) => {
                                                                const newBranches = [...branches];
                                                                newBranches[index].targetStepId = e.target.value || undefined;
                                                                setBranches(newBranches);
                                                            }}
                                                            style={{ flex: 1 }}
                                                        >
                                                            <option value="">→ Próxima etapa</option>
                                                            {scripts
                                                                .filter(s => s.id !== editingScript?.id)
                                                                .map((s) => (
                                                                    <option key={s.id} value={s.id}>
                                                                        → {s.name}
                                                                    </option>
                                                                ))
                                                            }
                                                        </select>
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => {
                                                                if (branches.length > 2) {
                                                                    setBranches(branches.filter(b => b.id !== branch.id));
                                                                }
                                                            }}
                                                            disabled={branches.length <= 2}
                                                            title={branches.length <= 2 ? 'Mínimo 2 caminhos' : 'Remover caminho'}
                                                            style={{ color: branches.length <= 2 ? 'var(--text-disabled)' : 'var(--color-danger)' }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                ))}
                                                <button
                                                    type="button"
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => {
                                                        setBranches([...branches, {
                                                            id: uuidv4(),
                                                            name: '',
                                                            targetStepId: ''
                                                        }]);
                                                    }}
                                                    style={{ alignSelf: 'flex-start' }}
                                                >
                                                    <Plus size={16} />
                                                    Adicionar Caminho
                                                </button>
                                            </div>
                                            <p className="form-hint">
                                                Defina os possíveis resultados da decisão e para qual etapa cada um leva
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    /* Campo de conteúdo padrão para outros tipos */
                                    <div className="form-group">
                                        <label className="form-label required">Conteúdo da Etapa</label>
                                        <textarea
                                            className="form-textarea"
                                            placeholder="Digite o conteúdo da etapa aqui..."
                                            value={scriptContent}
                                            onChange={(e) => setScriptContent(e.target.value)}
                                            rows={10}
                                            required
                                            style={{ fontFamily: 'monospace' }}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={handleCloseScriptModal}
                                >
                                    Cancelar
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {editingScript ? 'Salvar Alterações' : 'Criar Etapa'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Funnel Copilot */}
            <FunnelCopilot
                isOpen={showCopilot}
                onClose={() => setShowCopilot(false)}
                context={{
                    funnelName: funnel.name,
                    productName: activeProduct?.name || 'Produto',
                    scripts: scripts,
                    flowchartNodes: flowchartNodes
                }}
                onAction={handleCopilotAction}
            />
        </div>
    );
}
