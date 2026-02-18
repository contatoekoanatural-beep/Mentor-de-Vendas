// ========================================
// Objecoes Page - Biblioteca de Objeções
// ========================================

import { useState, useEffect } from 'react';
import {
    Plus,
    Edit2,
    Trash2,
    ChevronDown,
    ChevronUp,
    MessageCircle,
    Filter,
} from 'lucide-react';
import { useProduct } from '../contexts/ProductContext';
import { useAuth } from '../contexts/AuthContext';
import {
    getObjections,
    createObjection,
    updateObjection,
    deleteObjection,
    logAudit,
} from '../services/firebase';
import type { Objection, ObjectionCategory } from '../types';

const CATEGORY_OPTIONS: { value: ObjectionCategory; label: string }[] = [
    { value: 'price', label: 'Preço' },
    { value: 'trust', label: 'Confiança' },
    { value: 'delivery', label: 'Entrega' },
    { value: 'quality', label: 'Qualidade' },
    { value: 'other', label: 'Outro' },
];

const CATEGORY_COLORS: Record<ObjectionCategory, string> = {
    price: 'var(--color-success)',
    trust: 'var(--color-info)',
    delivery: 'var(--color-warning)',
    quality: 'var(--color-error)',
    other: 'var(--color-text-muted)',
};

