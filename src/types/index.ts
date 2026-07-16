// ========================================
// Mentor de Vendas (Ekoa) - Type Definitions
// ========================================

import { Timestamp } from 'firebase/firestore';

// ----------------------------------------
// User & Auth Types
// ----------------------------------------
export type UserRole = 'owner' | 'seller' | 'admin';

export interface User {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    createdAt: Timestamp;
}

// ----------------------------------------
// Product Types
// ----------------------------------------
export type ProductStatus = 'active' | 'inactive';

export interface Product {
    id: string;
    name: string;
    description?: string;
    status: ProductStatus;
    ownerId?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ----------------------------------------
// Funnel Types
// ----------------------------------------
export type FunnelType = 'automation' | 'closing' | 'remarketing' | 'out_of_route' | 'other';

export interface Funnel {
    id: string;
    productIds: string[];
    name: string;
    description?: string;
    type: FunnelType;
    status: 'active' | 'inactive';
    objective?: string;
    entryCriteria?: string;
    exitCriteria?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    currentGeneralFlowId?: string;
    currentDetailedFlowId?: string;
}

export const FUNNEL_TYPE_LABELS: Record<FunnelType, string> = {
    automation: 'Automação',
    closing: 'Fechamento',
    remarketing: 'Remarketing',
    out_of_route: 'Fora de Rota',
    other: 'Outro',
};

// ----------------------------------------
// Funnel Transition Types (Journey)
// ----------------------------------------
export type FunnelTransitionTrigger =
    | 'lead_responded'
    | 'no_response_24h'
    | 'no_response_48h'
    | 'objection_raised'
    | 'objection_resolved'
    | 'interest_confirmed'
    | 'purchase_completed'
    | 'lead_cooled'
    | 'lead_returned'
    | 'custom';

export interface FunnelTransition {
    id: string;
    productId: string;
    fromFunnelId: string;
    toFunnelId: string;
    trigger: FunnelTransitionTrigger;
    customTrigger?: string; // Used when trigger is 'custom'
    description?: string;
    createdAt: Timestamp;
}

export const FUNNEL_TRANSITION_LABELS: Record<FunnelTransitionTrigger, string> = {
    lead_responded: 'Lead respondeu',
    no_response_24h: 'Sem resposta 24h',
    no_response_48h: 'Sem resposta 48h',
    objection_raised: 'Demonstrou objeção',
    objection_resolved: 'Objeção resolvida',
    interest_confirmed: 'Interesse confirmado',
    purchase_completed: 'Compra realizada',
    lead_cooled: 'Lead esfriou',
    lead_returned: 'Lead voltou',
    custom: 'Personalizado',
};

// ----------------------------------------
// Flowchart Types
// ----------------------------------------
export type FlowchartNodeType = 'start' | 'step' | 'decision' | 'end' | 'note' | 'link_in' | 'link_out';
export type FlowchartScope = 'general' | 'detailed';

export interface FlowchartNode {
    nodeId: string;
    type: FlowchartNodeType;
    title: string;
    description: string;
    position: { x: number; y: number };
    /** ID do funil de destino (para link_out) ou origem (para link_in) */
    linkedFunnelId?: string;
    /** ID do script vinculado (para step/decision) */
    scriptId?: string | null;
}

export interface FlowchartEdge {
    edgeId: string;
    fromNodeId: string;
    toNodeId: string;
    label: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
}

export interface Flowchart {
    id: string;
    productIds: string[];
    funnelId?: string;
    /** Explicit start node id for execution */
    startNodeId?: string | null;
    scope: FlowchartScope;
    title: string;
    nodes: FlowchartNode[];
    edges: FlowchartEdge[];
    version: number;
    previousFlowchartId?: string | null;
    changeNote: string;
    createdAt: Timestamp;
    updatedAt?: string | Timestamp;
    createdBy: string;
}

export const NODE_TYPE_LABELS: Record<FlowchartNodeType, string> = {
    start: 'Início',
    step: 'Etapa',
    decision: 'Decisão',
    end: 'Fim',
    note: 'Nota',
    link_in: '🔵 Entrada',
    link_out: '🔴 Saída',
};

// ----------------------------------------
// Objection Library Types
// ----------------------------------------
export type ObjectionCategory = 'price' | 'trust' | 'delivery' | 'quality' | 'other';

export interface Objection {
    id: string;
    productIds: string[];
    title: string;
    category: ObjectionCategory;
    whatItMeans?: string;
    bestResponses?: string[];
    followUpQuestions?: string[];
    linkedFunnels?: string[];
    createdAt: Timestamp;
    updatedAt: Timestamp;
    createdBy?: string;
}

export const OBJECTION_CATEGORY_LABELS: Record<ObjectionCategory, string> = {
    price: 'Preço',
    trust: 'Confiança',
    delivery: 'Entrega',
    quality: 'Qualidade',
    other: 'Outro',
};

// ----------------------------------------
// Script Types
// ----------------------------------------

/** Tipos de nó que um script pode representar no fluxograma */
export type ScriptNodeType = 'start' | 'step' | 'decision' | 'link_in' | 'link_out';

/** Labels para os tipos de nó de script */
export const SCRIPT_NODE_TYPE_LABELS: Record<ScriptNodeType, string> = {
    start: '🎯 Evento',
    step: '📄 Conteúdo',
    decision: '◇ Decisão',
    link_in: '🔵 Entrada (de outro fluxo)',
    link_out: '🔴 Evento (Saída para outro fluxo)',
};

export interface Script {
    id: string;
    productIds: string[];
    funnelId?: string;
    flowchartNodeId?: string;
    name: string;
    content: string;
    tags: string[];
    version: number;
    previousScriptId?: string | null;
    changeNote?: string;
    createdAt: Timestamp;
    createdBy: string;
    /** Tipo do nó no fluxograma */
    nodeType?: ScriptNodeType;
    /** Ordem do script no fluxograma (para ordenação) */
    order?: number;
    /** ID do funil de destino (usado quando nodeType é 'link_out') */
    targetFunnelId?: string;
    /** Critério da decisão (usado quando nodeType é 'decision') - ex: "O lead enviou o endereço?" */
    decisionCriteria?: string;
    /** Caminhos de saída da decisão (usado quando nodeType é 'decision') */
    branches?: DecisionBranch[];
    /** IDs das próximas etapas diretas (ordem sequencial) */
    nextSteps?: string[];
    /** Execution order index calculated from the flow (BFS from start) */
    executionOrder?: number;
    /** Condições detalhadas quando nodeType === 'decision' (regras avaliáveis) */
    conditions?: ConditionRule[] | null;
}

/** Representa um caminho de saída de uma decisão */
export interface DecisionBranch {
    /** ID único do branch */
    id: string;
    /** Nome do caminho (ex: "Sim", "Não", "Talvez") */
    name: string;
    /** ID da etapa de destino quando este caminho é escolhido */
    targetStepId?: string;
    /** Alias mais explícito para destino do próximo script */
    nextScriptId?: string;
}

// ----------------------------------------
// Case Types
// ----------------------------------------
export type CaseClassification = 'good' | 'bad' | 'neutral';
export type MediaType = 'image' | 'audio' | 'text';

export interface Case {
    id: string;
    productId: string;
    funnelId?: string;
    title: string;
    description?: string;
    classification: CaseClassification;
    mediaType?: MediaType;
    mediaUrl?: string;
    transcript?: string;
    userMessage?: string;
    detectedObjections?: string[];
    outcome?: string;
    notes?: string;
    uploadedBy?: string;
    createdAt: Timestamp;
    createdBy?: string;
}

export const CLASSIFICATION_LABELS: Record<CaseClassification, string> = {
    good: 'Bom',
    bad: 'Ruim',
    neutral: 'Neutro',
};

// ----------------------------------------
// Support Session Types
// ----------------------------------------
export interface SupportSession {
    id: string;
    productId: string;
    funnelId?: string;
    notes?: string;
    objectionsDetected?: string[];
    status: 'active' | 'completed';
    userId: string;
    inputType?: MediaType;
    inputUrl?: string;
    transcript?: string;
    contextNotes?: string;
    aiResponse?: string;
    linkedObjectionIds?: string[];
    linkedFunnelId?: string;
    linkedScriptId?: string;
    createdAt: Timestamp;
}

// ----------------------------------------
// Audit Log Types
// ----------------------------------------
export type AuditAction = 'create' | 'update' | 'delete' | 'approve' | 'reject';
export type AuditEntityType = 'funnel' | 'flowchart' | 'script' | 'case' | 'objection' | 'product' | 'supportSession';

export interface AuditLogEntry {
    id: string;
    actorId: string;
    actorName: string;
    action: AuditAction;
    entityType: AuditEntityType;
    entityId: string;
    entityName: string;
    metadata: Record<string, unknown>;
    createdAt: Timestamp;
}

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
    create: 'Criou',
    update: 'Atualizou',
    delete: 'Excluiu',
    approve: 'Aprovou',
    reject: 'Rejeitou',
};

