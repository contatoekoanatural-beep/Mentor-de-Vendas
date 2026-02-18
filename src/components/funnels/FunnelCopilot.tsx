import { useState, useEffect, useRef } from 'react';
import {
    X,
    Send,
    MessageSquare,
    Loader2,
    Sparkles,
    Play,
    CheckCircle2,
    Minimize2
} from 'lucide-react';
import {
    FunnelCopilotService,
    type CopilotMessage,
    type CopilotContext,
    type CopilotAction
} from '../../services/ai/FunnelCopilotService';

interface FunnelCopilotProps {
    isOpen: boolean;
    onClose: () => void;
    context: CopilotContext;
    onAction: (action: CopilotAction) => Promise<void>;
}

export default function FunnelCopilot({ isOpen, onClose, context, onAction }: FunnelCopilotProps) {
    const [messages, setMessages] = useState<CopilotMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const scrollToBottomRef = useRef<HTMLDivElement>(null);

    // Initial greeting
    useEffect(() => {
        if (isOpen && messages.length === 0) {
            setMessages([{
                id: 'init',
                role: 'ai',
                content: `Olá! Sou seu Copilot de Vendas.\nEstou analisando o funil **${context.funnelName}**. Como posso ajudar a melhorá-lo hoje?`,
                timestamp: new Date()
            }]);
        }
    }, [isOpen, context.funnelName]);

    useEffect(() => {
        scrollToBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    const handleSendMessage = async () => {
        if (!inputText.trim() || isLoading) return;

        const userMsg: CopilotMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: inputText,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setIsLoading(true);

        try {
            const response = await FunnelCopilotService.sendMessage(
                userMsg.content,
                messages, // Send history
                context
            );

            const aiMsg: CopilotMessage = {
                id: (Date.now() + 1).toString(),
                role: 'ai',
                content: response.text,
                timestamp: new Date(),
                proposedAction: response.action
            };

            setMessages(prev => [...prev, aiMsg]);

        } catch (error) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'ai',
                content: 'Desculpe, tive um problema de conexão. Tente novamente.',
                timestamp: new Date()
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleApplyAction = async (messageId: string, action: CopilotAction) => {
        // Prevent double click/execution logic could be added here
        try {
            await onAction(action);

            // Mark action as applied in UI (update message state)
            setMessages(prev => prev.map(m => {
                if (m.id === messageId && m.proposedAction) {
                    return {
                        ...m,
                        proposedAction: { ...m.proposedAction, status: 'applied' }
                    };
                }
                return m;
            }));

        } catch (error) {
            console.error('Failed to apply action', error);
            alert('Erro ao aplicar ação.');
        }
    };

    if (!isOpen) return null;

    if (isMinimized) {
        return (
            <div
                className="fixed bottom-4 right-4 z-50 bg-primary text-white p-3 rounded-full shadow-lg cursor-pointer hover:bg-primary-dark transition-all"
                onClick={() => setIsMinimized(false)}
            >
                <MessageSquare size={24} />
            </div>
        );
    }

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: '400px',
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
                    <Sparkles size={20} className="text-primary" />
                    <div>
                        <h3 style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>Funnel Copilot</h3>
                        <p className="text-muted" style={{ fontSize: '10px' }}>Powered by Gemini 2.0</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setIsMinimized(true)}>
                        <Minimize2 size={16} />
                    </button>
                    <button className="btn btn-icon btn-ghost btn-sm" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Messages Area */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
                backgroundColor: 'var(--color-bg-tertiary)'
            }}>
                {messages.map((msg) => (
                    <div key={msg.id} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '90%'
                    }}>
                        <div style={{
                            padding: 'var(--space-3)',
                            borderRadius: '12px',
                            borderBottomRightRadius: msg.role === 'user' ? 0 : '12px',
                            borderTopLeftRadius: msg.role === 'ai' ? 0 : '12px',
                            background: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-bg-primary)',
                            color: msg.role === 'user' ? 'white' : 'var(--color-text-primary)',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                            fontSize: 'var(--text-sm)',
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap'
                        }}>
                            {msg.content}
                        </div>

                        {/* Action Card */}
                        {msg.proposedAction && (
                            <div className="animate-fade-in" style={{
                                marginTop: '8px',
                                background: 'var(--color-bg-primary)',
                                border: '1px solid var(--color-border)',
                                borderRadius: '8px',
                                padding: '12px',
                                width: '100%'
                            }}>
                                <div className="flex items-center gap-2 mb-2 text-primary">
                                    <Sparkles size={14} />
                                    <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>Sugestão de Ação</span>
                                </div>
                                <p style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
                                    {msg.proposedAction.summary}
                                </p>

                                {msg.proposedAction.status === 'applied' ? (
                                    <div className="flex items-center gap-2 text-green-600" style={{ fontSize: '12px' }}>
                                        <CheckCircle2 size={16} />
                                        <span>Aplicado com sucesso!</span>
                                    </div>
                                ) : (
                                    <button
                                        className="btn btn-sm btn-primary w-full"
                                        onClick={() => handleApplyAction(msg.id, msg.proposedAction!)}
                                    >
                                        <Play size={14} className="mr-1" />
                                        Aplicar Agora
                                    </button>
                                )}
                            </div>
                        )}

                        <span style={{
                            fontSize: '10px',
                            color: 'var(--color-text-muted)',
                            marginTop: '4px',
                            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start'
                        }}>
                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                ))}

                {isLoading && (
                    <div style={{ alignSelf: 'flex-start', padding: 'var(--space-3)', background: 'var(--color-bg-primary)', borderRadius: '12px', borderTopLeftRadius: 0 }}>
                        <div className="flex items-center gap-2 text-muted">
                            <Loader2 className="animate-spin" size={14} />
                            <span style={{ fontSize: '12px' }}>Analisando...</span>
                        </div>
                    </div>
                )}
                <div ref={scrollToBottomRef} />
            </div>

            {/* Input Area */}
            <div style={{
                padding: 'var(--space-3)',
                borderTop: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)'
            }}>
                <div className="flex gap-2 relative">
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Peça para criar scripts, melhorar fluxos..."
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        disabled={isLoading}
                        style={{ paddingRight: '40px' }}
                    />
                    <button
                        className="btn btn-primary btn-icon absolute right-1 top-1 bottom-1"
                        style={{ height: 'auto', width: '32px' }}
                        onClick={handleSendMessage}
                        disabled={!inputText.trim() || isLoading}
                    >
                        <Send size={16} />
                    </button>
                </div>
                <div className="text-center mt-2">
                    <p style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                        O Copilot pode cometer erros. Verifique as informações importantes.
                    </p>
                </div>
            </div>
        </div>
    );
}
