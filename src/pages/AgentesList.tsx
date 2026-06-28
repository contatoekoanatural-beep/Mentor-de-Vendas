import { useParams, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getAgents, createAgent, updateAgent, deleteAgent } from '../services/firebase';
import { useProduct } from '../contexts/ProductContext';
import type { Agent } from '../types';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { InputModal } from '../components/ui/InputModal';
import { Sparkles, Trash2, Edit2, Play, ChevronLeft } from 'lucide-react';

export default function AgentesList() {
    const { productId } = useParams<{ productId: string }>();
    const { products } = useProduct();
    
    // States
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [productName, setProductName] = useState('Produto');

    // Modal Control States
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [renameAgentTarget, setRenameAgentTarget] = useState<Agent | null>(null);
    const [deleteAgentTarget, setDeleteAgentTarget] = useState<Agent | null>(null);

    const loadAgents = async () => {
        if (!productId) return;
        setLoading(true);
        try {
            // Load agents
            const data = await getAgents(productId);
            // Sort by name
            const sorted = [...data].sort((a, b) => a.name.localeCompare(b.name));
            setAgents(sorted);

            // Find product name
            const currentProduct = products.find(p => p.id === productId);
            if (currentProduct) {
                setProductName(currentProduct.name);
            }
        } catch (error) {
            console.error('Error loading agents:', error);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadAgents();
    }, [productId, products]);

    const handleCreate = async (name: string) => {
        if (!productId || !name.trim()) return;
        try {
            await createAgent({
                productId,
                name: name.trim(),
                base: ''
            });
            setIsCreateOpen(false);
            loadAgents();
        } catch (error) {
            console.error('Error creating agent:', error);
        }
    };

    const handleRename = async (newName: string) => {
        if (!renameAgentTarget || !newName.trim()) return;
        try {
            await updateAgent(renameAgentTarget.id, {
                name: newName.trim()
            });
            setRenameAgentTarget(null);
            loadAgents();
        } catch (error) {
            console.error('Error renaming agent:', error);
        }
    };

    const handleDelete = async () => {
        if (!deleteAgentTarget) return;
        try {
            await deleteAgent(deleteAgentTarget.id);
            setDeleteAgentTarget(null);
            loadAgents();
        } catch (error) {
            console.error('Error deleting agent:', error);
        }
    };

    if (loading) {
        return (
            <div className="loading-page" style={{ minHeight: '50vh' }}>
                <div className="loading-spinner" />
                <p className="text-muted">Carregando agentes...</p>
            </div>
        );
    }

    return (
        <div className="page-container" style={{ padding: 'var(--spacing-lg)' }}>
            {/* Breadcrumb / Back button */}
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                <Link to="/produtos" className="flex items-center gap-1 text-muted hover-text" style={{ textDecoration: 'none', display: 'inline-flex' }}>
                    <ChevronLeft size={16} />
                    <span className="text-sm">Voltar para Agentes</span>
                </Link>
            </div>

            {/* Header */}
            <div className="flex justify-between items-center mb-6" style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div>
                    <span className="badge badge-info" style={{ marginBottom: 'var(--spacing-xs)' }}>{productName}</span>
                    <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--color-text)' }}>
                        Agentes de IA
                    </h2>
                    <p className="text-muted text-sm">
                        Crie e treine os agentes de IA responsáveis pelo atendimento e conversão deste produto.
                    </p>
                </div>
                <button className="btn btn-primary" onClick={() => setIsCreateOpen(true)}>
                    Novo Agente
                </button>
            </div>

            {/* List */}
            {agents.length === 0 ? (
                <div className="card" style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>
                    <Sparkles size={48} style={{ margin: '0 auto var(--spacing-md) auto', color: 'var(--color-text-muted)' }} />
                    <h3 style={{ marginBottom: 'var(--spacing-sm)' }}>Nenhum agente cadastrado</h3>
                    <p className="text-muted" style={{ marginBottom: 'var(--spacing-md)' }}>
                        Crie seu primeiro agente de IA para começar o treinamento do produto.
                    </p>
                    <button className="btn btn-primary" onClick={() => setIsCreateOpen(true)} style={{ margin: '0 auto' }}>
                        Criar Agente
                    </button>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                    {agents.map((agent) => (
                        <div key={agent.id} className="card" style={{
                            padding: 'var(--spacing-md) var(--spacing-lg)',
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 'var(--spacing-md)'
                        }}>
                            <div className="flex items-center gap-3">
                                <div style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '50%',
                                    backgroundColor: 'var(--color-bg-alt)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--color-info)'
                                }}>
                                    <Sparkles size={20} />
                                </div>
                                <div>
                                    <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--color-text)' }}>
                                        {agent.name}
                                    </h3>
                                    <p className="text-muted text-xs">
                                        Atualizado em: {agent.updatedAt ? new Date(agent.updatedAt instanceof Date ? agent.updatedAt : (agent.updatedAt as any).toDate?.() || agent.updatedAt).toLocaleDateString('pt-BR') : 'Recentemente'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <Link
                                    to={`/produtos/${productId}/agentes/${agent.id}`}
                                    className="btn btn-secondary flex items-center gap-1 btn-sm"
                                >
                                    <Play size={14} />
                                    <span>Abrir</span>
                                </Link>
                                <button
                                    onClick={() => setRenameAgentTarget(agent)}
                                    className="btn btn-ghost btn-icon btn-sm"
                                    title="Renomear Agente"
                                >
                                    <Edit2 size={16} />
                                </button>
                                <button
                                    onClick={() => setDeleteAgentTarget(agent)}
                                    className="btn btn-ghost btn-icon btn-sm text-red-500 hover-bg-red"
                                    title="Excluir Agente"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modais */}
            <InputModal
                isOpen={isCreateOpen}
                title="Novo Agente de IA"
                message="Insira o nome do novo agente para este produto."
                placeholder="Ex: Assistente de Vendas WhatsApp"
                onConfirm={handleCreate}
                onCancel={() => setIsCreateOpen(false)}
            />

            <InputModal
                isOpen={renameAgentTarget !== null}
                title="Renomear Agente"
                message={`Insira o novo nome para o agente "${renameAgentTarget?.name}".`}
                initialValue={renameAgentTarget?.name}
                onConfirm={handleRename}
                onCancel={() => setRenameAgentTarget(null)}
            />

            <ConfirmModal
                isOpen={deleteAgentTarget !== null}
                title="Excluir Agente de IA"
                message={`Tem certeza que deseja excluir o agente "${deleteAgentTarget?.name}"? Esta ação é permanente e apagará toda a base de treinamento associada.`}
                onConfirm={handleDelete}
                onCancel={() => setDeleteAgentTarget(null)}
                confirmText="Excluir"
                isDestructive={true}
            />
        </div>
    );
}