export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
    funnel: 'Funil',
    flowchart: 'Fluxograma',
    script: 'Script',
    case: 'Caso',
    objection: 'Objeção',
    product: 'Produto',
    supportSession: 'Sessão de Atendimento',
};

// ----------------------------------------
// AI Interpreter Types
// ----------------------------------------
export interface DraftStep {
    key: string;
    name: string;
    goal: string;
    notes?: string;
}

export interface DraftEdge {
    from: string;
    to: string;
    label?: string;
}

export interface FlowDraft {
    title: string;
    steps: DraftStep[];
    edges: DraftEdge[];
}

// ----------------------------------------
// Dynamic Condition Node Types
// ----------------------------------------

/**
 * Operadores lógicos disponíveis para condições
 */
export type ConditionOperator =
    | 'equals'           // Igual a
    | 'not_equals'       // Diferente de
    | 'contains'         // Contém substring
    | 'not_contains'     // Não contém
    | 'greater_than'     // Maior que (numérico)
    | 'less_than'        // Menor que
    | 'greater_or_equal' // Maior ou igual
    | 'less_or_equal'    // Menor ou igual
    | 'is_empty'         // Está vazio
    | 'is_not_empty'     // Não está vazio
    | 'matches_regex'    // Regex match
    | 'in_list'          // Está na lista
    | 'not_in_list';     // Não está na lista

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
    equals: 'Igual a',
    not_equals: 'Diferente de',
    contains: 'Contém',
    not_contains: 'Não contém',
    greater_than: 'Maior que',
    less_than: 'Menor que',
    greater_or_equal: 'Maior ou igual a',
    less_or_equal: 'Menor ou igual a',
    is_empty: 'Está vazio',
    is_not_empty: 'Não está vazio',
    matches_regex: 'Corresponde a regex',
    in_list: 'Está na lista',
    not_in_list: 'Não está na lista',
};

