// ========================================
// Main App - Routes & Providers
// ========================================

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ProductProvider } from './contexts/ProductContext';
import { loadGeminiKey } from './services/aiService';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Produtos from './pages/Produtos';
import AgentesList from './pages/AgentesList';
import AgenteDetalhe from './pages/AgenteDetalhe';
import Conversas from './pages/Conversas';
import Configuracoes from './pages/Configuracoes';
import Equipe from './pages/Equipe';
import './index.css';

// Load Gemini API key from Firestore on app start
loadGeminiKey();

// Protected Route Component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-page" style={{ minHeight: '100vh' }}>
        <div className="loading-spinner" />
        <p className="text-muted">Carregando...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Rotas só do dono (Agentes, Configurações, Equipe). O vendedor que digitar a
// URL na mão é mandado para as Conversas — não basta esconder o menu.
function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { isOwner } = useAuth();
  if (!isOwner) {
    return <Navigate to="/conversas" replace />;
  }
  return <>{children}</>;
}


// App Routes
function AppRoutes() {
  const { user, isOwner } = useAuth();

  return (
    <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login />}
      />

      {/* Protected Routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <ProductProvider>
              <Layout />
            </ProductProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to={isOwner ? '/produtos' : '/conversas'} replace />} />
        <Route path="produtos" element={<OwnerRoute><Produtos /></OwnerRoute>} />
        <Route path="produtos/:productId/agentes" element={<OwnerRoute><AgentesList /></OwnerRoute>} />
        <Route path="produtos/:productId/agentes/:agentId" element={<OwnerRoute><AgenteDetalhe /></OwnerRoute>} />
        <Route path="conversas" element={<Conversas />} />
        <Route path="configuracoes" element={<OwnerRoute><Configuracoes /></OwnerRoute>} />
        <Route path="equipe" element={<OwnerRoute><Equipe /></OwnerRoute>} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Main App Component
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
