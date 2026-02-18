// ========================================
// Product Selector Component
// ========================================

import React, { useState } from 'react';
import { ChevronDown, Check, Plus } from 'lucide-react';
import { useProduct } from '../../contexts/ProductContext';
import { useAuth } from '../../contexts/AuthContext';

export default function ProductSelector() {
    const { products, activeProduct, setActiveProduct, addProduct, loading } = useProduct();
    const { isOwner } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [newProductName, setNewProductName] = useState('');

    const handleSelect = (product: typeof products[0]) => {
        setActiveProduct(product);
        setIsOpen(false);
    };

    const handleAddProduct = async () => {
        if (!newProductName.trim()) return;

        try {
            await addProduct(newProductName.trim());
            setNewProductName('');
            setIsAdding(false);
        } catch (error) {
            console.error('Error adding product:', error);
        }
    };

    if (loading) {
        return (
            <div className="product-selector">
                <div className="product-selector-label">Produto</div>
                <div className="product-selector-button">
                    <span className="text-muted">Carregando...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="product-selector">
            <div className="product-selector-label">Produto Ativo</div>

            <div className="dropdown">
                <button
                    className="product-selector-button"
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <span>{activeProduct?.name || 'Selecionar produto'}</span>
                    <ChevronDown size={16} />
                </button>

                {isOpen && (
                    <div className="dropdown-menu" style={{ bottom: '100%', top: 'auto', marginBottom: '4px' }}>
                        {products.map((product) => (
                            <div
                                key={product.id}
                                className="dropdown-item"
                                onClick={() => handleSelect(product)}
                            >
                                {activeProduct?.id === product.id && <Check size={16} />}
                                <span>{product.name}</span>
                            </div>
                        ))}

                        {products.length === 0 && !isAdding && (
                            <div className="dropdown-item" style={{ color: 'var(--color-text-muted)', cursor: 'default' }}>
                                Nenhum produto cadastrado
                            </div>
                        )}

                        {isOwner && (
                            <>
                                <div className="dropdown-divider" />

                                {isAdding ? (
                                    <div style={{ padding: 'var(--space-2)' }}>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Nome do produto"
                                            value={newProductName}
                                            onChange={(e) => setNewProductName(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleAddProduct()}
                                            autoFocus
                                        />
                                        <div className="flex gap-2 mt-2">
                                            <button
                                                className="btn btn-primary btn-sm w-full"
                                                onClick={handleAddProduct}
                                            >
                                                Adicionar
                                            </button>
                                            <button
                                                className="btn btn-secondary btn-sm w-full"
                                                onClick={() => {
                                                    setIsAdding(false);
                                                    setNewProductName('');
                                                }}
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div
                                        className="dropdown-item"
                                        onClick={() => setIsAdding(true)}
                                    >
                                        <Plus size={16} />
                                        <span>Novo produto</span>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
