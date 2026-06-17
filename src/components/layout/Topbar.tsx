// ========================================
// Topbar Component
// ========================================

import { Search } from 'lucide-react';
import { useLocation } from 'react-router-dom';

interface TopbarProps {
    onCreateClick?: () => void;
}

const PAGE_TITLES: Record<string, string> = {
    '/produtos': 'Produtos',
    '/testes': 'Testes',
    '/configuracoes': 'Configurações',
};

export default function Topbar({ onCreateClick: _ }: TopbarProps) {
    const location = useLocation();

    const currentPath = location.pathname;
    const pageTitle = PAGE_TITLES[currentPath] || 'Agentes de IA';

    return (
        <header className="topbar">
            <div className="flex items-center gap-4">
                <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600 }}>
                    {pageTitle}
                </h1>
            </div>

            <div className="topbar-actions">
                {/* Search */}
                <div className="topbar-search">
                    <Search size={18} style={{ color: 'var(--color-text-muted)' }} />
                    <input type="text" placeholder="Buscar..." />
                </div>
            </div>
        </header>
    );
}
