import { useState, useEffect, type CSSProperties } from 'react';
import { getAppSettings, saveAppSettings, saveCanais } from '../services/firebase';
import { setGeminiKey } from '../services/aiService';
import { useToast } from '../contexts/ToastContext';
import { Key, Eye, EyeOff, Save, CheckCircle, AlertTriangle, Globe, Pencil, X, Lock, FileText, Plus, Trash2, Smartphone } from 'lucide-react';

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

// ----------------------------------------
// Telefones (canais) — cada número de WhatsApp com token e webhooks próprios.
// O "canal padrão" (mensagens sem &canal= na URL de entrada) usa o token e os
// webhooks globais; os demais chips ficam em settings.canais. Sem isso, os
// eventos que mexem no lead (mover p/ atendendo, lead pronto, remarketing,
// falha) disparam sempre pela automação do padrão, na caixa errada.
// ----------------------------------------

interface Canal {
    _id: string;    // id só do cliente, p/ key estável no React — não é persistido
    slug: string;   // casa com ?canal=<slug> na URL de entrada do Responde Chat
    nome: string;   // rótulo amigável (ex.: "Claro 2")
    token: string;  // token do Responde Chat desta conexão
    webhooks: Record<ChaveWebhook, ConfigWebhook>;
}

let seqCanal = 0;
const novoIdCanal = () => `canal-${Date.now()}-${seqCanal++}`;

const webhooksVazios = (): Record<ChaveWebhook, ConfigWebhook> =>
    Object.fromEntries(
        Object.entries(WEBHOOKS_VAZIOS).map(([k, v]) => [k, { ...v }]),
    ) as Record<ChaveWebhook, ConfigWebhook>;

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
                {!configurado && notaVazio && (
                    <span style={{ display: 'block', color: 'var(--text-tertiary)', marginTop: '2px' }}>{notaVazio}</span>
                )}
            </p>

            {editando ? (
                <>
                    <input
                        type="text"
                        value={cfg.url}
                        onChange={(e) => onChange({ ...cfg, url: e.target.value })}
                        placeholder="https://..."
                        disabled={salvando}
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: 'var(--bg-input)',
                            border: `1px solid ${urlInvalida ? 'var(--danger, #dc2626)' : 'var(--border-subtle)'}`,
                            borderRadius: 'var(--radius-md)',
                            color: 'var(--text-primary)',
                            fontSize: 'var(--text-sm)',
                            fontFamily: 'var(--font-mono)',
                        }}
                    />
                    {urlInvalida && (
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--danger, #dc2626)', marginTop: 'var(--space-1)' }}>
                            A URL precisa começar com http:// ou https://
                        </p>
                    )}
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={cancelar}
                            disabled={salvando}
                            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
                        >
                            <X size={14} /> Cancelar
                        </button>
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => { setEditando(false); setRevelado(false); }}
                            disabled={salvando || urlInvalida}
                            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
                        >
                            <Lock size={14} /> Pronto
                        </button>
                    </div>
                </>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <input
                        type="text"
                        readOnly
                        value={configurado ? (revelado ? cfg.url : mascarar(cfg.url)) : ''}
                        placeholder="Nenhuma URL configurada — este evento não é enviado."
                        style={{
                            flex: 1,
                            minWidth: 0,
                            padding: '10px 12px',
                            background: 'var(--bg-input)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-md)',
                            color: 'var(--text-secondary)',
                            fontSize: 'var(--text-sm)',
                            fontFamily: 'var(--font-mono)',
                        }}
                    />
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

interface PropsCartaoCanal {
    canal: Canal;
    original: Canal;
    salvando: boolean;
    onChange: (c: Canal) => void;
    onRemover: () => void;
}

/**
 * Painel de um chip (telefone não-padrão): nome, slug, token e os webhooks que
 * agem no lead. O slug é o que amarra tudo — precisa bater com o ?canal=<slug>
 * na URL de entrada, senão o backend não reconhece o chip e cai no canal padrão.
 */
