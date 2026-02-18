// ========================================
// Dashboard Page
// ========================================

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    GitBranch,
    FileText,
    MessageCircle,
    Briefcase,
    CheckCircle,
    AlertCircle,
    Clock,
    ArrowRight,
    Sparkles,
} from 'lucide-react';
import { useProduct } from '../contexts/ProductContext';
import { useAuth } from '../contexts/AuthContext';
import {
    getFunnels,
    getScripts,
    getObjections,
    getCases,
    getAuditLog,
} from '../services/firebase';
import type { AuditLogEntry } from '../types';

interface StatCard {
    title: string;
    value: number;
    icon: typeof GitBranch;
    color: string;
    path: string;
}

interface ChecklistItem {
    title: string;
    description: string;
    completed: boolean;
    path: string;
}

export default function Dashboard() {
    const navigate = useNavigate();
    const { activeProduct } = useProduct();
    const { user, isOwner } = useAuth();

    const [stats, setStats] = useState<StatCard[]>([]);
    const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
    const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!activeProduct) {
            setLoading(false);
            return;
        }

        const loadDashboard = async () => {
            setLoading(true);
            try {
                // Load counts from Firebase
                const funnels = await getFunnels(activeProduct.id);
                const scripts = await getScripts(activeProduct.id);
                const objections = await getObjections(activeProduct.id);
                const cases = await getCases(activeProduct.id);
                const logs = await getAuditLog();

                // Set stats
                setStats([
                    {
                        title: 'Funis',
                        value: funnels.length,
                        icon: GitBranch,
                        color: 'var(--color-info)',
                        path: '/funis',
                    },
                    {
                        title: 'Scripts',
                        value: scripts.length,
                        icon: FileText,
                        color: 'var(--color-success)',
                        path: '/scripts',
                    },
                    {
                        title: 'Objeções',
                        value: objections.length,
                        icon: MessageCircle,
                        color: 'var(--color-warning)',
                        path: '/objecoes',
                    },
                    {
                        title: 'Casos',
                        value: cases.length,
                        icon: Briefcase,
                        color: 'var(--color-error)',
                        path: '/casos',
                    },
                ]);

                // Set checklist
                setChecklist([
                    {
                        title: 'Criar funil de vendas',
                        description: 'Defina o fluxo de atendimento do produto',
                        completed: funnels.length > 0,
                        path: '/funis',
                    },
                    {
                        title: 'Montar fluxograma',
                        description: 'Visualize as etapas do processo de vendas',
                        completed: scripts.length > 0,
                        path: '/funis',
                    },
                    {
                        title: 'Adicionar scripts',
                        description: 'Crie scripts para cada etapa do funil',
                        completed: scripts.length > 0,
                        path: '/funis',
                    },
                    {
                        title: 'Cadastrar objeções',
                        description: 'Documente as objeções mais comuns dos clientes',
                        completed: objections.length > 0,
                        path: '/objecoes',
                    },
                    {
                        title: 'Registrar casos',
                        description: 'Adicione exemplos reais de atendimentos',
                        completed: cases.length > 0,
                        path: '/casos',
                    },
                ]);

                // Set audit log
                setAuditLog(logs);
            } catch (error) {
                console.error('Error loading dashboard:', error);
            }
            setLoading(false);
        };

        loadDashboard();
    }, [activeProduct]);

    if (loading) {
        return (
            <div className="loading-page">
                <div className="loading-spinner" />
                <p className="text-muted">Carregando dashboard...</p>
            </div>
        );
    }

    const completedItems = checklist.filter(item => item.completed).length;
    const progress = checklist.length > 0 ? (completedItems / checklist.length) * 100 : 0;

    return (
        <div>
            {/* Welcome Section */}
            <div className="mb-8">
                <h1 className="page-title">
                    Olá, {user?.name || 'Usuário'}! 👋
                </h1>
                <p className="text-muted">
                    Aqui está o resumo do produto <strong>{activeProduct?.name || 'Selecione um produto'}</strong>
                </p>
            </div>

            {/* Stats Grid */}
            <div className="grid mb-8" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
                {stats.map((stat) => (
                    <div
                        key={stat.title}
                        className="card card-hover"
                        style={{ padding: 'var(--space-5)', cursor: 'pointer' }}
                        onClick={() => navigate(stat.path)}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div
                                style={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: 'var(--radius-md)',
                                    background: `${stat.color}20`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <stat.icon size={22} style={{ color: stat.color }} />
                            </div>
                            <ArrowRight size={16} className="text-muted" />
                        </div>
                        <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>
                            {stat.title}
                        </p>
                        <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>
                            {stat.value}
                        </p>
                    </div>
                ))}
            </div>

            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 'var(--space-6)' }}>
                {/* Setup Checklist */}
                {isOwner && (
                    <div className="card" style={{ padding: 'var(--space-5)' }}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>
                                Checklist de Configuração
                            </h2>
                            <span className="badge badge-primary">
                                {completedItems}/{checklist.length}
                            </span>
                        </div>

                        {/* Progress Bar */}
                        <div
                            style={{
                                height: 6,
                                background: 'var(--color-bg-tertiary)',
                                borderRadius: 'var(--radius-full)',
                                marginBottom: 'var(--space-4)',
                                overflow: 'hidden',
                            }}
                        >
                            <div
                                style={{
                                    height: '100%',
                                    width: `${progress}%`,
                                    background: 'var(--color-success)',
                                    borderRadius: 'var(--radius-full)',
                                    transition: 'width 0.3s ease',
                                }}
                            />
                        </div>

                        <div className="flex flex-col gap-3">
                            {checklist.map((item, index) => (
                                <div
                                    key={index}
                                    className="flex items-start gap-3"
                                    style={{
                                        padding: 'var(--space-3)',
                                        background: item.completed ? 'var(--color-success-bg)' : 'var(--color-bg-tertiary)',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        opacity: item.completed ? 0.8 : 1,
                                    }}
                                    onClick={() => navigate(item.path)}
                                >
                                    {item.completed ? (
                                        <CheckCircle size={18} style={{ color: 'var(--color-success)', flexShrink: 0, marginTop: 2 }} />
                                    ) : (
                                        <AlertCircle size={18} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 2 }} />
                                    )}
                                    <div>
                                        <p style={{ fontWeight: 500, fontSize: 'var(--text-sm)' }}>
                                            {item.title}
                                        </p>
                                        <p className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                                            {item.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Recent Activity */}
                <div className="card" style={{ padding: 'var(--space-5)' }}>
                    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>
                        Atividade Recente
                    </h2>

                    {auditLog.length === 0 ? (
                        <div className="empty-state" style={{ padding: 'var(--space-6)' }}>
                            <Clock size={32} strokeWidth={1.5} />
                            <p className="text-muted">Nenhuma atividade recente</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {auditLog.map((log) => (
                                <div
                                    key={log.id}
                                    className="flex items-start gap-3"
                                    style={{
                                        padding: 'var(--space-3)',
                                        background: 'var(--color-bg-tertiary)',
                                        borderRadius: 'var(--radius-md)',
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: 'var(--radius-full)',
                                            background: 'var(--color-accent-primary)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            fontSize: 'var(--text-xs)',
                                            fontWeight: 600,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {log.actorName?.charAt(0).toUpperCase() || 'U'}
                                    </div>
                                    <div>
                                        <p style={{ fontSize: 'var(--text-sm)' }}>
                                            <strong>{log.actorName}</strong>{' '}
                                            {log.action === 'create' && 'criou'}
                                            {log.action === 'update' && 'atualizou'}
                                            {log.action === 'delete' && 'excluiu'}{' '}
                                            <strong>{log.entityName}</strong>
                                        </p>
                                        <p className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                                            {log.entityType}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* AI Feature Placeholder */}
                <div
                    className="card"
                    style={{
                        padding: 'var(--space-5)',
                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%)',
                        border: '1px solid rgba(139, 92, 246, 0.3)',
                    }}
                >
                    <div className="flex items-center gap-3 mb-4">
                        <Sparkles size={24} style={{ color: 'var(--color-accent-primary)' }} />
                        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>
                            IA em Breve
                        </h2>
                        <span className="badge" style={{ background: 'rgba(139, 92, 246, 0.3)', color: 'white' }}>
                            Fase 2
                        </span>
                    </div>
                    <p className="text-muted" style={{ marginBottom: 'var(--space-4)' }}>
                        Na próxima fase, a IA irá:
                    </p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {[
                            'Transcrever áudios automaticamente',
                            'Detectar objeções em tempo real',
                            'Sugerir scripts baseado no contexto',
                            'Analisar qualidade do atendimento',
                        ].map((item, i) => (
                            <li
                                key={i}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-2)',
                                    marginBottom: 'var(--space-2)',
                                    fontSize: 'var(--text-sm)',
                                }}
                            >
                                <CheckCircle size={14} style={{ color: 'var(--color-accent-primary)' }} />
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}
