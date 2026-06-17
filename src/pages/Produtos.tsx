import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProduct } from '../contexts/ProductContext';
import { Layers, ArrowRight, Plus } from 'lucide-react';
import { InputModal } from '../components/ui/InputModal';

export default function Produtos() {
    const { products, loading, addProduct, refreshProducts } = useProduct();
    const [isCreateOpen, setIsCreateOpen] = useState(false);

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
                        Seus Produtos
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
                                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--spacing-xs)', color: 'var(--color-text)' }}>
                                    {product.name}
                                </h3>
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
        </div>
    );
}
