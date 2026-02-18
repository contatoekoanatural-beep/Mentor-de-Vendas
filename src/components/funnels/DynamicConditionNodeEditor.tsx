// ========================================
// Dynamic Condition Node Editor Component
// ========================================
// Editor visual para nós de condição dinâmica

import { useState } from 'react';
import { Plus, Trash2, Save, ArrowRight, GitBranch, AlertCircle } from 'lucide-react';
import type {
    DynamicConditionNode,
    ConditionRule,
    ConditionAction,
    ConditionOperator,
    ConditionVariable,
    Funnel,
} from '../../types';
import {
    CONDITION_OPERATOR_LABELS,
    PREDEFINED_VARIABLES
} from '../../types';
import { describeCondition } from '../../services/ConditionEvaluator';
import { v4 as uuidv4 } from 'uuid';

interface DynamicConditionNodeEditorProps {
    node?: DynamicConditionNode;
    funnels: Funnel[];
    flowchartNodes: { id: string; title: string }[];
    productId: string;
    funnelId?: string;
    onSave: (node: Omit<DynamicConditionNode, 'id' | 'createdAt' | 'updatedAt'>) => void;
    onCancel: () => void;
}

// Ação padrão inicial
const defaultAction: ConditionAction = {
    type: 'goto_node',
    targetNodeId: '',
    targetFunnelId: null,
};

// Variável padrão inicial
const defaultVariable: ConditionVariable = {
    name: '',
    template: '',
    type: 'string',
    source: 'lead_data',
};

