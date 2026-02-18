// ========================================
// Main Layout Component
// ========================================

import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function Layout() {
    const [showCreateModal, setShowCreateModal] = useState(false);

    return (
        <div className="app-layout">
            <Sidebar />
            <main className="main-content">
                <Topbar onCreateClick={() => setShowCreateModal(true)} />
                <div className="page-content">
                    <Outlet context={{ showCreateModal, setShowCreateModal }} />
                </div>
            </main>
        </div>
    );
}

// Hook to access layout context from child pages
export function useLayoutContext() {
    const context = React.useContext(React.createContext({
        showCreateModal: false,
        setShowCreateModal: (value: boolean) => { }
    }));
    return context;
}
