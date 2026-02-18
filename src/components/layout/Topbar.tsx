// ========================================
// Topbar Component
// ========================================

import React from 'react';
import { Search, Plus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useProduct } from '../../contexts/ProductContext';
import { useAuth } from '../../contexts/AuthContext';

interface TopbarProps {
    onCreateClick?: () => void;
}

const PAGE_TITLES: Record<string, string> = {
    '/': 'Dashboard',
    '/atendimento': 'Atendimento',
    '/funis': 'Funis',
    '/casos': 'Casos',
    '/scripts': 'Scripts',
    '/objecoes': 'Objeções',
    '/configuracoes': 'Configurações',
};

const PAGES_WITH_CREATE = ['/casos', '/objecoes'];

export default function Topbar({ onCreateClick }: TopbarProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const { activeProduct } = useProduct();
    const { isOwner } = useAuth();

    const currentPath = location.pathname;
    const pageTitle = PAGE_TITLES[currentPath] || 'Mentor de Vendas';
    const showCreateButton = PAGES_WITH_CREATE.includes(currentPath) && isOwner;

    const getCreateLabel = () => {
        switch (currentPath) {
            case '/funis':
                return 'Novo Funil';
            case '/casos':
                return 'Novo Caso';
            case '/scripts':
                return 'Novo Script';
            case '/objecoes':
                return 'Nova Objeção';
            default:
                return 'Criar';
        }
    };

    return (
        <header className="topbar">
            <div className="flex items-center gap-4">
                <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600 }}>
                    {pageTitle}
                </h1>
                {activeProduct && (
                    <span className="badge badge-info">
                        {activeProduct.name}
                    </span>
                )}
            </div>

            <div className="topbar-actions">
                {/* Search */}
                <div className="topbar-search">
                    <Search size={18} style={{ color: 'var(--color-text-muted)' }} />
                    <input type="text" placeholder="Buscar..." />
                </div>

                {/* Create Button */}
                {showCreateButton && (
                    <button className="btn btn-primary" onClick={onCreateClick}>
                        <Plus size={18} />
                        {getCreateLabel()}
                    </button>
                )}
            </div>
        </header>
    );
}
