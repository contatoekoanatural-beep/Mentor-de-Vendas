// ========================================
// Funis Page - Lista de Funis
// ========================================

import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    Plus,
    Edit2,
    Trash2,
    Eye,
    GitBranch,
    Target,
    RefreshCcw,
    Route,
    MoreHorizontal,
    Sparkles,
    List,
    Map,
} from 'lucide-react';
import { useProduct } from '../contexts/ProductContext';
import { useAuth } from '../contexts/AuthContext';
import {
    getFunnels,
    createFunnel,
    updateFunnel,
    deleteFunnel,
    logAudit,
} from '../services/firebase';
import type { Funnel, FunnelType } from '../types';
import FunnelJourneyFlow from '../components/funnels/FunnelJourneyFlow';

const FUNNEL_TYPE_OPTIONS: { value: FunnelType; label: string; icon: typeof GitBranch }[] = [
    { value: 'automation', label: 'Automação', icon: GitBranch },
    { value: 'closing', label: 'Fechamento', icon: Target },
    { value: 'remarketing', label: 'Remarketing', icon: RefreshCcw },
    { value: 'out_of_route', label: 'Fora de Rota', icon: Route },
    { value: 'other', label: 'Outro', icon: MoreHorizontal },
];

const FUNNEL_TYPE_COLORS: Record<FunnelType, string> = {
    automation: 'var(--color-info)',
    closing: 'var(--color-success)',
    remarketing: 'var(--color-warning)',
    out_of_route: 'var(--color-error)',
    other: 'var(--color-text-muted)',
};