export default function Objecoes() {
    const { activeProduct } = useProduct();
    const { user, isOwner } = useAuth();

    const [objections, setObjections] = useState<Objection[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingObjection, setEditingObjection] = useState<Objection | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [filterCategory, setFilterCategory] = useState<ObjectionCategory | 'all'>('all');

    // Form state
    const [formTitle, setFormTitle] = useState('');
    const [formCategory, setFormCategory] = useState<ObjectionCategory>('price');
    const [formMeaning, setFormMeaning] = useState('');
    const [formResponses, setFormResponses] = useState<string[]>(['']);
    const [formFollowUps, setFormFollowUps] = useState<string[]>(['']);

    // Load objections
    useEffect(() => {
        loadObjections();
    }, [activeProduct]);

    const loadObjections = async () => {
        setLoading(true);
        try {
            const data = await getObjections(activeProduct?.id);
            setObjections(data);
        } catch (error) {
            console.error('Error loading objections:', error);
        }
        setLoading(false);
    };

    const handleOpenModal = (objection?: Objection) => {
        if (objection) {
            setEditingObjection(objection);
            setFormTitle(objection.title);
            setFormCategory(objection.category);
            setFormMeaning(objection.whatItMeans || '');
            setFormResponses(objection.bestResponses?.length ? objection.bestResponses : ['']);
            setFormFollowUps(objection.followUpQuestions?.length ? objection.followUpQuestions : ['']);
        } else {
            setEditingObjection(null);
            setFormTitle('');
            setFormCategory('price');
            setFormMeaning('');
            setFormResponses(['']);
            setFormFollowUps(['']);
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingObjection(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeProduct || !user) return;

        try {
            const responses = formResponses.filter(r => r.trim());
            const followUps = formFollowUps.filter(f => f.trim());

            if (editingObjection) {
                await updateObjection(editingObjection.id, {
                    title: formTitle,
                    category: formCategory,
                    whatItMeans: formMeaning,
                    bestResponses: responses,
                    followUpQuestions: followUps,
                });
                logAudit(user.id, user.name, 'update', 'objection', editingObjection.id, formTitle);
            } else {
                const objectionId = await createObjection({
                    title: formTitle,
                    category: formCategory,
                    whatItMeans: formMeaning,
                    bestResponses: responses,
                    followUpQuestions: followUps,
                    productIds: [activeProduct.id],
                    createdBy: user.id
                });
                logAudit(user.id, user.name, 'create', 'objection', objectionId, formTitle);
            }

            handleCloseModal();
            loadObjections();
        } catch (error) {
            console.error('Error saving objection:', error);
            alert('Erro ao salvar objeção');
        }
    };

    const handleDelete = async (id: string) => {
        if (!user) return;

        try {
            const objection = objections.find(o => o.id === id);
            await deleteObjection(id);
            if (objection) {
                logAudit(user.id, user.name, 'delete', 'objection', id, objection.title);
            }
            setDeleteConfirm(null);
            loadObjections();
        } catch (error) {
            console.error('Error deleting objection:', error);
            alert('Erro ao excluir objeção');
        }
    };

    const addResponse = () => setFormResponses([...formResponses, '']);
    const removeResponse = (index: number) => setFormResponses(formResponses.filter((_, i) => i !== index));
    const updateResponse = (index: number, value: string) => {
        const updated = [...formResponses];
        updated[index] = value;
        setFormResponses(updated);
    };

    const addFollowUp = () => setFormFollowUps([...formFollowUps, '']);
    const removeFollowUp = (index: number) => setFormFollowUps(formFollowUps.filter((_, i) => i !== index));
    const updateFollowUp = (index: number, value: string) => {
        const updated = [...formFollowUps];
        updated[index] = value;
        setFormFollowUps(updated);
    };

    const filteredObjections = filterCategory === 'all'
        ? objections
        : objections.filter(o => o.category === filterCategory);

    if (loading) {
        return (
            <div className="loading-page">
                <div className="loading-spinner" />
                <p className="text-muted">Carregando objeções...</p>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">Biblioteca de Objeções</h1>
                    <p className="text-muted">
                        Documente as objeções mais comuns e as melhores respostas
                    </p>
                </div>
                {isOwner && (
                    <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                        <Plus size={16} />
                        Nova Objeção
                    </button>
                )}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-4 mb-6">
                <div className="flex items-center gap-2">
                    <Filter size={16} className="text-muted" />
                    <span className="text-muted">Categoria:</span>
                </div>
                <div className="flex gap-2">
                    <button
                        className={`btn btn-sm ${filterCategory === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setFilterCategory('all')}
                    >
                        Todas
                    </button>
                    {CATEGORY_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            className={`btn btn-sm ${filterCategory === opt.value ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setFilterCategory(opt.value)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Objections List */}
            {filteredObjections.length === 0 ? (
                <div className="empty-state">
                    <MessageCircle size={48} strokeWidth={1.5} />
                    <h3>Nenhuma objeção encontrada</h3>
                    <p>Comece cadastrando as objeções mais comuns dos clientes.</p>
                    {isOwner && (
                        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                            <Plus size={16} />
                            Cadastrar Primeira Objeção
                        </button>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    {filteredObjections.map((objection) => (
                        <div key={objection.id} className="card" style={{ overflow: 'hidden' }}>
                            {/* Header */}
                            <div
                                className="flex items-center justify-between"
                                style={{
                                    padding: 'var(--space-4)',
                                    cursor: 'pointer',
                                }}
                                onClick={() => setExpandedId(expandedId === objection.id ? null : objection.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <div
                                        style={{
                                            width: 8,
                                            height: 8,
                                            borderRadius: 'var(--radius-full)',
                                            background: CATEGORY_COLORS[objection.category],
                                        }}
                                    />
                                    <h3 style={{ fontWeight: 600 }}>{objection.title}</h3>
                                    <span className="badge badge-secondary" style={{ fontSize: 'var(--text-xs)' }}>
                                        {CATEGORY_OPTIONS.find(c => c.value === objection.category)?.label}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {isOwner && (
                                        <>
                                            <button
                                                className="btn btn-sm btn-ghost"
                                                onClick={(e) => { e.stopPropagation(); handleOpenModal(objection); }}
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                className="btn btn-sm btn-ghost"
                                                onClick={(e) => { e.stopPropagation(); setDeleteConfirm(objection.id); }}
                                                style={{ color: 'var(--color-error)' }}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </>
                                    )}
                                    {expandedId === objection.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                </div>
                            </div>

                            {/* Expanded Content */}
                            {expandedId === objection.id && (
                                <div
                                    style={{
                                        padding: 'var(--space-4)',
                                        borderTop: '1px solid var(--color-border)',
                                        background: 'var(--color-bg-tertiary)',
                                    }}
                                >
                                    {objection.whatItMeans && (
                                        <div style={{ marginBottom: 'var(--space-4)' }}>
                                            <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                                                O que significa
                                            </h4>
                                            <p style={{ fontSize: 'var(--text-sm)' }}>{objection.whatItMeans}</p>
                                        </div>
                                    )}

                                    {objection.bestResponses && objection.bestResponses.length > 0 && (
                                        <div style={{ marginBottom: 'var(--space-4)' }}>
                                            <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                                                Melhores Respostas
                                            </h4>
                                            <ul style={{ paddingLeft: 'var(--space-4)', margin: 0 }}>
                                                {objection.bestResponses.map((response, i) => (
                                                    <li key={i} style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>
                                                        {response}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {objection.followUpQuestions && objection.followUpQuestions.length > 0 && (
                                        <div>
                                            <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                                                Perguntas de Diagnóstico
                                            </h4>
                                            <ul style={{ paddingLeft: 'var(--space-4)', margin: 0 }}>
                                                {objection.followUpQuestions.map((question, i) => (
                                                    <li key={i} style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)', fontStyle: 'italic' }}>
                                                        "{question}"
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Delete Confirmation */}
                            {deleteConfirm === objection.id && (
                                <div
                                    style={{
                                        padding: 'var(--space-3)',
                                        background: 'var(--color-error-bg)',
                                        borderTop: '1px solid var(--color-border)',
                                    }}
                                >
                                    <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                                        Excluir esta objeção?
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
                                            onClick={() => handleDelete(objection.id)}
                                        >
                                            Excluir
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {editingObjection ? 'Editar Objeção' : 'Nova Objeção'}
                            </h2>
                            <button className="modal-close" onClick={handleCloseModal}>
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                                <div className="form-group">
                                    <label className="form-label required">Título da Objeção</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder='Ex: "Está muito caro"'
                                        value={formTitle}
                                        onChange={(e) => setFormTitle(e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label required">Categoria</label>
                                    <select
                                        className="form-select"
                                        value={formCategory}
                                        onChange={(e) => setFormCategory(e.target.value as ObjectionCategory)}
                                    >
                                        {CATEGORY_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">O que significa</label>
                                    <textarea
                                        className="form-textarea"
                                        placeholder="Explique o que o cliente realmente quer dizer..."
                                        value={formMeaning}
                                        onChange={(e) => setFormMeaning(e.target.value)}
                                        rows={2}
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Melhores Respostas</label>
                                    {formResponses.map((response, index) => (
                                        <div key={index} className="flex gap-2 mb-2">
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="Digite uma resposta..."
                                                value={response}
                                                onChange={(e) => updateResponse(index, e.target.value)}
                                            />
                                            {formResponses.length > 1 && (
                                                <button
                                                    type="button"
                                                    className="btn btn-icon btn-ghost"
                                                    onClick={() => removeResponse(index)}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-ghost"
                                        onClick={addResponse}
                                    >
                                        <Plus size={14} />
                                        Adicionar Resposta
                                    </button>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Perguntas de Diagnóstico</label>
                                    {formFollowUps.map((followUp, index) => (
                                        <div key={index} className="flex gap-2 mb-2">
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="Digite uma pergunta..."
                                                value={followUp}
                                                onChange={(e) => updateFollowUp(index, e.target.value)}
                                            />
                                            {formFollowUps.length > 1 && (
                                                <button
                                                    type="button"
                                                    className="btn btn-icon btn-ghost"
                                                    onClick={() => removeFollowUp(index)}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-ghost"
                                        onClick={addFollowUp}
                                    >
                                        <Plus size={14} />
                                        Adicionar Pergunta
                                    </button>
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
                                    {editingObjection ? 'Salvar Alterações' : 'Criar Objeção'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
