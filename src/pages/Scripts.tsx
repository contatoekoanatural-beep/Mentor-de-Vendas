// ========================================
// Scripts Page
// ========================================

import React, { useState, useEffect } from 'react';
import {
    FileText,
    Plus,
    Edit2,
    Trash2,
    Copy,
    Check,
    Clock,
    Tag,
    X,
} from 'lucide-react';
import { useProduct } from '../contexts/ProductContext';
import { useAuth } from '../contexts/AuthContext';
import {
    getScripts,
    createScript,
    getFunnels,
    logAudit,
} from '../services/firebase';
import type { Script, Funnel } from '../types';

export default function Scripts() {
    const { activeProduct } = useProduct();
    const { user, isOwner } = useAuth();

    const [scripts, setScripts] = useState<Script[]>([]);
    const [funnels, setFunnels] = useState<Funnel[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingScript, setEditingScript] = useState<Script | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        content: '',
        funnelId: '',
        tags: [] as string[],
        changeNote: '',
    });
    const [tagInput, setTagInput] = useState('');

    // Filters
    const [filterFunnel, setFilterFunnel] = useState('');

    const fetchData = async () => {
        if (!activeProduct) return;
        setLoading(true);
        try {
            const [scriptData, funnelData] = await Promise.all([
                getScripts(activeProduct.id),
                getFunnels(activeProduct.id),
            ]);
            // Sort scripts by executionOrder (if present), then by order, then name
            scriptData.sort((a, b) => {
                const ea = a.executionOrder ?? Number.POSITIVE_INFINITY;
                const eb = b.executionOrder ?? Number.POSITIVE_INFINITY;
                if (ea !== eb) return ea - eb;
                const oa = a.order ?? 0;
                const ob = b.order ?? 0;
                if (oa !== ob) return oa - ob;
                return a.name.localeCompare(b.name);
            });
            setScripts(scriptData);
            setFunnels(funnelData);
        } catch (error) {
            console.error('Error fetching scripts:', error);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, [activeProduct]);

    const handleOpenModal = (script?: Script) => {
        if (script) {
            setEditingScript(script);
            setFormData({
                name: script.name,
                content: script.content,
                funnelId: script.funnelId || '',
                tags: script.tags,
                changeNote: '',
            });
        } else {
            setEditingScript(null);
            setFormData({
                name: '',
                content: '',
                funnelId: '',
                tags: [],
                changeNote: '',
            });
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingScript(null);
    };

    const handleAddTag = () => {
        if (!tagInput.trim() || formData.tags.includes(tagInput.trim())) return;
        setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] });
        setTagInput('');
    };

    const handleRemoveTag = (tag: string) => {
        setFormData({ ...formData, tags: formData.tags.filter((t) => t !== tag) });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeProduct || !user) return;

        try {
            const id = await createScript(
                {
                    productIds: [activeProduct.id],
                    funnelId: formData.funnelId || undefined,
                    name: formData.name,
                    content: formData.content,
                    tags: formData.tags,
                    changeNote: formData.changeNote || 'Versão inicial',
                    createdBy: user.id,
                },
                editingScript?.id
            );

            await logAudit(
                user.id,
                user.name,
                editingScript ? 'update' : 'create',
                'script',
                id,
                formData.name
            );

            handleCloseModal();
            fetchData();
        } catch (error) {
            console.error('Error saving script:', error);
        }
    };

    const handleCopy = async (content: string, id: string) => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(id);
            setTimeout(() => setCopied(null), 2000);
        } catch (error) {
            console.error('Error copying:', error);
        }
    };

    // Filter scripts
    const filteredScripts = scripts.filter((script) => {
        if (filterFunnel && script.funnelId !== filterFunnel) return false;
        return true;
    });

    // Group scripts by funnel
    const groupedScripts = filteredScripts.reduce((acc, script) => {
        const key = script.funnelId || 'general';
        if (!acc[key]) acc[key] = [];
        acc[key].push(script);
        return acc;
    }, {} as Record<string, Script[]>);

    if (!activeProduct) {
        return (
            <div className="empty-state">
                <FileText className="empty-state-icon" />
                <h2 className="empty-state-title">Selecione um produto</h2>
                <p className="empty-state-description">
                    Escolha um produto no seletor da sidebar para ver os scripts.
                </p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="loading-page">
                <div className="loading-spinner" />
                <p className="text-muted">Carregando scripts...</p>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Scripts</h1>
                    <p className="page-subtitle">
                        Biblioteca de scripts de vendas do produto {activeProduct.name}
                    </p>
                </div>
                {isOwner && (
                    <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                        <Plus size={18} />
                        Novo Script
                    </button>
                )}
            </div>

            {/* Filters */}
            <div className="card mb-6">
                <div className="flex items-center gap-4">
                    <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}>
                        <select
                            className="form-select"
                            value={filterFunnel}
                            onChange={(e) => setFilterFunnel(e.target.value)}
                        >
                            <option value="">Todos os funis</option>
                            {funnels.map((funnel) => (
                                <option key={funnel.id} value={funnel.id}>
                                    {funnel.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <span className="text-muted">
                        {filteredScripts.length} script(s) encontrado(s)
                    </span>
                </div>
            </div>

            {scripts.length === 0 ? (
                <div className="empty-state">
                    <FileText className="empty-state-icon" />
                    <h2 className="empty-state-title">Nenhum script cadastrado</h2>
                    <p className="empty-state-description">
                        Crie scripts para padronizar as mensagens de vendas.
                    </p>
                    {isOwner && (
                        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                            <Plus size={18} />
                            Criar Primeiro Script
                        </button>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-6">
                    {/* General Scripts */}
                    {groupedScripts['general'] && (
                        <div>
                            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>
                                Scripts Gerais
                            </h3>
                            <div className="grid grid-2">
                                {groupedScripts['general'].map((script) => (
                                    <ScriptCard
                                        key={script.id}
                                        script={script}
                                        isOwner={isOwner}
                                        copied={copied === script.id}
                                        onCopy={() => handleCopy(script.content, script.id)}
                                        onEdit={() => handleOpenModal(script)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Scripts by Funnel */}
                    {funnels.map((funnel) =>
                        groupedScripts[funnel.id] ? (
                            <div key={funnel.id}>
                                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>
                                    {funnel.name}
                                </h3>
                                <div className="grid grid-2">
                                    {groupedScripts[funnel.id].map((script) => (
                                        <ScriptCard
                                            key={script.id}
                                            script={script}
                                            isOwner={isOwner}
                                            copied={copied === script.id}
                                            onCopy={() => handleCopy(script.content, script.id)}
                                            onEdit={() => handleOpenModal(script)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : null
                    )}
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {editingScript ? 'Editar Script' : 'Novo Script'}
                            </h2>
                            <button className="modal-close" onClick={handleCloseModal}>
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="grid grid-2">
                                    <div className="form-group">
                                        <label className="form-label required">Nome do Script</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Ex: Abertura WhatsApp"
                                            value={formData.name}
                                            onChange={(e) =>
                                                setFormData({ ...formData, name: e.target.value })
                                            }
                                            required
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Funil (opcional)</label>
                                        <select
                                            className="form-select"
                                            value={formData.funnelId}
                                            onChange={(e) =>
                                                setFormData({ ...formData, funnelId: e.target.value })
                                            }
                                        >
                                            <option value="">Geral (todos os funis)</option>
                                            {funnels.map((funnel) => (
                                                <option key={funnel.id} value={funnel.id}>
                                                    {funnel.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label required">Conteúdo</label>
                                    <textarea
                                        className="form-textarea"
                                        placeholder="Digite o script aqui..."
                                        value={formData.content}
                                        onChange={(e) =>
                                            setFormData({ ...formData, content: e.target.value })
                                        }
                                        rows={8}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Tags</label>
                                    <div className="tags-container">
                                        {formData.tags.map((tag) => (
                                            <span key={tag} className="tag">
                                                {tag}
                                                <button
                                                    type="button"
                                                    className="tag-remove"
                                                    onClick={() => handleRemoveTag(tag)}
                                                >
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                        <input
                                            type="text"
                                            className="tags-input"
                                            placeholder="Adicionar tag..."
                                            value={tagInput}
                                            onChange={(e) => setTagInput(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleAddTag();
                                                }
                                            }}
                                        />
                                    </div>
                                </div>

                                {editingScript && (
                                    <div className="form-group">
                                        <label className="form-label required">
                                            Nota da alteração
                                        </label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Descreva o que mudou"
                                            value={formData.changeNote}
                                            onChange={(e) =>
                                                setFormData({ ...formData, changeNote: e.target.value })
                                            }
                                            required={!!editingScript}
                                        />
                                        <p className="form-helper">
                                            Uma nova versão será criada. A versão anterior será preservada.
                                        </p>
                                    </div>
                                )}
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
                                    {editingScript ? 'Salvar Nova Versão' : 'Criar Script'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

// Script Card Component
interface ScriptCardProps {
    script: Script;
    isOwner: boolean;
    copied: boolean;
    onCopy: () => void;
    onEdit: () => void;
}

function ScriptCard({ script, isOwner, copied, onCopy, onEdit }: ScriptCardProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="card">
            <div className="card-header">
                <div>
                    <h3 className="card-title">{script.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="badge badge-neutral">v{script.version}</span>
                        {script.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="badge badge-info">
                                <Tag size={10} />
                                {tag}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="flex gap-1">
                    <button
                        className="btn btn-icon btn-secondary"
                        onClick={onCopy}
                        title="Copiar"
                    >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                    {isOwner && (
                        <button
                            className="btn btn-icon btn-ghost"
                            onClick={onEdit}
                            title="Editar"
                        >
                            <Edit2 size={16} />
                        </button>
                    )}
                </div>
            </div>

            <div className="card-body">
                <p
                    style={{
                        whiteSpace: 'pre-wrap',
                        maxHeight: expanded ? 'none' : 80,
                        overflow: 'hidden',
                    }}
                >
                    {script.content}
                </p>
                {script.content.length > 200 && (
                    <button
                        className="btn btn-sm btn-ghost mt-2"
                        onClick={() => setExpanded(!expanded)}
                    >
                        {expanded ? 'Ver menos' : 'Ver mais'}
                    </button>
                )}
            </div>
        </div>
    );
}
