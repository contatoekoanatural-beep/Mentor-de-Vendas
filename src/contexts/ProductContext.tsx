// ========================================
// Product Context - Gerenciamento de Produtos
// ========================================

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Product } from '../types';
import {
    getProducts,
    createProduct,
    updateProduct,
} from '../services/firebase';

interface ProductContextType {
    products: Product[];
    activeProduct: Product | null;
    loading: boolean;
    setActiveProduct: (product: Product) => void;
    addProduct: (name: string, description?: string) => Promise<Product>;
    editProduct: (id: string, data: Partial<Product>) => void;
    refreshProducts: () => void;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

export function ProductProvider({ children }: { children: ReactNode }) {
    const [products, setProducts] = useState<Product[]>([]);
    const [activeProduct, setActiveProductState] = useState<Product | null>(null);
    const [loading, setLoading] = useState(true);

    // Load products on mount
    useEffect(() => {
        const loadProducts = async () => {
            setLoading(true);
            try {
                // Get products from Firebase
                const data = await getProducts();
                setProducts(data);

                // Try to restore active product from localStorage
                const savedActiveId = localStorage.getItem('activeProductId');
                if (savedActiveId) {
                    const saved = data.find(p => p.id === savedActiveId);
                    if (saved) {
                        setActiveProductState(saved);
                    } else if (data.length > 0) {
                        setActiveProductState(data[0]);
                    }
                } else if (data.length > 0) {
                    setActiveProductState(data[0]);
                }
            } catch (error) {
                console.error('Error loading products:', error);
            }
            setLoading(false);
        };

        loadProducts();
    }, []);

    const setActiveProduct = (product: Product) => {
        setActiveProductState(product);
        localStorage.setItem('activeProductId', product.id);
    };

    const refreshProducts = async () => {
        const data = await getProducts();
        setProducts(data);

        // Update active product if it was modified
        if (activeProduct) {
            const updated = data.find(p => p.id === activeProduct.id);
            if (updated) {
                setActiveProductState(updated);
            }
        }
    };

    const addProduct = async (name: string, description?: string): Promise<Product> => {
        // Create in Firebase (returns ID)
        const id = await createProduct({
            name,
            description: description || '',
            status: 'active',
            ownerId: 'owner-1', // TODO: Use actual user ID
        });

        // Re-construct the product object to update local state immediately
        const newProduct: Product = {
            id,
            name,
            description: description || '',
            status: 'active',
            ownerId: 'owner-1',
            createdAt: {} as any, // Timestamp placeholder
            updatedAt: {} as any
        };

        setProducts(prev => [...prev, newProduct]);

        // If this is the first product, set it as active
        if (products.length === 0) {
            setActiveProduct(newProduct);
        }

        return newProduct;
    };

    const editProduct = async (id: string, data: Partial<Product>) => {
        await updateProduct(id, data);

        // Refresh to get latest state or update locally
        setProducts(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
        if (activeProduct?.id === id) {
            setActiveProductState(prev => prev ? { ...prev, ...data } : null);
        }
    };

    const value: ProductContextType = {
        products,
        activeProduct,
        loading,
        setActiveProduct,
        addProduct,
        editProduct,
        refreshProducts,
    };

    return (
        <ProductContext.Provider value={value}>
            {children}
        </ProductContext.Provider>
    );
}

export function useProduct() {
    const context = useContext(ProductContext);
    if (context === undefined) {
        throw new Error('useProduct must be used within a ProductProvider');
    }
    return context;
}

export default ProductContext;
