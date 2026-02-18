import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Play, FileText, ArrowRight, MessageSquare, Loader2 } from 'lucide-react';
import { MentorInterpreter } from '../../services/interpreter/MentorInterpreter';
import type { FlowDraft } from '../../types';

interface ScriptInterpreterPanelProps {
    isOpen: boolean;
    onClose: () => void;
    initialScript: string;
    funnelId: string;
    productId: string;
    onApplyFlow: (draft: FlowDraft) => void;
}

interface Message {
    id: string;
    role: 'user' | 'ai';
    content: string;
    timestamp: Date;
}

export default function ScriptInterpreterPanel({
    isOpen,
    onClose,
    initialScript,
    funnelId,
    productId,
    onApplyFlow,
}: ScriptInterpreterPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [draft, setDraft] = useState<FlowDraft | null>(null);
    const [viewMode, setViewMode] = useState<'chat' | 'preview'>('chat');

    // Auto-analyze on open if script is provided and no messages
    useEffect(() => {
        if (isOpen && initialScript && messages.length === 0) {
            handleAnalyze(initialScript);
        }
    }, [isOpen, initialScript]);

    const scrollToBottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        scrollToBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const addMessage = (role: 'user' | 'ai', content: string) => {
        const newMessage: Message = {
            id: Date.now().toString(),
            role,
            content,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, newMessage]);
    };

    const handleAnalyze = async (text: string) => {
        setIsLoading(true);
        if (messages.length === 0) {
            // Initial user message implicitly
            addMessage('user', `Analise este script:\n${text.substring(0, 100)}...`);
        }

        try {
            // Collect user answers from previous messages if needed (mock for now)
            const userAnswers = messages
                .filter(m => m.role === 'user')
                .map(m => m.content);

            const result = await MentorInterpreter.analyzeScript(text, funnelId, productId, userAnswers);

            if (result.type === 'questions') {
                const questionsList = (result.content as string[]).map(q => `- ${q}`).join('\n');
                addMessage('ai', `Preciso entender melhor:\n${questionsList}`);
            } else {
                const generatedDraft = result.content as FlowDraft;
                setDraft(generatedDraft);
                addMessage('ai', `Entendi! Gere uma estrutura com ${generatedDraft.steps.length} etapas.`);
                setViewMode('preview');
            }
        } catch (error) {
            console.error(error);
            addMessage('ai', 'Desculpe, não consegui analisar o script agora.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSendMessage = async () => {
        if (!inputText.trim()) return;

        const text = inputText;
        setInputText('');
        addMessage('user', text);

        setIsLoading(true);
        try {
            // Re-analyze with new context (the input text is treated as answer or new instruction)
            // In a real LLM scenario, we would send the whole history.
            // For mock, we just pass the input text concatenated with initial script or just input.
            // Let's pass the input text as "answers" to the mock service.

            const result = await MentorInterpreter.analyzeScript(initialScript || text, funnelId, productId, [text]);

            if (result.type === 'questions') {
                const questionsList = (result.content as string[]).map(q => `- ${q}`).join('\n');
                addMessage('ai', `Ainda tenho dúvidas:\n${questionsList}`);
            } else {
                const generatedDraft = result.content as FlowDraft;
                setDraft(generatedDraft);
                addMessage('ai', `Atualizei a estrutura baseada na sua resposta.`);
                setViewMode('preview');
            }

        } catch (error) {
            addMessage('ai', 'Erro ao processar resposta.');
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: '450px',
            background: 'var(--color-bg-secondary)',
            boxShadow: '-4px 0 20px rgba(0,0,0,0.2)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid var(--color-border)'
        }}>
            {/* Header */}
            <div style={{
                padding: 'var(--space-4)',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--color-bg-primary)'
            }}>
                <div className="flex items-center gap-2">
                    <MessageSquare size={20} className="text-primary" />
                    <h3 style={{ fontWeight: 600 }}>IA Interpreter</h3>
                </div>
                <button className="btn btn-icon btn-ghost" onClick={onClose}>
                    <X size={20} />
                </button>
            </div>

            {/* View Toggle */}
            <div style={{ padding: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-border)' }}>
                <button
                    className={`btn btn-sm ${viewMode === 'chat' ? 'btn-secondary' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => setViewMode('chat')}
                >
                    Chat
                </button>
                <button
                    className={`btn btn-sm ${viewMode === 'preview' ? 'btn-secondary' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => setViewMode('preview')}
                    disabled={!draft}
                >
                    Preview Estrutura
                    {draft && <span className="badge badge-success" style={{ marginLeft: 6, fontSize: 10 }}>{draft.steps.length}</span>}
                </button>
            </div>

            {/* Content Area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column' }}>

                {/* Chat View */}
                <div style={{ display: viewMode === 'chat' ? 'flex' : 'none', flexDirection: 'column', gap: 'var(--space-3)', minHeight: '100%' }}>
                    {messages.map((msg) => (
                        <div key={msg.id} style={{
                            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            maxWidth: '85%',
                            background: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-bg-tertiary)',
                            color: msg.role === 'user' ? 'white' : 'var(--color-text-primary)',
                            padding: 'var(--space-3)',
                            borderRadius: 'var(--radius-lg)',
                            borderBottomRightRadius: msg.role === 'user' ? 0 : 'var(--radius-lg)',
                            borderBottomLeftRadius: msg.role === 'ai' ? 0 : 'var(--radius-lg)',
                            fontSize: 'var(--text-sm)',
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap'
                        }}>
                            {msg.content}
                        </div>
                    ))}
                    {isLoading && (
                        <div style={{ alignSelf: 'flex-start', padding: 'var(--space-3)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-lg)' }}>
                            <Loader2 className="animate-spin" size={16} />
                        </div>
                    )}
                    <div ref={scrollToBottomRef} />
                </div>

                {/* Preview View */}
                {viewMode === 'preview' && draft && (
                    <div className="animate-fade-in">
                        <h4 style={{ fontWeight: 600, marginBottom: 'var(--space-3)' }}>{draft.title}</h4>
                        <div className="flex flex-col gap-2">
                            {draft.steps.map((step, idx) => (
                                <div key={step.key} className="card" style={{ padding: 'var(--space-3)', borderLeft: '3px solid var(--color-primary)' }}>
                                    <div className="flex justify-between items-start">
                                        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{step.name}</span>
                                        <span className="badge badge-neutral">{step.key}</span>
                                    </div>
                                    <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}>
                                        Objetivo: {step.goal}
                                    </p>
                                    {idx < draft.steps.length - 1 && (
                                        <div className="flex justify-center my-1 text-muted">
                                            <ArrowRight size={14} className="transform rotate-90" />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                            <h5 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Pronto para aplicar?</h5>
                            <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-3)' }}>
                                Isso criará {draft.steps.length} nós no fluxograma e conectará as etapas.
                            </p>
                            <button
                                className="btn btn-primary w-full"
                                onClick={() => onApplyFlow(draft)}
                            >
                                <Play size={16} />
                                Aplicar no Fluxograma
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area (only for chat) */}
            {viewMode === 'chat' && (
                <div style={{
                    padding: 'var(--space-3)',
                    borderTop: '1px solid var(--color-border)',
                    background: 'var(--color-bg-secondary)'
                }}>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            className="form-input"
                            placeholder="Responda ou digite..."
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                            disabled={isLoading}
                        />
                        <button
                            className="btn btn-primary btn-icon"
                            onClick={handleSendMessage}
                            disabled={!inputText.trim() || isLoading}
                        >
                            <Send size={18} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
