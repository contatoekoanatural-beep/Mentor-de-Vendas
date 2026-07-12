import { useState, useEffect } from 'react';
import { getAppSettings, saveAppSettings } from '../services/firebase';
import { setGeminiKey } from '../services/aiService';
import { useToast } from '../contexts/ToastContext';
import { Key, Eye, EyeOff, Save, CheckCircle, AlertTriangle, Plug, Globe, Pencil, X, Lock, FileText } from 'lucide-react';

// ----------------------------------------
// Asaas — geração automática de boleto
// ----------------------------------------
const ASAAS_URLS: Record<'sandbox' | 'producao', string> = {
    sandbox: 'https://api-sandbox.asaas.com/v3',
    producao: 'https://api.asaas.com/v3',
};

// ----------------------------------------
// Webhooks
// ----------------------------------------

type ChaveWebhook = 'leadPronto' | 'remarketing' | 'iaAcionada' | 'falhaIA';

interface ConfigWebhook {
    url: string;
    ativo: boolean;
}

const WEBHOOKS_VAZIOS: Record<ChaveWebhook, ConfigWebhook> = {
    leadPronto: { url: '', ativo: true },
    remarketing: { url: '', ativo: true },
    iaAcionada: { url: '', ativo: true },
    falhaIA: { url: '', ativo: true },
};

const DEFINICOES: { chave: ChaveWebhook; titulo: string; descricao: string; notaVazio?: string }[] = [
    {
        chave: 'leadPronto',
        titulo: 'Lead Pronto',
        descricao: 'Avisa quando o cliente escolheu a forma de pagamento e está pronto para fechar.',
        notaVazio: 'Sem URL aqui, o sistema usa uma URL padrão embutida no código.',
    },
    {
        chave: 'remarketing',
        titulo: 'Remarketing',
        descricao: 'Dispara a mensagem de reengajamento em conversas paradas há ~22h.',
    },
    {
        chave: 'iaAcionada',
        titulo: 'IA Acionada',
        descricao: 'Avisa na primeira vez que a IA assume uma conversa.',
    },
    {
        chave: 'falhaIA',
        titulo: 'IA Falhou',
        descricao: 'Avisa quando a IA não conseguiu responder e o cliente ficou esperando. Uma vez por conversa, até a IA voltar a responder.',
    },
];