function CartaoCanal({ canal, original, salvando, onChange, onRemover }: PropsCartaoCanal) {
    const [showToken, setShowToken] = useState(false);
    // Nome/slug começam recolhidos (card limpo, igual ao Claro 4); abrem no lápis.
    // Um telefone novo (sem slug) já nasce com os campos abertos para preencher.
    const [editandoDados, setEditandoDados] = useState(canal.slug.trim() === '');
    const tokenConfigurado = canal.token.trim().length > 0;

    return (
        <div className="card" style={{ maxWidth: '600px', marginTop: 'var(--spacing-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--spacing-md)' }}>
                <div style={{
                    width: '40px', height: '40px', borderRadius: '50%',
                    background: 'var(--bg-card-elevated)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexShrink: 0,
                }}>
                    <Smartphone size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {canal.nome.trim() || 'Novo telefone'}
                    </h3>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {canal.slug.trim()
                            ? <>Responde pela URL com <code>&amp;canal={canal.slug.trim()}</code>.</>
                            : 'Defina o nome e o identificador deste número.'}
                    </p>
                </div>
                <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => setEditandoDados((v) => !v)}
                    disabled={salvando}
                    title="Editar nome e identificador"
                    style={{ flexShrink: 0 }}
                >
                    <Pencil size={16} />
                </button>
                <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={onRemover}
                    disabled={salvando}
                    title="Remover telefone"
                    style={{ color: '#dc2626', flexShrink: 0 }}
                >
                    <Trash2 size={16} />
                </button>
            </div>

            {editandoDados && (
                <>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                            <label className="label-section" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>Nome</label>
                            <input
                                value={canal.nome}
                                onChange={(e) => onChange({ ...canal, nome: e.target.value })}
                                placeholder="Ex.: Claro 2"
                                disabled={salvando}
                                style={{
                                    width: '100%', padding: '14px', background: 'var(--bg-input)',
                                    border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                                    color: 'var(--text-primary)', fontSize: 'var(--text-sm)',
                                }}
                            />
                        </div>
                        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                            <label className="label-section" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>Identificador (slug)</label>
                            <input
                                value={canal.slug}
                                onChange={(e) => onChange({ ...canal, slug: e.target.value.trim() })}
                                placeholder="Ex.: claro2"
                                disabled={salvando}
                                style={{
                                    width: '100%', padding: '14px', background: 'var(--bg-input)',
                                    border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                                    color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
                                }}
                            />
                        </div>
                    </div>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--spacing-md)' }}>
                        A URL de entrada deste telefone no Responde Chat precisa terminar com{' '}
                        <code>&amp;canal={canal.slug.trim() || 'slug'}</code>. Sem isso, a mensagem cai no canal padrão.
                    </p>
                </>
            )}

            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                <label className="label-section" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                    Token do Responde Chat
                    {tokenConfigurado
                        ? <span className="badge badge-success" style={{ fontSize: '10px', padding: '1px 6px' }}>configurado</span>
                        : <span className="badge badge-warning" style={{ fontSize: '10px', padding: '1px 6px' }}>sem token</span>}
                </label>
                <div style={{ position: 'relative' }}>
                    <input
                        type={showToken ? 'text' : 'password'}
                        value={canal.token}
                        onChange={(e) => onChange({ ...canal, token: e.target.value })}
                        placeholder="Cole o token desta conexão (Copiar token)..."
                        disabled={salvando}
                        style={{
                            width: '100%', padding: '14px', paddingRight: '48px', background: 'var(--bg-input)',
                            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                            color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => setShowToken((s) => !s)}
                        style={{
                            position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '4px',
                        }}
                        title={showToken ? 'Ocultar' : 'Mostrar'}
                    >
                        {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                </div>
            </div>

            <span className="label-section" style={{ display: 'block', marginBottom: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                Webhooks deste telefone
            </span>
            {DEFINICOES.map(({ chave, titulo, descricao }) => (
                <CampoWebhook
                    key={chave}
                    titulo={titulo}
                    descricao={descricao}
                    cfg={canal.webhooks[chave]}
                    original={original.webhooks[chave]}
                    salvando={salvando}
                    onChange={(cfg) => onChange({ ...canal, webhooks: { ...canal.webhooks, [chave]: cfg } })}
                />
            ))}
        </div>
    );
}

export default function Configuracoes() {
    const { addToast } = useToast();
    const [activeTab, setActiveTab] = useState<'webhooks' | 'ia' | 'asaas'>('webhooks');
    const [apiKey, setApiKey] = useState('');
    const [hasExistingKey, setHasExistingKey] = useState(false);
    const [showKey, setShowKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Seletor de telefone da aba Webhooks: 'padrao' (Claro 4) ou o _id de um chip.
    const [telefoneSelId, setTelefoneSelId] = useState<string>('padrao');

    // Canal padrão (Claro 4): token e webhooks globais.
    const [rcTokenValue, setRcTokenValue] = useState('');
    const [rcTokenOriginal, setRcTokenOriginal] = useState('');
    const [showRcTokenVal, setShowRcTokenVal] = useState(false);

    const [webhooks, setWebhooks] = useState<Record<ChaveWebhook, ConfigWebhook>>(webhooksVazios());
    const [webhooksOriginais, setWebhooksOriginais] = useState<Record<ChaveWebhook, ConfigWebhook>>(webhooksVazios());
    const [isSavingWebhooks, setIsSavingWebhooks] = useState(false);

    // Chips (telefones não-padrão): cada um com token e webhooks próprios.
    const [canais, setCanais] = useState<Canal[]>([]);
    const [canaisOriginais, setCanaisOriginais] = useState<Canal[]>([]);
    const [isSavingCanais, setIsSavingCanais] = useState(false);

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

    // Canal padrão: mudou algum webhook OU o token?
    const chavesAlteradas = (Object.keys(webhooks) as ChaveWebhook[]).filter(
        (k) => webhooks[k].url !== webhooksOriginais[k].url || webhooks[k].ativo !== webhooksOriginais[k].ativo
    );
    const rcTokenAlterado = rcTokenValue.trim() !== rcTokenOriginal.trim();
    const padraoAlterado = chavesAlteradas.length > 0 || rcTokenAlterado;

    const canaisAlterados = JSON.stringify(canais) !== JSON.stringify(canaisOriginais);

    const telefoneSel = canais.find((c) => c._id === telefoneSelId) || null;
    const telefoneSelIndex = canais.findIndex((c) => c._id === telefoneSelId);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settings = await getAppSettings();
                if (settings && typeof settings.geminiApiKey === 'string' && settings.geminiApiKey.length > 10) {
                    setHasExistingKey(true);
                }

                if (settings && typeof settings.respondechatToken === 'string') {
                    setRcTokenValue(settings.respondechatToken);
                    setRcTokenOriginal(settings.respondechatToken);
                }

                if (settings && settings.webhooks) {
                    const whs = settings.webhooks as Record<string, { url?: string; ativo?: boolean }>;
                    const carregado = webhooksVazios();
                    for (const { chave } of DEFINICOES) {
                        if (whs[chave]) {
                            carregado[chave] = {
                                url: whs[chave].url || '',
                                ativo: whs[chave].ativo !== false,
                            };
                        }
                    }
                    setWebhooks(carregado);
                    setWebhooksOriginais({ ...carregado });
                }

                // Monta a lista de chips a partir de settings.canais e migra tokens
                // legados (respondechatTokens.<slug>) que ainda não tenham um chip.
                const listaCanais: Canal[] = [];
                const rawCanais = (settings && settings.canais && typeof settings.canais === 'object')
                    ? settings.canais as Record<string, {
                        nome?: string; token?: string;
                        webhooks?: Partial<Record<ChaveWebhook, { url?: string; ativo?: boolean }>>;
                    }>
                    : {};
                for (const slug of Object.keys(rawCanais)) {
                    const c = rawCanais[slug] || {};
                    const whs = webhooksVazios();
                    for (const { chave } of DEFINICOES) {
                        const w = c.webhooks?.[chave];
                        if (w) whs[chave] = { url: w.url || '', ativo: w.ativo !== false };
                    }
                    listaCanais.push({
                        _id: novoIdCanal(),
                        slug,
                        nome: typeof c.nome === 'string' && c.nome ? c.nome : slug,
                        token: typeof c.token === 'string' ? c.token : '',
                        webhooks: whs,
                    });
                }
                if (settings && settings.respondechatTokens && typeof settings.respondechatTokens === 'object') {
                    const tokens = settings.respondechatTokens as Record<string, unknown>;
                    for (const slug of Object.keys(tokens)) {
                        if (listaCanais.some((c) => c.slug === slug)) continue;
                        const tok = tokens[slug];
                        if (typeof tok === 'string' && tok.length > 0) {
                            listaCanais.push({
                                _id: novoIdCanal(),
                                slug,
                                nome: slug === 'claro2' ? 'Claro 2' : slug,
                                token: tok,
                                webhooks: webhooksVazios(),
                            });
                        }
                    }
                }
                setCanais(listaCanais);
                setCanaisOriginais(JSON.parse(JSON.stringify(listaCanais)));

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

    // ---- Canal padrão (Claro 4): token + webhooks globais ----
    const handleSalvarPadrao = async () => {
        if (!padraoAlterado) return;

        const invalida = (Object.keys(webhooks) as ChaveWebhook[]).find((k) => {
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
            // Objeto webhooks ANINHADO inteiro — setDoc+merge não trata chave
            // pontilhada como caminho; o estado tem todas as chaves, nada se perde.
            const webhooksSalvar: Record<ChaveWebhook, ConfigWebhook> = webhooksVazios();
            for (const chave of Object.keys(webhooks) as ChaveWebhook[]) {
                webhooksSalvar[chave] = { url: webhooks[chave].url.trim(), ativo: webhooks[chave].ativo };
            }
            const payload: Record<string, unknown> = { webhooks: webhooksSalvar };
            if (rcTokenAlterado) payload.respondechatToken = rcTokenValue.trim();
            await saveAppSettings(payload);

            const salvos = { ...webhooks };
            for (const chave of Object.keys(salvos) as ChaveWebhook[]) salvos[chave] = { ...salvos[chave], url: salvos[chave].url.trim() };
            setWebhooks(salvos);
            setWebhooksOriginais(salvos);
            setRcTokenValue(rcTokenValue.trim());
            setRcTokenOriginal(rcTokenValue.trim());

            addToast('Canal padrão (Claro 4) salvo com sucesso!', 'success');
        } catch (error) {
            console.error('Error saving canal padrao:', error);
            addToast('Erro ao salvar o canal padrão.', 'error');
        }
        setIsSavingWebhooks(false);
    };

    // ---- Chips (telefones não-padrão) ----
    const adicionarTelefone = () => {
        const novo: Canal = { _id: novoIdCanal(), slug: '', nome: '', token: '', webhooks: webhooksVazios() };
        setCanais((cs) => [...cs, novo]);
        setTelefoneSelId(novo._id);
    };

    const atualizarChip = (index: number, canal: Canal) => {
        setCanais((cs) => cs.map((c, i) => (i === index ? canal : c)));
    };

    const removerChip = (index: number) => {
        const c = canais[index];
        const rotulo = c.nome.trim() || c.slug.trim() || 'este telefone';
        if (!window.confirm(`Remover ${rotulo}? O token e os webhooks dele serão apagados ao salvar.`)) return;
        if (c._id === telefoneSelId) setTelefoneSelId('padrao');
        setCanais((cs) => cs.filter((_, i) => i !== index));
    };

    /** Normaliza um chip do estado (trim) para o formato que vai ao Firestore. */
    const chipNormalizado = (c: Canal) => {
        const slug = c.slug.trim();
        const webhooks: Record<ChaveWebhook, ConfigWebhook> = webhooksVazios();
        for (const { chave } of DEFINICOES) {
            webhooks[chave] = { url: c.webhooks[chave].url.trim(), ativo: c.webhooks[chave].ativo };
        }
        return { _id: c._id, slug, nome: c.nome.trim() || slug, token: c.token.trim(), webhooks };
    };

    const handleSaveCanais = async () => {
        // Slug obrigatório, formato válido e único — ele amarra o chip ao ?canal=.
        for (const c of canais) {
            const slug = c.slug.trim();
            if (!slug) {
                addToast('Todo telefone precisa de um identificador (slug), ex.: claro5.', 'error');
                return;
            }
            if (!/^[a-z0-9_-]+$/i.test(slug)) {
                addToast(`O identificador "${slug}" só pode ter letras, números, "-" e "_" (sem espaços).`, 'error');
                return;
            }
        }
        const slugs = canais.map((c) => c.slug.trim().toLowerCase());
        if (new Set(slugs).size !== slugs.length) {
            addToast('Há dois telefones com o mesmo identificador (slug). Cada um precisa ser único.', 'error');
            return;
        }
        // URLs de webhook precisam começar com http(s).
        for (const c of canais) {
            for (const { chave, titulo } of DEFINICOES) {
                const url = c.webhooks[chave].url.trim();
                if (url && !/^https?:\/\//i.test(url)) {
                    addToast(`A URL de "${titulo}" do ${c.nome.trim() || c.slug} precisa começar com https://`, 'error');
                    return;
                }
            }
        }

        setIsSavingCanais(true);
        try {
            const canaisSalvar: Record<string, unknown> = {};
            for (const c of canais) {
                const norm = chipNormalizado(c);
                canaisSalvar[norm.slug] = { nome: norm.nome, token: norm.token, webhooks: norm.webhooks };
            }
            // Slugs que existiam e sumiram (removidos ou renomeados) precisam ser
            // apagados de verdade — o merge sozinho deixaria a chave velha no banco.
            const slugsAtuais = new Set(canais.map((c) => c.slug.trim()));
            const removidos = canaisOriginais.map((c) => c.slug).filter((slug) => !slugsAtuais.has(slug));

            await saveCanais(canaisSalvar, removidos);

            const salvos: Canal[] = canais.map(chipNormalizado);
            setCanais(salvos);
            setCanaisOriginais(JSON.parse(JSON.stringify(salvos)));
            addToast('Telefones salvos com sucesso!', 'success');
        } catch (error) {
            console.error('Error saving canais:', error);
            addToast('Erro ao salvar os telefones.', 'error');
        }
        setIsSavingCanais(false);
    };

    // Estilo dos botões do seletor de telefone.
    const pillStyle = (ativo: boolean): CSSProperties => ({
        padding: '8px 14px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${ativo ? 'var(--primary)' : 'var(--border-subtle)'}`,
        background: ativo ? 'var(--primary)' : 'var(--bg-card-elevated)',
        color: ativo ? '#fff' : 'var(--text-secondary)',
        fontSize: 'var(--text-sm)',
        fontWeight: ativo ? 600 : 400,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
    });

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
                    className={`tab ${activeTab === 'asaas' ? 'active' : ''}`}
                    onClick={() => setActiveTab('asaas')}
                >
                    Asaas
                </button>
            </div>

            {/* Aba Webhooks — por telefone */}
            {activeTab === 'webhooks' && (
                <div style={{ marginTop: 'var(--spacing-lg)' }}>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', maxWidth: '600px', marginBottom: 'var(--spacing-md)' }}>
                        Escolha o telefone e configure o token e os webhooks dele. Cada número dispara os eventos pela sua própria automação — o lead é movido na caixa certa.
                    </p>

                    {/* Seletor de telefone */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', maxWidth: '600px', marginBottom: 'var(--spacing-md)' }}>
                        <button type="button" style={pillStyle(telefoneSelId === 'padrao')} onClick={() => setTelefoneSelId('padrao')}>
                            <Globe size={14} /> Claro 4
                        </button>
                        {canais.map((c) => (
                            <button key={c._id} type="button" style={pillStyle(telefoneSelId === c._id)} onClick={() => setTelefoneSelId(c._id)}>
                                <Smartphone size={14} /> {c.nome.trim() || 'Novo telefone'}
                            </button>
                        ))}
                        <button type="button" className="btn btn-ghost" onClick={adicionarTelefone} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <Plus size={16} /> Adicionar telefone
                        </button>
                    </div>

                    {/* Painel do canal padrão (Claro 4) */}
                    {telefoneSelId === 'padrao' && (
                        <div className="card" style={{ maxWidth: '600px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '50%',
                                    background: 'var(--bg-card-elevated)', display: 'flex',
                                    alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexShrink: 0,
                                }}>
                                    <Globe size={20} />
                                </div>
                                <div>
                                    <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                                        Claro 4
                                    </h3>
                                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                                        Usado quando a mensagem chega sem <code>&amp;canal=</code> na URL de entrada.
                                    </p>
                                </div>
                            </div>

                            {/* Token do canal padrão */}
                            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                <label className="label-section" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                                    Token do Responde Chat
                                    {rcTokenValue.trim().length > 0
                                        ? <span className="badge badge-success" style={{ fontSize: '10px', padding: '1px 6px' }}>configurado</span>
                                        : <span className="badge badge-warning" style={{ fontSize: '10px', padding: '1px 6px' }}>sem token</span>}
                                </label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showRcTokenVal ? 'text' : 'password'}
                                        value={rcTokenValue}
                                        onChange={(e) => setRcTokenValue(e.target.value)}
                                        placeholder="Cole o token do Responde Chat..."
                                        disabled={isSavingWebhooks}
                                        style={{
                                            width: '100%', padding: '14px', paddingRight: '48px', background: 'var(--bg-input)',
                                            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                                            color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowRcTokenVal((s) => !s)}
                                        style={{
                                            position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                                            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '4px',
                                        }}
                                        title={showRcTokenVal ? 'Ocultar' : 'Mostrar'}
                                    >
                                        {showRcTokenVal ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>

                            <span className="label-section" style={{ display: 'block', marginBottom: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                                Webhooks deste telefone
                            </span>
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

                            <button
                                onClick={handleSalvarPadrao}
                                className="btn btn-primary"
                                disabled={isSavingWebhooks || !padraoAlterado}
                                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                            >
                                <Save size={16} />
                                <span>{isSavingWebhooks ? 'Salvando...' : padraoAlterado ? 'Salvar canal padrão' : 'Nada a salvar'}</span>
                            </button>
                        </div>
                    )}

                    {/* Painel de um chip selecionado */}
                    {telefoneSelId !== 'padrao' && telefoneSel && (
                        <>
                            <CartaoCanal
                                canal={telefoneSel}
                                original={canaisOriginais.find((o) => o._id === telefoneSel._id) || telefoneSel}
                                salvando={isSavingCanais}
                                onChange={(atualizado) => atualizarChip(telefoneSelIndex, atualizado)}
                                onRemover={() => removerChip(telefoneSelIndex)}
                            />
                            <div style={{ maxWidth: '600px', marginTop: 'var(--spacing-md)' }}>
                                <button
                                    onClick={handleSaveCanais}
                                    className="btn btn-primary"
                                    disabled={!canaisAlterados || isSavingCanais}
                                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                                >
                                    <Save size={16} />
                                    <span>{isSavingCanais ? 'Salvando...' : 'Salvar telefone'}</span>
                                </button>
                            </div>
                        </>
                    )}
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

            {/* Aba Asaas */}
            {activeTab === 'asaas' && (
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
            )}
        </div>
    );
}
