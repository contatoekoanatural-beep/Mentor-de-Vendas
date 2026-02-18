// ========================================
// Atendimento Page - Chat Interface
// ========================================

import { useState, useEffect, useRef } from 'react';
import {
    MessageCircle,
    GitBranch,
    Send,
    Image,
    Mic,
    FileText,
    Search,
    ChevronLeft,
    ChevronRight,
    Plus,
    X,
    User,
    Bot,
    Sparkles,
    Check,
} from 'lucide-react';
import { useProduct } from '../contexts/ProductContext';
import { useAuth } from '../contexts/AuthContext';
import {
    getFunnels,
    getScripts,
    getObjections,
    getFlowcharts,
    createSupportSession,
    logAudit,
} from '../services/firebase';
import { mentorEngine } from '../services/MentorEngine';
import type { Funnel, Script, Objection } from '../types';

// Message type
interface ChatMessage {
    id: string;
    type: 'user' | 'mentor' | 'script' | 'system';
    content: string;
    timestamp: Date;
    attachments?: { type: 'image' | 'audio'; url: string; name: string }[];
    suggestions?: Script[];
    isClarification?: boolean;
}

interface ClarificationContext {
    active: boolean;
    step: 'phase' | 'doubt' | 'context';
    answers: {
        phase?: string;
        doubt?: string;
        context?: string;
    };
}

