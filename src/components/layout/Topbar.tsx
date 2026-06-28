// ========================================
// Topbar Component
// ========================================

import { useLocation } from 'react-router-dom';

interface TopbarProps {
    onCreateClick?: () => void;
}

const PAGE_TITLES: Record<string, string> = {
    '/produtos': 'Agentes',
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

        </header>
    );
}
