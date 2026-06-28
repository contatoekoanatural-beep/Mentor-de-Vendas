import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProduct } from '../contexts/ProductContext';
import { Layers, ArrowRight, Plus } from 'lucide-react';
import { InputModal } from '../components/ui/InputModal';
import { getAgents, deleteProduct } from '../services/firebase';
import type { Product } from '../types';

export default function Produtos() {
    const { products, loading, addProduct, refreshProducts, editProduct } = useProduct();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [editName, setEditName] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    const handleCreateProduct = async (name: string) => {
        if (!name.trim()) return;
        try {
            await addProduct(name.trim(), 'Novo produto de IA cadastrado.');
            setIsCreateOpen(false);
            // Refresh para garantir que os timestamps/IDs venham corretos do Firebase
            if (refreshProducts) {
                refreshProducts();
            }
        } catch (error) {
            console.error('Error creating product:', error);
        }
    };

    const handleOpenEdit = (product: Product) => {
        setSelectedProduct(product);
        setEditName(product.name);
        setIsEditOpen(true);
    };

    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProduct || !editName.trim()) return;
        try {
            await editProduct(selectedProduct.id, { name: editName.trim() });
            setIsEditOpen(false);
        } catch (error) {
            console.error('Error editing product:', error);
        }
    };

    const handleDeleteProduct = async () => {
        if (!selectedProduct || isDeleting) return;
        setIsDeleting(true);
        try {
            // Contar quantos agentes têm o productId
            const agents = await getAgents(selectedProduct.id);
            if (agents.length > 0) {
                alert(`Este produto tem ${agents.length} agente(s) associado(s). Remova os agentes antes de excluir o produto.`);
                setIsDeleting(false);
                return;
            }

            const confirmed = window.confirm("Excluir este produto? Esta ação não pode ser desfeita.");
            if (!confirmed) {
                setIsDeleting(false);
                return;
            }

            await deleteProduct(selectedProduct.id);
            setIsEditOpen(false);
            if (refreshProducts) {
                refreshProducts();
            }
        } catch (error) {
            console.error('Error deleting product:', error);
        }
        setIsDeleting(false);
    };

    if (loading) {
        return (
            <div className="loading-page" style={{ minHeight: '50vh' }}>
                <div className="loading-spinner" />
                <p className="text-muted">Carregando produtos...</p>
            </div>
        );
    }

    return (
        <div className="page-container" style={{ padding: 'var(--spacing-lg)' }}>
            <div className="flex justify-between items-center mb-6" style={{ marginBottom: 'var(--spacing-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--color-text)' }}>
                        Agentes
                    </h2>
                    <p className="text-muted text-sm">
                        Selecione um produto para gerenciar e treinar os agentes de IA associados.
                    </p>
                </div>
                <button className="btn btn-primary flex items-center gap-2" onClick={() => setIsCreateOpen(true)}>
                    <Plus size={18} />
                    <span>Novo Produto</span>
                </button>
            </div>

            {products.length === 0 ? (
                <div className="card" style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>
                    <Layers size={48} style={{ margin: '0 auto var(--spacing-md) auto', color: 'var(--color-text-muted)' }} />
                    <h3 style={{ marginBottom: 'var(--spacing-sm)' }}>Nenhum produto encontrado</h3>
                    <p className="text-muted" style={{ marginBottom: 'var(--spacing-md)' }}>
                        Crie seu primeiro produto para começar a associar agentes de IA.
                    </p>
                    <button className="btn btn-primary flex items-center gap-2" onClick={() => setIsCreateOpen(true)} style={{ margin: '0 auto' }}>
                        <Plus size={18} />
                        <span>Criar Produto</span>
                    </button>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: 'var(--spacing-md)'
                }}>
                    {products.map((product) => (
                        <div key={product.id} className="card hover-scale" style={{
                            padding: 'var(--spacing-lg)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            height: '100%',
                            transition: 'all 0.2s ease',
                        }}>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--spacing-xs)' }}>
                                    <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                                        {product.name}
                                    </h3>
                                    <button
                                        onClick={() => handleOpenEdit(product)}
                                        className="btn btn-secondary"
                                        style={{ padding: '4px 8px', fontSize: 'var(--text-xs)', flexShrink: 0 }}
                                    >
                                        Editar
                                    </button>
                                </div>
                                <p className="text-muted text-sm" style={{
                                    marginBottom: 'var(--spacing-md)',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    minHeight: '4.5em'
                                }}>
                                    {product.description || 'Sem descrição cadastrada.'}
                                </p>
                            </div>

                            <Link
                                to={`/produtos/${product.id}/agentes`}
                                className="btn btn-primary w-full flex items-center justify-center gap-2"
                                style={{ marginTop: 'auto' }}
                            >
                                <span>Ver Agentes</span>
                                <ArrowRight size={16} />
                            </Link>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal para criar produto */}
            <InputModal
                isOpen={isCreateOpen}
                title="Novo Produto"
                message="Digite o nome do novo produto para criar agentes de IA."
                placeholder="Ex: Mentor de Vendas Ekoa"
                onConfirm={handleCreateProduct}
                onCancel={() => setIsCreateOpen(false)}
            />

            {/* Modal para editar produto */}
            {isEditOpen && selectedProduct && (
                <div className="modal-overlay">
                    <div className="modal" style={{ maxWidth: '400px' }}>
                        <form onSubmit={handleEditSubmit}>
                            <div className="modal-header">
                                <h3 className="modal-title text-lg">Editar Produto</h3>
                            </div>
                            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                                <p className="text-muted text-sm">Edite o nome do produto ou exclua o produto.</p>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    placeholder="Nome do produto"
                                    autoFocus
                                    required
                                    style={{
                                        width: '100%',
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--color-border)',
                                        backgroundColor: 'var(--color-bg)',
                                        color: 'var(--color-text)',
                                    }}
                                />
                            </div>
                            <div className="modal-footer flex justify-between gap-2 p-4 pt-0 border-t-0" style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                <button
                                    type="button"
                                    onClick={handleDeleteProduct}
                                    className="btn btn-secondary"
                                    style={{ color: 'var(--error, #dc2626)', borderColor: 'var(--error, #dc2626)' }}
                                    disabled={isDeleting}
                                >
                                    {isDeleting ? 'Excluindo...' : 'Excluir Produto'}
                                </button>
                                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                    <button type="button" onClick={() => setIsEditOpen(false)} className="btn btn-secondary">
                                        Cancelar
                                    </button>
                                    <button type="submit" className="btn btn-primary">
                                        Salvar
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
