// ========================================
// Condition Evaluator Service
// ========================================
// Avalia condições dinâmicas e determina a ação a ser executada

import type {
    DynamicConditionNode,
    ConditionRule,
    ConditionAction,
    ConditionOperator,
} from '../types';

/**
 * Contexto de variáveis para avaliação
 * Mapa de nome da variável -> valor
 */
export type VariableContext = Record<string, string | number | boolean | string[] | null | undefined>;

/**
 * Resultado da avaliação de uma condição
 */
export interface EvaluationResult {
    matched: boolean;
    matchedRule: ConditionRule | null;
    action: ConditionAction;
    variableValue: unknown;
    debug?: string;
}

/**
 * Extrai o nome da variável de um template {{variavel}}
 */
export function extractVariableName(template: string): string {
    const match = template.match(/\{\{(.+?)\}\}/);
    return match ? match[1].trim() : template;
}

/**
 * Resolve o valor de uma variável do contexto
 */
export function resolveVariable(
    template: string,
    context: VariableContext
): unknown {
    const varName = extractVariableName(template);
    return context[varName];
}

/**
 * Compara dois valores usando o operador especificado
 */
export function evaluateOperator(
    operator: ConditionOperator,
    actualValue: unknown,
    expectedValue: unknown
): boolean {
    // Normaliza valores nulos/undefined
    const actual = actualValue ?? '';
    const expected = expectedValue ?? '';

    switch (operator) {
        case 'equals':
            return String(actual).toLowerCase() === String(expected).toLowerCase();

        case 'not_equals':
            return String(actual).toLowerCase() !== String(expected).toLowerCase();

        case 'contains':
            return String(actual).toLowerCase().includes(String(expected).toLowerCase());

        case 'not_contains':
            return !String(actual).toLowerCase().includes(String(expected).toLowerCase());

        case 'greater_than':
            return Number(actual) > Number(expected);

        case 'less_than':
            return Number(actual) < Number(expected);

        case 'greater_or_equal':
            return Number(actual) >= Number(expected);

        case 'less_or_equal':
            return Number(actual) <= Number(expected);

        case 'is_empty':
            if (Array.isArray(actual)) return actual.length === 0;
            return actual === '' || actual === null || actual === undefined;

        case 'is_not_empty':
            if (Array.isArray(actual)) return actual.length > 0;
            return actual !== '' && actual !== null && actual !== undefined;

        case 'matches_regex':
            try {
                const regex = new RegExp(String(expected), 'i');
                return regex.test(String(actual));
            } catch {
                return false;
            }

        case 'in_list':
            const list = Array.isArray(expected) ? expected : String(expected).split(',').map(s => s.trim());
            return list.some(item => String(item).toLowerCase() === String(actual).toLowerCase());

        case 'not_in_list':
            const notList = Array.isArray(expected) ? expected : String(expected).split(',').map(s => s.trim());
            return !notList.some(item => String(item).toLowerCase() === String(actual).toLowerCase());

        default:
            return false;
    }
}

/**
 * Avalia um nó de condição dinâmica e retorna a ação a ser executada
 */
export function evaluateConditionNode(
    node: DynamicConditionNode,
    context: VariableContext
): EvaluationResult {
    // Resolve o valor da variável
    const variableValue = resolveVariable(node.variable.template, context);

    // Ordena condições por prioridade (menor = primeiro)
    const sortedConditions = [...node.conditions].sort((a, b) => a.priority - b.priority);

    // Avalia cada condição em ordem de prioridade
    for (const rule of sortedConditions) {
        const matched = evaluateOperator(rule.operator, variableValue, rule.value);

        if (matched) {
            return {
                matched: true,
                matchedRule: rule,
                action: rule.action,
                variableValue,
                debug: `Condição "${node.variable.name} ${rule.operator} ${rule.value}" = TRUE`,
            };
        }
    }

    // Nenhuma condição correspondeu, usa ação padrão (SENÃO)
    return {
        matched: false,
        matchedRule: null,
        action: node.defaultAction,
        variableValue,
        debug: `Nenhuma condição correspondeu. Usando ação padrão (SENÃO).`,
    };
}

/**
 * Interface para o resultado do handover
 */
export interface HandoverData {
    leadId: string;
    fromFunnelId: string;
    toFunnelId: string;
    reason: string;
    timestamp: string;
    preservedData: Record<string, unknown>;
}

/**
 * Prepara os dados para handover entre funis
 */
export function prepareHandover(
    action: ConditionAction,
    leadData: Record<string, unknown>,
    fromFunnelId: string
): HandoverData | null {
    if (action.type !== 'goto_funnel' || !action.targetFunnelId) {
        return null;
    }

    const handoverConfig = action.handover;
    const preservedData: Record<string, unknown> = {};

    if (handoverConfig?.preserveHistory) {
        // Transfere campos especificados
        const fieldsToTransfer = handoverConfig.transferData || [];
        for (const field of fieldsToTransfer) {
            if (field in leadData) {
                preservedData[field] = leadData[field];
            }
        }
    }

    return {
        leadId: String(leadData.id || leadData.leadId || ''),
        fromFunnelId,
        toFunnelId: action.targetFunnelId,
        reason: handoverConfig?.addNote || 'Transferência automática por condição',
        timestamp: new Date().toISOString(),
        preservedData,
    };
}

/**
 * Valida se uma expressão de variável é válida
 */
export function isValidVariableTemplate(template: string): boolean {
    return /^\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}$/.test(template);
}

/**
 * Gera uma descrição legível da condição
 */
export function describeCondition(
    variableName: string,
    operator: ConditionOperator,
    value: unknown
): string {
    const operatorLabels: Record<ConditionOperator, string> = {
        equals: 'for igual a',
        not_equals: 'for diferente de',
        contains: 'contiver',
        not_contains: 'não contiver',
        greater_than: 'for maior que',
        less_than: 'for menor que',
        greater_or_equal: 'for maior ou igual a',
        less_or_equal: 'for menor ou igual a',
        is_empty: 'estiver vazio',
        is_not_empty: 'não estiver vazio',
        matches_regex: 'corresponder a',
        in_list: 'estiver na lista',
        not_in_list: 'não estiver na lista',
    };

    const valueStr = Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
    const opLabel = operatorLabels[operator] || operator;

    if (operator === 'is_empty' || operator === 'is_not_empty') {
        return `SE {{${variableName}}} ${opLabel}`;
    }

    return `SE {{${variableName}}} ${opLabel} "${valueStr}"`;
}