export default function DynamicConditionNodeEditor({
    node,
    funnels,
    flowchartNodes,
    productId,
    funnelId,
    onSave,
    onCancel,
}: DynamicConditionNodeEditorProps) {
    const [name, setName] = useState(node?.name || '');
    const [description, setDescription] = useState(node?.description || '');
    const [variable, setVariable] = useState<ConditionVariable>(
        node?.variable || defaultVariable
    );
    const [conditions, setConditions] = useState<ConditionRule[]>(
        node?.conditions || []
    );
    const [defaultActionState, setDefaultActionState] = useState<ConditionAction>(
        node?.defaultAction || defaultAction
    );
    const [showCustomVariable, setShowCustomVariable] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Atualiza variável quando selecionada da lista
    const handleVariableSelect = (varName: string) => {
        if (varName === 'custom') {
            setShowCustomVariable(true);
            setVariable(defaultVariable);
        } else {
            setShowCustomVariable(false);
            const predefined = PREDEFINED_VARIABLES.find(v => v.name === varName);
            if (predefined) {
                setVariable(predefined);
            }
        }
    };

    // Adiciona nova condição
    const addCondition = () => {
        const newCondition: ConditionRule = {
            id: uuidv4(),
            operator: 'equals',
            value: '',
            priority: conditions.length + 1,
            action: { ...defaultAction },
        };
        setConditions([...conditions, newCondition]);
    };

    // Remove condição
    const removeCondition = (id: string) => {
        setConditions(conditions.filter(c => c.id !== id));
    };

    // Atualiza condição
    const updateCondition = (id: string, updates: Partial<ConditionRule>) => {
        setConditions(conditions.map(c =>
            c.id === id ? { ...c, ...updates } : c
        ));
    };

    // Atualiza ação de uma condição
    const updateConditionAction = (
        conditionId: string,
        actionUpdates: Partial<ConditionAction>
    ) => {
        setConditions(conditions.map(c =>
            c.id === conditionId
                ? { ...c, action: { ...c.action, ...actionUpdates } }
                : c
        ));
    };

    // Valida e salva
    const handleSave = () => {
        setError(null);

        // Validações
        if (!name.trim()) {
            setError('Nome é obrigatório');
            return;
        }

        if (!variable.name || !variable.template) {
            setError('Selecione ou defina uma variável');
            return;
        }

        if (conditions.length === 0) {
            setError('Adicione pelo menos uma condição');
            return;
        }

        // Monta o nó
        const nodeData: Omit<DynamicConditionNode, 'id' | 'createdAt' | 'updatedAt'> = {
            name,
            description: description || undefined,
            productId,
            funnelId,
            variable,
            conditions,
            defaultAction: defaultActionState,
        };

        onSave(nodeData);
    };

    return (
        <div className="dynamic-condition-editor">
            {/* Header */}
            <div className="flex items-center gap-2 mb-4">
                <GitBranch size={20} className="text-primary" />
                <h3 style={{ margin: 0 }}>
                    {node ? 'Editar' : 'Novo'} Nó de Condição Dinâmica
                </h3>
            </div>

            {error && (
                <div className="alert alert-error mb-4 flex items-center gap-2">
                    <AlertCircle size={16} />
                    {error}
                </div>
            )}

            {/* Nome e Descrição */}
            <div className="form-group">
                <label className="form-label">Nome do Nó *</label>
                <input
                    type="text"
                    className="form-input"
                    placeholder="Ex: Verificação de Cobertura CEP"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>

            <div className="form-group">
                <label className="form-label">Descrição</label>
                <textarea
                    className="form-input"
                    placeholder="Descreva o propósito desta condição..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                />
            </div>

            {/* Seleção de Variável */}
            <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                <h4 style={{ margin: '0 0 var(--space-3) 0', fontSize: 'var(--text-sm)' }}>
                    📊 Variável a Avaliar
                </h4>

                <div className="form-group">
                    <label className="form-label">Selecione a Variável</label>
                    <select
                        className="form-select"
                        value={showCustomVariable ? 'custom' : variable.name}
                        onChange={(e) => handleVariableSelect(e.target.value)}
                    >
                        <option value="">-- Selecione --</option>
                        {PREDEFINED_VARIABLES.map(v => (
                            <option key={v.name} value={v.name}>
                                {v.template} - {v.description}
                            </option>
                        ))}
                        <option value="custom">+ Variável Personalizada</option>
                    </select>
                </div>

                {showCustomVariable && (
                    <>
                        <div className="form-group">
                            <label className="form-label">Nome da Variável</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="minha_variavel"
                                value={variable.name}
                                onChange={(e) => setVariable({
                                    ...variable,
                                    name: e.target.value,
                                    template: `{{${e.target.value}}}`,
                                })}
                            />
                            <span className="text-muted text-xs">
                                Template: {variable.template || '{{...}}'}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="form-group">
                                <label className="form-label">Tipo</label>
                                <select
                                    className="form-select"
                                    value={variable.type}
                                    onChange={(e) => setVariable({
                                        ...variable,
                                        type: e.target.value as ConditionVariable['type'],
                                    })}
                                >
                                    <option value="string">Texto</option>
                                    <option value="number">Número</option>
                                    <option value="boolean">Booleano</option>
                                    <option value="array">Lista</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Fonte</label>
                                <select
                                    className="form-select"
                                    value={variable.source}
                                    onChange={(e) => setVariable({
                                        ...variable,
                                        source: e.target.value as ConditionVariable['source'],
                                    })}
                                >
                                    <option value="lead_data">Dados do Lead</option>
                                    <option value="form_input">Entrada de Formulário</option>
                                    <option value="api_response">Resposta de API</option>
                                    <option value="custom">Personalizado</option>
                                </select>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Condições */}
            <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                <div className="flex items-center justify-between mb-3">
                    <h4 style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
                        🔀 Condições (SE/ENTÃO)
                    </h4>
                    <button className="btn btn-sm btn-secondary" onClick={addCondition}>
                        <Plus size={14} /> Adicionar
                    </button>
                </div>

                {conditions.length === 0 ? (
                    <p className="text-muted text-sm">
                        Nenhuma condição definida. Clique em "Adicionar" para criar.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {conditions.map((cond, index) => (
                            <div
                                key={cond.id}
                                className="card"
                                style={{
                                    padding: 'var(--space-3)',
                                    background: 'var(--color-bg-tertiary)',
                                }}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="badge badge-primary">
                                        Condição #{index + 1}
                                    </span>
                                    <button
                                        className="btn btn-sm"
                                        style={{ color: 'var(--color-error)' }}
                                        onClick={() => removeCondition(cond.id)}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>

                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    <div className="form-group">
                                        <label className="form-label text-xs">Operador</label>
                                        <select
                                            className="form-select form-select-sm"
                                            value={cond.operator}
                                            onChange={(e) => updateCondition(cond.id, {
                                                operator: e.target.value as ConditionOperator,
                                            })}
                                        >
                                            {Object.entries(CONDITION_OPERATOR_LABELS).map(([op, label]) => (
                                                <option key={op} value={op}>{label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label text-xs">Valor</label>
                                        <input
                                            type="text"
                                            className="form-input form-input-sm"
                                            placeholder="Ex: true, sim, SP"
                                            value={String(cond.value)}
                                            onChange={(e) => updateCondition(cond.id, {
                                                value: e.target.value,
                                            })}
                                            disabled={cond.operator === 'is_empty' || cond.operator === 'is_not_empty'}
                                        />
                                    </div>
                                </div>

                                {/* Preview da condição */}
                                <div className="text-xs text-muted mb-2" style={{ fontStyle: 'italic' }}>
                                    {variable.name && describeCondition(variable.name, cond.operator, cond.value)}
                                </div>

                                {/* Ação ENTÃO */}
                                <div className="flex items-center gap-2">
                                    <ArrowRight size={14} className="text-success" />
                                    <span className="text-xs font-medium">ENTÃO:</span>

                                    <select
                                        className="form-select form-select-sm"
                                        style={{ flex: 1 }}
                                        value={cond.action.type}
                                        onChange={(e) => updateConditionAction(cond.id, {
                                            type: e.target.value as ConditionAction['type'],
                                        })}
                                    >
                                        <option value="goto_node">Ir para Nó</option>
                                        <option value="goto_funnel">Ir para Funil (Handover)</option>
                                        <option value="end_journey">Finalizar Jornada</option>
                                    </select>

                                    {cond.action.type === 'goto_node' && (
                                        <select
                                            className="form-select form-select-sm"
                                            style={{ flex: 1 }}
                                            value={cond.action.targetNodeId || ''}
                                            onChange={(e) => updateConditionAction(cond.id, {
                                                targetNodeId: e.target.value,
                                            })}
                                        >
                                            <option value="">-- Selecione o Nó --</option>
                                            {flowchartNodes.map(n => (
                                                <option key={n.id} value={n.id}>{n.title}</option>
                                            ))}
                                        </select>
                                    )}

                                    {cond.action.type === 'goto_funnel' && (
                                        <select
                                            className="form-select form-select-sm"
                                            style={{ flex: 1 }}
                                            value={cond.action.targetFunnelId || ''}
                                            onChange={(e) => updateConditionAction(cond.id, {
                                                targetFunnelId: e.target.value,
                                                handover: {
                                                    preserveHistory: true,
                                                    transferData: ['lead_id', 'contact_info', 'conversation_history'],
                                                },
                                            })}
                                        >
                                            <option value="">-- Selecione o Funil --</option>
                                            {funnels.filter(f => f.id !== funnelId).map(f => (
                                                <option key={f.id} value={f.id}>{f.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                {/* Handover config */}
                                {cond.action.type === 'goto_funnel' && cond.action.targetFunnelId && (
                                    <div className="mt-2 p-2 rounded" style={{ background: 'var(--color-bg-secondary)' }}>
                                        <span className="text-xs text-muted">
                                            ✅ Handover com preservação de histórico
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Ação Padrão (SENÃO) */}
            <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                <h4 style={{ margin: '0 0 var(--space-3) 0', fontSize: 'var(--text-sm)' }}>
                    ⚠️ Ação Padrão (SENÃO)
                </h4>
                <p className="text-muted text-xs mb-3">
                    O que acontece se nenhuma condição for verdadeira?
                </p>

                <div className="flex items-center gap-2">
                    <select
                        className="form-select"
                        style={{ flex: 1 }}
                        value={defaultActionState.type}
                        onChange={(e) => setDefaultActionState({
                            ...defaultActionState,
                            type: e.target.value as ConditionAction['type'],
                        })}
                    >
                        <option value="goto_node">Ir para Nó</option>
                        <option value="goto_funnel">Ir para Funil (Handover)</option>
                        <option value="end_journey">Finalizar Jornada</option>
                    </select>

                    {defaultActionState.type === 'goto_node' && (
                        <select
                            className="form-select"
                            style={{ flex: 1 }}
                            value={defaultActionState.targetNodeId || ''}
                            onChange={(e) => setDefaultActionState({
                                ...defaultActionState,
                                targetNodeId: e.target.value,
                            })}
                        >
                            <option value="">-- Selecione o Nó --</option>
                            {flowchartNodes.map(n => (
                                <option key={n.id} value={n.id}>{n.title}</option>
                            ))}
                        </select>
                    )}

                    {defaultActionState.type === 'goto_funnel' && (
                        <select
                            className="form-select"
                            style={{ flex: 1 }}
                            value={defaultActionState.targetFunnelId || ''}
                            onChange={(e) => setDefaultActionState({
                                ...defaultActionState,
                                targetFunnelId: e.target.value,
                                handover: {
                                    preserveHistory: true,
                                    transferData: ['lead_id', 'contact_info', 'conversation_history'],
                                },
                            })}
                        >
                            <option value="">-- Selecione o Funil --</option>
                            {funnels.filter(f => f.id !== funnelId).map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                    )}
                </div>
            </div>

            {/* Footer / Actions */}
            <div className="flex justify-end gap-2">
                <button className="btn btn-secondary" onClick={onCancel}>
                    Cancelar
                </button>
                <button className="btn btn-primary" onClick={handleSave}>
                    <Save size={14} />
                    Salvar Condição
                </button>
            </div>
        </div>
    );
}
