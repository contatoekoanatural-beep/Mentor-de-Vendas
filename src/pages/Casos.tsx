// ========================================
// Casos Page - Biblioteca de Casos
// ========================================

import { useState, useEffect } from 'react';
import {
    Plus,
    Edit2,
    Trash2,
    ThumbsUp,
    ThumbsDown,
    Minus,
    Filter,
    Briefcase,
    Image,
    Volume2,
    Eye,
    X,
} from 'lucide-react';
import { useProduct } from '../contexts/ProductContext';
import { useAuth } from '../contexts/AuthContext';
import {
    getCases,
    getFunnels,
    createCase,
    updateCase,
    deleteCase,
    uploadFile,
    logAudit,
} from '../services/firebase';
import type { Case, CaseClassification, Funnel } from '../types';

const CLASSIFICATION_OPTIONS: { value: CaseClassification; label: string; icon: typeof ThumbsUp }[] = [
    { value: 'good', label: 'Bom', icon: ThumbsUp },
    { value: 'bad', label: 'Ruim', icon: ThumbsDown },
    { value: 'neutral', label: 'Neutro', icon: Minus },
];

const CLASSIFICATION_COLORS: Record<CaseClassification, string> = {
    good: 'var(--color-success)',
    bad: 'var(--color-error)',
    neutral: 'var(--color-warning)',
};

