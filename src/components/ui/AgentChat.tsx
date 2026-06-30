import { useState, useRef, useEffect, useCallback } from 'react';
import type { Agent, AgentCase } from '../../types';
import { chatWithAgent, buildAgentSystemPrompt } from '../../services/aiService';
import type { ChatTurn } from '../../services/aiService';
import { X, Send, Trash2, Sparkles, User, AlertTriangle } from 'lucide-react';

interface ChatMessage {
    id: string;
    role: 'user' | 'agent';
    content: string;
    timestamp: Date;
    isError?: boolean;
}

interface AgentChatProps {
    agent: Agent;
    isOpen: boolean;
    onClose: () => void;
    cases?: AgentCase[];
}

export default function AgentChat({ agent, isOpen, onClose, cases }: AgentChatProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    // Focus input when panel opens
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen]);

    const addAgentMessage = useCallback((content: string, isError = false): ChatMessage => {
        const msg: ChatMessage = {
            id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'agent',
            content,
            timestamp: new Date(),
            isError,
        };
        setMessages((prev) => [...prev, msg]);
        return msg;
    }, []);

    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || isTyping) return;

        // Check if agent has a base prompt configured
        if (!agent.base || !agent.base.trim()) {
            addAgentMessage(
                'Este agente ainda não tem uma Base configurada. Vá até a aba "Base" e defina as instruções do agente antes de testar.',
                true,
            );
            return;
        }

        const userMsg: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: trimmed,
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput('');
        setIsTyping(true);

        try {
            // Build history from existing messages (exclude error messages)
            const history: ChatTurn[] = messages
                .filter((m) => !m.isError)
                .map((m) => ({
                    role: m.role === 'user' ? 'user' as const : 'model' as const,
                    text: m.content,
                }));

            // Build full system prompt with agent config
            const systemPrompt = buildAgentSystemPrompt({
                base: agent.base,
                tone: agent.tone,
                handoffRule: agent.handoffRule,
                responseMode: agent.responseMode,
                maxMessages: agent.maxMessages,
            }, cases);

            const result = await chatWithAgent(systemPrompt, history, trimmed);

            if (!result.success) {
                addAgentMessage(`Erro ao gerar resposta: ${result.error}`, true);
                setIsTyping(false);
                return;
            }

            const responseText = result.text!;
            const isSplitMode = agent.responseMode === 'split' && agent.maxMessages && agent.maxMessages > 1;

            if (isSplitMode) {
                // Split by '---' separator and clean up
                let parts = responseText
                    .split(/^---$/m)
                    .map((p) => p.trim())
                    .filter((p) => p.length > 0);

                const max = agent.maxMessages!;

                // If more parts than max, merge excess into last allowed part
                if (parts.length > max) {
                    const allowed = parts.slice(0, max - 1);
                    const excess = parts.slice(max - 1).join('\n\n');
                    allowed.push(excess);
                    parts = allowed;
                }

                // Display each part sequentially with delay
                setIsTyping(false);
                for (let i = 0; i < parts.length; i++) {
                    if (i > 0) {
                        // Show typing indicator between messages
                        setIsTyping(true);
                        await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 200));
                        setIsTyping(false);
                    }
                    addAgentMessage(parts[i]);
                }
            } else {
                // Single message mode — display as one bubble
                addAgentMessage(responseText);
            }
        } catch {
            addAgentMessage('Erro inesperado ao chamar a IA. Verifique sua conexão e tente novamente.', true);
        }

        setIsTyping(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleClear = () => {
        setMessages([]);
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <>
            {/* Overlay */}
            <div
                className={`chat-overlay ${isOpen ? 'open' : ''}`}
                onClick={onClose}
            />

            {/* Panel */}
            <div className={`chat-panel ${isOpen ? 'open' : ''}`}>
                {/* Header */}
                <div className="chat-panel-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1, minWidth: 0 }}>
                        <div className="chat-agent-avatar">
                            <Sparkles size={18} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {agent.name}
                            </h3>
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                                Teste de conversa
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                            onClick={handleClear}
                            className="btn btn-ghost"
                            style={{ padding: 'var(--space-2)', minWidth: 'auto', color: 'var(--text-tertiary)' }}
                            title="Limpar conversa"
                            disabled={messages.length === 0}
                        >
                            <Trash2 size={16} />
                        </button>
                        <button
                            onClick={onClose}
                            className="btn btn-ghost"
                            style={{ padding: 'var(--space-2)', minWidth: 'auto', color: 'var(--text-tertiary)' }}
                            title="Fechar"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Messages Area */}
                <div className="chat-messages">
                    {messages.length === 0 && (
                        <div className="chat-empty-state">
                            <div className="chat-empty-icon">
                                <Sparkles size={32} />
                            </div>
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
                                Converse com <strong style={{ color: 'var(--text-primary)' }}>{agent.name}</strong>
                            </p>
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                                Envie uma mensagem como se fosse o cliente para testar o agente.
                            </p>
                        </div>
                    )}

                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={`chat-message ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-agent'}`}
                        >
                            {msg.role === 'agent' && (
                                <div className={`chat-message-avatar agent`} style={msg.isError ? { background: 'rgba(220, 38, 38, 0.2)', color: 'var(--error)' } : undefined}>
                                    {msg.isError ? <AlertTriangle size={14} /> : <Sparkles size={14} />}
                                </div>
                            )}
                            <div
                                className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-agent'}`}
                                style={msg.isError ? { borderColor: 'rgba(220, 38, 38, 0.3)', color: 'var(--error)' } : undefined}
                            >
                                <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5 }}>{msg.content}</p>
                                <span className="chat-bubble-time">{formatTime(msg.timestamp)}</span>
                            </div>
                            {msg.role === 'user' && (
                                <div className="chat-message-avatar user">
                                    <User size={14} />
                                </div>
                            )}
                        </div>
                    ))}

                    {isTyping && (
                        <div className="chat-message chat-message-agent">
                            <div className="chat-message-avatar agent">
                                <Sparkles size={14} />
                            </div>
                            <div className="chat-bubble chat-bubble-agent">
                                <div className="chat-typing-indicator">
                                    <span /><span /><span />
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="chat-input-area">
                    <div className="chat-input-wrapper">
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Escreva como o cliente..."
                            disabled={isTyping}
                            className="chat-input"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isTyping}
                            className="chat-send-btn"
                            title="Enviar"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