/**
 * Tipos de variáveis suportadas
 */
export type ConditionVariableType = 'string' | 'number' | 'boolean' | 'array';

/**
 * Fonte de dados da variável
 */
export type ConditionVariableSource = 'lead_data' | 'form_input' | 'api_response' | 'custom';

/**
 * Definição de uma variável de condição
 */
export interface ConditionVariable {
    name: string;                      // Nome da variável (ex: "cep_cobertura")
    template: string;                  // Template {{variavel}}
    type: ConditionVariableType;       // Tipo do valor
    source: ConditionVariableSource;   // De onde vem o valor
    description?: string;              // Descrição para o usuário
}

/**
 * Tipos de ação que podem ser executadas
 */
export type ConditionActionType =
    | 'goto_node'       // Ir para outro nó no mesmo funil
    | 'goto_funnel'     // Handover para outro funil
    | 'execute_script'  // Executar um script específico
    | 'set_variable'    // Definir uma variável
    | 'end_journey';    // Finalizar jornada

/**
 * Configuração de handover entre funis
 */
export interface HandoverConfig {
    preserveHistory: boolean;           // Manter histórico do lead
    transferData: string[];             // Campos a transferir
    addNote?: string;                   // Nota sobre a transferência
    notifyAgent?: boolean;              // Notificar agente
    assignTo?: string;                  // ID do agente ou "auto" | "queue"
}

/**
 * Ação a ser executada quando condição é verdadeira
 */
export interface ConditionAction {
    type: ConditionActionType;
    targetNodeId?: string;              // ID do nó destino
    targetFunnelId?: string | null;     // ID do funil destino (para handover)
    scriptId?: string;                  // ID do script (para execute_script)
    variableName?: string;              // Nome da variável (para set_variable)
    variableValue?: string;             // Valor a definir (para set_variable)
    handover?: HandoverConfig;          // Config de handover (para goto_funnel)
}

