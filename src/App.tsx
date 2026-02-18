// ========================================
// Main App - Routes & Providers
// ========================================

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ProductProvider } from './contexts/ProductContext';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Atendimento from './pages/Atendimento';
import Funis from './pages/Funis';
import FunilDetalhe from './pages/FunilDetalhe';
import FlowchartEditor from './pages/FlowchartEditor';
import Objecoes from './pages/Objecoes';
import Casos from './pages/Casos';
import ImportFunnel from './pages/ImportFunnel';
import './index.css';

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

// Owner Only Route
function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { isOwner, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-page" style={{ minHeight: '100vh' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!isOwner) {
    return <Navigate to="/" replace />;
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
        <Route index element={<Dashboard />} />
        <Route path="atendimento" element={<Atendimento />} />
        <Route path="funis" element={<Funis />} />
        <Route path="funis/importar" element={<OwnerRoute><ImportFunnel /></OwnerRoute>} />
        <Route path="funis/:id" element={<FunilDetalhe />} />
        <Route
          path="flowchart/:id"
          element={
            <OwnerRoute>
              <FlowchartEditor />
            </OwnerRoute>
          }
        />
        <Route
          path="objecoes"
          element={
            <OwnerRoute>
              <Objecoes />
            </OwnerRoute>
          }
        />
        <Route path="casos" element={<Casos />} />
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
