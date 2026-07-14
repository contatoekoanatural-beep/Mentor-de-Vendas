// ========================================
// Conversas Page - Read-only Conversation Viewer
// ========================================

import { useEffect, useState, useRef } from 'react';
import { MessageSquare, Power, RotateCcw, ChevronRight, ChevronDown, Search, Archive, Trash2, Bell, AlertTriangle } from 'lucide-react';
import type { Conversation } from '../types';
import { Timestamp } from 'firebase/firestore';
import { setConversationAtivo, resetConversation, subscribeConversations, setConversationArquivada, deleteConversation, setConversationRemarketing, limparFalhaIA, subscribeChipSaude } from '../services/firebase';
import type { ChipSaudeDoc } from '../services/firebase';

// ----------------------------------------
// Helpers
// ----------------------------------------

/** Extract millis from Firestore Timestamp, Unix number, or object with seconds */
function toMillis(val: any): number {
    if (!val) return 0;
    if (val instanceof Timestamp) return val.toMillis();
    if (typeof val === 'number') return val > 1e12 ? val : val * 1000; // seconds vs ms
    if (typeof val === 'object') {
        if ('toMillis' in val && typeof val.toMillis === 'function') return val.toMillis();
        if ('seconds' in val) return (val.seconds || 0) * 1000;
    }
    if (typeof val === 'string') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    return 0;
}

/** Format a timestamp (millis) into a readable string */
function formatTime(ms: number): string {
    if (!ms) return '';
    const d = new Date(ms);
    const now = new Date();
    const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    if (isToday) return `Hoje, ${time}`;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
        d.getDate() === yesterday.getDate() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getFullYear() === yesterday.getFullYear();

    if (isYesterday) return `Ontem, ${time}`;

    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ` ${time}`;
}

/** Truncate text to maxLen characters */
function truncate(text: string, maxLen: number): string {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen).trimEnd() + '…';
}

// ----------------------------------------
// Component
// ----------------------------------------