/**
 * Regra individual de condição
 */
export interface ConditionRule {
    id: string;
    operator: ConditionOperator;
    value: string | number | boolean | string[];  // Valor para comparação
    priority: number;                              // Ordem de avaliação (menor = primeiro)
    action: ConditionAction;
}

/**
 * Nó de Condição Dinâmica
 * Permite lógica SE [variável] FOR [valor], ENTÃO [ação], SENÃO [ação]
 */
export interface DynamicConditionNode {
    id: string;
    name: string;
    description?: string;
    productId: string;
    funnelId?: string;
    flowchartNodeId?: string;

    // Variável a ser avaliada
    variable: ConditionVariable;

    // Lista de condições (avaliadas por prioridade)
    conditions: ConditionRule[];

    // Ação padrão (SENÃO)
    defaultAction: ConditionAction;

    createdAt: Timestamp;
    updatedAt: Timestamp;
}

/**
 * Variáveis pré-definidas disponíveis no sistema
 */
export const PREDEFINED_VARIABLES: ConditionVariable[] = [
    { name: 'cep_cobertura', template: '{{cep_cobertura}}', type: 'boolean', source: 'api_response', description: 'CEP está em área de cobertura' },
    { name: 'pagamento_status', template: '{{pagamento_status}}', type: 'string', source: 'api_response', description: 'Status do pagamento' },
    { name: 'interesse_nivel', template: '{{interesse_nivel}}', type: 'number', source: 'lead_data', description: 'Nível de interesse (1-10)' },
    { name: 'resposta_lead', template: '{{resposta_lead}}', type: 'string', source: 'lead_data', description: 'Última resposta do lead' },
    { name: 'tempo_sem_resposta', template: '{{tempo_sem_resposta}}', type: 'number', source: 'lead_data', description: 'Horas sem resposta' },
    { name: 'tentativas_contato', template: '{{tentativas_contato}}', type: 'number', source: 'lead_data', description: 'Número de tentativas de contato' },
    { name: 'objecao_detectada', template: '{{objecao_detectada}}', type: 'string', source: 'lead_data', description: 'Tipo de objeção detectada' },
    { name: 'produto_interesse', template: '{{produto_interesse}}', type: 'string', source: 'form_input', description: 'Produto de interesse' },
    { name: 'estado_lead', template: '{{estado_lead}}', type: 'string', source: 'lead_data', description: 'Estado/UF do lead' },
    { name: 'valor_pedido', template: '{{valor_pedido}}', type: 'number', source: 'form_input', description: 'Valor do pedido' },
];

// ----------------------------------------
// Agent Types
// ----------------------------------------
export interface Agent {
    id: string;
    productId: string;
    name: string;
    slug?: string;
    base: string;
    responseMode?: 'single' | 'split';
    maxMessages?: number;
    tone?: string;
    handoffRule?: string;
    debounceSegundos?: number;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ----------------------------------------
// Agent Objection Types
// ----------------------------------------
export interface AgentObjection {
    id: string;
    agentId: string;
    trigger: string;
    response: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ----------------------------------------
// Agent Case Types
// ----------------------------------------
export interface AgentCase {
    id: string;
    agentId: string;
    title: string;
    kind: 'good' | 'bad';
    content: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ----------------------------------------
// Conversation Types (read-only viewer)
// ----------------------------------------
export interface ConversationMessage {
    role: 'user' | 'model';
    text: string;
    ts: number;
}

export interface Conversation {
    id: string;
    numero: string;
    agenteSlug: string;
    canal?: string; // slug do chip/WhatsApp de origem (ex.: "claro2"); ausente = canal padrão
    messages: ConversationMessage[];
    ativo?: boolean; // toggle: Patrícia só responde se true
    remarketingAtivo?: boolean; // toggle: se false, esta conversa não recebe remarketing
    arquivada?: boolean; // toggle: se a conversa foi arquivada
    updatedAt: any; // Firestore Timestamp or Unix number
    status?: string;
    leadPronto?: boolean;
    falhaIA?: boolean; // a IA não conseguiu responder: precisa de atendimento humano
    falhaIAMotivo?: string;
    falhaIATs?: number;
}