/** Esconde o miolo da URL: protocolo, host e os últimos caracteres bastam para reconhecê-la. */
function mascarar(url: string): string {
    if (!url) return '';
    const cauda = url.slice(-6);
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}/••••••••${cauda}`;
    } catch {
        return `${url.slice(0, 16)}••••••••${cauda}`;
    }
}

interface PropsCampo {
    titulo: string;
    descricao: string;
    notaVazio?: string;
    cfg: ConfigWebhook;
    original: ConfigWebhook;
    salvando: boolean;
    onChange: (cfg: ConfigWebhook) => void;
}

/**
 * Um webhook. Nasce trancado: a URL vem mascarada e só vira campo editável
 * depois de um clique explícito em "Editar" — sem isso, um clique distraído
 * altera a URL e o botão de salvar leva a alteração junto sem ninguém ver.
 */
function CampoWebhook({ titulo, descricao, notaVazio, cfg, original, salvando, onChange }: PropsCampo) {
    const [editando, setEditando] = useState(false);
    const [revelado, setRevelado] = useState(false);

    const alterado = cfg.url !== original.url || cfg.ativo !== original.ativo;
    const configurado = cfg.url.trim().length > 0;
    const urlInvalida = configurado && !/^https?:\/\//i.test(cfg.url.trim());

    const cancelar = () => {
        onChange(original);
        setEditando(false);
        setRevelado(false);
    };

    return (
        <div style={{
            marginBottom: 'var(--spacing-md)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${alterado ? 'var(--primary)' : 'var(--border-subtle)'}`,
            background: 'var(--bg-card-elevated)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <span className="label-section" style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                        {titulo}
                    </span>
                    {configurado ? (
                        <span className="badge badge-success" style={{ fontSize: '10px', padding: '1px 6px' }}>configurado</span>
                    ) : (
                        <span className="badge badge-warning" style={{ fontSize: '10px', padding: '1px 6px' }}>sem URL</span>
                    )}
                    {alterado && (
                        <span className="badge badge-info" style={{ fontSize: '10px', padding: '1px 6px' }}>alterado</span>
                    )}
                </div>
                <label className="form-checkbox" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                    <input
                        type="checkbox"
                        checked={cfg.ativo}
                        disabled={salvando}
                        onChange={(e) => onChange({ ...cfg, ativo: e.target.checked })}
                    />
                    <span>Ativo</span>
                </label>
            </div>

            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 'var(--space-2) 0' }}>
                {descricao}
            </p>

            {editando ? (
                <>
                    <input
                        type="text"
                        autoFocus
                        value={cfg.url}
                        onChange={(e) => onChange({ ...cfg, url: e.target.value })}
                        placeholder="https://backend.respondechat.ai/webhook/..."
                        disabled={salvando}
                        style={{
                            width: '100%',
                            padding: '12px',
                            background: 'var(--bg-input)',
                            border: `1px solid ${urlInvalida ? 'var(--error, #ef4444)' : 'var(--border-subtle)'}`,
                            borderRadius: 'var(--radius-md)',
                            color: 'var(--text-primary)',
                            fontSize: 'var(--text-sm)',
                            fontFamily: 'var(--font-mono)',
                        }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={cancelar} disabled={salvando}>
                            <X size={14} /> Cancelar
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setEditando(false); setRevelado(false); }}
                            disabled={salvando || urlInvalida}
                        >
                            <Lock size={14} /> Pronto
                        </button>
                        {urlInvalida && (
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--error, #ef4444)' }}>
                                A URL precisa começar com https://
                            </span>
                        )}
                    </div>
                </>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <code style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '10px 12px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        color: configurado ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                        fontSize: 'var(--text-xs)',
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        {configurado
                            ? (revelado ? cfg.url : mascarar(cfg.url))
                            : (notaVazio || 'Nenhuma URL configurada — este evento não é enviado.')}
                    </code>
                    {configurado && (
                        <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            onClick={() => setRevelado((v) => !v)}
                            title={revelado ? 'Ocultar URL' : 'Revelar URL'}
                        >
                            {revelado ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        onClick={() => { setEditando(true); setRevelado(true); }}
                        disabled={salvando}
                        title="Editar URL"
                    >
                        <Pencil size={16} />
                    </button>
                </div>
            )}
        </div>
    );
}

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

    const [webhooks, setWebhooks] = useState<Record<ChaveWebhook, ConfigWebhook>>(WEBHOOKS_VAZIOS);
    const [webhooksOriginais, setWebhooksOriginais] = useState<Record<ChaveWebhook, ConfigWebhook>>(WEBHOOKS_VAZIOS);
    const [isSavingWebhooks, setIsSavingWebhooks] = useState(false);

    // Asaas: chave (secreta, write-only) + config não-secreta (ativo/ambiente/vencimento)
    const [asaasKey, setAsaasKey] = useState('');
    const [hasExistingAsaasKey, setHasExistingAsaasKey] = useState(false);
    const [showAsaasKey, setShowAsaasKey] = useState(false);

    const [asaasAtivo, setAsaasAtivo] = useState(true);
    const [asaasAmbiente, setAsaasAmbiente] = useState<'sandbox' | 'producao'>('sandbox');
    const [asaasVencimento, setAsaasVencimento] = useState(3);
    const [asaasCfgOriginal, setAsaasCfgOriginal] = useState<{ ativo: boolean; ambiente: 'sandbox' | 'producao'; vencimento: number }>({ ativo: true, ambiente: 'sandbox', vencimento: 3 });
    const [isSavingAsaas, setIsSavingAsaas] = useState(false);

    const asaasCfgAlterada =
        asaasAtivo !== asaasCfgOriginal.ativo ||
        asaasAmbiente !== asaasCfgOriginal.ambiente ||
        asaasVencimento !== asaasCfgOriginal.vencimento;
    // Botão único "Salvar tudo": habilita se mudou a config OU se há uma nova chave digitada.
    const asaasAlterado = asaasCfgAlterada || asaasKey.trim().length > 0;

    const chavesAlteradas = (Object.keys(webhooks) as ChaveWebhook[]).filter(
        (k) => webhooks[k].url !== webhooksOriginais[k].url || webhooks[k].ativo !== webhooksOriginais[k].ativo
    );

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
                    const whs = settings.webhooks as Record<string, { url?: string; ativo?: boolean }>;
                    const carregado = { ...WEBHOOKS_VAZIOS };
                    for (const { chave } of DEFINICOES) {
                        if (whs[chave]) {
                            carregado[chave] = {
                                url: whs[chave].url || '',
                                ativo: whs[chave].ativo !== false,
                            };
                        }
                    }
                    setWebhooks({ ...carregado });
                    setWebhooksOriginais({ ...carregado });
                }

                if (settings && typeof settings.asaasApiKey === 'string' && settings.asaasApiKey.length > 10) {
                    setHasExistingAsaasKey(true);
                }
                if (settings && settings.asaas && typeof settings.asaas === 'object') {
                    const a = settings.asaas as { ativo?: boolean; apiUrl?: string; vencimentoDias?: number };
                    const ambiente: 'sandbox' | 'producao' =
                        typeof a.apiUrl === 'string' && !a.apiUrl.includes('sandbox') && a.apiUrl.length > 0
                            ? 'producao'
                            : 'sandbox';
                    const cfg = {
                        ativo: a.ativo !== false,
                        ambiente,
                        vencimento: typeof a.vencimentoDias === 'number' && a.vencimentoDias > 0 ? a.vencimentoDias : 3,
                    };
                    setAsaasAtivo(cfg.ativo);
                    setAsaasAmbiente(cfg.ambiente);
                    setAsaasVencimento(cfg.vencimento);
                    setAsaasCfgOriginal(cfg);
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

    const handleSaveAsaas = async () => {
        const venc = Math.max(1, Math.min(30, Math.round(asaasVencimento) || 3));
        const trimmedKey = asaasKey.trim();
        // A chave só é validada/gravada se o usuário digitou uma nova (campo fica vazio no uso normal).
        if (trimmedKey && trimmedKey.length < 10) {
            addToast('A chave parece inválida (muito curta).', 'error');
            return;
        }

        setIsSavingAsaas(true);
        try {
            // Chave (se nova) + config numa ÚNICA gravação — nunca mais ficam
            // dessincronizadas (foi o que causou o invalid_environment).
            // Objeto aninhado completo: setDoc+merge não trata chave pontilhada como caminho.
            const payload: Record<string, unknown> = {
                asaas: {
                    ativo: asaasAtivo,
                    apiUrl: ASAAS_URLS[asaasAmbiente],
                    vencimentoDias: venc,
                },
            };
            if (trimmedKey) payload.asaasApiKey = trimmedKey;
            await saveAppSettings(payload);

            setAsaasVencimento(venc);
            setAsaasCfgOriginal({ ativo: asaasAtivo, ambiente: asaasAmbiente, vencimento: venc });
            if (trimmedKey) {
                setHasExistingAsaasKey(true);
                setAsaasKey('');
                setShowAsaasKey(false);
            }
            addToast('Asaas salvo com sucesso!', 'success');
        } catch (error) {
            console.error('Error saving Asaas:', error);
            addToast('Erro ao salvar o Asaas.', 'error');
        }
        setIsSavingAsaas(false);
    };

    const handleSaveWebhooks = async () => {
        if (chavesAlteradas.length === 0) return;

        const invalida = chavesAlteradas.find((k) => {
            const url = webhooks[k].url.trim();
            return url.length > 0 && !/^https?:\/\//i.test(url);
        });
        if (invalida) {
            addToast(`A URL de "${DEFINICOES.find((d) => d.chave === invalida)!.titulo}" precisa começar com https://`, 'error');
            return;
        }

        // Apagar a URL de um webhook ativo o desliga na prática, sem aviso nenhum.
        const apagada = chavesAlteradas.find(
            (k) => webhooks[k].ativo && !webhooks[k].url.trim() && webhooksOriginais[k].url.trim()
        );
        if (apagada) {
            const titulo = DEFINICOES.find((d) => d.chave === apagada)!.titulo;
            if (!window.confirm(`Você apagou a URL de "${titulo}", que está marcado como Ativo. Sem URL, esse evento deixa de ser enviado. Salvar mesmo assim?`)) {
                return;
            }
        }

        setIsSavingWebhooks(true);
        try {
            // Grava só o que mudou: assim uma edição num campo nunca sobrescreve os outros.
            const payload: Record<string, ConfigWebhook> = {};
            for (const chave of chavesAlteradas) {
                payload[`webhooks.${chave}`] = {
                    url: webhooks[chave].url.trim(),
                    ativo: webhooks[chave].ativo,
                };
            }
            await saveAppSettings(payload);

            const salvos = { ...webhooks };
            for (const chave of chavesAlteradas) salvos[chave] = { ...salvos[chave], url: salvos[chave].url.trim() };
            setWebhooks(salvos);
            setWebhooksOriginais(salvos);

            const nomes = chavesAlteradas.map((k) => DEFINICOES.find((d) => d.chave === k)!.titulo).join(', ');
            addToast(`Salvo: ${nomes}`, 'success');
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

                    {DEFINICOES.map(({ chave, titulo, descricao, notaVazio }) => (
                        <CampoWebhook
                            key={chave}
                            titulo={titulo}
                            descricao={descricao}
                            notaVazio={notaVazio}
                            cfg={webhooks[chave]}
                            original={webhooksOriginais[chave]}
                            salvando={isSavingWebhooks}
                            onChange={(cfg) => setWebhooks((prev) => ({ ...prev, [chave]: cfg }))}
                        />
                    ))}

                    {/* Salvar — grava só o que foi alterado */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <button
                            onClick={handleSaveWebhooks}
                            className="btn btn-primary"
                            disabled={isSavingWebhooks || chavesAlteradas.length === 0}
                            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                        >
                            <Save size={16} />
                            <span>
                                {isSavingWebhooks
                                    ? 'Salvando...'
                                    : chavesAlteradas.length === 0
                                        ? 'Nada a salvar'
                                        : `Salvar ${chavesAlteradas.length} alteraç${chavesAlteradas.length === 1 ? 'ão' : 'ões'}`}
                            </span>
                        </button>
                        {chavesAlteradas.length > 0 && !isSavingWebhooks && (
                            <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                                {chavesAlteradas.map((k) => DEFINICOES.find((d) => d.chave === k)!.titulo).join(', ')}
                            </span>
                        )}
                    </div>
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

                    {/* Asaas — Boleto automático */}
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
                                <FileText size={20} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    Asaas (boleto automático)
                                </h3>
                                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                                    Gera o boleto sozinho quando o cliente fecha no boleto e envia o link + a linha digitável.
                                </p>
                            </div>
                        </div>

                        {/* Status da chave */}
                        {!isLoading && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-2)',
                                padding: 'var(--space-3) var(--space-4)',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: hasExistingAsaasKey ? 'rgba(5, 150, 105, 0.1)' : 'rgba(217, 119, 6, 0.1)',
                                marginBottom: 'var(--spacing-md)',
                            }}>
                                {hasExistingAsaasKey ? (
                                    <>
                                        <CheckCircle size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
                                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--success)' }}>Chave configurada</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--warning)' }}>Nenhuma chave configurada</span>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Input da chave */}
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label className="label-section" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                                {hasExistingAsaasKey ? 'Substituir chave' : 'Colar chave da API do Asaas'}
                            </label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showAsaasKey ? 'text' : 'password'}
                                    value={asaasKey}
                                    onChange={(e) => setAsaasKey(e.target.value)}
                                    placeholder={hasExistingAsaasKey ? 'Cole a nova chave para substituir...' : 'Cole a chave (sandbox para testar)...'}
                                    disabled={isSavingAsaas}
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
                                    onClick={() => setShowAsaasKey(!showAsaasKey)}
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
                                    title={showAsaasKey ? 'Ocultar' : 'Mostrar'}
                                >
                                    {showAsaasKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        <div style={{ borderTop: '1px solid var(--border-subtle)', margin: 'var(--spacing-md) 0' }} />

                        {/* Ligar/desligar a geração */}
                        <label className="form-checkbox" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--spacing-md)' }}>
                            <input
                                type="checkbox"
                                checked={asaasAtivo}
                                disabled={isSavingAsaas}
                                onChange={(e) => setAsaasAtivo(e.target.checked)}
                            />
                            <span>Geração automática de boleto ativa</span>
                        </label>

                        {/* Ambiente */}
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label className="label-section" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>Ambiente</label>
                            <select
                                value={asaasAmbiente}
                                disabled={isSavingAsaas}
                                onChange={(e) => setAsaasAmbiente(e.target.value as 'sandbox' | 'producao')}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    background: 'var(--bg-input)',
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'var(--text-primary)',
                                    fontSize: 'var(--text-sm)',
                                }}
                            >
                                <option value="sandbox">Sandbox (teste — boletos fictícios)</option>
                                <option value="producao">Produção (boletos reais)</option>
                            </select>
                            {asaasAmbiente === 'producao' && (
                                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                                    <AlertTriangle size={12} /> Produção emite boletos reais. Confirme que a chave acima é a de produção.
                                </p>
                            )}
                        </div>

                        {/* Vencimento */}
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label className="label-section" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>Vencimento do boleto (dias)</label>
                            <input
                                type="number"
                                min={1}
                                max={30}
                                value={asaasVencimento}
                                disabled={isSavingAsaas}
                                onChange={(e) => setAsaasVencimento(parseInt(e.target.value, 10) || 0)}
                                style={{
                                    width: '120px',
                                    padding: '12px',
                                    background: 'var(--bg-input)',
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'var(--text-primary)',
                                    fontSize: 'var(--text-sm)',
                                }}
                            />
                        </div>

                        <button
                            onClick={handleSaveAsaas}
                            className="btn btn-primary"
                            disabled={isSavingAsaas || !asaasAlterado}
                            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                        >
                            <Save size={16} />
                            <span>{isSavingAsaas ? 'Salvando...' : asaasAlterado ? 'Salvar tudo' : 'Nada a salvar'}</span>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
