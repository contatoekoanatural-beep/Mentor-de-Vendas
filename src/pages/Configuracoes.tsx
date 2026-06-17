import { useState, useEffect } from 'react';
import { getAppSettings, saveAppSettings } from '../services/firebase';
import { setGeminiKey } from '../services/aiService';
import { useToast } from '../contexts/ToastContext';
import { Key, Eye, EyeOff, Save, CheckCircle, AlertTriangle } from 'lucide-react';

export default function Configuracoes() {
    const { addToast } = useToast();
    const [apiKey, setApiKey] = useState('');
    const [hasExistingKey, setHasExistingKey] = useState(false);
    const [showKey, setShowKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settings = await getAppSettings();
                if (settings && typeof settings.geminiApiKey === 'string' && settings.geminiApiKey.length > 10) {
                    setHasExistingKey(true);
                }
            } catch (error) {
                console.error('Error loading settings:', error);
            }
            setIsLoading(false);
        };
        loadSettings();
    }, []);

    const handleSaveKey = async () => {
        const trimmed = apiKey.trim();
        if (!trimmed) {
            addToast('Cole a chave da API antes de salvar.', 'error');
            return;
        }
        if (trimmed.length < 10) {
            addToast('A chave parece inválida (muito curta).', 'error');
            return;
        }

        setIsSaving(true);
        try {
            await saveAppSettings({ geminiApiKey: trimmed });
            setGeminiKey(trimmed);
            setHasExistingKey(true);
            setApiKey('');
            setShowKey(false);
            addToast('Chave da API salva com sucesso!', 'success');
        } catch (error) {
            console.error('Error saving API key:', error);
            addToast('Erro ao salvar a chave da API.', 'error');
        }
        setIsSaving(false);
    };

    return (
        <div className="page-container" style={{ padding: 'var(--spacing-lg)' }}>
            {/* Page Header */}
            <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}>
                    Configurações
                </h2>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    Configurações gerais do sistema e chaves de API.
                </p>
            </div>

            {/* API Key Section */}
            <div className="card" style={{ maxWidth: '600px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--spacing-lg)' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: 'var(--bg-card-elevated)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--primary)',
                    }}>
                        <Key size={20} />
                    </div>
                    <div>
                        <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Chave da API (Gemini)
                        </h3>
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                            Usada para gerar respostas de IA no chat de teste dos agentes.
                        </p>
                    </div>
                </div>

                {/* Status indicator */}
                {!isLoading && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        padding: 'var(--space-3) var(--space-4)',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: hasExistingKey ? 'rgba(5, 150, 105, 0.1)' : 'rgba(217, 119, 6, 0.1)',
                        marginBottom: 'var(--spacing-md)',
                    }}>
                        {hasExistingKey ? (
                            <>
                                <CheckCircle size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--success)' }}>
                                    Chave configurada
                                </span>
                            </>
                        ) : (
                            <>
                                <AlertTriangle size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--warning)' }}>
                                    Nenhuma chave configurada
                                </span>
                            </>
                        )}
                    </div>
                )}

                {/* Input */}
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label className="label-section" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                        {hasExistingKey ? 'Substituir chave' : 'Colar chave da API'}
                    </label>
                    <div style={{ position: 'relative' }}>
                        <input
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={hasExistingKey ? 'Cole a nova chave para substituir...' : 'Cole sua chave do Google AI Studio aqui...'}
                            disabled={isSaving}
                            style={{
                                width: '100%',
                                padding: '14px',
                                paddingRight: '48px',
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-md)',
                                color: 'var(--text-primary)',
                                fontSize: 'var(--text-sm)',
                                fontFamily: 'var(--font-mono)',
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            style={{
                                position: 'absolute',
                                right: '12px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--text-tertiary)',
                                padding: '4px',
                            }}
                            title={showKey ? 'Ocultar' : 'Mostrar'}
                        >
                            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                </div>

                {/* Save button */}
                <button
                    onClick={handleSaveKey}
                    className="btn btn-primary"
                    disabled={!apiKey.trim() || isSaving}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                >
                    <Save size={16} />
                    <span>{isSaving ? 'Salvando...' : 'Salvar chave'}</span>
                </button>
            </div>
        </div>
    );
}
