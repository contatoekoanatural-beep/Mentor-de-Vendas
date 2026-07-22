// ========================================
// Conversas Page - Read-only Conversation Viewer
// ========================================

import { useEffect, useState, useRef, type CSSProperties } from 'react';
import { MessageSquare, Power, RotateCcw, ChevronRight, ChevronDown, Search, Archive, Trash2, Bell, AlertTriangle } from 'lucide-react';
import type { Conversation } from '../types';
import { Timestamp } from 'firebase/firestore';
import { setConversationAtivo, resetConversation, subscribeConversations, setConversationArquivada, deleteConversation, setConversationRemarketing, limparFalhaIA, subscribeChipSaude, getAppSettings, arquivarConversasEmMassa, rodarFaxinaConversas } from '../services/firebase';
import type { ChipSaudeDoc } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';

// Slug interno das conversas do canal padrão (sem &canal= na URL de entrada).
const CANAL_PADRAO = '__padrao__';

/** Slug do chip de uma conversa; conversas sem canal caem no padrão. */
function chipSlugDe(conv: Conversation): string {
    return conv.canal || CANAL_PADRAO;
}

/** Cor estável por chip, para o marcador visual (padrão = cinza neutro). */
function corDoChip(slug: string): string {
    if (slug === CANAL_PADRAO) return '#6b7280';
    let h = 0;
    for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 360;
    return `hsl(${h}, 60%, 42%)`;
}

/** Marcador visual do WhatsApp de origem: pílula com bolinha colorida. */
function ChipBadge({ slug, nome }: { slug: string; nome: string }) {
    const cor = corDoChip(slug);
    return (
        <span
            title={`WhatsApp: ${nome}`}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '10px',
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: '10px',
                color: cor,
                background: 'color-mix(in srgb, ' + cor + ' 14%, transparent)',
                border: '1px solid color-mix(in srgb, ' + cor + ' 35%, transparent)',
                whiteSpace: 'nowrap',
            }}
        >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: cor, flexShrink: 0 }} />
            {nome}
        </span>
    );
}

/** Estilo de um item (linha com checkbox) do dropdown de WhatsApp. */
function estiloItemDropdown(): CSSProperties {
    return {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        borderRadius: '6px',
        border: 'none',
        background: 'transparent',
        color: 'var(--text-main)',
        fontSize: '0.8125rem',
        cursor: 'pointer',
    };
}

/** Estilo da caixinha de check de cada item do dropdown. */
function estiloCaixaCheck(marcado: boolean): CSSProperties {
    return {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: '4px',
        border: `1px solid ${marcado ? 'var(--primary-color, #2563eb)' : 'var(--border-color)'}`,
        background: marcado ? 'var(--primary-color, #2563eb)' : 'transparent',
        color: '#fff',
        fontSize: '11px',
        lineHeight: 1,
        flexShrink: 0,
    };
}

/**
 * Dropdown de filtro por WhatsApp com multiseleção (checkboxes).
 * Lista vazia de selecionados = "Todos". Fecha ao clicar fora.
 */