export default function Funis() {
    const navigate = useNavigate();
    const location = useLocation();
    const { activeProduct } = useProduct();
    const { user, isOwner } = useAuth();

    const [funnels, setFunnels] = useState<Funnel[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingFunnel, setEditingFunnel] = useState<Funnel | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'list' | 'journey'>('list');


    // Form state
    const [formName, setFormName] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formType, setFormType] = useState<FunnelType>('automation');
    const [formStatus, setFormStatus] = useState<'active' | 'inactive'>('active');

    // Load funnels - recarrega quando muda produto OU quando navega para a página
    useEffect(() => {
        loadFunnels();
    }, [activeProduct, location.key]);

    const loadFunnels = async () => {
        setLoading(true);
        try {
            const data = await getFunnels(activeProduct?.id);
            setFunnels(data);
        } catch (error) {
            console.error('Error loading funnels:', error);
        }
        setLoading(false);
    };

    const handleOpenModal = (funnel?: Funnel) => {
        if (funnel) {
            setEditingFunnel(funnel);
            setFormName(funnel.name);
            setFormDescription(funnel.description || '');
            setFormType(funnel.type);
            setFormStatus(funnel.status);
        } else {
            setEditingFunnel(null);
            setFormName('');
            setFormDescription('');
            setFormType('automation');
            setFormStatus('active');
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingFunnel(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeProduct || !user) return;

        try {
            if (editingFunnel) {
                // Update
                await updateFunnel(editingFunnel.id, {
                    name: formName,
                    description: formDescription,
                    type: formType,
                    status: formStatus,
                });
                logAudit(user.id, user.name, 'update', 'funnel', editingFunnel.id, formName);
            } else {
                // Create
                const id = await createFunnel({
                    name: formName,
                    description: formDescription,
                    type: formType,
                    status: formStatus,
                    productIds: [activeProduct.id],
                });
                logAudit(user.id, user.name, 'create', 'funnel', id, formName);
            }

            handleCloseModal();
            loadFunnels();
        } catch (error) {
            console.error('Error saving funnel:', error);
            alert('Erro ao salvar funil');
        }
    };

    const handleDelete = async (id: string) => {
        if (!user) return;

        try {
            const funnel = funnels.find(f => f.id === id);
            await deleteFunnel(id);
            if (funnel) {
                logAudit(user.id, user.name, 'delete', 'funnel', id, funnel.name);
            }
            setDeleteConfirm(null);
            loadFunnels();
        } catch (error) {
            console.error('Error deleting funnel:', error);
            alert('Erro ao excluir funil');
        }
    };



    if (loading) {
        return (
            <div className="loading-page">
                <div className="loading-spinner" />
                <p className="text-muted">Carregando funis...</p>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">Funis de Vendas</h1>
                    <p className="text-muted">
                        Gerencie os funis de vendas do produto {activeProduct?.name}
                    </p>
                </div>
                {isOwner && (
                    <div className="flex gap-2">
                        <button
                            className="btn btn-secondary"
                            onClick={() => navigate('/funis/importar')}
                        >
                            <Sparkles size={16} />
                            Importar com IA
                        </button>
                        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                            <Plus size={16} />
                            Novo Funil
                        </button>
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                <button
                    className={`btn ${activeTab === 'list' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setActiveTab('list')}
                >
                    <List size={16} />
                    Lista de Funis
                </button>
                <button
                    className={`btn ${activeTab === 'journey' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setActiveTab('journey')}
                >
                    <Map size={16} />
                    Jornada do Lead
                </button>
            </div>

            {/* Journey View */}
            {activeTab === 'journey' && activeProduct && (
                <FunnelJourneyFlow funnels={funnels} productId={activeProduct.id} />
            )}

            {/* Funnel Grid */}
            {activeTab === 'list' && (funnels.length === 0 ? (
                <div className="empty-state">
                    <GitBranch size={48} strokeWidth={1.5} />
                    <h3>Nenhum funil encontrado</h3>
                    <p>
                        Comece criando seu primeiro funil de vendas.
                    </p>
                    {isOwner && (
                        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                            <Plus size={16} />
                            Criar Primeiro Funil
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-4)' }}>
                    {funnels.map((funnel) => {
                        const TypeIcon = FUNNEL_TYPE_OPTIONS.find(o => o.value === funnel.type)?.icon || GitBranch;
                        return (
                            <div
                                key={funnel.id}
                                className="card card-hover"
                                style={{ padding: 'var(--space-5)' }}
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div
                                        style={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: 'var(--radius-md)',
                                            background: `${FUNNEL_TYPE_COLORS[funnel.type]}20`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <TypeIcon size={20} style={{ color: FUNNEL_TYPE_COLORS[funnel.type] }} />
                                    </div>
                                    <span
                                        className={`badge ${funnel.status === 'active' ? 'badge-success' : 'badge-secondary'}`}
                                    >
                                        {funnel.status === 'active' ? 'Ativo' : 'Inativo'}
                                    </span>
                                </div>

                                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                                    {funnel.name}
                                </h3>
                                <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)', minHeight: 40 }}>
                                    {funnel.description || 'Sem descrição'}
                                </p>

                                <div className="flex items-center gap-2">
                                    <button
                                        className="btn btn-sm btn-primary"
                                        onClick={() => navigate(`/funis/${funnel.id}`)}
                                    >
                                        <Eye size={14} />
                                        Ver Detalhes
                                    </button>
                                    {isOwner && (
                                        <>
                                            <button
                                                className="btn btn-sm btn-ghost"
                                                onClick={() => handleOpenModal(funnel)}
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                className="btn btn-sm btn-ghost"
                                                onClick={() => setDeleteConfirm(funnel.id)}
                                                style={{ color: 'var(--color-error)' }}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </>
                                    )}
                                </div>

                                {/* Delete Confirmation */}
                                {deleteConfirm === funnel.id && (
                                    <div
                                        style={{
                                            marginTop: 'var(--space-3)',
                                            padding: 'var(--space-3)',
                                            background: 'var(--color-error-bg)',
                                            borderRadius: 'var(--radius-md)',
                                        }}
                                    >
                                        <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                                            Excluir este funil?
                                        </p>
                                        <div className="flex gap-2">
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => setDeleteConfirm(null)}
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                className="btn btn-sm"
                                                style={{ background: 'var(--color-error)', color: 'white' }}
                                                onClick={() => handleDelete(funnel.id)}
                                            >
                                                Excluir
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}

            {/* Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {editingFunnel ? 'Editar Funil' : 'Novo Funil'}
                            </h2>
                            <button className="modal-close" onClick={handleCloseModal}>
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label required">Nome do Funil</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Ex: Automação Instagram"
                                        value={formName}
                                        onChange={(e) => setFormName(e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Descrição</label>
                                    <textarea
                                        className="form-textarea"
                                        placeholder="Descreva o objetivo deste funil..."
                                        value={formDescription}
                                        onChange={(e) => setFormDescription(e.target.value)}
                                        rows={3}
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select
                                        className="form-select"
                                        value={formStatus}
                                        onChange={(e) => setFormStatus(e.target.value as 'active' | 'inactive')}
                                    >
                                        <option value="active">Ativo</option>
                                        <option value="inactive">Inativo</option>
                                    </select>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={handleCloseModal}
                                >
                                    Cancelar
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {editingFunnel ? 'Salvar Alterações' : 'Criar Funil'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
