// ========================================
// Conversas Page - Read-only Conversation Viewer
// ========================================

import { useEffect, useState } from 'react';
import { MessageSquare, Power, RotateCcw, ChevronRight, ChevronDown } from 'lucide-react';
import type { Conversation } from '../types';
import { Timestamp } from 'firebase/firestore';
import { setConversationAtivo, resetConversation, subscribeConversations } from '../services/firebase';

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

    const selected = conversations.find((c) => c.id === selectedId) || null;

    const pendentes = conversations.filter(
        (conv) => conv.status === 'pendente' && (!conv.messages || conv.messages.length === 0)
    );
    const normais = conversations.filter(
        (conv) => !(conv.status === 'pendente' && (!conv.messages || conv.messages.length === 0))
    );

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

            {/* Two-column layout */}
            <div className="conversations-layout">
                {/* Left column: conversation list */}
                <div className="conversations-list">
                    {conversations.length === 0 ? (
                        <div className="conversations-empty-list">
                            <MessageSquare size={32} />
                            <p>Nenhuma conversa encontrada.</p>
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
                                                            <span className="conversation-item-numero">{conv.numero}</span>
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
                                            <span className="conversation-item-numero">{conv.numero}</span>
                                            <span className="conversation-item-time">{formatTime(updatedMs)}</span>
                                        </div>
                                        <div className="conversation-item-agent" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                            <span>{conv.agenteSlug}</span>
                                            {conv.leadPronto === true && (
                                                <span className="badge badge-warning" style={{ fontSize: '10px', padding: '1px 6px' }}>
                                                    🔥 Lead pronto
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
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
