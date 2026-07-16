// ========================================
// Equipe - Gestão de vendedores e acesso por chip (WhatsApp)
// ========================================

import { useEffect, useState, type CSSProperties } from 'react';
import { Users, UserPlus, Trash2, ShieldCheck, UserCog } from 'lucide-react';
import type { User } from '../types';
import {
    getUsers,
    getAppSettings,
    getCanaisEmUso,
    criarVendedor,
    removerVendedor,
    removerConta,
    updateUserCanais,
    tornarVendedor,
} from '../services/firebase';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

// Slug interno das conversas sem canal de origem (igual à bancada).
const CANAL_PADRAO = '__padrao__';

interface OpcaoChip {
    slug: string;
    nome: string;
}

export default function Equipe() {
    const { addToast } = useToast();
    const { user: contaAtual } = useAuth();

    const [users, setUsers] = useState<(User & { id: string })[]>([]);
    const [chips, setChips] = useState<OpcaoChip[]>([]);
    const [loading, setLoading] = useState(true);

    // Formulário de novo vendedor
    const [nome, setNome] = useState('');
    const [email, setEmail] = useState('');
    const [senha, setSenha] = useState('');
    const [novoChips, setNovoChips] = useState<string[]>([]);
    const [criando, setCriando] = useState(false);

    // uid em processo de salvar/remover (para desabilitar botões)
    const [ocupado, setOcupado] = useState<string | null>(null);

    const carregar = async () => {
        try {
            const [lista, settings, canaisEmUso] = await Promise.all([
                getUsers(), getAppSettings(), getCanaisEmUso(),
            ]);
            setUsers(lista.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')));

            // Nome amigável dos chips cadastrados em Configurações (se houver).
            const rawCanais = (settings?.canais && typeof settings.canais === 'object')
                ? settings.canais as Record<string, { slug?: string; nome?: string }>
                : {};
            const nomePorSlug: Record<string, string> = { [CANAL_PADRAO]: 'Padrão' };
            for (const c of Object.values(rawCanais)) {
                if (c?.slug) nomePorSlug[c.slug] = c.nome || c.slug;
            }

            // Opções = chips que aparecem nas conversas (fonte da bancada) +
            // os cadastrados em Configurações + "Padrão", sem duplicar.
            const slugs = new Set<string>([CANAL_PADRAO, ...canaisEmUso, ...Object.keys(nomePorSlug)]);
            const opcoes: OpcaoChip[] = Array.from(slugs)
                .map((slug) => ({ slug, nome: nomePorSlug[slug] || slug }))
                .sort((a, b) => {
                    if (a.slug === CANAL_PADRAO) return 1; // "Padrão" por último
                    if (b.slug === CANAL_PADRAO) return -1;
                    return a.nome.localeCompare(b.nome, 'pt-BR');
                });
            setChips(opcoes);
        } catch (e) {
            console.error('Erro ao carregar equipe:', e);
            addToast('Não foi possível carregar a equipe.', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        carregar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const vendedores = users.filter((u) => u.role === 'seller');
    // Contas que ainda não são vendedores (donos/admins), exceto você mesmo —
    // candidatas a serem convertidas em vendedor restrito.
    const outrasContas = users.filter((u) => u.role !== 'seller' && u.id !== contaAtual?.id);

    const toggleNovoChip = (slug: string) => {
        setNovoChips((cur) => cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]);
    };

    const handleCriar = async () => {
        if (criando) return;
        if (!nome.trim() || !email.trim() || !senha.trim()) {
            addToast('Preencha nome, email e senha.', 'warning');
            return;
        }
        if (senha.trim().length < 6) {
            addToast('A senha precisa ter ao menos 6 caracteres.', 'warning');
            return;
        }
        setCriando(true);
        try {
            await criarVendedor({
                nome: nome.trim(),
                email: email.trim(),
                senha: senha.trim(),
                canaisPermitidos: novoChips,
            });
            addToast(`Vendedor ${nome.trim()} criado.`, 'success');
            setNome('');
            setEmail('');
            setSenha('');
            setNovoChips([]);
            await carregar();
        } catch (e: unknown) {
            const msg = (e as { message?: string })?.message || 'Erro ao criar vendedor.';
            addToast(msg, 'error');
        } finally {
            setCriando(false);
        }
    };

    const handleToggleChipVendedor = async (u: User & { id: string }, slug: string) => {
        if (ocupado) return;
        const atuais = u.canaisPermitidos || [];
        const novos = atuais.includes(slug) ? atuais.filter((s) => s !== slug) : [...atuais, slug];
        // Atualização otimista
        setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, canaisPermitidos: novos } : x));
        setOcupado(u.id);
        try {
            await updateUserCanais(u.id, novos);
        } catch (e) {
            console.error('Erro ao salvar chips do vendedor:', e);
            addToast('Não foi possível salvar. Recarregando.', 'error');
            await carregar();
        } finally {
            setOcupado(null);
        }
    };

    const handleRemoverConta = async (u: User & { id: string }) => {
        if (ocupado) return;
        if (!window.confirm(`Excluir a conta de ${u.name || u.email} (${u.email}) DEFINITIVAMENTE? Esta ação não pode ser desfeita.`)) return;
        setOcupado(u.id);
        try {
            await removerConta(u.id);
            addToast('Conta excluída.', 'success');
            setUsers((prev) => prev.filter((x) => x.id !== u.id));
        } catch (e: unknown) {
            const msg = (e as { message?: string })?.message || 'Erro ao excluir conta.';
            addToast(msg, 'error');
        } finally {
            setOcupado(null);
        }
    };

    const handleTornarVendedor = async (u: User & { id: string }) => {
        if (ocupado) return;
        if (!window.confirm(`Converter ${u.name || u.email} em vendedor? Ele mantém o mesmo login, mas passa a ver só os WhatsApp que você liberar (nenhum, no início).`)) return;
        setOcupado(u.id);
        try {
            await tornarVendedor(u.id);
            addToast(`${u.name || u.email} agora é vendedor. Marque os WhatsApp dele abaixo.`, 'success');
            await carregar();
        } catch (e: unknown) {
            const msg = (e as { message?: string })?.message || 'Erro ao converter conta.';
            addToast(msg, 'error');
        } finally {
            setOcupado(null);
        }
    };

    const handleRemover = async (u: User & { id: string }) => {
        if (ocupado) return;
        if (!window.confirm(`Remover o acesso de ${u.name || u.email}? A conta dele será apagada.`)) return;
        setOcupado(u.id);
        try {
            await removerVendedor(u.id);
            addToast('Vendedor removido.', 'success');
            setUsers((prev) => prev.filter((x) => x.id !== u.id));
        } catch (e: unknown) {
            const msg = (e as { message?: string })?.message || 'Erro ao remover vendedor.';
            addToast(msg, 'error');
        } finally {
            setOcupado(null);
        }
    };

    return (
        <div className="page-container" style={{ padding: 'var(--space-6, 24px)', maxWidth: 900, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                <Users size={26} />
                <h1 style={{ margin: 0 }}>Equipe</h1>
            </div>
            <p className="text-muted" style={{ marginTop: 0, marginBottom: 'var(--space-5, 20px)' }}>
                Crie vendedores e escolha de quais WhatsApp cada um acompanha as conversas.
                O vendedor não vê Agentes nem Configurações.
            </p>

            {/* Novo vendedor */}
            <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                    <UserPlus size={18} />
                    <strong>Adicionar vendedor</strong>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
                    <label style={labelStyle}>
                        <span>Nome</span>
                        <input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Lucas" />
                    </label>
                    <label style={labelStyle}>
                        <span>Email</span>
                        <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lucas@email.com" />
                    </label>
                    <label style={labelStyle}>
                        <span>Senha temporária</span>
                        <input style={inputStyle} type="text" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="mín. 6 caracteres" />
                    </label>
                </div>

                <div style={{ marginTop: 'var(--space-4)' }}>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
                        WhatsApp que ele pode ver:
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                        {chips.map((chip) => (
                            <ChipCheckbox
                                key={chip.slug}
                                nome={chip.nome}
                                checked={novoChips.includes(chip.slug)}
                                onChange={() => toggleNovoChip(chip.slug)}
                            />
                        ))}
                    </div>
                </div>

                <button
                    className="btn btn-primary"
                    style={{ marginTop: 'var(--space-4)' }}
                    onClick={handleCriar}
                    disabled={criando}
                >
                    {criando ? 'Criando...' : 'Criar vendedor'}
                </button>
            </div>

            {/* Lista de vendedores */}
            <h2 style={{ fontSize: '1.05rem', margin: 'var(--space-6, 24px) 0 var(--space-3)' }}>
                Vendedores {vendedores.length > 0 && <span className="text-muted">({vendedores.length})</span>}
            </h2>

            {loading ? (
                <p className="text-muted">Carregando...</p>
            ) : vendedores.length === 0 ? (
                <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Nenhum vendedor ainda. Crie o primeiro acima.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {vendedores.map((u) => {
                        const permitidos = u.canaisPermitidos || [];
                        return (
                            <div key={u.id} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{u.name || '(sem nome)'}</div>
                                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{u.email}</div>
                                    </div>
                                    <button
                                        className="btn btn-ghost btn-icon"
                                        title="Remover vendedor"
                                        onClick={() => handleRemover(u)}
                                        disabled={ocupado === u.id}
                                        style={{ color: '#dc2626' }}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>

                                <div style={{ marginTop: 'var(--space-3)' }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 'var(--space-2)' }}>
                                        <ShieldCheck size={13} /> WhatsApp liberados
                                        {permitidos.length === 0 && ' — nenhum (ele não vê conversas)'}
                                    </span>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                                        {chips.map((chip) => (
                                            <ChipCheckbox
                                                key={chip.slug}
                                                nome={chip.nome}
                                                checked={permitidos.includes(chip.slug)}
                                                disabled={ocupado === u.id}
                                                onChange={() => handleToggleChipVendedor(u, chip.slug)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Outras contas: quem já tem login e ainda vê tudo (dono/admin) e
                pode ser convertido em vendedor restrito, mantendo o mesmo login. */}
            {!loading && outrasContas.length > 0 && (
                <>
                    <h2 style={{ fontSize: '1.05rem', margin: 'var(--space-6, 24px) 0 var(--space-3)' }}>
                        Outras contas <span className="text-muted">({outrasContas.length})</span>
                    </h2>
                    <p className="text-muted" style={{ marginTop: 0, fontSize: '0.8125rem' }}>
                        Contas que hoje veem tudo. Converta em vendedor para restringir aos WhatsApp que você escolher — o login e a senha continuam os mesmos.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        {outrasContas.map((u) => (
                            <div key={u.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                                <div>
                                    <div style={{ fontWeight: 600 }}>
                                        {u.name || '(sem nome)'}
                                        <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: '0.75rem' }}>
                                            {u.role === 'owner' ? 'Proprietário' : u.role === 'admin' ? 'Administrador' : u.role}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{u.email}</div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => handleTornarVendedor(u)}
                                        disabled={ocupado === u.id}
                                        style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                                    >
                                        <UserCog size={15} /> Tornar vendedor
                                    </button>
                                    <button
                                        className="btn btn-ghost btn-icon"
                                        title="Excluir conta"
                                        onClick={() => handleRemoverConta(u)}
                                        disabled={ocupado === u.id}
                                        style={{ color: '#dc2626' }}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// ----------------------------------------
// Subcomponentes / estilos
// ----------------------------------------
function ChipCheckbox({ nome, checked, disabled, onChange }: {
    nome: string;
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
}) {
    return (
        <label
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 11px',
                borderRadius: 999,
                border: `1px solid ${checked ? 'var(--primary-color, #2563eb)' : 'var(--border-color)'}`,
                background: checked ? 'rgba(37, 99, 235, 0.10)' : 'transparent',
                color: checked ? 'var(--primary-color, #2563eb)' : 'var(--text-main)',
                fontSize: '0.8125rem',
                fontWeight: checked ? 600 : 500,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                userSelect: 'none',
            }}
        >
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={onChange}
                style={{ margin: 0, cursor: disabled ? 'default' : 'pointer' }}
            />
            {nome}
        </label>
    );
}

const cardStyle: CSSProperties = {
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md, 10px)',
    background: 'var(--bg-card, #fff)',
    padding: 'var(--space-4, 16px)',
};

const labelStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: '0.8125rem',
    color: 'var(--text-muted)',
};

const inputStyle: CSSProperties = {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid var(--border-color)',
    background: 'var(--bg-input, #fff)',
    color: 'var(--text-main)',
    fontSize: '0.875rem',
};