export default function Atendimento() {
    const { activeProduct } = useProduct();
    const { user } = useAuth();
    const chatEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Data state
    const [funnels, setFunnels] = useState<Funnel[]>([]);
    const [scripts, setScripts] = useState<Script[]>([]);
    const [objections, setObjections] = useState<Objection[]>([]);
    const [loading, setLoading] = useState(true);

    // Chat state
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [selectedFunnelId, setSelectedFunnelId] = useState<string>('');
    const [clarification, setClarification] = useState<ClarificationContext>({
        active: false,
        step: 'phase',
        answers: {}
    });

    // Sidebar state
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [sidebarTab, setSidebarTab] = useState<'scripts' | 'objections'>('scripts');
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Notes state (collapsible)
    const [showNotes, setShowNotes] = useState(false);
    const [notes, setNotes] = useState('');

    // Run Funnel state
    const [runModeActive, setRunModeActive] = useState(false);
    const [currentScriptId, setCurrentScriptId] = useState<string | null>(null);

    // Load data
    useEffect(() => {
        if (!activeProduct) return;

        const loadData = async () => {
            setLoading(true);
            try {
                const funnelsData = await getFunnels(activeProduct.id);
                setFunnels(funnelsData);
                if (funnelsData.length > 0 && !selectedFunnelId) {
                    setSelectedFunnelId(funnelsData[0].id);
                }

                const objectionsData = await getObjections(activeProduct.id);
                setObjections(objectionsData);
            } catch (error) {
                console.error('Error loading data:', error);
            }
            setLoading(false);
        };

        loadData();
    }, [activeProduct]);

    // Load scripts when funnel changes
    // Load scripts when funnel changes
    useEffect(() => {
        const loadScripts = async () => {
            if (!activeProduct) return;
            const scriptsData = await getScripts(activeProduct.id, selectedFunnelId || undefined);
            setScripts(scriptsData);
        };
        loadScripts();
    }, [activeProduct, selectedFunnelId]);

    // Start/Stop Run Funnel
    const startRunFunnel = async () => {
        if (!activeProduct || !selectedFunnelId) {
            setMessages(prev => [...prev, { id: Date.now().toString(), type: 'system', content: 'Selecione um produto e funil para executar o fluxo.', timestamp: new Date() }]);
            return;
        }

        // Load latest flowchart for this funnel
        const flowcharts = await getFlowcharts(activeProduct.id, selectedFunnelId);
        const flowchart = (flowcharts && flowcharts.length > 0) ? flowcharts[0] : null;
        if (!flowchart) {
            setMessages(prev => [...prev, { id: Date.now().toString(), type: 'system', content: 'Nenhum fluxograma encontrado para este funil.', timestamp: new Date() }]);
            return;
        }

        // Build node->script mapping
        const map = new Map<string, string>();
        flowchart.nodes.forEach((n: any) => {
            if (n.scriptId) map.set(n.nodeId, n.scriptId);
        });

        const startNodeId = flowchart.startNodeId || (flowchart.nodes.find((n: any) => n.type === 'start')?.nodeId);
        const startScriptId = startNodeId ? map.get(startNodeId) : null;
        if (!startScriptId) {
            setMessages(prev => [...prev, { id: Date.now().toString(), type: 'system', content: 'Start node não tem script associado.', timestamp: new Date() }]);
            return;
        }

        setRunModeActive(true);
        setCurrentScriptId(startScriptId);
        // Render initial script into chat
        const s = scripts.find(sc => sc.id === startScriptId);
        if (s) {
            setMessages(prev => [...prev, { id: Date.now().toString(), type: 'script', content: s.content, timestamp: new Date() }]);
        }
    };

    const stopRunFunnel = () => {
        setRunModeActive(false);
        // cleanup
        setCurrentScriptId(null);
    };

    const handleSelectBranch = (nextScriptId?: string | null) => {
        if (!nextScriptId) {
            setMessages(prev => [...prev, { id: Date.now().toString(), type: 'system', content: 'Rota não configurada para este branch.', timestamp: new Date() }]);
            return;
        }
        const s = scripts.find(sc => sc.id === nextScriptId);
        if (s) {
            setMessages(prev => [...prev, { id: Date.now().toString(), type: 'script', content: s.content, timestamp: new Date() }]);
            setCurrentScriptId(nextScriptId);
        } else {
            setMessages(prev => [...prev, { id: Date.now().toString(), type: 'system', content: 'Próximo script não encontrado localmente.', timestamp: new Date() }]);
            setCurrentScriptId(nextScriptId);
        }
    };

    // Scroll to bottom on new message
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Add welcome message on load
    useEffect(() => {
        if (!loading && messages.length === 0) {
            setMessages([{
                id: 'welcome',
                type: 'system',
                content: 'Bem-vindo ao Mentor de Vendas! Selecione um funil para começar. Use o painel lateral para acessar scripts e objeções.',
                timestamp: new Date(),
            }]);
        }
    }, [loading]);

    const handleSendMessage = async () => {
        if (!inputValue.trim()) return;

        const userText = inputValue;
        const newMessage: ChatMessage = {
            id: Date.now().toString(),
            type: 'user',
            content: userText,
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, newMessage]);
        setInputValue('');
        setLoading(true);

        // If answering a clarification, keep existing flow
        if (clarification.active) {
            setLoading(false);
            handleClarificationResponse(userText);
            return;
        }

        // Try MentorEngine (AI) when product is active
        try {
            if (!activeProduct) {
                // Fallback to local keyword matching when no product
                const keywords = userText.toLowerCase().split(' ').filter(t => t.length > 3);
                const { bestMatches } = findBestScripts(keywords);
                setLoading(false);
                if (bestMatches.length > 0) sendMentorResponse(bestMatches);
                else startClarificationFlow();
                return;
            }

            const result = await mentorEngine.processRequest({
                productId: activeProduct.id,
                funnelId: selectedFunnelId || undefined,
                userMessage: userText,
                mode: 'ai',
            });

            setLoading(false);

            if (result && result.response && result.response.trim().length > 0) {
                const suggested = Array.isArray(result.suggestedScriptIds)
                    ? scripts.filter(s => result.suggestedScriptIds.includes(s.id))
                    : [];

                const mentorMessage: ChatMessage = {
                    id: Date.now().toString(),
                    type: 'mentor',
                    content: result.response,
                    timestamp: new Date(),
                    suggestions: suggested.length > 0 ? suggested : undefined,
                };

                setMessages(prev => [...prev, mentorMessage]);

                if (result.clarifyingQuestions && result.clarifyingQuestions.length > 0) {
                    const qMsg: ChatMessage = {
                        id: (Date.now() + 1).toString(),
                        type: 'mentor',
                        content: 'Perguntas de clarificação:\n' + result.clarifyingQuestions.join('\n'),
                        timestamp: new Date(),
                        isClarification: true,
                    };
                    setMessages(prev => [...prev, qMsg]);
                }

                // Reset clarification state if previously active
                if (clarification.active) setClarification({ active: false, step: 'phase', answers: {} });
            } else {
                // AI returned no useful response -> provide short fallback using rules + objections, then ask 1 clarification question
                const keywords = userText.toLowerCase().split(' ').filter(t => t.length > 3);
                const { bestMatches } = findBestScripts(keywords);

                const objectionMatches = objections.filter(o =>
                    keywords.some(k => o.title.toLowerCase().includes(k) || (o.bestResponses || []).some(r => r.toLowerCase().includes(k)))
                ).slice(0, 2);

                let fallbackText = '';
                if (objectionMatches.length > 0) {
                    const o = objectionMatches[0];
                    fallbackText = `Resposta rápida: ${o.bestResponses?.[0] || 'Sem resposta cadastrada para esta objeção.'} (Baseado na objeção: ${o.title})`;
                } else if (bestMatches.length > 0) {
                    const main = bestMatches[0];
                    fallbackText = `Resposta rápida: ${main.content.substring(0, 300)}${main.content.length > 300 ? '...' : ''} (Baseado no script: ${main.name})`;
                } else {
                    fallbackText = 'Desculpe, não encontrei uma resposta pronta nos materiais disponíveis.';
                }

                const fallbackMessage: ChatMessage = {
                    id: Date.now().toString(),
                    type: 'mentor',
                    content: fallbackText,
                    timestamp: new Date(),
                };
                setMessages(prev => [...prev, fallbackMessage]);

                // Ask a single clarification question (do not start full clarification flow)
                const clarMsg: ChatMessage = {
                    id: (Date.now() + 1).toString(),
                    type: 'mentor',
                    content: 'Para me ajudar a responder melhor: em que etapa do atendimento isso ocorreu?',
                    timestamp: new Date(),
                    isClarification: true,
                };
                setMessages(prev => [...prev, clarMsg]);
            }
        } catch (error) {
            console.error('MentorEngine error:', error);
            setLoading(false);

            // On error, provide short fallback using rules + objections, then ask single clarification
            const keywords = userText.toLowerCase().split(' ').filter(t => t.length > 3);
            const { bestMatches } = findBestScripts(keywords);

            const objectionMatches = objections.filter(o =>
                keywords.some(k => o.title.toLowerCase().includes(k) || (o.bestResponses || []).some(r => r.toLowerCase().includes(k)))
            ).slice(0, 2);

            let fallbackText = '';
            if (objectionMatches.length > 0) {
                const o = objectionMatches[0];
                fallbackText = `Resposta rápida: ${o.bestResponses?.[0] || 'Sem resposta cadastrada para esta objeção.'} (Baseado na objeção: ${o.title})`;
            } else if (bestMatches.length > 0) {
                const main = bestMatches[0];
                fallbackText = `Resposta rápida: ${main.content.substring(0, 300)}${main.content.length > 300 ? '...' : ''} (Baseado no script: ${main.name})`;
            } else {
                fallbackText = 'Desculpe, não encontrei uma resposta pronta nos materiais disponíveis.';
            }

            const fallbackMessage: ChatMessage = {
                id: Date.now().toString(),
                type: 'mentor',
                content: fallbackText,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, fallbackMessage]);

            const clarMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                type: 'mentor',
                content: 'Para me ajudar a responder melhor: em que etapa do atendimento isso ocorreu?',
                timestamp: new Date(),
                isClarification: true,
            };
            setMessages(prev => [...prev, clarMsg]);
        }
    };

    const findBestScripts = (keywords: string[]) => {
        const scoredScripts = scripts.map(script => {
            let score = 0;
            const titleLower = script.name.toLowerCase();
            const contentLower = script.content.toLowerCase();

            keywords.forEach(term => {
                if (titleLower.includes(term)) score += 3;
                if (contentLower.includes(term)) score += 1;
            });

            return { script, score };
        });

        const bestMatches = scoredScripts
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(item => item.script)
            .slice(0, 3);

        return { bestMatches };
    };

    const sendMentorResponse = (matches: Script[]) => {
        if (matches.length === 0) return;

        const main = matches[0];
        const others = matches.slice(1);

        const mentorMessage: ChatMessage = {
            id: Date.now().toString(),
            type: 'mentor',
            content: `💡 **Sugestão Principal:**\n\n${main.content}\n\n${others.length > 0 ? '**Outras opções:**' : ''}`,
            timestamp: new Date(),
            suggestions: others
        };

        setMessages(prev => [...prev, mentorMessage]);

        // Reset clarification if it was active
        if (clarification.active) {
            setClarification({ active: false, step: 'phase', answers: {} });
        }
    };

    const startClarificationFlow = () => {
        setClarification({
            active: true,
            step: 'phase',
            answers: {}
        });

        const question: ChatMessage = {
            id: Date.now().toString(),
            type: 'mentor',
            content: 'Hmm, não tenho certeza de qual script usar. Me ajude a entender:\n\n**O atendimento está em qual fase?** (ex: início, explicação, fechamento)',
            timestamp: new Date(),
            isClarification: true,
        };
        setMessages(prev => [...prev, question]);
    };

    const handleClarificationResponse = (answer: string) => {
        const currentStep = clarification.step;
        const newAnswers = { ...clarification.answers, [currentStep]: answer };

        if (currentStep === 'phase') {
            setClarification({
                active: true,
                step: 'doubt',
                answers: newAnswers
            });

            const question: ChatMessage = {
                id: Date.now().toString(),
                type: 'mentor',
                content: 'Entendi. E **qual é a principal dúvida ou objeção** do cliente agora?',
                timestamp: new Date(),
                isClarification: true,
            };
            setMessages(prev => [...prev, question]);
        }
        else if (currentStep === 'doubt') {
            setClarification({
                active: true,
                step: 'context',
                answers: newAnswers
            });

            const question: ChatMessage = {
                id: Date.now().toString(),
                type: 'mentor',
                content: 'Certo. Por fim, **ele já recebeu a oferta/preço** ou ainda não?',
                timestamp: new Date(),
                isClarification: true,
            };
            setMessages(prev => [...prev, question]);
        }
        else if (currentStep === 'context') {
            // Final step - use collected info to search again
            const searchContext = `${newAnswers.phase} ${newAnswers.doubt} ${newAnswers.context} ${answer}`;
            const keywords = searchContext.toLowerCase().split(' ').filter(t => t.length > 3);

            const { bestMatches } = findBestScripts(keywords);

            if (bestMatches.length > 0) {
                sendMentorResponse(bestMatches);
            } else {
                // Still no match, but flow complete
                const failMessage: ChatMessage = {
                    id: Date.now().toString(),
                    type: 'mentor',
                    content: 'Obrigado pelas informações! Mesmo com esses detalhes, não encontrei um script exato no funil ativo. Recomendo verificar o painel lateral ou criar um novo script para esse caso.',
                    timestamp: new Date(),
                };
                setMessages(prev => [...prev, failMessage]);
                setClarification({ active: false, step: 'phase', answers: {} });
            }
        }
    };

    const handleInsertScript = (script: Script) => {
        const scriptMessage: ChatMessage = {
            id: Date.now().toString(),
            type: 'script',
            content: script.content,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, scriptMessage]);

        // Copy to clipboard as well
        navigator.clipboard.writeText(script.content);
        setCopiedId(script.id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleInsertObjection = (objection: Objection) => {
        const content = `**Objeção:** ${objection.title}\n\n**Resposta sugerida:**\n${objection.bestResponses?.[0] || 'Sem resposta cadastrada'}`;
        const objectionMessage: ChatMessage = {
            id: Date.now().toString(),
            type: 'mentor',
            content,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, objectionMessage]);
    };

    const handleImageUpload = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const newMessage: ChatMessage = {
                id: Date.now().toString(),
                type: 'user',
                content: `📷 Imagem anexada: ${file.name}`,
                timestamp: new Date(),
                attachments: [{ type: 'image', url: reader.result as string, name: file.name }],
            };
            setMessages(prev => [...prev, newMessage]);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleAudioRecord = () => {
        // Placeholder for audio recording
        const newMessage: ChatMessage = {
            id: Date.now().toString(),
            type: 'system',
            content: '🎤 Gravação de áudio em desenvolvimento. Em breve você poderá gravar e a IA transcreverá automaticamente.',
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, newMessage]);
    };

    const handleSaveSession = async () => {
        if (!activeProduct || !user) return;

        try {
            const sessionId = await createSupportSession({
                productId: activeProduct.id,
                funnelId: selectedFunnelId || undefined,
                notes,
                objectionsDetected: [],
                status: 'completed',
                userId: user.id,
            });

            logAudit(user.id, user.name, 'create', 'supportSession', sessionId, 'Sessão de Chat');

            // Clear chat
            setMessages([{
                id: 'saved',
                type: 'system',
                content: '✅ Sessão salva com sucesso! Chat limpo para novo atendimento.',
                timestamp: new Date(),
            }]);
            setNotes('');
        } catch (error) {
            console.error('Error saving session:', error);
            alert('Erro ao salvar sessão');
        }
    };

    // Filtered scripts/objections based on search
    const filteredScripts = scripts.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.content.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredObjections = objections.filter(o =>
        o.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.bestResponses?.some(r => r.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    if (loading) {
        return (
            <div className="loading-page">
                <div className="loading-spinner" />
                <p className="text-muted">Carregando...</p>
            </div>
        );
    }

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 80px)',
            margin: 'calc(-1 * var(--space-6))',
            marginTop: 'calc(-1 * var(--space-4))',
        }}>
            {/* Header */}
            <div style={{
                padding: 'var(--space-4)',
                borderBottom: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
            }}>
                <div className="flex items-center gap-4">
                    <MessageCircle size={24} style={{ color: 'var(--color-accent-primary)' }} />
                    <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>Atendimento</h1>

                    {/* Funnel Selector */}
                    <div className="flex items-center gap-2" style={{ marginLeft: 'var(--space-4)' }}>
                        <GitBranch size={16} className="text-muted" />
                        <select
                            className="form-select"
                            value={selectedFunnelId}
                            onChange={(e) => setSelectedFunnelId(e.target.value)}
                            style={{ minWidth: 200 }}
                        >
                            <option value="">Todos os funis</option>
                            {funnels.map((f) => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => setShowNotes(!showNotes)}
                    >
                        📝 Notas
                    </button>
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={handleSaveSession}
                    >
                        Salvar Sessão
                    </button>

                    <button
                        className={`btn btn-sm ${runModeActive ? 'btn-danger' : 'btn-ghost'}`}
                        onClick={() => runModeActive ? stopRunFunnel() : startRunFunnel()}
                        title="Run Funnel"
                    >
                        {runModeActive ? 'Parar Execução' : 'Executar Funil'}
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Chat Area */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--color-bg-primary)',
                }}>
                    {/* Messages */}
                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: 'var(--space-4)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-3)',
                    }}>
                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                style={{
                                    display: 'flex',
                                    justifyContent: msg.type === 'user' ? 'flex-end' : 'flex-start',
                                }}
                            >
                                <div
                                    style={{
                                        maxWidth: '70%',
                                        padding: 'var(--space-3)',
                                        borderRadius: 'var(--radius-lg)',
                                        background: msg.type === 'user'
                                            ? 'var(--color-accent-primary)'
                                            : msg.type === 'script'
                                                ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.2))'
                                                : 'var(--color-bg-tertiary)',
                                        color: msg.type === 'user' ? 'white' : 'inherit',
                                        border: msg.type === 'script' ? '1px solid var(--color-accent-primary)' : 'none',
                                    }}
                                >
                                    {/* Message Header */}
                                    <div className="flex items-center gap-2 mb-1" style={{ opacity: 0.7, fontSize: 'var(--text-xs)' }}>
                                        {msg.type === 'user' && <User size={12} />}
                                        {msg.type === 'mentor' && <Bot size={12} />}
                                        {msg.type === 'script' && <FileText size={12} />}
                                        {msg.type === 'system' && <Sparkles size={12} />}
                                        <span>
                                            {msg.type === 'user' ? 'Você' :
                                                msg.type === 'mentor' ? 'Mentor' :
                                                    msg.type === 'script' ? 'Script' : 'Sistema'}
                                        </span>
                                        <span>• {msg.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>

                                    {/* Message Content */}
                                    <p style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)' }}>
                                        {msg.content}
                                    </p>

                                    {/* Attachments */}
                                    {msg.attachments?.map((att, i) => (
                                        <div key={i} style={{ marginTop: 'var(--space-2)' }}>
                                            {att.type === 'image' && (
                                                <img
                                                    src={att.url}
                                                    alt={att.name}
                                                    style={{
                                                        maxWidth: '100%',
                                                        maxHeight: 200,
                                                        borderRadius: 'var(--radius-md)'
                                                    }}
                                                />
                                            )}
                                        </div>
                                    ))}

                                    {/* Suggestions */}
                                    {msg.suggestions && msg.suggestions.length > 0 && (
                                        <div className="flex flex-col gap-2 mt-3">
                                            {msg.suggestions.map((script) => (
                                                <div
                                                    key={script.id}
                                                    style={{
                                                        padding: 'var(--space-2)',
                                                        background: 'rgba(255,255,255,0.1)',
                                                        borderRadius: 'var(--radius-md)',
                                                        border: '1px solid rgba(255,255,255,0.2)',
                                                    }}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span style={{ fontWeight: 600, fontSize: 'var(--text-xs)' }}>{script.name}</span>
                                                        <button
                                                            className="btn btn-xs btn-primary"
                                                            onClick={() => handleInsertScript(script)}
                                                        >
                                                            Usar
                                                        </button>
                                                    </div>
                                                    <p style={{ fontSize: 'var(--text-xs)', opacity: 0.8, marginTop: 'var(--space-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {script.content}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>

                    {/* Notes Panel (collapsible) */}
                    {showNotes && (
                        <div style={{
                            padding: 'var(--space-3)',
                            borderTop: '1px solid var(--color-border)',
                            background: 'var(--color-bg-secondary)',
                        }}>
                            <div className="flex items-center justify-between mb-2">
                                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>📝 Notas do Atendimento</span>
                                <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setShowNotes(false)}>
                                    <X size={14} />
                                </button>
                            </div>
                            <textarea
                                className="form-textarea"
                                placeholder="Anote detalhes importantes..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                style={{ fontSize: 'var(--text-sm)' }}
                            />
                        </div>
                    )}

                    {/* Run Funnel Controls: show branches if in run mode and current script is a decision */}
                    {runModeActive && currentScriptId && (() => {
                        const currentScript = scripts.find(s => s.id === currentScriptId);
                        if (currentScript && currentScript.nodeType === 'decision' && currentScript.branches && currentScript.branches.length > 0) {
                            return (
                                <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
                                    <div style={{ marginBottom: '8px', fontWeight: 600 }}>Escolha o caminho:</div>
                                    <div className="flex gap-2">
                                        {currentScript.branches.map((b) => (
                                            <button key={b.id} className="btn btn-sm btn-ghost" onClick={() => handleSelectBranch(b.nextScriptId || (b as any).targetStepId)}>
                                                {b.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            );
                        }
                        return null;
                    })()}

                    {/* Input Area */}
                    <div style={{
                        padding: 'var(--space-4)',
                        borderTop: '1px solid var(--color-border)',
                        background: 'var(--color-bg-secondary)',
                    }}>
                        <div className="flex items-center gap-2">
                            {/* Attachment Buttons */}
                            <button
                                className="btn btn-icon btn-ghost"
                                onClick={handleImageUpload}
                                title="Anexar imagem"
                            >
                                <Image size={20} />
                            </button>
                            <button
                                className="btn btn-icon btn-ghost"
                                onClick={handleAudioRecord}
                                title="Gravar áudio"
                            >
                                <Mic size={20} />
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                accept="image/*"
                                style={{ display: 'none' }}
                            />

                            {/* Text Input */}
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Digite sua mensagem ou cole texto do cliente..."
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                                style={{ flex: 1 }}
                            />

                            {/* Send Button */}
                            <button
                                className="btn btn-primary"
                                onClick={handleSendMessage}
                                disabled={!inputValue.trim()}
                            >
                                <Send size={18} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Sidebar Toggle */}
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    style={{
                        position: 'absolute',
                        right: sidebarOpen ? 320 : 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        zIndex: 10,
                        background: 'var(--color-bg-tertiary)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md) 0 0 var(--radius-md)',
                        padding: 'var(--space-2)',
                        cursor: 'pointer',
                        transition: 'right 0.3s ease',
                    }}
                >
                    {sidebarOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>

                {/* Sidebar */}
                <div style={{
                    width: sidebarOpen ? 320 : 0,
                    overflow: 'hidden',
                    transition: 'width 0.3s ease',
                    borderLeft: sidebarOpen ? '1px solid var(--color-border)' : 'none',
                    background: 'var(--color-bg-secondary)',
                    display: 'flex',
                    flexDirection: 'column',
                }}>
                    {/* Sidebar Header */}
                    <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--color-border)' }}>
                        {/* Tabs */}
                        <div className="flex gap-2 mb-3">
                            <button
                                className={`btn btn-sm ${sidebarTab === 'scripts' ? 'btn-primary' : 'btn-ghost'}`}
                                onClick={() => setSidebarTab('scripts')}
                                style={{ flex: 1 }}
                            >
                                <FileText size={14} />
                                Scripts ({scripts.length})
                            </button>
                            <button
                                className={`btn btn-sm ${sidebarTab === 'objections' ? 'btn-primary' : 'btn-ghost'}`}
                                onClick={() => setSidebarTab('objections')}
                                style={{ flex: 1 }}
                            >
                                <MessageCircle size={14} />
                                Objeções ({objections.length})
                            </button>
                        </div>

                        {/* Search */}
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{
                                position: 'absolute',
                                left: 'var(--space-3)',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--color-text-muted)',
                            }} />
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Buscar..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ paddingLeft: 'var(--space-8)', fontSize: 'var(--text-sm)' }}
                            />
                        </div>
                    </div>

                    {/* Sidebar Content */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)' }}>
                        {sidebarTab === 'scripts' && (
                            <>
                                {filteredScripts.length === 0 ? (
                                    <p className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
                                        {selectedFunnelId ? 'Nenhum script encontrado' : 'Selecione um funil'}
                                    </p>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {filteredScripts.map((script) => (
                                            <div
                                                key={script.id}
                                                style={{
                                                    padding: 'var(--space-3)',
                                                    background: 'var(--color-bg-tertiary)',
                                                    borderRadius: 'var(--radius-md)',
                                                    fontSize: 'var(--text-sm)',
                                                }}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <strong style={{ fontSize: 'var(--text-xs)' }}>{script.name}</strong>
                                                </div>
                                                <p style={{
                                                    fontSize: 'var(--text-xs)',
                                                    opacity: 0.8,
                                                    maxHeight: 60,
                                                    overflow: 'hidden',
                                                    marginBottom: 'var(--space-2)',
                                                }}>
                                                    {(script.content || '').substring(0, 100)}...
                                                </p>
                                                <button
                                                    className="btn btn-sm btn-primary"
                                                    onClick={() => handleInsertScript(script)}
                                                    style={{ width: '100%' }}
                                                >
                                                    {copiedId === script.id ? (
                                                        <><Check size={12} /> Inserido!</>
                                                    ) : (
                                                        <><Plus size={12} /> Inserir no Chat</>
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}

                        {sidebarTab === 'objections' && (
                            <>
                                {filteredObjections.length === 0 ? (
                                    <p className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
                                        Nenhuma objeção encontrada
                                    </p>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {filteredObjections.map((objection) => (
                                            <div
                                                key={objection.id}
                                                style={{
                                                    padding: 'var(--space-3)',
                                                    background: 'var(--color-bg-tertiary)',
                                                    borderRadius: 'var(--radius-md)',
                                                    fontSize: 'var(--text-sm)',
                                                }}
                                            >
                                                <strong style={{ fontSize: 'var(--text-xs)' }}>{objection.title}</strong>
                                                {objection.bestResponses?.[0] && (
                                                    <p style={{
                                                        fontSize: 'var(--text-xs)',
                                                        opacity: 0.8,
                                                        marginTop: 'var(--space-1)',
                                                        marginBottom: 'var(--space-2)',
                                                    }}>
                                                        → {objection.bestResponses[0].substring(0, 80)}...
                                                    </p>
                                                )}
                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => handleInsertObjection(objection)}
                                                    style={{ width: '100%' }}
                                                >
                                                    <Plus size={12} /> Inserir Resposta
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