export default function Casos() {
    const { activeProduct } = useProduct();
    const { user, isOwner } = useAuth();

    const [cases, setCases] = useState<Case[]>([]);
    const [funnels, setFunnels] = useState<Funnel[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingCase, setEditingCase] = useState<Case | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [viewingCase, setViewingCase] = useState<Case | null>(null);
    const [filterClassification, setFilterClassification] = useState<CaseClassification | 'all'>('all');
    const [filterFunnel, setFilterFunnel] = useState<string>('all');

    // Form state
    const [formTitle, setFormTitle] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formClassification, setFormClassification] = useState<CaseClassification>('good');
    const [formFunnelId, setFormFunnelId] = useState('');
    const [formMediaFile, setFormMediaFile] = useState<File | null>(null);
    const [formMediaPreview, setFormMediaPreview] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);

    // Load data
    useEffect(() => {
        if (!activeProduct) return;
        loadData();
    }, [activeProduct]);

    const loadData = async () => {
        setLoading(true);
        try {
            const casesData = await getCases(activeProduct?.id);
            setCases(casesData);

            const funnelsData = await getFunnels(activeProduct?.id);
            setFunnels(funnelsData);
        } catch (error) {
            console.error('Error loading cases:', error);
        }
        setLoading(false);
    };

    const handleOpenModal = (caseItem?: Case) => {
        if (caseItem) {
            setEditingCase(caseItem);
            setFormTitle(caseItem.title);
            setFormDescription(caseItem.description || '');
            setFormClassification(caseItem.classification);
            setFormFunnelId(caseItem.funnelId || '');
            setFormMediaPreview(caseItem.mediaUrl || null);
        } else {
            setEditingCase(null);
            setFormTitle('');
            setFormDescription('');
            setFormClassification('good');
            setFormFunnelId('');
            setFormMediaFile(null);
            setFormMediaPreview(null);
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingCase(null);
        setFormMediaFile(null);
        setFormMediaPreview(null);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setFormMediaFile(file);
            const reader = new FileReader();
            reader.onload = () => setFormMediaPreview(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeProduct || !user) return;

        setUploading(true);
        try {
            let mediaUrl = editingCase?.mediaUrl || '';
            let mediaType = editingCase?.mediaType || undefined;

            if (formMediaFile) {
                // Use Firebase Storage
                const path = `cases/${user.id}/${Date.now()}_${formMediaFile.name}`;
                mediaUrl = await uploadFile(formMediaFile, path);
                mediaType = formMediaFile.type.startsWith('image/') ? 'image' : 'audio';
            }

            if (editingCase) {
                await updateCase(editingCase.id, {
                    title: formTitle,
                    description: formDescription,
                    classification: formClassification,
                    funnelId: formFunnelId || undefined,
                    mediaUrl: mediaUrl || undefined,
                    mediaType,
                });
                logAudit(user.id, user.name, 'update', 'case', editingCase.id, formTitle);
            } else {
                const caseId = await createCase({
                    title: formTitle,
                    description: formDescription,
                    classification: formClassification,
                    productId: activeProduct.id,
                    funnelId: formFunnelId || undefined,
                    mediaUrl: mediaUrl || undefined,
                    mediaType,
                    uploadedBy: user.id,
                    createdBy: user.id
                });
                logAudit(user.id, user.name, 'create', 'case', caseId, formTitle);
            }

            handleCloseModal();
            loadData();
        } catch (error) {
            console.error('Error saving case:', error);
            alert('Erro ao salvar caso');
        }
        setUploading(false);
    };

    const handleDelete = async (id: string) => {
        if (!user) return;

        try {
            const caseItem = cases.find(c => c.id === id);
            await deleteCase(id);
            if (caseItem) {
                logAudit(user.id, user.name, 'delete', 'case', id, caseItem.title);
            }
            setDeleteConfirm(null);
            loadData();
        } catch (error) {
            console.error('Error deleting case:', error);
            alert('Erro ao excluir caso');
        }
    };

    const filteredCases = cases.filter(c => {
        if (filterClassification !== 'all' && c.classification !== filterClassification) return false;
        if (filterFunnel !== 'all' && c.funnelId !== filterFunnel) return false;
        return true;
    });

    if (loading) {
        return (
            <div className="loading-page">
                <div className="loading-spinner" />
                <p className="text-muted">Carregando casos...</p>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">Biblioteca de Casos</h1>
                    <p className="text-muted">
                        Registre exemplos reais de atendimentos para treinamento
                    </p>
                </div>
                {isOwner && (
                    <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                        <Plus size={16} />
                        Novo Caso
                    </button>
                )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 mb-6">
                <div className="flex items-center gap-2">
                    <Filter size={16} className="text-muted" />
                    <span className="text-muted">Classificação:</span>
                </div>
                <div className="flex gap-2">
                    <button
                        className={`btn btn-sm ${filterClassification === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setFilterClassification('all')}
                    >
                        Todos
                    </button>
                    {CLASSIFICATION_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            className={`btn btn-sm ${filterClassification === opt.value ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setFilterClassification(opt.value)}
                        >
                            <opt.icon size={14} />
                            {opt.label}
                        </button>
                    ))}
                </div>

                {funnels.length > 0 && (
                    <>
                        <div style={{ width: 1, height: 20, background: 'var(--color-border)' }} />
                        <div className="flex items-center gap-2">
                            <span className="text-muted">Funil:</span>
                            <select
                                className="form-select"
                                value={filterFunnel}
                                onChange={(e) => setFilterFunnel(e.target.value)}
                                style={{ width: 'auto' }}
                            >
                                <option value="all">Todos</option>
                                {funnels.map((f) => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                        </div>
                    </>
                )}
            </div>

            {/* Cases Grid */}
            {filteredCases.length === 0 ? (
                <div className="empty-state">
                    <Briefcase size={48} strokeWidth={1.5} />
                    <h3>Nenhum caso encontrado</h3>
                    <p>Registre exemplos de atendimentos para criar uma biblioteca de referência.</p>
                    {isOwner && (
                        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                            <Plus size={16} />
                            Registrar Primeiro Caso
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-4)' }}>
                    {filteredCases.map((caseItem) => {
                        const ClassificationIcon = CLASSIFICATION_OPTIONS.find(o => o.value === caseItem.classification)?.icon || Minus;
                        const funnelName = funnels.find(f => f.id === caseItem.funnelId)?.name;

                        return (
                            <div key={caseItem.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                {/* Media Preview */}
                                {caseItem.mediaUrl && (
                                    <div
                                        style={{
                                            height: 120,
                                            background: 'var(--color-bg-tertiary)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            borderBottom: '1px solid var(--color-border)',
                                        }}
                                    >
                                        {caseItem.mediaType === 'image' ? (
                                            <img
                                                src={caseItem.mediaUrl}
                                                alt={caseItem.title}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                        ) : (
                                            <Volume2 size={32} className="text-muted" />
                                        )}
                                    </div>
                                )}

                                <div style={{ padding: 'var(--space-4)' }}>
                                    <div className="flex items-start justify-between mb-2">
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 'var(--space-2)',
                                                padding: 'var(--space-1) var(--space-2)',
                                                background: `${CLASSIFICATION_COLORS[caseItem.classification]}20`,
                                                borderRadius: 'var(--radius-sm)',
                                            }}
                                        >
                                            <ClassificationIcon size={14} style={{ color: CLASSIFICATION_COLORS[caseItem.classification] }} />
                                            <span style={{ fontSize: 'var(--text-xs)', color: CLASSIFICATION_COLORS[caseItem.classification] }}>
                                                {CLASSIFICATION_OPTIONS.find(o => o.value === caseItem.classification)?.label}
                                            </span>
                                        </div>
                                        {caseItem.mediaType && (
                                            <span className="badge badge-secondary">
                                                {caseItem.mediaType === 'image' ? <Image size={12} /> : <Volume2 size={12} />}
                                            </span>
                                        )}
                                    </div>

                                    <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                                        {caseItem.title}
                                    </h3>

                                    {funnelName && (
                                        <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-2)' }}>
                                            Funil: {funnelName}
                                        </p>
                                    )}

                                    <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)', minHeight: 40 }}>
                                        {caseItem.description?.substring(0, 100) || 'Sem descrição'}
                                        {(caseItem.description?.length || 0) > 100 && '...'}
                                    </p>

                                    <div className="flex items-center gap-2">
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => setViewingCase(caseItem)}
                                        >
                                            <Eye size={14} />
                                            Ver Detalhes
                                        </button>
                                        {isOwner && (
                                            <>
                                                <button
                                                    className="btn btn-sm btn-ghost"
                                                    onClick={() => handleOpenModal(caseItem)}
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                <button
                                                    className="btn btn-sm btn-ghost"
                                                    onClick={() => setDeleteConfirm(caseItem.id)}
                                                    style={{ color: 'var(--color-error)' }}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </>
                                        )}
                                    </div>

                                    {/* Delete Confirmation */}
                                    {deleteConfirm === caseItem.id && (
                                        <div
                                            style={{
                                                marginTop: 'var(--space-3)',
                                                padding: 'var(--space-3)',
                                                background: 'var(--color-error-bg)',
                                                borderRadius: 'var(--radius-md)',
                                            }}
                                        >
                                            <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                                                Excluir este caso?
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
                                                    onClick={() => handleDelete(caseItem.id)}
                                                >
                                                    Excluir
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* View Case Modal */}
            {viewingCase && (
                <div className="modal-overlay" onClick={() => setViewingCase(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">{viewingCase.title}</h2>
                            <button className="modal-close" onClick={() => setViewingCase(null)}>
                                ×
                            </button>
                        </div>
                        <div className="modal-body">
                            {viewingCase.mediaUrl && (
                                <div style={{ marginBottom: 'var(--space-4)' }}>
                                    {viewingCase.mediaType === 'image' ? (
                                        <img
                                            src={viewingCase.mediaUrl}
                                            alt={viewingCase.title}
                                            style={{ width: '100%', borderRadius: 'var(--radius-md)' }}
                                        />
                                    ) : (
                                        <audio controls src={viewingCase.mediaUrl} style={{ width: '100%' }} />
                                    )}
                                </div>
                            )}
                            <p style={{ whiteSpace: 'pre-wrap' }}>{viewingCase.description}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {editingCase ? 'Editar Caso' : 'Novo Caso'}
                            </h2>
                            <button className="modal-close" onClick={handleCloseModal}>
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label required">Título</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Ex: Cliente com dúvida sobre entrega"
                                        value={formTitle}
                                        onChange={(e) => setFormTitle(e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label required">Classificação</label>
                                    <div className="flex gap-2">
                                        {CLASSIFICATION_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                className={`btn ${formClassification === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                                                onClick={() => setFormClassification(opt.value)}
                                                style={{
                                                    flex: 1,
                                                    background: formClassification === opt.value ? CLASSIFICATION_COLORS[opt.value] : undefined,
                                                }}
                                            >
                                                <opt.icon size={16} />
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {funnels.length > 0 && (
                                    <div className="form-group">
                                        <label className="form-label">Funil Relacionado</label>
                                        <select
                                            className="form-select"
                                            value={formFunnelId}
                                            onChange={(e) => setFormFunnelId(e.target.value)}
                                        >
                                            <option value="">Nenhum</option>
                                            {funnels.map((f) => (
                                                <option key={f.id} value={f.id}>{f.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="form-group">
                                    <label className="form-label">Descrição/Transcrição</label>
                                    <textarea
                                        className="form-textarea"
                                        placeholder="Descreva o atendimento ou cole a transcrição..."
                                        value={formDescription}
                                        onChange={(e) => setFormDescription(e.target.value)}
                                        rows={5}
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Mídia (Imagem ou Áudio)</label>
                                    {formMediaPreview ? (
                                        <div style={{ position: 'relative' }}>
                                            {formMediaFile?.type.startsWith('image/') || (editingCase?.mediaType === 'image') ? (
                                                <img
                                                    src={formMediaPreview}
                                                    alt="Preview"
                                                    style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 'var(--radius-md)' }}
                                                />
                                            ) : (
                                                <audio controls src={formMediaPreview} style={{ width: '100%' }} />
                                            )}
                                            <button
                                                type="button"
                                                className="btn btn-icon btn-ghost"
                                                onClick={() => { setFormMediaFile(null); setFormMediaPreview(null); }}
                                                style={{ position: 'absolute', top: 8, right: 8, background: 'var(--color-bg-secondary)' }}
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    ) : (
                                        <input
                                            type="file"
                                            accept="image/*,audio/*"
                                            onChange={handleFileChange}
                                            className="form-input"
                                        />
                                    )}
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
                                <button type="submit" className="btn btn-primary" disabled={uploading}>
                                    {uploading ? 'Salvando...' : editingCase ? 'Salvar Alterações' : 'Criar Caso'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
