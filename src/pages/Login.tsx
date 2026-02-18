// ========================================
// Login Page
// ========================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
    const navigate = useNavigate();
    const { signIn, signUp, loading, error } = useAuth();

    const [isRegistering, setIsRegistering] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [localError, setLocalError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError('');

        if (!email || !password) {
            setLocalError('Preencha todos os campos');
            return;
        }

        if (isRegistering) {
            if (!name.trim()) {
                setLocalError('Informe seu nome');
                return;
            }
            if (password !== confirmPassword) {
                setLocalError('As senhas não coincidem');
                return;
            }
            if (password.length < 6) {
                setLocalError('A senha deve ter pelo menos 6 caracteres');
                return;
            }

            try {
                await signUp(email, password, name);
                navigate('/');
            } catch (err) {
                // Error is already set in context
            }
        } else {
            try {
                await signIn(email, password);
                navigate('/');
            } catch (err) {
                // Error is already set in context
            }
        }
    };

    const toggleMode = () => {
        setIsRegistering(!isRegistering);
        setLocalError('');
        setName('');
        setPassword('');
        setConfirmPassword('');
    };

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo">M</div>
                    <h1 className="login-title">Mentor de Vendas</h1>
                    <p className="login-subtitle">Ekoa - Sistema de Vendas Inteligente</p>
                </div>

                <form onSubmit={handleSubmit}>
                    {isRegistering && (
                        <div className="form-group">
                            <label className="form-label">Nome</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Seu nome completo"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label">Email</label>
                        <input
                            type="email"
                            className="form-input"
                            placeholder="seu@email.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Senha</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="form-input"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                style={{ paddingRight: '44px' }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--color-text-muted)',
                                    cursor: 'pointer',
                                }}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    {isRegistering && (
                        <div className="form-group">
                            <label className="form-label">Confirmar Senha</label>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="form-input"
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                        </div>
                    )}

                    {(localError || error) && (
                        <div className="form-error mb-4">{localError || error}</div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary w-full"
                        disabled={loading}
                    >
                        {loading ? (
                            <div className="loading-spinner" style={{ width: 20, height: 20 }} />
                        ) : isRegistering ? (
                            <>
                                <UserPlus size={18} />
                                Criar Conta
                            </>
                        ) : (
                            <>
                                <LogIn size={18} />
                                Entrar
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <button
                        type="button"
                        onClick={toggleMode}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-primary)',
                            cursor: 'pointer',
                            fontSize: 'var(--text-sm)',
                            textDecoration: 'underline',
                        }}
                    >
                        {isRegistering
                            ? 'Já tenho conta. Fazer login'
                            : 'Não tenho conta. Criar agora'}
                    </button>
                </div>
            </div>
        </div>
    );
}
