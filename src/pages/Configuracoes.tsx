import { useState, useEffect } from 'react';
import { getAppSettings, saveAppSettings } from '../services/firebase';
import { setGeminiKey } from '../services/aiService';
import { useToast } from '../contexts/ToastContext';
import { Key, Eye, EyeOff, Save, CheckCircle, AlertTriangle, Plug, Globe } from 'lucide-react';

export default function Configuracoes() {
    const { addToast } = useToast();
    const [activeTab, setActiveTab] = useState<'webhooks' | 'ia' | 'canais'>('webhooks');
    const [apiKey, setApiKey] = useState('');
    const [hasExistingKey, setHasExistingKey] = useState(false);
    const [showKey, setShowKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);



    const [rcToken, setRcToken] = useState('');
    const [hasExistingRcToken, setHasExistingRcToken] = useState(false);
    const [showRcToken, setShowRcToken] = useState(false);
    const [isSavingRcToken, setIsSavingRcToken] = useState(false);

    const [lpUrl, setLpUrl] = useState('');
    const [lpAtivo, setLpAtivo] = useState(true);
    const [remUrl, setRemUrl] = useState('');
    const [remAtivo, setRemAtivo] = useState(true);
    const [iaUrl, setIaUrl] = useState('');
    const [iaAtivo, setIaAtivo] = useState(true);
    const [isSavingWebhooks, setIsSavingWebhooks] = useState(false);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settings = await getAppSettings();
                if (settings && typeof settings.geminiApiKey === 'string' && settings.geminiApiKey.length > 10) {
                    setHasExistingKey(true);
                }

                if (settings && typeof settings.respondechatToken === 'string' && settings.respondechatToken.length > 5) {
                    setHasExistingRcToken(true);
                }
                if (settings && settings.webhooks) {
                    const whs = settings.webhooks as any;
                    if (whs.leadPronto) {
                        setLpUrl(whs.leadPronto.url || '');
                        setLpAtivo(whs.leadPronto.ativo !== false);
                    }
                    if (whs.remarketing) {
                        setRemUrl(whs.remarketing.url || '');
                        setRemAtivo(whs.remarketing.ativo !== false);
                    }
                    if (whs.iaAcionada) {
                        setIaUrl(whs.iaAcionada.url || '');
                        setIaAtivo(whs.iaAcionada.ativo !== false);
                    }
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



    const handleSaveRcToken = async () => {
        const trimmed = rcToken.trim();
        if (!trimmed) {
            addToast('Cole o token do Responde Chat antes de salvar.', 'error');
            return;
        }
        if (trimmed.length < 5) {
            addToast('O token parece inválido (muito curto).', 'error');
            return;
        }

        setIsSavingRcToken(true);
        try {
            await saveAppSettings({ respondechatToken: trimmed });
            setHasExistingRcToken(true);
            setRcToken('');
            setShowRcToken(false);
            addToast('Token do Responde Chat salvo com sucesso!', 'success');
        } catch (error) {
            console.error('Error saving RespondeChat token:', error);
            addToast('Erro ao salvar o token do Responde Chat.', 'error');
        }
        setIsSavingRcToken(false);
    };

    const handleSaveWebhooks = async () => {
        setIsSavingWebhooks(true);
        try {
            await saveAppSettings({
                "webhooks.leadPronto": {
                    url: lpUrl.trim(),
                    ativo: lpAtivo
                },
                "webhooks.remarketing": {
                    url: remUrl.trim(),
                    ativo: remAtivo
                },
                "webhooks.iaAcionada": {
                    url: iaUrl.trim(),
                    ativo: iaAtivo
                }
            });
            addToast('Configurações de Webhooks salvas com sucesso!', 'success');
        } catch (error) {
            console.error('Error saving webhooks:', error);
            addToast('Erro ao salvar as configurações de Webhooks.', 'error');
        }
        setIsSavingWebhooks(false);
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

            {/* Sub-abas de Navegação */}
            <div className="tabs">
                <button
                    type="button"
                    className={`tab ${activeTab === 'webhooks' ? 'active' : ''}`}
                    onClick={() => setActiveTab('webhooks')}
                >
                    Webhooks
                </button>
                <button
                    type="button"
                    className={`tab ${activeTab === 'ia' ? 'active' : ''}`}
                    onClick={() => setActiveTab('ia')}
                >
                    IA
                </button>
                <button
                    type="button"
                    className={`tab ${activeTab === 'canais' ? 'active' : ''}`}
                    onClick={() => setActiveTab('canais')}
                >
                    Canais
                </button>
            </div>

            {/* Aba Webhooks */}
            {activeTab === 'webhooks' && (
                /* Webhooks Section */
                <div className="card" style={{ maxWidth: '600px', marginTop: 'var(--spacing-lg)' }}>
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
                            <Globe size={20} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                                Configurações de Webhooks
                            </h3>
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                                Configure os endpoints de webhook para envio de eventos externos.
                            </p>
                        </div>
                    </div>

                    {/* Webhook Lead Pronto */}
                    <div style={{ marginBottom: 'var(--spacing-lg)', paddingBottom: 'var(--spacing-md)', borderBottom: '1px solid var(--border-subtle)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                            <label className="label-section" style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                                Lead Pronto
                            </label>
                            <label className="form-checkbox" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
                                <input
                                    type="checkbox"
                                    checked={lpAtivo}
                                    onChange={(e) => setLpAtivo(e.target.checked)}
                                />
                                <span>Ativo</span>
                            </label>
                        </div>
                        <input
                            type="text"
                            value={lpUrl}
                            onChange={(e) => setLpUrl(e.target.value)}
                            placeholder="https://backend.respondechat.ai/webhook/188/EfEtTZsjXiR6R62esjGD7XWlHlIVwGv1Ru0YES1XOE"
                            disabled={isSavingWebhooks}
                            style={{
                                width: '100%',
                                padding: '12px',
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-md)',
                                color: 'var(--text-primary)',
                                fontSize: 'var(--text-sm)',
                                fontFamily: 'var(--font-mono)',
                            }}
                        />
                    </div>

                    {/* Webhook Remarketing */}
                    <div style={{ marginBottom: 'var(--spacing-lg)', paddingBottom: 'var(--spacing-md)', borderBottom: '1px solid var(--border-subtle)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                            <label className="label-section" style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                                Remarketing
                            </label>
                            <label className="form-checkbox" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
                                <input
                                    type="checkbox"
                                    checked={remAtivo}
                                    onChange={(e) => setRemAtivo(e.target.checked)}
                                />
                                <span>Ativo</span>
                            </label>
                        </div>
                        <input
                            type="text"
                            value={remUrl}
                            onChange={(e) => setRemUrl(e.target.value)}
                            placeholder="https://"
                            disabled={isSavingWebhooks}
                            style={{
                                width: '100%',
                                padding: '12px',
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-md)',
                                color: 'var(--text-primary)',
                                fontSize: 'var(--text-sm)',
                                fontFamily: 'var(--font-mono)',
                            }}
                        />
                    </div>

                    {/* Webhook IA Acionada */}
                    <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                            <label className="label-section" style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                                IA Acionada
                            </label>
                            <label className="form-checkbox" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
                                <input
                                    type="checkbox"
                                    checked={iaAtivo}
                                    onChange={(e) => setIaAtivo(e.target.checked)}
                                />
                                <span>Ativo</span>
                            </label>
                        </div>
                        <input
                            type="text"
                            value={iaUrl}
                            onChange={(e) => setIaUrl(e.target.value)}
                            placeholder="https://"
                            disabled={isSavingWebhooks}
                            style={{
                                width: '100%',
                                padding: '12px',
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-md)',
                                color: 'var(--text-primary)',
                                fontSize: 'var(--text-sm)',
                                fontFamily: 'var(--font-mono)',
                            }}
                        />
                    </div>

                    {/* Save button */}
                    <button
                        onClick={handleSaveWebhooks}
                        className="btn btn-primary"
                        disabled={isSavingWebhooks}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                    >
                        <Save size={16} />
                        <span>{isSavingWebhooks ? 'Salvando...' : 'Salvar Webhooks'}</span>
                    </button>
                </div>
            )}

            {/* Aba IA */}
            {activeTab === 'ia' && (
                /* API Key Section */
                <div className="card" style={{ maxWidth: '600px', marginTop: 'var(--spacing-lg)' }}>
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
            )}

            {/* Aba Canais */}
            {activeTab === 'canais' && (
                <>


                    {/* Responde Chat Token Section */}
                    <div className="card" style={{ maxWidth: '600px', marginTop: 'var(--spacing-lg)' }}>
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
                                <Plug size={20} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    Token Responde Chat
                                </h3>
                                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                                    Token do Responde Chat. Usado para enviar as respostas ao WhatsApp.
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
                                backgroundColor: hasExistingRcToken ? 'rgba(5, 150, 105, 0.1)' : 'rgba(217, 119, 6, 0.1)',
                                marginBottom: 'var(--spacing-md)',
                            }}>
                                {hasExistingRcToken ? (
                                    <>
                                        <CheckCircle size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
                                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--success)' }}>
                                            Token configurado
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--warning)' }}>
                                            Nenhum token configurado
                                        </span>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Input */}
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label className="label-section" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                                {hasExistingRcToken ? 'Substituir token' : 'Colar token do Responde Chat'}
                            </label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showRcToken ? 'text' : 'password'}
                                    value={rcToken}
                                    onChange={(e) => setRcToken(e.target.value)}
                                    placeholder={hasExistingRcToken ? 'Cole o novo token para substituir...' : 'Cole o token do Responde Chat aqui...'}
                                    disabled={isSavingRcToken}
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
                                    onClick={() => setShowRcToken(!showRcToken)}
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
                                    title={showRcToken ? 'Ocultar' : 'Mostrar'}
                                >
                                    {showRcToken ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Save button */}
                        <button
                            onClick={handleSaveRcToken}
                            className="btn btn-primary"
                            disabled={!rcToken.trim() || isSavingRcToken}
                            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                        >
                            <Save size={16} />
                            <span>{isSavingRcToken ? 'Salvando...' : 'Salvar token'}</span>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