export default function Conversas() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [pendentesExpanded, setPendentesExpanded] = useState(false);
    const [busca, setBusca] = useState('');
    const [abaAtiva, setAbaAtiva] = useState<'ativas' | 'arquivados'>('ativas');
    const [chipSaude, setChipSaude] = useState<ChipSaudeDoc | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Chips que o vigia marcou como possivelmente fora do ar (entrega travada).
    const chipsSuspeitos = Object.values(chipSaude?.canais || {}).filter(
        (c) => c.status === 'suspeito'
    );

    const selected = conversations.find((c) => c.id === selectedId) || null;

    // Contagem de conversas por aba
    const totalAtivas = conversations.filter(c => c.arquivada !== true).length;
    const totalArquivadas = conversations.filter(c => c.arquivada === true).length;

    // Filtragem por aba ativa
    const tabConversations = conversations.filter(c => 
        abaAtiva === 'ativas' ? c.arquivada !== true : c.arquivada === true
    );

    // Filtro de busca local por telefone
    const cleanSearch = busca.replace(/\D/g, '');
    const filteredConversations = tabConversations.filter(conv => {
        if (!cleanSearch) return true;
        const cleanNumero = (conv.numero || '').replace(/\D/g, '');
        return cleanNumero.includes(cleanSearch);
    });

    const pendentes = filteredConversations.filter(
        (conv) => conv.status === 'pendente' && (!conv.messages || conv.messages.length === 0)
    );
    const normais = filteredConversations.filter(
        (conv) => !(conv.status === 'pendente' && (!conv.messages || conv.messages.length === 0))
    );

    // Subscribe to conversations in real time on mount
    useEffect(() => {
        setLoading(true);
        const unsubscribe = subscribeConversations((data) => {
            // Sort in memory by updatedAt descending
            const sorted = [...data].sort((a, b) => {
                return toMillis(b.updatedAt) - toMillis(a.updatedAt);
            });
            setConversations(sorted);
            setLoading(false);
        });

        // Cleanup listener on unmount
        return () => {
            unsubscribe();
        };
    }, []);

    // Subscribe to chip health (vigia de entrega) in real time
    useEffect(() => {
        const unsubscribe = subscribeChipSaude(setChipSaude);
        return () => unsubscribe();
    }, []);

    // Auto-scroll to the bottom of the chat when selecting a conversation or when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [selectedId, selected?.messages?.length]);



    // Toggle ativo field
    const toggleAtivo = async () => {
        if (!selected || saving) return;
        const novoAtivo = !(selected.ativo === true);
        setSaving(true);
        try {
            await setConversationAtivo(selected.id, novoAtivo);
            // Update local state immediately
            setConversations((prev) =>
                prev.map((c) =>
                    c.id === selected.id ? { ...c, ativo: novoAtivo } : c
                )
            );
        } catch (error) {
            console.error('Erro ao alterar estado da IA:', error);
        }
        setSaving(false);
    };

    // Toggle remarketingAtivo field
    const toggleRemarketing = async () => {
        if (!selected || saving) return;
        const novoRemarketing = !(selected.remarketingAtivo !== false);
        setSaving(true);
        try {
            await setConversationRemarketing(selected.id, novoRemarketing);
            // Update local state immediately
            setConversations((prev) =>
                prev.map((c) =>
                    c.id === selected.id ? { ...c, remarketingAtivo: novoRemarketing } : c
                )
            );
        } catch (error) {
            console.error('Erro ao alterar estado do remarketing:', error);
        }
        setSaving(false);
    };

    // Toggle arquivada field
    const toggleArquivada = async () => {
        if (!selected || saving) return;
        const novoArquivada = !(selected.arquivada === true);
        setSaving(true);
        try {
            await setConversationArquivada(selected.id, novoArquivada);
            // Update local state immediately
            setConversations((prev) =>
                prev.map((c) =>
                    c.id === selected.id ? { ...c, arquivada: novoArquivada } : c
                )
            );
        } catch (error) {
            console.error('Erro ao alterar estado de arquivamento:', error);
        }
        setSaving(false);
    };

    // Baixa o alerta de falha da IA (o vendedor assumiu a conversa)
    const handleLimparFalha = async () => {
        if (!selected || saving) return;
        setSaving(true);
        try {
            await limparFalhaIA(selected.id);
            setConversations((prev) =>
                prev.map((c) =>
                    c.id === selected.id ? { ...c, falhaIA: false } : c
                )
            );
        } catch (error) {
            console.error('Erro ao limpar alerta de falha da IA:', error);
        }
        setSaving(false);
    };

    // Reset conversation memory
    const handleReset = async () => {
        if (!selected || saving) return;

        const confirmed = window.confirm(
            "Reiniciar a memória desta conversa? Isso apaga todo o histórico de mensagens e desliga a IA. O número permanece na lista. Esta ação não pode ser desfeita."
        );
        if (!confirmed) return;

        setSaving(true);
        try {
            await resetConversation(selected.id);
            // Update local state immediately
            setConversations((prev) =>
                prev.map((c) =>
                    c.id === selected.id
                        ? { ...c, messages: [], ativo: false, ultimaMensagemTs: null, leadPronto: false }
                        : c
                )
            );
        } catch (error) {
            console.error('Erro ao reiniciar conversa:', error);
        }
        setSaving(false);
    };

    // Excluir conversa permanentemente
    const handleExcluir = async () => {
        if (!selected || selected.arquivada !== true || saving) return;

        const confirmed = window.confirm(
            "Excluir permanentemente esta conversa? Todo o histórico será apagado e NÃO poderá ser recuperado. Esta ação é irreversível."
        );
        if (!confirmed) return;

        setSaving(true);
        try {
            await deleteConversation(selected.id);
            // Limpa a seleção para evitar erro no painel lateral
            setSelectedId(null);
        } catch (error) {
            console.error('Erro ao excluir conversa:', error);
        }
        setSaving(false);
    };

    // Loading state
    if (loading) {
        return (
            <div className="loading-page" style={{ minHeight: '50vh' }}>
                <div className="loading-spinner" />
                <p className="text-muted">Carregando conversas...</p>
            </div>
        );
    }

    return (
        <div className="conversations-page">
            {/* Header */}
            <div className="conversations-header">
                <div>
                    <h2 className="conversations-title">Conversas</h2>
                    <p className="text-muted text-sm">
                        Acompanhe as conversas dos agentes com os clientes.
                    </p>
                </div>
                <span className="conversations-count">{conversations.length} conversa{conversations.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Alerta de chip possivelmente fora do ar (vigia de entrega) */}
            {chipsSuspeitos.length > 0 && (
                <div
                    role="alert"
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-3) var(--space-4)',
                        margin: '0 0 var(--space-3)',
                        border: '1px solid #f59e0b',
                        background: 'rgba(245, 158, 11, 0.12)',
                        borderRadius: 'var(--radius-md, 8px)',
                        color: 'var(--text-primary)',
                    }}
                >
                    <AlertTriangle size={20} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.45 }}>
                        <strong>
                            {chipsSuspeitos.length === 1
                                ? `O chip "${chipsSuspeitos[0].nome}" pode estar fora do ar`
                                : `${chipsSuspeitos.length} chips podem estar fora do ar`}
                        </strong>
                        {chipsSuspeitos.map((c) => (
                            <div key={c.nome} style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                                <strong>{c.nome}</strong>: a IA respondeu {c.enviados} cliente{c.enviados !== 1 ? 's' : ''} e nenhum respondeu de volta
                                {c.desde ? ` (desde ${formatTime(c.desde)})` : ''} — as mensagens podem não estar chegando. Confira a conexão desse número no Responde Chat.
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Two-column layout */}
            <div className="conversations-layout">
                {/* Left column: conversation list */}
                <div className="conversations-list">
                    {/* Abas Ativas / Arquivados */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card, #fff)' }}>
                        <button
                            onClick={() => setAbaAtiva('ativas')}
                            style={{
                                flex: 1,
                                padding: '12px 8px',
                                border: 'none',
                                borderBottom: abaAtiva === 'ativas' ? '2px solid var(--primary-color, #2563eb)' : '2px solid transparent',
                                background: 'transparent',
                                color: abaAtiva === 'ativas' ? 'var(--text-main, #1f2937)' : 'var(--text-muted, #6b7280)',
                                fontWeight: abaAtiva === 'ativas' ? '600' : '500',
                                fontSize: '0.875rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                        >
                            <span>Ativas</span>
                            <span style={{
                                fontSize: '0.75rem',
                                background: abaAtiva === 'ativas' ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-hover, #f3f4f6)',
                                padding: '2px 6px',
                                borderRadius: '10px',
                                color: abaAtiva === 'ativas' ? 'var(--primary-color, #2563eb)' : 'var(--text-muted, #6b7280)'
                            }}>
                                {totalAtivas}
                            </span>
                        </button>
                        <button
                            onClick={() => setAbaAtiva('arquivados')}
                            style={{
                                flex: 1,
                                padding: '12px 8px',
                                border: 'none',
                                borderBottom: abaAtiva === 'arquivados' ? '2px solid var(--primary-color, #2563eb)' : '2px solid transparent',
                                background: 'transparent',
                                color: abaAtiva === 'arquivados' ? 'var(--text-main, #1f2937)' : 'var(--text-muted, #6b7280)',
                                fontWeight: abaAtiva === 'arquivados' ? '600' : '500',
                                fontSize: '0.875rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                        >
                            <span>Arquivados</span>
                            <span style={{
                                fontSize: '0.75rem',
                                background: abaAtiva === 'arquivados' ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-hover, #f3f4f6)',
                                padding: '2px 6px',
                                borderRadius: '10px',
                                color: abaAtiva === 'arquivados' ? 'var(--primary-color, #2563eb)' : 'var(--text-muted, #6b7280)'
                            }}>
                                {totalArquivadas}
                            </span>
                        </button>
                    </div>

                    {/* Campo de Busca local */}
                    <div className="conversations-search-bar" style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <input
                                type="text"
                                placeholder="Buscar por número..."
                                value={busca}
                                onChange={(e) => setBusca(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px 8px 36px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    background: 'var(--bg-input, #fff)',
                                    color: 'var(--text-main)',
                                    fontSize: '0.875rem'
                                }}
                            />
                            <div style={{ position: 'absolute', left: '12px', display: 'flex', alignItems: 'center', pointerEvents: 'none', color: 'var(--text-muted)' }}>
                                <Search size={16} />
                            </div>
                            {busca && (
                                <button
                                    onClick={() => setBusca('')}
                                    style={{
                                        position: 'absolute',
                                        right: '12px',
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--text-muted)',
                                        cursor: 'pointer',
                                        fontSize: '0.875rem',
                                        padding: 0
                                    }}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    {filteredConversations.length === 0 ? (
                        <div className="conversations-empty-list">
                            <MessageSquare size={32} />
                            <p>
                                {busca 
                                    ? 'Nenhum resultado para a busca.' 
                                    : abaAtiva === 'ativas' 
                                        ? 'Nenhuma conversa ativa.' 
                                        : 'Nenhuma conversa arquivada.'}
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Seção de Pendentes (só aparece se houver pendentes) */}
                            {pendentes.length > 0 && (
                                <div className="conversations-section-pendentes" style={{ borderBottom: '1px solid var(--border-color)', marginBottom: 'var(--space-2)' }}>
                                    <button
                                        onClick={() => setPendentesExpanded(!pendentesExpanded)}
                                        className="conversations-pendentes-header"
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--space-2)',
                                            width: '100%',
                                            padding: 'var(--space-3) var(--space-4)',
                                            background: 'transparent',
                                            border: 'none',
                                            color: 'var(--text-main)',
                                            fontWeight: '600',
                                            fontSize: '0.875rem',
                                            cursor: 'pointer',
                                            textAlign: 'left'
                                        }}
                                    >
                                        {pendentesExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                        <span>Pendentes ({pendentes.length})</span>
                                    </button>

                                    {pendentesExpanded && (
                                        <div className="conversations-pendentes-list" style={{ paddingLeft: 'var(--space-2)' }}>
                                            {pendentes.map((conv) => {
                                                const updatedMs = toMillis(conv.updatedAt);
                                                return (
                                                    <button
                                                        key={conv.id}
                                                        className={`conversation-item ${selectedId === conv.id ? 'conversation-item--selected' : ''}`}
                                                        onClick={() => setSelectedId(conv.id)}
                                                    >
                                                        <div className="conversation-item-top">
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                                <span 
                                                                    style={{
                                                                        width: '8px',
                                                                        height: '8px',
                                                                        borderRadius: '50%',
                                                                        backgroundColor: conv.ativo === true ? '#22c55e' : '#9ca3af',
                                                                        display: 'inline-block',
                                                                        flexShrink: 0
                                                                    }}
                                                                    title={conv.ativo === true ? 'IA Ligada' : 'IA Desligada'}
                                                                />
                                                                <span className="conversation-item-numero">{conv.numero}</span>
                                                                {conv.leadPronto === true && (
                                                                    <span title="Lead Pronto" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center' }}>🔥</span>
                                                                )}
                                                                {conv.falhaIA === true && (
                                                                    <span title="A IA não respondeu — cliente esperando" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center' }}>⚠️</span>
                                                                )}
                                                            </div>
                                                            <span className="conversation-item-time">{formatTime(updatedMs)}</span>
                                                        </div>
                                                        <div className="conversation-item-agent">{conv.agenteSlug}</div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Seção Normal / Ativas */}
                            {normais.map((conv) => {
                                const lastMsg = conv.messages?.length
                                    ? conv.messages[conv.messages.length - 1]
                                    : null;
                                const updatedMs = toMillis(conv.updatedAt);

                                return (
                                    <button
                                        key={conv.id}
                                        className={`conversation-item ${selectedId === conv.id ? 'conversation-item--selected' : ''}`}
                                        onClick={() => setSelectedId(conv.id)}
                                    >
                                        <div className="conversation-item-top">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                <span 
                                                    style={{
                                                        width: '8px',
                                                        height: '8px',
                                                        borderRadius: '50%',
                                                        backgroundColor: conv.ativo === true ? '#22c55e' : '#9ca3af',
                                                        display: 'inline-block',
                                                        flexShrink: 0
                                                    }}
                                                    title={conv.ativo === true ? 'IA Ligada' : 'IA Desligada'}
                                                />
                                                <span className="conversation-item-numero">{conv.numero}</span>
                                                {conv.leadPronto === true && (
                                                    <span title="Lead Pronto" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center' }}>🔥</span>
                                                )}
                                                {conv.falhaIA === true && (
                                                    <span title="A IA não respondeu — cliente esperando" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center' }}>⚠️</span>
                                                )}
                                            </div>
                                            <span className="conversation-item-time">{formatTime(updatedMs)}</span>
                                        </div>
                                        <div className="conversation-item-agent" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                            <span>{conv.agenteSlug}</span>
                                            {conv.leadPronto === true && (
                                                <span className="badge badge-warning" style={{ fontSize: '10px', padding: '1px 6px' }}>
                                                    🔥 Lead pronto
                                                </span>
                                            )}
                                            {conv.falhaIA === true && (
                                                <span className="badge badge-error" style={{ fontSize: '10px', padding: '1px 6px' }}>
                                                    ⚠️ IA falhou
                                                </span>
                                            )}
                                        </div>
                                        {lastMsg && (
                                            <div className="conversation-item-preview">
                                                <span className="conversation-item-role">
                                                    {lastMsg.role === 'user' ? 'Cliente' : 'IA'}:
                                                </span>{' '}
                                                {truncate(lastMsg.text, 80)}
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </>
                    )}
                </div>

                {/* Right column: chat history */}
                <div className="conv-chat-panel">
                    {!selected ? (
                        <div className="chat-empty-state">
                            <MessageSquare size={48} />
                            <h3>Selecione uma conversa</h3>
                            <p className="text-muted">Escolha uma conversa na lista ao lado para visualizar o histórico completo.</p>
                        </div>
                    ) : (
                        <>
                            {/* Chat header */}
                            <div className="conv-chat-header">
                                 <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                     <span className="conv-chat-header-numero" style={{ marginRight: 0 }}>{selected.numero}</span>
                                     <span className="conv-chat-header-agent">{selected.agenteSlug}</span>
                                     {selected.leadPronto === true && (
                                         <span className="badge badge-warning" style={{ marginLeft: 'var(--space-2)' }}>
                                             🔥 Lead pronto
                                         </span>
                                     )}
                                 </div>
                                <div className="conv-chat-header-actions" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                    <span className="conv-chat-header-count" style={{ display: 'flex', alignItems: 'center' }}>
                                        {selected.messages?.length || 0} mensagen{(selected.messages?.length || 0) !== 1 ? 's' : ''}
                                    </span>
                                    <button
                                        className="conv-toggle-ativo conv-toggle-ativo--off"
                                        onClick={handleReset}
                                        disabled={saving}
                                        title="Reiniciar memória desta conversa"
                                        style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                    >
                                        <RotateCcw size={14} />
                                        <span>Reiniciar memória</span>
                                    </button>
                                    <button
                                        className={`conv-toggle-ativo ${selected.arquivada === true ? 'conv-toggle-ativo--on' : 'conv-toggle-ativo--off'}`}
                                        onClick={toggleArquivada}
                                        disabled={saving}
                                        title={selected.arquivada === true ? 'Desarquivar esta conversa' : 'Arquivar esta conversa'}
                                        style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                    >
                                        <Archive size={14} />
                                        <span>{saving ? 'Salvando...' : selected.arquivada === true ? 'Desarquivar' : 'Arquivar'}</span>
                                    </button>
                                    {selected.arquivada === true && (
                                        <button
                                            className="conv-toggle-ativo conv-toggle-ativo--off"
                                            onClick={handleExcluir}
                                            disabled={saving}
                                            title="Excluir permanentemente esta conversa"
                                            style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#ef4444' }}
                                        >
                                            <Trash2 size={14} />
                                            <span>Excluir</span>
                                        </button>
                                    )}
                                    <button
                                        className={`conv-toggle-ativo ${selected.remarketingAtivo !== false ? 'conv-toggle-ativo--on' : 'conv-toggle-ativo--off'}`}
                                        onClick={toggleRemarketing}
                                        disabled={saving}
                                        title={selected.remarketingAtivo !== false ? 'Desativar remarketing para este cliente' : 'Ativar remarketing para este cliente'}
                                        style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                    >
                                        <Bell size={14} />
                                        <span>{saving ? 'Salvando...' : selected.remarketingAtivo !== false ? 'Remarketing On' : 'Remarketing Off'}</span>
                                    </button>
                                    <button
                                        className={`conv-toggle-ativo ${selected.ativo === true ? 'conv-toggle-ativo--on' : 'conv-toggle-ativo--off'}`}
                                        onClick={toggleAtivo}
                                        disabled={saving}
                                        title={selected.ativo === true ? 'Desligar IA para este cliente' : 'Ligar IA para este cliente'}
                                    >
                                        <Power size={14} />
                                        <span>{saving ? 'Salvando...' : selected.ativo === true ? 'IA Ligada' : 'IA Desligada'}</span>
                                    </button>
                                </div>
                            </div>

                            {/* Alerta: a IA não conseguiu responder e o cliente ficou esperando */}
                            {selected.falhaIA === true && (
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-2)',
                                        padding: 'var(--space-3)',
                                        borderBottom: '1px solid var(--color-border)',
                                        backgroundColor: 'rgba(239, 68, 68, 0.1)'
                                    }}
                                >
                                    <AlertTriangle size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600 }}>
                                            A IA não respondeu esta mensagem
                                        </div>
                                        <div className="text-muted" style={{ fontSize: '12px' }}>
                                            {selected.falhaIATs ? formatTime(selected.falhaIATs) + ' — ' : ''}
                                            {truncate(selected.falhaIAMotivo || 'motivo não registrado', 160)}
                                        </div>
                                    </div>
                                    <button
                                        className="conv-toggle-ativo conv-toggle-ativo--off"
                                        onClick={handleLimparFalha}
                                        disabled={saving}
                                        title="Baixar o alerta depois de assumir a conversa"
                                    >
                                        {saving ? 'Salvando...' : 'Resolvido'}
                                    </button>
                                </div>
                            )}

                            {/* Messages */}
                            <div className="chat-messages">
                                {(selected.messages || []).flatMap((msg, idx) => {
                                    if (msg.role === 'model' && msg.text.includes('---')) {
                                        const parts = msg.text
                                            .split(/^---$/m)
                                            .map((p) => p.trim())
                                            .filter((p) => p.length > 0);

                                        return parts.map((partText, partIdx) => (
                                            <div
                                                key={`${idx}-${partIdx}`}
                                                className="chat-bubble chat-bubble--model"
                                                style={{
                                                    marginBottom: partIdx < parts.length - 1 ? '4px' : undefined
                                                }}
                                            >
                                                {partIdx === 0 && (
                                                    <div className="chat-bubble-role">Patrícia (IA)</div>
                                                )}
                                                <div className="chat-bubble-text">{partText}</div>
                                                {partIdx === parts.length - 1 && (
                                                    <div className="chat-bubble-time">
                                                        {formatTime(msg.ts > 1e12 ? msg.ts : msg.ts * 1000)}
                                                    </div>
                                                )}
                                            </div>
                                        ));
                                    }

                                    // Mensagens normais sem split (user ou model sem ---)
                                    return (
                                        <div
                                            key={idx}
                                            className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble--user' : 'chat-bubble--model'}`}
                                        >
                                            <div className="chat-bubble-role">
                                                {msg.role === 'user' ? 'Cliente' : 'Patrícia (IA)'}
                                            </div>
                                            <div className="chat-bubble-text">{msg.text}</div>
                                            <div className="chat-bubble-time">
                                                {formatTime(msg.ts > 1e12 ? msg.ts : msg.ts * 1000)}
                                            </div>
                                        </div>
                                    );
                                })}
                                {/* Anchor element for auto-scroll */}
                                <div ref={messagesEndRef} />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
