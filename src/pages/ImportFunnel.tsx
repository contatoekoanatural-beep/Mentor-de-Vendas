// ========================================
// Import Funnel Page - AI-powered import
// ========================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Sparkles,
    FileText,
    ArrowLeft,
    Send,
    Check,
    AlertCircle,
    Loader2,
    GitBranch,
    ChevronRight,
} from 'lucide-react';
import { useProduct } from '../contexts/ProductContext';
import { useAuth } from '../contexts/AuthContext';
import {
    parseFunnelWithAI,
    isAIConfigured,
    generateFlowchartFromFunnel,
    type ImportedFunnel,
} from '../services/aiService';
import {
    createFunnel,
    createScript,
    createFlowchart,
    logAudit,
} from '../services/firebase';

type ImportStage = 'input' | 'processing' | 'review' | 'questions' | 'success';

const STEP_TYPE_LABELS: Record<string, string> = {
    greeting: '👋 Saudação',
    audio: '🎤 Áudio',
    text: '💬 Texto',
    media: '🖼️ Mídia',
    delay: '⏱️ Delay',
    decision: '🔀 Decisão',
    closing: '🎯 Fechamento',
};

export default function ImportFunnel() {
    const navigate = useNavigate();
    const { activeProduct } = useProduct();
    const { user } = useAuth();

    const [stage, setStage] = useState<ImportStage>('input');
    const [funnelText, setFunnelText] = useState('');
    const [parsedFunnel, setParsedFunnel] = useState<ImportedFunnel | null>(null);
    const [questions, setQuestions] = useState<string[]>([]);
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [refinementInput, setRefinementInput] = useState('');
    const [isRefining, setIsRefining] = useState(false);

    const aiConfigured = isAIConfigured();

    const handleProcess = async () => {
        if (!funnelText.trim()) {
            setError('Cole o texto do funil antes de processar');
            return;
        }

        setError(null);
        setStage('processing');

        // Build additional context from previous answers if any
        let additionalContext = '';
        if (Object.keys(answers).length > 0) {
            additionalContext = questions
                .map((q, i) => answers[i] ? `Pergunta: ${q}\nResposta: ${answers[i]}` : '')
                .filter(Boolean)
                .join('\n\n');
        }

        const result = await parseFunnelWithAI(funnelText, additionalContext || undefined);

        if (!result.success) {
            setError(result.error || 'Erro ao processar');
            setStage('input');
            return;
        }

        setParsedFunnel(result.funnel || null);

        // Check if there are questions
        if (result.questions && result.questions.length > 0) {
            setQuestions(result.questions);
            setError(null); // Reset error state
            setStage('questions');
        } else {
            setError(null); // Reset error state
            setStage('review');
        }
    };

    const handleAnswerQuestions = async () => {
        // Re-process with answers
        setStage('processing');

        const additionalContext = questions
            .map((q, i) => `Pergunta: ${q}\nResposta: ${answers[i] || 'Não informado'}`)
            .join('\n\n');

        const result = await parseFunnelWithAI(funnelText, additionalContext);

        if (!result.success) {
            setError(result.error || 'Erro ao processar');
            setStage('questions');
            return;
        }

        setParsedFunnel(result.funnel || null);
        setStage('review');
    };

    const handleRefine = async () => {
        if (!refinementInput.trim() || !parsedFunnel) return;

        setIsRefining(true);
        setError(null);

        // Build context with current structure + refinement request
        const refinementContext = `ESTRUTURA ATUAL GERADA:\n${JSON.stringify(parsedFunnel, null, 2)}\n\n--- SOLICITAÇÃO DE AJUSTE ---\n${refinementInput}`;

        const result = await parseFunnelWithAI(funnelText, refinementContext);

        if (!result.success) {
            setError(result.error || 'Erro ao refinar');
        } else if (result.funnel) {
            setParsedFunnel(result.funnel);
            setRefinementInput('');
        }

        setIsRefining(false);
    };

    const handleSave = async () => {
        if (!parsedFunnel || !activeProduct || !user) {
            setError('Dados incompletos. Verifique se há um produto ativo selecionado.');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            // 1. Create the funnel
            console.log('Criando funil...', parsedFunnel.name);
            const funnelId = await createFunnel({
                name: parsedFunnel.name || 'Funil Importado',
                description: `Produto: ${parsedFunnel.product || 'N/A'}\nAtendente: ${parsedFunnel.attendant || 'N/A'}\nTrigger: ${parsedFunnel.trigger || 'N/A'}`,
                type: 'other',
                status: 'active',
                productIds: [activeProduct.id],
            });
            console.log('Funil criado com ID:', funnelId);

            logAudit(user.id, user.name, 'create', 'funnel', funnelId, parsedFunnel.name || 'Funil Importado');

            // 2. Create scripts for each step
            console.log('Criando scripts...', parsedFunnel.steps.length, 'etapas');
            for (const step of parsedFunnel.steps) {
                let scriptContent = step.content || '(Conteúdo não especificado)';
                if (step.duration) {
                    scriptContent += `\n\n⏱️ Duração: ${step.duration}`;
                }
                if (step.notes) {
                    scriptContent += `\n\n📝 Notas: ${step.notes}`;
                }

                const scriptId = await createScript({
                    name: `${step.order}. ${step.name || 'Etapa'}`,
                    content: scriptContent,
                    productIds: [activeProduct.id],
                    funnelId: funnelId,
                    tags: [step.type || 'text'],
                    createdBy: user.id,
                });
                console.log('Script criado:', step.name, 'ID:', scriptId);
            }

            // 3. Create flowchart
            console.log('Criando fluxograma...');
            const { nodes, edges } = generateFlowchartFromFunnel(parsedFunnel);
            console.log('Nodes gerados:', nodes.length, 'Edges:', edges.length);

            const flowchartId = await createFlowchart({
                title: `Fluxo - ${parsedFunnel.name || 'Funil Importado'}`,
                productIds: [activeProduct.id],
                funnelId: funnelId,
                scope: 'general',
                nodes: nodes.map(n => ({
                    nodeId: n.id,
                    type: n.type as 'start' | 'step' | 'decision' | 'end' | 'note',
                    title: n.title,
                    description: n.description,
                    position: n.position,
                })),
                edges: edges.map(e => ({
                    edgeId: e.id,
                    fromNodeId: e.source,
                    toNodeId: e.target,
                    label: e.label || '',
                })),
                changeNote: 'Importado via IA',
                createdBy: user.id,
            });
            console.log('Fluxograma criado com ID:', flowchartId);

            logAudit(user.id, user.name, 'create', 'flowchart', flowchartId, `Fluxo - ${parsedFunnel.name}`);

            setStage('success');

            // Navigate after delay
            setTimeout(() => {
                navigate(`/funis/${funnelId}`);
            }, 2000);

        } catch (err) {
            console.error('Error saving funnel:', err);
            const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
            setError(`Erro ao salvar funil: ${errorMessage}`);
        }

        setSaving(false);
    };

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div className="flex items-center gap-4">
                    <button
                        className="btn btn-icon btn-ghost"
                        onClick={() => navigate('/funis')}
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="page-title">
                            <Sparkles size={24} style={{ marginRight: 'var(--space-2)' }} />
                            Importar Funil com IA
                        </h1>
                        <p className="text-muted">
                            Cole o texto do seu funil e deixe a IA estruturar para você
                        </p>
                    </div>
                </div>
            </div>

            {/* API Warning */}
            {!aiConfigured && (
                <div
                    style={{
                        padding: 'var(--space-4)',
                        background: 'var(--color-warning-bg)',
                        border: '1px solid var(--color-warning)',
                        borderRadius: 'var(--radius-md)',
                        marginBottom: 'var(--space-6)',
                    }}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <AlertCircle size={18} style={{ color: 'var(--color-warning)' }} />
                        <strong>API do Gemini não configurada</strong>
                    </div>
                    <p style={{ fontSize: 'var(--text-sm)' }}>
                        Adicione sua chave de API no arquivo <code>.env</code>:
                    </p>
                    <code style={{
                        display: 'block',
                        marginTop: 'var(--space-2)',
                        padding: 'var(--space-2)',
                        background: 'rgba(0,0,0,0.2)',
                        borderRadius: 'var(--radius-sm)',
                    }}>
                        VITE_GEMINI_API_KEY=sua_chave_aqui
                    </code>
                </div>
            )}

            {/* Progress Steps */}
            <div className="flex items-center gap-2 mb-6">
                {['input', 'processing', 'review', 'success'].map((s, i) => (
                    <div key={s} className="flex items-center">
                        <div
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: 'var(--radius-full)',
                                background: stage === s || ['processing', 'review', 'questions', 'success'].indexOf(stage) > i - 1
                                    ? 'var(--color-accent-primary)'
                                    : 'var(--color-bg-tertiary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontSize: 'var(--text-sm)',
                                fontWeight: 600,
                            }}
                        >
                            {i + 1}
                        </div>
                        {i < 3 && (
                            <ChevronRight size={16} className="text-muted" style={{ margin: '0 var(--space-2)' }} />
                        )}
                    </div>
                ))}
            </div>

            {/* Stage: Input */}
            {stage === 'input' && (
                <div className="card" style={{ padding: 'var(--space-6)' }}>
                    <div className="form-group">
                        <label className="form-label">
                            <FileText size={16} style={{ marginRight: 'var(--space-1)' }} />
                            Cole o texto do funil
                        </label>
                        <textarea
                            className="form-textarea"
                            placeholder={`Exemplo:

FUNIL DE VENDAS - [NOME DO PRODUTO]
Atendimento: [Nome]

[ETAPA 1 - SAUDAÇÃO]
Olá! Tudo bem?
...

[ETAPA 2 - BENEFÍCIOS]
...`}
                            value={funnelText}
                            onChange={(e) => setFunnelText(e.target.value)}
                            rows={15}
                            style={{ fontFamily: 'monospace', fontSize: 'var(--text-sm)' }}
                        />
                    </div>

                    {error && (
                        <div style={{
                            padding: 'var(--space-3)',
                            background: 'var(--color-error-bg)',
                            borderRadius: 'var(--radius-md)',
                            marginBottom: 'var(--space-4)',
                            color: 'var(--color-error)',
                        }}>
                            {error}
                        </div>
                    )}

                    <button
                        className="btn btn-primary"
                        onClick={handleProcess}
                        disabled={!aiConfigured || !funnelText.trim()}
                        style={{ width: '100%' }}
                    >
                        <Sparkles size={16} />
                        Processar com IA
                    </button>
                </div>
            )}

            {/* Stage: Processing */}
            {stage === 'processing' && (
                <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
                    <Loader2 size={48} className="text-muted" style={{ animation: 'spin 1s linear infinite', margin: '0 auto var(--space-4)' }} />
                    <h3 style={{ marginBottom: 'var(--space-2)' }}>Processando com IA...</h3>
                    <p className="text-muted">Analisando a estrutura do funil</p>
                </div>
            )}

            {/* Stage: Questions */}
            {stage === 'questions' && (
                <div className="card" style={{ padding: 'var(--space-6)' }}>
                    <h3 style={{ marginBottom: 'var(--space-4)' }}>
                        <AlertCircle size={20} style={{ marginRight: 'var(--space-2)', color: 'var(--color-warning)' }} />
                        Preciso de mais informações
                    </h3>
                    <p className="text-muted" style={{ marginBottom: 'var(--space-4)' }}>
                        A IA identificou algumas informações que podem estar faltando:
                    </p>

                    {questions.map((question, index) => (
                        <div key={index} className="form-group">
                            <label className="form-label">{question}</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Sua resposta..."
                                value={answers[index] || ''}
                                onChange={(e) => setAnswers({ ...answers, [index]: e.target.value })}
                            />
                        </div>
                    ))}

                    <div className="flex gap-3">
                        <button
                            className="btn btn-secondary"
                            onClick={() => setStage('review')}
                        >
                            Pular perguntas
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleAnswerQuestions}
                        >
                            <Send size={16} />
                            Enviar respostas
                        </button>
                    </div>
                </div>
            )}

            {/* Stage: Review */}
            {stage === 'review' && parsedFunnel && (
                <div>
                    {/* Funnel Info */}
                    <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
                        <h3 style={{ marginBottom: 'var(--space-3)' }}>
                            <GitBranch size={20} style={{ marginRight: 'var(--space-2)' }} />
                            {parsedFunnel.name || 'Funil Importado'}
                        </h3>
                        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
                            {parsedFunnel.product && (
                                <div>
                                    <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Produto</span>
                                    <p style={{ fontWeight: 500 }}>{parsedFunnel.product}</p>
                                </div>
                            )}
                            {parsedFunnel.attendant && (
                                <div>
                                    <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Atendente</span>
                                    <p style={{ fontWeight: 500 }}>{parsedFunnel.attendant}</p>
                                </div>
                            )}
                            {parsedFunnel.trigger && (
                                <div>
                                    <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Trigger</span>
                                    <p style={{ fontWeight: 500 }}>{parsedFunnel.trigger}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Steps */}
                    <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
                        <h4 style={{ marginBottom: 'var(--space-4)' }}>
                            Etapas Identificadas ({parsedFunnel.steps.length})
                        </h4>
                        <div className="flex flex-col gap-3">
                            {parsedFunnel.steps.map((step) => (
                                <div
                                    key={step.order}
                                    style={{
                                        padding: 'var(--space-3)',
                                        background: 'var(--color-bg-tertiary)',
                                        borderRadius: 'var(--radius-md)',
                                        borderLeft: '3px solid var(--color-accent-primary)',
                                    }}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <strong>{step.order}. {step.name}</strong>
                                        <span className="badge badge-secondary">
                                            {STEP_TYPE_LABELS[step.type] || step.type}
                                        </span>
                                    </div>
                                    <p style={{ fontSize: 'var(--text-sm)', opacity: 0.8 }}>
                                        {step.content ? (
                                            <>
                                                {step.content.substring(0, 150)}
                                                {step.content.length > 150 && '...'}
                                            </>
                                        ) : (
                                            <span className="text-muted">(Sem conteúdo)</span>
                                        )}
                                    </p>
                                    {step.duration && (
                                        <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                                            ⏱️ {step.duration}
                                        </span>
                                    )}
                                    {step.delayTime && (
                                        <span className="text-muted" style={{ fontSize: 'var(--text-xs)', marginLeft: 'var(--space-2)' }}>
                                            ⏸️ Delay: {step.delayTime}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Missing Info Warning */}
                    {parsedFunnel.missingInfo && parsedFunnel.missingInfo.length > 0 && (
                        <div
                            style={{
                                padding: 'var(--space-4)',
                                background: 'var(--color-warning-bg)',
                                borderRadius: 'var(--radius-md)',
                                marginBottom: 'var(--space-4)',
                            }}
                        >
                            <strong>Informações possivelmente faltantes:</strong>
                            <ul style={{ margin: 'var(--space-2) 0 0 var(--space-4)', padding: 0 }}>
                                {parsedFunnel.missingInfo.map((info, i) => (
                                    <li key={i} style={{ fontSize: 'var(--text-sm)' }}>{info}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Chat Refinement */}
                    <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                        <h4 style={{ marginBottom: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
                            💬 Solicitar Ajustes
                        </h4>
                        <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-3)' }}>
                            Descreva mudanças ou observações e a IA ajustará a estrutura.
                        </p>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Ex: Adicione uma etapa de objeção entre 3 e 4..."
                                value={refinementInput}
                                onChange={(e) => setRefinementInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
                                disabled={isRefining}
                            />
                            <button
                                className="btn btn-secondary"
                                onClick={handleRefine}
                                disabled={!refinementInput.trim() || isRefining}
                            >
                                {isRefining ? (
                                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                                ) : (
                                    <Send size={16} />
                                )}
                            </button>
                        </div>
                        {error && (
                            <div style={{ marginTop: 'var(--space-2)', color: 'var(--color-error)', fontSize: 'var(--text-xs)' }}>
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3">
                        <button
                            className="btn btn-secondary"
                            onClick={() => {
                                setStage('input');
                                setParsedFunnel(null);
                            }}
                        >
                            Voltar e Editar
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleSave}
                            disabled={saving}
                            style={{ flex: 1 }}
                        >
                            {saving ? (
                                <>
                                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                                    Salvando...
                                </>
                            ) : (
                                <>
                                    <Check size={16} />
                                    Salvar Funil e Fluxograma
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* Stage: Success */}
            {stage === 'success' && (
                <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
                    <div
                        style={{
                            width: 64,
                            height: 64,
                            borderRadius: 'var(--radius-full)',
                            background: 'var(--color-success)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto var(--space-4)',
                        }}
                    >
                        <Check size={32} color="white" />
                    </div>
                    <h3 style={{ marginBottom: 'var(--space-2)' }}>Funil importado com sucesso!</h3>
                    <p className="text-muted">Redirecionando para os detalhes...</p>
                </div>
            )}

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