function FiltroWhatsApp({
    chips,
    selecionados,
    nomeDoChip,
    onChange,
}: {
    chips: string[];
    selecionados: string[];
    nomeDoChip: (slug: string) => string;
    onChange: (novos: string[]) => void;
}) {
    const [aberto, setAberto] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Fecha ao clicar fora do dropdown.
    useEffect(() => {
        if (!aberto) return;
        const onDocClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [aberto]);

    const resumo =
        selecionados.length === 0
            ? 'Todos os WhatsApp'
            : selecionados.length === 1
                ? nomeDoChip(selecionados[0])
                : `${selecionados.length} WhatsApp`;

    const toggle = (slug: string) => {
        onChange(
            selecionados.includes(slug)
                ? selecionados.filter((s) => s !== slug)
                : [...selecionados, slug]
        );
    };

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                onClick={() => setAberto((v) => !v)}
                title="Filtrar por WhatsApp (pode marcar mais de um)"
                style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 12px', borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-input, #fff)',
                    color: 'var(--text-main)',
                    fontSize: '0.8125rem', fontWeight: 500,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                }}
            >
                <span style={{ color: 'var(--text-muted)' }}>WhatsApp:</span>
                <span>{resumo}</span>
                <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
            {aberto && (
                <div
                    style={{
                        position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30,
                        minWidth: 220,
                        background: 'var(--bg-card, #fff)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
                        padding: '4px',
                    }}
                >
                    <button onClick={() => onChange([])} style={estiloItemDropdown()}>
                        <span style={estiloCaixaCheck(selecionados.length === 0)}>
                            {selecionados.length === 0 ? '✓' : ''}
                        </span>
                        Todos os WhatsApp
                    </button>
                    {chips.map((slug) => {
                        const marcado = selecionados.includes(slug);
                        return (
                            <button key={slug} onClick={() => toggle(slug)} style={estiloItemDropdown()}>
                                <span style={estiloCaixaCheck(marcado)}>{marcado ? '✓' : ''}</span>
                                {nomeDoChip(slug)}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

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
    const [chipNomePorSlug, setChipNomePorSlug] = useState<Record<string, string>>({});
    // Filtro de WhatsApp: lista de chips selecionados. Vazio = todos os chips.
    // Permite marcar 1, 2, 3... em vez de só "um" ou "todos".
    const [filtrosChip, setFiltrosChip] = useState<string[]>([]);
    const [soLeadsProntos, setSoLeadsProntos] = useState(false);
    const [limpando, setLimpando] = useState(false);
    const [faxinando, setFaxinando] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Chips que o vigia marcou como possivelmente fora do ar (entrega travada).
    const chipsSuspeitos = Object.values(chipSaude?.canais || {}).filter(
        (c) => c.status === 'suspeito'
    );

    const { user, isOwner } = useAuth();

    // Só o proprietário vê tudo. Qualquer não-dono (vendedor) é sempre restrito
    // aos chips liberados — sem nenhum chip, não vê conversa alguma (fail-safe:
    // nunca cair no "vê tudo" por falta de configuração).
    const restringirPorChip = !isOwner;
    const canaisPermitidos = user?.canaisPermitidos || [];
    const conversasVisiveis = restringirPorChip
        ? conversations.filter((c) => canaisPermitidos.includes(chipSlugDe(c)))
        : conversations;

    const selected = conversasVisiveis.find((c) => c.id === selectedId) || null;

    // Contagem de conversas por aba
    const totalAtivas = conversasVisiveis.filter(c => c.arquivada !== true).length;
    const totalArquivadas = conversasVisiveis.filter(c => c.arquivada === true).length;

    // O vendedor não tem a aba "Arquivados" — vê só a lista ativa (bancada limpa).
    // O dono usa o arquivamento como faxina, mantendo tudo visível para si.
    const podeVerArquivados = isOwner;
    const abaEfetiva: 'ativas' | 'arquivados' = podeVerArquivados ? abaAtiva : 'ativas';

    // Filtragem por aba ativa
    const tabConversations = conversasVisiveis.filter(c =>
        abaEfetiva === 'ativas' ? c.arquivada !== true : c.arquivada === true
    );

    // Nome amigável de um chip (settings.canais); padrão e desconhecidos têm fallback.
    const nomeDoChip = (slug: string): string =>
        chipNomePorSlug[slug] || (slug === CANAL_PADRAO ? 'Padrão' : slug);

    // Chips do filtro: os que aparecem nas conversas MAIS os cadastrados em
    // Configurações — senão um telefone recém-criado, ainda sem nenhuma conversa,
    // fica invisível aqui mesmo existindo no sistema. O vendedor continua vendo
    // só os que lhe foram liberados (mesma regra de conversasVisiveis).
    const chipsConfigurados = Object.keys(chipNomePorSlug)
        .filter((slug) => !restringirPorChip || canaisPermitidos.includes(slug));
    const chipsEmUso = Array.from(
        new Set([...conversasVisiveis.map(chipSlugDe), ...chipsConfigurados])
    ).sort((a, b) => nomeDoChip(a).localeCompare(nomeDoChip(b), 'pt-BR'));
    const mostrarChips = chipsEmUso.length > 1;

    // Filtro de busca local por telefone + filtro por chip (WhatsApp)
    const cleanSearch = busca.replace(/\D/g, '');
    const filteredConversations = tabConversations.filter(conv => {
        if (filtrosChip.length > 0 && !filtrosChip.includes(chipSlugDe(conv))) return false;
        if (soLeadsProntos && conv.leadPronto !== true) return false;
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

    // Faxina da bancada: arquiva de uma vez todas as conversas ATIVAS do chip
    // filtrado. Só o dono, e só com UM chip específico selecionado (a ação é por
    // chip; com vários marcados não há um alvo único para "arquivar todas de X").
    const chipUnicoSelecionado = filtrosChip.length === 1 ? filtrosChip[0] : null;
    const idsDoChipAtivas = (isOwner && chipUnicoSelecionado)
        ? conversasVisiveis.filter(c => chipSlugDe(c) === chipUnicoSelecionado && c.arquivada !== true).map(c => c.id)
        : [];

    const handleLimparBancada = async () => {
        if (limpando || idsDoChipAtivas.length === 0 || !chipUnicoSelecionado) return;
        const nome = nomeDoChip(chipUnicoSelecionado);
        if (!window.confirm(
            `Arquivar todas as ${idsDoChipAtivas.length} conversas de "${nome}"?\n\n` +
            `Elas saem da lista ativa, mas continuam existindo — você as vê na aba "Arquivados", ` +
            `e um cliente que voltar a escrever continua sendo atendido. É reversível.`
        )) return;
        setLimpando(true);
        try {
            await arquivarConversasEmMassa(idsDoChipAtivas, true);
            setConversations(prev => prev.map(c => idsDoChipAtivas.includes(c.id) ? { ...c, arquivada: true } : c));
        } catch (e) {
            console.error('Erro ao arquivar em massa:', e);
        }
        setLimpando(false);
    };

    // Exclusão de leads mortos sob demanda (só dono): mesma regra do job diário
    // das 00:00 — exclui quem recebeu remarketing há +24h e não respondeu.
    const handleFaxina = async () => {
        if (faxinando) return;
        if (!window.confirm(
            'Excluir os leads mortos agora?\n\n' +
            'EXCLUI de vez as conversas que receberam remarketing há mais de 24h e ' +
            'o cliente não respondeu (com a IA tendo respondido ou não). A exclusão ' +
            'é permanente. Vendas fechadas (lead pronto) e conversas com remarketing ' +
            'desligado não são tocadas.\n\n' +
            'É a mesma limpeza que roda sozinha todo dia às 00:00.'
        )) return;
        setFaxinando(true);
        try {
            const r = await rodarFaxinaConversas();
            window.alert(`Limpeza concluída:\n\n• ${r.excluidas} leads mortos excluídos\n• ${r.mantidas} mantidos`);
        } catch (e) {
            console.error('Erro ao excluir leads mortos:', e);
            window.alert('Erro ao rodar a limpeza. Tente de novo.');
        }
        setFaxinando(false);
    };

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

    // Carrega o nome amigável de cada chip (settings.canais) para o marcador/filtro.
    useEffect(() => {
        (async () => {
            try {
                const settings = await getAppSettings();
                // O slug é a CHAVE do mapa, não um campo de dentro do objeto (é
                // assim que Configurações grava). Ler c.slug dava sempre undefined
                // e deixava este mapa vazio — por isso os chips apareciam como
                // "claro2" em vez de "Claro 2".
                const rawCanais = (settings?.canais && typeof settings.canais === 'object')
                    ? settings.canais as Record<string, { nome?: string }>
                    : {};
                const mapa: Record<string, string> = {};
                for (const [slug, c] of Object.entries(rawCanais)) {
                    if (slug) mapa[slug] = c?.nome || slug;
                }
                setChipNomePorSlug(mapa);
            } catch (e) {
                console.error('Erro ao carregar chips:', e);
            }
        })();
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    <h2 className="conversations-title">Conversas</h2>
                    {mostrarChips && (
                        <FiltroWhatsApp
                            chips={chipsEmUso}
                            selecionados={filtrosChip}
                            nomeDoChip={nomeDoChip}
                            onChange={setFiltrosChip}
                        />
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {isOwner && (
                        <button
                            onClick={handleFaxina}
                            disabled={faxinando}
                            title="Conversas paradas há 2+ dias: arquiva as que a IA respondeu, exclui as que a IA nunca respondeu"
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '6px 12px', borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                background: 'transparent', color: 'var(--text-secondary, #6b7280)',
                                fontSize: '0.8125rem', fontWeight: 500,
                                cursor: faxinando ? 'default' : 'pointer',
                            }}
                        >
                            <Trash2 size={14} />
                            {faxinando ? 'Limpando...' : 'Limpar leads mortos'}
                        </button>
                    )}
                    <span className="conversations-count">{conversasVisiveis.length} conversa{conversasVisiveis.length !== 1 ? 's' : ''}</span>
                </div>
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
                                {c.desde ? ` (desde ${formatTime(c.desde)})` : ''} — as mensagens podem não estar chegando. Confira a conexão desse número no {c.ferramenta === 'convertechat' ? 'ConverteChat' : 'Responde Chat'}.
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Two-column layout */}
            <div className="conversations-layout">
                {/* Left column: conversation list */}
                <div className="conversations-list">
                    {/* Abas Ativas / Arquivados — só o dono; o vendedor vê só as ativas */}
                    {podeVerArquivados && (
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
                    )}

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

                    {/* Filtro rápido: só leads prontos */}
                    <div style={{ padding: 'var(--space-2) var(--space-4)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <button
                            onClick={() => setSoLeadsProntos((v) => !v)}
                            title={soLeadsProntos ? 'Mostrar todas as conversas' : 'Mostrar só os leads prontos para fechar'}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '6px 12px', borderRadius: '16px',
                                border: soLeadsProntos ? '1px solid #f59e0b' : '1px solid var(--border-color)',
                                background: soLeadsProntos ? 'rgba(245, 158, 11, 0.14)' : 'transparent',
                                color: soLeadsProntos ? '#b45309' : 'var(--text-muted)',
                                fontSize: '0.8125rem', fontWeight: 600,
                                cursor: 'pointer',
                            }}
                        >
                            🔥 Só leads prontos
                        </button>
                    </div>

                    {/* Faxina da bancada: arquivar em massa o chip filtrado (só dono,
                        e só com UM chip marcado) */}
                    {isOwner && chipUnicoSelecionado && abaEfetiva === 'ativas' && idsDoChipAtivas.length > 0 && (
                        <div style={{ padding: 'var(--space-2) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
                            <button
                                onClick={handleLimparBancada}
                                disabled={limpando}
                                title={`Arquiva todas as conversas ativas de ${nomeDoChip(chipUnicoSelecionado)}`}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    width: '100%', justifyContent: 'center',
                                    padding: '8px 12px', borderRadius: '6px',
                                    border: '1px solid #f59e0b',
                                    background: 'rgba(245, 158, 11, 0.10)',
                                    color: '#b45309', fontSize: '0.8125rem', fontWeight: 600,
                                    cursor: limpando ? 'default' : 'pointer',
                                }}
                            >
                                <Archive size={15} />
                                {limpando ? 'Arquivando...' : `Arquivar todas de ${nomeDoChip(chipUnicoSelecionado)} (${idsDoChipAtivas.length})`}
                            </button>
                        </div>
                    )}

                    {filteredConversations.length === 0 ? (
                        <div className="conversations-empty-list">
                            <MessageSquare size={32} />
                            <p>
                                {busca
                                    ? 'Nenhum resultado para a busca.'
                                    : soLeadsProntos
                                        ? 'Nenhum lead pronto no momento.'
                                        : abaEfetiva === 'ativas'
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
                                                                <span className="conversation-item-numero">{conv.nomeCliente?.trim() || conv.numero}</span>
                                                                {conv.nomeCliente?.trim() && (
                                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{conv.numero}</span>
                                                                )}
                                                                {conv.leadPronto === true && (
                                                                    <span title="Lead Pronto" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center' }}>🔥</span>
                                                                )}
                                                                {conv.falhaIA === true && (
                                                                    <span title="A IA não respondeu — cliente esperando" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center' }}>⚠️</span>
                                                                )}
                                                            </div>
                                                            <span className="conversation-item-time">{formatTime(updatedMs)}</span>
                                                        </div>
                                                        <div className="conversation-item-agent" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                                            {mostrarChips && <ChipBadge slug={chipSlugDe(conv)} nome={nomeDoChip(chipSlugDe(conv))} />}
                                                        </div>
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
                                                <span className="conversation-item-numero">{conv.nomeCliente?.trim() || conv.numero}</span>
                                                {conv.leadPronto === true && (
                                                    <span title="Lead Pronto" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center' }}>🔥</span>
                                                )}
                                                {conv.falhaIA === true && (
                                                    <span title="A IA não respondeu — cliente esperando" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center' }}>⚠️</span>
                                                )}
                                            </div>
                                            <span className="conversation-item-time">{formatTime(updatedMs)}</span>
                                        </div>
                                        <div className="conversation-item-agent" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                            {conv.nomeCliente?.trim() && <span>{conv.numero}</span>}
                                            {mostrarChips && <ChipBadge slug={chipSlugDe(conv)} nome={nomeDoChip(chipSlugDe(conv))} />}
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
                                     <span className="conv-chat-header-numero" style={{ marginRight: 0 }}>{selected.nomeCliente?.trim() || selected.numero}</span>
                                     {selected.nomeCliente?.trim() && (
                                         <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{selected.numero}</span>
                                     )}
                                     {mostrarChips && <ChipBadge slug={chipSlugDe(selected)} nome={nomeDoChip(chipSlugDe(selected))} />}
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
