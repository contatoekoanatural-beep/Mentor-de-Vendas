import { useParams, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getAgent, updateAgent, getAgentObjections, createAgentObjection, updateAgentObjection, deleteAgentObjection, getAgentCases, createAgentCase, updateAgentCase, deleteAgentCase } from '../services/firebase';
import type { Agent, AgentObjection, AgentCase } from '../types';
import { useToast } from '../contexts/ToastContext';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import AgentChat from '../components/ui/AgentChat';
import { ChevronLeft, Sparkles, AlertTriangle, Database, Save, Plus, Pencil, Trash2, MessageSquare } from 'lucide-react';

type TabType = 'base' | 'configuracoes' | 'objecoes' | 'casos';

/** Normaliza texto para slug: minúsculo, sem acentos, espaços → hífen, só a-z 0-9 e hífen */
function normalizeSlug(value: string): string {
    return value
        .normalize('NFD')                    // decompõe acentos
        .replace(/[\u0300-\u036f]/g, '')     // remove diacríticos
        .toLowerCase()
        .replace(/\s+/g, '-')               // espaços viram hífen
        .replace(/[^a-z0-9-]/g, '');         // remove tudo que não for a-z, 0-9, hífen
}

export default function AgenteDetalhe() {
    const { productId, agentId } = useParams<{ productId: string; agentId: string }>();
    const { addToast } = useToast();

    // Data States
    const [agent, setAgent] = useState<Agent | null>(null);
    const [loading, setLoading] = useState(true);

    // Tab State
    const [activeTab, setActiveTab] = useState<TabType>('base');

    // Chat Test State
    const [isChatOpen, setIsChatOpen] = useState(false);

    // Base Tab States
    const [prompt, setPrompt] = useState('');
    const [initialPrompt, setInitialPrompt] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Configurações Tab States
    const [responseMode, setResponseMode] = useState<'single' | 'split'>('single');
    const [maxMessages, setMaxMessages] = useState(3);
    const [tone, setTone] = useState('');
    const [handoffRule, setHandoffRule] = useState('');
    const [slug, setSlug] = useState('');
    const [debounceSegundos, setDebounceSegundos] = useState(8);
    const [tabelaPrecos, setTabelaPrecos] = useState<{ quantidade: number; valor: number }[]>([]);
    const [initialConfigState, setInitialConfigState] = useState({ responseMode: 'single' as 'single' | 'split', maxMessages: 3, tone: '', handoffRule: '', slug: '', debounceSegundos: 8, tabelaPrecos: [] as { quantidade: number; valor: number }[] });
    const [isSavingConfig, setIsSavingConfig] = useState(false);

    // Objeções Tab States
    const [objections, setObjections] = useState<AgentObjection[]>([]);
    const [loadingObjections, setLoadingObjections] = useState(false);
    const [showObjectionModal, setShowObjectionModal] = useState(false);
    const [editingObjection, setEditingObjection] = useState<AgentObjection | null>(null);
    const [objTrigger, setObjTrigger] = useState('');
    const [objResponse, setObjResponse] = useState('');
    const [isSavingObjection, setIsSavingObjection] = useState(false);
    const [deleteObjectionTarget, setDeleteObjectionTarget] = useState<AgentObjection | null>(null);

    // Casos Tab States
    const [cases, setCases] = useState<AgentCase[]>([]);
    const [loadingCases, setLoadingCases] = useState(false);
    const [showCaseModal, setShowCaseModal] = useState(false);
    const [editingCase, setEditingCase] = useState<AgentCase | null>(null);
    const [caseTitle, setCaseTitle] = useState('');
    const [caseKind, setCaseKind] = useState<'good' | 'bad'>('good');
    const [caseContent, setCaseContent] = useState('');
    const [isSavingCase, setIsSavingCase] = useState(false);
    const [deleteCaseTarget, setDeleteCaseTarget] = useState<AgentCase | null>(null);

    useEffect(() => {
        const loadAgent = async () => {
            if (!agentId) return;
            setLoading(true);
            try {
                const data = await getAgent(agentId);
                setAgent(data);
                if (data) {
                    // Base tab
                    setPrompt(data.base || '');
                    setInitialPrompt(data.base || '');
                    // Configurações tab
                    const rm = data.responseMode || 'single';
                    const mm = data.maxMessages ?? 3;
                    const t = data.tone || '';
                    const hr = data.handoffRule || '';
                    const sl = data.slug || '';
                    const ds = data.debounceSegundos ?? 8;
                    const tp = Array.isArray(data.tabelaPrecos) ? data.tabelaPrecos : [];
                    setResponseMode(rm);
                    setMaxMessages(mm);
                    setTone(t);
                    setHandoffRule(hr);
                    setSlug(sl);
                    setDebounceSegundos(ds);
                    setTabelaPrecos(tp);
                    setInitialConfigState({ responseMode: rm, maxMessages: mm, tone: t, handoffRule: hr, slug: sl, debounceSegundos: ds, tabelaPrecos: tp });
                }
            } catch (error) {
                console.error('Error loading agent:', error);
                addToast('Erro ao carregar dados do agente.', 'error');
            }
            setLoading(false);
        };
        loadAgent();
    }, [agentId]);

    // Load objections when tab becomes active
    useEffect(() => {
        if (activeTab === 'objecoes' && agentId) {
            loadObjections();
        }
    }, [activeTab, agentId]);

    // Load cases when tab becomes active
    useEffect(() => {
        if (activeTab === 'casos' && agentId) {
            loadCases();
        }
    }, [activeTab, agentId]);

    const loadObjections = async () => {
        if (!agentId) return;
        setLoadingObjections(true);
        try {
            const data = await getAgentObjections(agentId);
            setObjections(data);
        } catch (error) {
            console.error('Error loading objections:', error);
            addToast('Erro ao carregar objeções.', 'error');
        }
        setLoadingObjections(false);
    };

    const handleSaveBase = async () => {
        if (!agentId || !agent) return;
        setIsSaving(true);
        try {
            await updateAgent(agentId, {
                base: prompt
            });
            setAgent((prev) => prev ? { ...prev, base: prompt } : prev);
            setInitialPrompt(prompt);
            addToast('Instruções da base salvas com sucesso!', 'success');
        } catch (error) {
            console.error('Error saving agent base:', error);
            addToast('Erro ao salvar instruções da base.', 'error');
        }
        setIsSaving(false);
    };

    const configHasChanges = () => {
        return (
            responseMode !== initialConfigState.responseMode ||
            maxMessages !== initialConfigState.maxMessages ||
            tone !== initialConfigState.tone ||
            handoffRule !== initialConfigState.handoffRule ||
            slug !== initialConfigState.slug ||
            debounceSegundos !== initialConfigState.debounceSegundos ||
            JSON.stringify(tabelaPrecos) !== JSON.stringify(initialConfigState.tabelaPrecos)
        );
    };

    const openNewObjectionModal = () => {
        setEditingObjection(null);
        setObjTrigger('');
        setObjResponse('');
        setShowObjectionModal(true);
    };

    const openEditObjectionModal = (obj: AgentObjection) => {
        setEditingObjection(obj);
        setObjTrigger(obj.trigger);
        setObjResponse(obj.response);
        setShowObjectionModal(true);
    };

    const handleSaveObjection = async () => {
        if (!agentId || !objTrigger.trim() || !objResponse.trim()) return;
        setIsSavingObjection(true);
        try {
            if (editingObjection) {
                await updateAgentObjection(editingObjection.id, {
                    trigger: objTrigger.trim(),
                    response: objResponse.trim(),
                });
                addToast('Objeção atualizada com sucesso!', 'success');
            } else {
                await createAgentObjection({
                    agentId,
                    trigger: objTrigger.trim(),
                    response: objResponse.trim(),
                });
                addToast('Objeção criada com sucesso!', 'success');
            }
            setShowObjectionModal(false);
            await loadObjections();
        } catch (error) {
            console.error('Error saving objection:', error);
            addToast('Erro ao salvar objeção.', 'error');
        }
        setIsSavingObjection(false);
    };

    const handleDeleteObjection = async () => {
        if (!deleteObjectionTarget) return;
        try {
            await deleteAgentObjection(deleteObjectionTarget.id);
            addToast('Objeção excluída com sucesso!', 'success');
            setDeleteObjectionTarget(null);
            await loadObjections();
        } catch (error) {
            console.error('Error deleting objection:', error);
            addToast('Erro ao excluir objeção.', 'error');
        }
    };

    // --- Cases handlers ---
    const loadCases = async () => {
        if (!agentId) return;
        setLoadingCases(true);
        try {
            const data = await getAgentCases(agentId);
            setCases(data);
        } catch (error) {
            console.error('Error loading cases:', error);
            addToast('Erro ao carregar casos.', 'error');
        }
        setLoadingCases(false);
    };

    const openNewCaseModal = () => {
        setEditingCase(null);
        setCaseTitle('');
        setCaseKind('good');
        setCaseContent('');
        setShowCaseModal(true);
    };

    const openEditCaseModal = (c: AgentCase) => {
        setEditingCase(c);
        setCaseTitle(c.title);
        setCaseKind(c.kind);
        setCaseContent(c.content);
        setShowCaseModal(true);
    };

    const handleSaveCase = async () => {
        if (!agentId || !caseTitle.trim() || !caseContent.trim()) return;
        setIsSavingCase(true);
        try {
            if (editingCase) {
                await updateAgentCase(editingCase.id, {
                    title: caseTitle.trim(),
                    kind: caseKind,
                    content: caseContent.trim(),
                });
                addToast('Caso atualizado com sucesso!', 'success');
            } else {
                await createAgentCase({
                    agentId,
                    title: caseTitle.trim(),
                    kind: caseKind,
                    content: caseContent.trim(),
                });
                addToast('Caso criado com sucesso!', 'success');
            }
            setShowCaseModal(false);
            await loadCases();
        } catch (error) {
            console.error('Error saving case:', error);
            addToast('Erro ao salvar caso.', 'error');
        }
        setIsSavingCase(false);
    };

    const handleDeleteCase = async () => {
        if (!deleteCaseTarget) return;
        try {
            await deleteAgentCase(deleteCaseTarget.id);
            addToast('Caso excluído com sucesso!', 'success');
            setDeleteCaseTarget(null);
            await loadCases();
        } catch (error) {
            console.error('Error deleting case:', error);
            addToast('Erro ao excluir caso.', 'error');
        }
    };

    const handleSaveConfig = async () => {
        if (!agentId || !agent) return;
        setIsSavingConfig(true);
        try {
            // Tabela: só faixas válidas (quantidade e valor positivos), ordenadas por quantidade.
            const tabelaLimpa = tabelaPrecos
                .filter((f) => Number.isFinite(f.quantidade) && f.quantidade > 0 && Number.isFinite(f.valor) && f.valor > 0)
                .sort((a, b) => a.quantidade - b.quantidade);

            const payload: Partial<Agent> = {
                responseMode,
                tone,
                handoffRule,
                slug,
                debounceSegundos,
                tabelaPrecos: tabelaLimpa,
            };
            if (responseMode === 'split') {
                payload.maxMessages = maxMessages;
            }
            await updateAgent(agentId, payload);
            setAgent((prev) => prev ? { ...prev, ...payload } : prev);
            setTabelaPrecos(tabelaLimpa);
            setInitialConfigState({ responseMode, maxMessages, tone, handoffRule, slug, debounceSegundos, tabelaPrecos: tabelaLimpa });
            addToast('Configurações do agente salvas com sucesso!', 'success');
        } catch (error) {
            console.error('Error saving agent config:', error);
            addToast('Erro ao salvar configurações do agente.', 'error');
        }
        setIsSavingConfig(false);
    };

    if (loading) {
        return (
            <div className="loading-page" style={{ minHeight: '50vh' }}>
                <div className="loading-spinner" />
                <p className="text-muted">Carregando detalhes do agente...</p>
            </div>
        );
    }

    const sectionCardStyle: React.CSSProperties = {
        backgroundColor: 'var(--color-bg-alt)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--spacing-lg)',
        marginBottom: 'var(--spacing-lg)',
    };

    const sectionTitleStyle: React.CSSProperties = {
        fontSize: 'var(--text-base)',
        fontWeight: 600,
        color: 'var(--color-text)',
        marginBottom: 'var(--spacing-xs)',
    };

    const sectionDescStyle: React.CSSProperties = {
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        marginBottom: 'var(--spacing-md)',
    };

    const toggleContainerStyle: React.CSSProperties = {
        display: 'flex',
        gap: '0',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
        width: 'fit-content',
    };

    const toggleBtnStyle = (isActive: boolean): React.CSSProperties => ({
        padding: 'var(--spacing-sm) var(--spacing-lg)',
        border: 'none',
        cursor: 'pointer',
        fontWeight: 500,
        fontSize: 'var(--text-sm)',
        transition: 'all 0.2s ease',
        backgroundColor: isActive ? 'var(--color-primary)' : 'var(--color-bg)',
        color: isActive ? '#fff' : 'var(--color-text-muted)',
    });

    return (
        <>
        <div className="page-container" style={{ padding: 'var(--spacing-lg)' }}>
            {/* Breadcrumb / Back button */}
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                <Link to={`/produtos/${productId}/agentes`} className="flex items-center gap-1 text-muted hover-text" style={{ textDecoration: 'none', display: 'inline-flex' }}>
                    <ChevronLeft size={16} />
                    <span className="text-sm">Voltar para a Lista de Agentes</span>
                </Link>
            </div>

            {/* Header */}
            <div className="flex justify-between items-center mb-6" style={{ marginBottom: 'var(--spacing-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="flex items-center gap-3">
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--color-bg-alt)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-info)'
                    }}>
                        <Sparkles size={24} />
                    </div>
                    <div>
                        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--color-text)' }}>
                            {agent?.name || 'Agente de IA'}
                        </h2>
                        <p className="text-muted text-sm">
                            Configure a base de conhecimento e as regras de treinamento da inteligência artificial.
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => setIsChatOpen(true)}
                    className="btn btn-primary flex items-center gap-2"
                >
                    <MessageSquare size={16} />
                    <span>Testar Agente</span>
                </button>
            </div>

            {/* Tabs Navigation */}
            <div className="tabs" style={{ marginBottom: 'var(--spacing-lg)' }}>
                <button
                    className={`tab ${activeTab === 'base' ? 'active' : ''}`}
                    onClick={() => setActiveTab('base')}
                >
                    Base
                </button>
                <button
                    className={`tab ${activeTab === 'configuracoes' ? 'active' : ''}`}
                    onClick={() => setActiveTab('configuracoes')}
                >
                    Configurações
                </button>
                {/* Ocultado visualmente conforme solicitação
                <button
                    className={`tab ${activeTab === 'objecoes' ? 'active' : ''}`}
                    onClick={() => setActiveTab('objecoes')}
                >
                    Objeções
                </button>
                */}
                <button
                    className={`tab ${activeTab === 'casos' ? 'active' : ''}`}
                    onClick={() => setActiveTab('casos')}
                >
                    Casos
                </button>
            </div>

            {/* Tab Contents */}
            {activeTab === 'base' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--spacing-xs)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                            Instrução Base (System Prompt)
                        </label>
                        <p className="text-muted text-xs" style={{ marginBottom: 'var(--spacing-sm)' }}>
                            Defina a personalidade do agente, as regras de negócios do produto e as instruções rígidas de comportamento que a IA deve seguir ao conversar.
                        </p>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Ex: Você é o agente de vendas da Ekoa. Seu objetivo é qualificar o lead respondendo suas dúvidas sobre o produto de forma cortês e conduzi-lo para o agendamento de uma demonstração..."
                            disabled={isSaving}
                            style={{
                                width: '100%',
                                minHeight: '350px',
                                padding: 'var(--spacing-md)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                backgroundColor: 'var(--color-bg)',
                                color: 'var(--color-text)',
                                fontFamily: 'inherit',
                                fontSize: 'var(--text-sm)',
                                lineHeight: '1.6',
                                resize: 'vertical'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-md)' }}>
                        <button
                            onClick={handleSaveBase}
                            disabled={prompt === initialPrompt || isSaving}
                            className="btn btn-primary flex items-center gap-2"
                        >
                            <Save size={16} />
                            <span>{isSaving ? 'Salvando...' : 'Salvar Alterações'}</span>
                        </button>
                    </div>
                </div>
            )}

            {activeTab === 'configuracoes' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    {/* Bloco 1: Modo de Resposta */}
                    <div style={sectionCardStyle}>
                        <h4 style={sectionTitleStyle}>Modo de Resposta</h4>
                        <p style={sectionDescStyle}>
                            Defina se o agente responde em uma única mensagem ou divide a resposta em várias mensagens menores, simulando uma conversa mais natural.
                        </p>
                        <div style={toggleContainerStyle}>
                            <button
                                type="button"
                                style={toggleBtnStyle(responseMode === 'single')}
                                onClick={() => setResponseMode('single')}
                                disabled={isSavingConfig}
                            >
                                Mensagem única
                            </button>
                            <button
                                type="button"
                                style={toggleBtnStyle(responseMode === 'split')}
                                onClick={() => setResponseMode('split')}
                                disabled={isSavingConfig}
                            >
                                Dividir em várias mensagens
                            </button>
                        </div>

                        {responseMode === 'split' && (
                            <div style={{ marginTop: 'var(--spacing-md)' }}>
                                <label style={{ display: 'block', fontWeight: 500, marginBottom: 'var(--spacing-xs)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                                    Máximo de mensagens por resposta
                                </label>
                                <input
                                    type="number"
                                    value={maxMessages}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value, 10);
                                        if (!isNaN(val) && val >= 1 && val <= 10) {
                                            setMaxMessages(val);
                                        }
                                    }}
                                    min={1}
                                    max={10}
                                    disabled={isSavingConfig}
                                    style={{
                                        width: '80px',
                                        padding: 'var(--spacing-sm)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--color-border)',
                                        backgroundColor: 'var(--color-bg)',
                                        color: 'var(--color-text)',
                                        fontSize: 'var(--text-sm)',
                                        textAlign: 'center',
                                    }}
                                />
                                <span className="text-muted text-xs" style={{ marginLeft: 'var(--spacing-sm)' }}>
                                    (entre 1 e 10)
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Bloco 2: Tom do Agente */}
                    <div style={sectionCardStyle}>
                        <h4 style={sectionTitleStyle}>Tom do Agente</h4>
                        <p style={sectionDescStyle}>
                            Descreva em texto livre o tom e a personalidade que o agente deve adotar nas conversas. Exemplos: "Cordial e profissional", "Descontraído e empático, usa emojis com moderação".
                        </p>
                        <textarea
                            value={tone}
                            onChange={(e) => setTone(e.target.value)}
                            placeholder="Ex: Cordial e profissional, sem usar gírias. Sempre trate o cliente por 'você'."
                            disabled={isSavingConfig}
                            style={{
                                width: '100%',
                                minHeight: '100px',
                                padding: 'var(--spacing-md)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                backgroundColor: 'var(--color-bg)',
                                color: 'var(--color-text)',
                                fontFamily: 'inherit',
                                fontSize: 'var(--text-sm)',
                                lineHeight: '1.6',
                                resize: 'vertical',
                            }}
                        />
                    </div>

                    {/* Bloco 3: Regra de Handoff */}
                    <div style={sectionCardStyle}>
                        <h4 style={sectionTitleStyle}>Acionar Vendedor (Lead Pronto)</h4>
                        <p style={sectionDescStyle}>
                            Descreva a condição em que o cliente é considerado um lead pronto para o vendedor fechar. A IA vai sinalizar internamente e CONTINUAR atendendo normalmente. Ex: cliente já informou a quantidade de frascos, o endereço completo e está aguardando os dados de pagamento.
                        </p>
                        <textarea
                            value={handoffRule}
                            onChange={(e) => setHandoffRule(e.target.value)}
                            placeholder="Ex: Cliente informou a quantidade de frascos que deseja comprar, informou o endereço completo de entrega e concordou com o preço do frete."
                            disabled={isSavingConfig}
                            style={{
                                width: '100%',
                                minHeight: '100px',
                                padding: 'var(--spacing-md)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                backgroundColor: 'var(--color-bg)',
                                color: 'var(--color-text)',
                                fontFamily: 'inherit',
                                fontSize: 'var(--text-sm)',
                                lineHeight: '1.6',
                                resize: 'vertical',
                            }}
                        />
                    </div>

                    {/* Bloco 3b: Tabela de preços (quantidade → valor total) */}
                    <div style={sectionCardStyle}>
                        <h4 style={sectionTitleStyle}>Tabela de Preços (frascos → valor)</h4>
                        <p style={sectionDescStyle}>
                            Quando o lead fica pronto, o valor do pedido no CRM é preenchido a partir desta tabela, usando a quantidade de frascos que o cliente pediu — sem depender do que a IA falou na conversa. Se a quantidade não estiver na tabela, o valor vai em branco e o vendedor completa.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                            {tabelaPrecos.map((faixa, idx) => (
                                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                    <input
                                        type="number"
                                        min={1}
                                        value={faixa.quantidade || ''}
                                        onChange={(e) => {
                                            const q = parseInt(e.target.value, 10);
                                            setTabelaPrecos((prev) => prev.map((f, i) => i === idx ? { ...f, quantidade: isNaN(q) ? 0 : q } : f));
                                        }}
                                        placeholder="Qtd"
                                        disabled={isSavingConfig}
                                        style={{ width: '80px', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 'var(--text-sm)', textAlign: 'center' }}
                                    />
                                    <span className="text-muted text-sm">frasco(s) →</span>
                                    <span className="text-muted text-sm">R$</span>
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={faixa.valor || ''}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value);
                                            setTabelaPrecos((prev) => prev.map((f, i) => i === idx ? { ...f, valor: isNaN(v) ? 0 : v } : f));
                                        }}
                                        placeholder="0.00"
                                        disabled={isSavingConfig}
                                        style={{ width: '110px', padding: 'var(--spacing-sm)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 'var(--text-sm)' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setTabelaPrecos((prev) => prev.filter((_, i) => i !== idx))}
                                        disabled={isSavingConfig}
                                        className="btn btn-ghost"
                                        style={{ padding: 'var(--spacing-sm)', color: 'var(--color-danger, #dc2626)' }}
                                        title="Remover faixa"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => setTabelaPrecos((prev) => [...prev, { quantidade: 0, valor: 0 }])}
                            disabled={isSavingConfig}
                            className="btn btn-ghost flex items-center gap-2"
                            style={{ marginTop: 'var(--spacing-md)' }}
                        >
                            <Plus size={16} />
                            <span>Adicionar faixa</span>
                        </button>
                    </div>

                    {/* Bloco 4: Apelido (slug) */}
                    <div style={{ ...sectionCardStyle, marginBottom: 'var(--spacing-lg)' }}>
                        <h4 style={sectionTitleStyle}>Apelido (slug)</h4>
                        <p style={sectionDescStyle}>
                            Identificador fixo usado nas integrações (ex: WhatsApp). Use letras minúsculas, sem espaços nem acentos.
                        </p>
                        <input
                            type="text"
                            value={slug}
                            onChange={(e) => setSlug(normalizeSlug(e.target.value))}
                            placeholder="Ex: patricia-closer"
                            disabled={isSavingConfig}
                            style={{
                                width: '100%',
                                maxWidth: '320px',
                                padding: 'var(--spacing-md)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                backgroundColor: 'var(--color-bg)',
                                color: 'var(--color-text)',
                                fontFamily: 'inherit',
                                fontSize: 'var(--text-sm)',
                            }}
                        />
                    </div>

                    {/* Bloco 5: Tempo de espera do debounce */}
                    <div style={{ ...sectionCardStyle, marginBottom: 0 }}>
                        <h4 style={sectionTitleStyle}>Tempo de espera antes de responder (segundos)</h4>
                        <p style={sectionDescStyle}>
                            Tempo que a IA aguarda após a última mensagem do cliente antes de responder, para juntar mensagens enviadas em sequência. Padrão: 8 segundos. Use 0 para responder imediatamente.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                            <input
                                type="number"
                                value={debounceSegundos}
                                onChange={(e) => {
                                    const rawVal = e.target.value;
                                    if (rawVal === '') {
                                        setDebounceSegundos(0);
                                        return;
                                    }
                                    let val = parseInt(rawVal, 10);
                                    if (isNaN(val)) val = 0;
                                    const clamped = Math.max(0, Math.min(30, val));
                                    setDebounceSegundos(clamped);
                                }}
                                min={0}
                                max={30}
                                disabled={isSavingConfig}
                                style={{
                                    width: '80px',
                                    padding: 'var(--spacing-sm)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: 'var(--color-bg)',
                                    color: 'var(--color-text)',
                                    fontSize: 'var(--text-sm)',
                                    textAlign: 'center',
                                }}
                            />
                            <span className="text-muted text-xs">
                                (entre 0 e 30 segundos)
                            </span>
                        </div>
                    </div>

                    {/* Botão Salvar */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-md)', marginTop: 'var(--spacing-lg)' }}>
                        <button
                            onClick={handleSaveConfig}
                            disabled={!configHasChanges() || isSavingConfig}
                            className="btn btn-primary flex items-center gap-2"
                        >
                            <Save size={16} />
                            <span>{isSavingConfig ? 'Salvando...' : 'Salvar Configurações'}</span>
                        </button>
                    </div>
                </div>
            )}

            {activeTab === 'objecoes' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    {/* Header com botão */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-lg)' }}>
                        <div>
                            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)', marginBottom: 'var(--spacing-xs)' }}>
                                Biblioteca de Objeções
                            </h3>
                            <p className="text-muted text-xs">
                                Cadastre as objeções mais comuns dos clientes e a melhor resposta que o agente deve dar para cada uma.
                            </p>
                        </div>
                        <button onClick={openNewObjectionModal} className="btn btn-primary flex items-center gap-2">
                            <Plus size={16} />
                            <span>Nova Objeção</span>
                        </button>
                    </div>

                    {/* Lista de objeções */}
                    {loadingObjections ? (
                        <div style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}>
                            <div className="loading-spinner" />
                            <p className="text-muted text-sm" style={{ marginTop: 'var(--spacing-sm)' }}>Carregando objeções...</p>
                        </div>
                    ) : objections.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}>
                            <AlertTriangle size={40} style={{ margin: '0 auto var(--spacing-md) auto', color: 'var(--color-text-muted)' }} />
                            <p className="text-muted text-sm">Nenhuma objeção cadastrada ainda.</p>
                            <p className="text-muted text-xs" style={{ marginTop: 'var(--spacing-xs)' }}>Clique em "Nova Objeção" para começar.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {objections.map((obj) => (
                                <div
                                    key={obj.id}
                                    style={{
                                        backgroundColor: 'var(--color-bg-alt)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: 'var(--spacing-md)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--spacing-sm)' }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', marginBottom: 'var(--spacing-xs)' }}>
                                                Objeção do cliente:
                                            </p>
                                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>
                                                {obj.trigger}
                                            </p>
                                        </div>
                                        <div style={{ display: 'flex', gap: 'var(--spacing-xs)', marginLeft: 'var(--spacing-md)', flexShrink: 0 }}>
                                            <button
                                                onClick={() => openEditObjectionModal(obj)}
                                                className="btn btn-secondary"
                                                style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', minWidth: 'auto' }}
                                                title="Editar"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                onClick={() => setDeleteObjectionTarget(obj)}
                                                className="btn btn-secondary"
                                                style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', minWidth: 'auto', color: 'var(--color-error)' }}
                                                title="Excluir"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-sm)' }}>
                                        <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', marginBottom: 'var(--spacing-xs)' }}>
                                            Melhor resposta:
                                        </p>
                                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap' }}>
                                            {obj.response}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Modal de Criar/Editar Objeção */}
            {showObjectionModal && (
                <div className="modal-overlay">
                    <div className="modal" style={{ maxWidth: '500px' }}>
                        <form onSubmit={(e) => { e.preventDefault(); handleSaveObjection(); }}>
                            <div className="modal-header">
                                <h3 className="modal-title text-lg">
                                    {editingObjection ? 'Editar Objeção' : 'Nova Objeção'}
                                </h3>
                            </div>
                            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                <div>
                                    <label style={{ display: 'block', fontWeight: 500, marginBottom: 'var(--spacing-xs)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                                        Objeção do cliente
                                    </label>
                                    <input
                                        type="text"
                                        value={objTrigger}
                                        onChange={(e) => setObjTrigger(e.target.value)}
                                        placeholder='Ex: "Tá caro", "Vou pensar", "Não preciso disso"'
                                        autoFocus
                                        required
                                        disabled={isSavingObjection}
                                        style={{
                                            width: '100%',
                                            padding: 'var(--spacing-sm) var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg)',
                                            color: 'var(--color-text)',
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontWeight: 500, marginBottom: 'var(--spacing-xs)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                                        Melhor resposta
                                    </label>
                                    <textarea
                                        value={objResponse}
                                        onChange={(e) => setObjResponse(e.target.value)}
                                        placeholder="Descreva a melhor forma de contornar essa objeção..."
                                        required
                                        disabled={isSavingObjection}
                                        style={{
                                            width: '100%',
                                            minHeight: '120px',
                                            padding: 'var(--spacing-sm) var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg)',
                                            color: 'var(--color-text)',
                                            fontFamily: 'inherit',
                                            fontSize: 'var(--text-sm)',
                                            lineHeight: '1.6',
                                            resize: 'vertical',
                                        }}
                                    />
                                </div>
                            </div>
                            <div className="modal-footer flex justify-end gap-2 p-4 pt-0 border-t-0">
                                <button type="button" onClick={() => setShowObjectionModal(false)} className="btn btn-secondary" disabled={isSavingObjection}>
                                    Cancelar
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={!objTrigger.trim() || !objResponse.trim() || isSavingObjection}>
                                    {isSavingObjection ? 'Salvando...' : (editingObjection ? 'Salvar Alterações' : 'Criar Objeção')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Confirmação de Exclusão */}
            <ConfirmModal
                isOpen={!!deleteObjectionTarget}
                title="Excluir Objeção"
                message={`Tem certeza que deseja excluir a objeção "${deleteObjectionTarget?.trigger || ''}"? Essa ação não pode ser desfeita.`}
                onConfirm={handleDeleteObjection}
                onCancel={() => setDeleteObjectionTarget(null)}
                confirmText="Excluir"
                cancelText="Cancelar"
                isDestructive={true}
            />

            {activeTab === 'casos' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    {/* Header com botão */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-lg)' }}>
                        <div>
                            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)', marginBottom: 'var(--spacing-xs)' }}>
                                Casos de Treinamento
                            </h3>
                            <p className="text-muted text-xs">
                                Cadastre exemplos reais de bom e mau atendimento para treinar o agente pelo exemplo.
                            </p>
                        </div>
                        <button onClick={openNewCaseModal} className="btn btn-primary flex items-center gap-2">
                            <Plus size={16} />
                            <span>Novo Caso</span>
                        </button>
                    </div>

                    {/* Lista de casos */}
                    {loadingCases ? (
                        <div style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}>
                            <div className="loading-spinner" />
                            <p className="text-muted text-sm" style={{ marginTop: 'var(--spacing-sm)' }}>Carregando casos...</p>
                        </div>
                    ) : cases.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}>
                            <Database size={40} style={{ margin: '0 auto var(--spacing-md) auto', color: 'var(--color-text-muted)' }} />
                            <p className="text-muted text-sm">Nenhum caso cadastrado ainda.</p>
                            <p className="text-muted text-xs" style={{ marginTop: 'var(--spacing-xs)' }}>Clique em "Novo Caso" para começar.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {cases.map((c) => (
                                <div
                                    key={c.id}
                                    style={{
                                        backgroundColor: 'var(--color-bg-alt)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: 'var(--spacing-md)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--spacing-sm)' }}>
                                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                            <span style={{
                                                display: 'inline-block',
                                                padding: '2px 8px',
                                                borderRadius: 'var(--radius-sm)',
                                                fontSize: 'var(--text-xs)',
                                                fontWeight: 600,
                                                backgroundColor: c.kind === 'good' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                                color: c.kind === 'good' ? 'var(--color-success, #22c55e)' : 'var(--color-error, #ef4444)',
                                                flexShrink: 0,
                                            }}>
                                                {c.kind === 'good' ? 'Bom' : 'Mau'}
                                            </span>
                                            <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
                                                {c.title}
                                            </p>
                                        </div>
                                        <div style={{ display: 'flex', gap: 'var(--spacing-xs)', marginLeft: 'var(--spacing-md)', flexShrink: 0 }}>
                                            <button
                                                onClick={() => openEditCaseModal(c)}
                                                className="btn btn-secondary"
                                                style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', minWidth: 'auto' }}
                                                title="Editar"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                onClick={() => setDeleteCaseTarget(c)}
                                                className="btn btn-secondary"
                                                style={{ padding: 'var(--spacing-xs) var(--spacing-sm)', minWidth: 'auto', color: 'var(--color-error)' }}
                                                title="Excluir"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-sm)' }}>
                                        <p style={{
                                            fontSize: 'var(--text-sm)',
                                            color: 'var(--color-text-muted)',
                                            whiteSpace: 'pre-wrap',
                                            overflow: 'hidden',
                                            display: '-webkit-box',
                                            WebkitLineClamp: 4,
                                            WebkitBoxOrient: 'vertical',
                                        }}>
                                            {c.content}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Modal de Criar/Editar Caso */}
            {showCaseModal && (
                <div className="modal-overlay">
                    <div className="modal" style={{ maxWidth: '550px' }}>
                        <form onSubmit={(e) => { e.preventDefault(); handleSaveCase(); }}>
                            <div className="modal-header">
                                <h3 className="modal-title text-lg">
                                    {editingCase ? 'Editar Caso' : 'Novo Caso'}
                                </h3>
                            </div>
                            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                <div>
                                    <label style={{ display: 'block', fontWeight: 500, marginBottom: 'var(--spacing-xs)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                                        Título
                                    </label>
                                    <input
                                        type="text"
                                        value={caseTitle}
                                        onChange={(e) => setCaseTitle(e.target.value)}
                                        placeholder='Ex: "Cliente indeciso que fechou", "Lead que abandonou por demora"'
                                        autoFocus
                                        required
                                        disabled={isSavingCase}
                                        style={{
                                            width: '100%',
                                            padding: 'var(--spacing-sm) var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg)',
                                            color: 'var(--color-text)',
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontWeight: 500, marginBottom: 'var(--spacing-xs)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                                        Tipo de exemplo
                                    </label>
                                    <div style={{
                                        display: 'flex',
                                        gap: '0',
                                        borderRadius: 'var(--radius-md)',
                                        overflow: 'hidden',
                                        border: '1px solid var(--color-border)',
                                        width: 'fit-content',
                                    }}>
                                        <button
                                            type="button"
                                            onClick={() => setCaseKind('good')}
                                            disabled={isSavingCase}
                                            style={{
                                                padding: 'var(--spacing-sm) var(--spacing-lg)',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontWeight: 500,
                                                fontSize: 'var(--text-sm)',
                                                transition: 'all 0.2s ease',
                                                backgroundColor: caseKind === 'good' ? 'rgba(34, 197, 94, 0.2)' : 'var(--color-bg)',
                                                color: caseKind === 'good' ? 'var(--color-success, #22c55e)' : 'var(--color-text-muted)',
                                            }}
                                        >
                                            Bom exemplo
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setCaseKind('bad')}
                                            disabled={isSavingCase}
                                            style={{
                                                padding: 'var(--spacing-sm) var(--spacing-lg)',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontWeight: 500,
                                                fontSize: 'var(--text-sm)',
                                                transition: 'all 0.2s ease',
                                                backgroundColor: caseKind === 'bad' ? 'rgba(239, 68, 68, 0.2)' : 'var(--color-bg)',
                                                color: caseKind === 'bad' ? 'var(--color-error, #ef4444)' : 'var(--color-text-muted)',
                                            }}
                                        >
                                            Mau exemplo
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontWeight: 500, marginBottom: 'var(--spacing-xs)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                                        Conteúdo
                                    </label>
                                    <textarea
                                        value={caseContent}
                                        onChange={(e) => setCaseContent(e.target.value)}
                                        placeholder="Cole aqui o exemplo de conversa ou descreva a situação e como o agente deveria agir..."
                                        required
                                        disabled={isSavingCase}
                                        style={{
                                            width: '100%',
                                            minHeight: '180px',
                                            padding: 'var(--spacing-sm) var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg)',
                                            color: 'var(--color-text)',
                                            fontFamily: 'inherit',
                                            fontSize: 'var(--text-sm)',
                                            lineHeight: '1.6',
                                            resize: 'vertical',
                                        }}
                                    />
                                </div>
                            </div>
                            <div className="modal-footer flex justify-end gap-2 p-4 pt-0 border-t-0">
                                <button type="button" onClick={() => setShowCaseModal(false)} className="btn btn-secondary" disabled={isSavingCase}>
                                    Cancelar
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={!caseTitle.trim() || !caseContent.trim() || isSavingCase}>
                                    {isSavingCase ? 'Salvando...' : (editingCase ? 'Salvar Alterações' : 'Criar Caso')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Confirmação de Exclusão de Caso */}
            <ConfirmModal
                isOpen={!!deleteCaseTarget}
                title="Excluir Caso"
                message={`Tem certeza que deseja excluir o caso "${deleteCaseTarget?.title || ''}"? Essa ação não pode ser desfeita.`}
                onConfirm={handleDeleteCase}
                onCancel={() => setDeleteCaseTarget(null)}
                confirmText="Excluir"
                cancelText="Cancelar"
                isDestructive={true}
            />
        </div>

        {/* Chat de Teste */}
        {agent && (
            <AgentChat
                agent={agent}
                isOpen={isChatOpen}
                onClose={() => setIsChatOpen(false)}
                cases={cases}
            />
        )}
    </>
    );
}

