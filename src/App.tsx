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
import Testes from './pages/Testes';
import Configuracoes from './pages/Configuracoes';
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


// App Routes
function AppRoutes() {
  const { user } = useAuth();

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
        <Route index element={<Navigate to="/produtos" replace />} />
        <Route path="produtos" element={<Produtos />} />
        <Route path="produtos/:productId/agentes" element={<AgentesList />} />
        <Route path="produtos/:productId/agentes/:agentId" element={<AgenteDetalhe />} />
        <Route path="testes" element={<Testes />} />
        <Route path="configuracoes" element={<Configuracoes />} />
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
