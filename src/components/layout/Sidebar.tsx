// ========================================
// Sidebar Component
// ========================================

import React from 'react';
import { NavLink } from 'react-router-dom';
import {
    LayoutDashboard,
    MessageSquare,
    GitBranch,
    FolderOpen,
    AlertCircle,
    LogOut,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import ProductSelector from './ProductSelector';

const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, ownerOnly: false },
    { path: '/atendimento', label: 'Atendimento', icon: MessageSquare, ownerOnly: false },
    { path: '/funis', label: 'Funis', icon: GitBranch, ownerOnly: false },
    { path: '/casos', label: 'Casos', icon: FolderOpen, ownerOnly: false },
    { path: '/objecoes', label: 'Objeções', icon: AlertCircle, ownerOnly: true },
];

export default function Sidebar() {
    const { user, signOut, isOwner } = useAuth();

    const handleSignOut = async () => {
        try {
            await signOut();
        } catch (error) {
            console.error('Error signing out:', error);
        }
    };

    const filteredNavItems = navItems.filter(item => !item.ownerOnly || isOwner);

    return (
        <aside className="sidebar">
            {/* Logo */}
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <div className="sidebar-logo-icon">M</div>
                    <span className="sidebar-logo-text">Mentor</span>
                </div>
            </div>

            {/* Navigation */}
            <nav className="sidebar-nav">
                {filteredNavItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    >
                        <item.icon size={20} />
                        <span>{item.label}</span>
                    </NavLink>
                ))}
            </nav>

            {/* Footer */}
            <div className="sidebar-footer">
                {/* Product Selector */}
                <ProductSelector />

                {/* User Profile */}
                <div className="user-profile">
                    <div className="user-avatar">
                        {user?.name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="user-info">
                        <div className="user-name">{user?.name || 'Usuário'}</div>
                        <div className="user-role">
                            {user?.role === 'owner' ? 'Proprietário' :
                                user?.role === 'admin' ? 'Administrador' : 'Vendedor'}
                        </div>
                    </div>
                    <button
                        className="btn btn-icon btn-ghost"
                        onClick={handleSignOut}
                        title="Sair"
                    >
                        <LogOut size={18} />
                    </button>
                </div>
            </div>
        </aside>
    );
}
