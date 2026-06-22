// ========================================
// AI Service - Gemini Integration
// ========================================

import { getAppSettings } from './firebase';

const ENV_GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// ----------------------------------------
// Managed API Key (Firestore > .env)
// ----------------------------------------
let _firestoreKey = '';

/** Load key from Firestore (call once on app init) */
export async function loadGeminiKey(): Promise<void> {
    try {
        const settings = await getAppSettings();
        if (settings && typeof settings.geminiApiKey === 'string' && settings.geminiApiKey.length > 10) {
            _firestoreKey = settings.geminiApiKey;
        }
    } catch (error) {
        console.error('Failed to load Gemini key from Firestore:', error);
    }
}

/** Update in-memory key after saving from the UI */
export function setGeminiKey(key: string): void {
    _firestoreKey = key;
}

/** Get effective key: Firestore first, then .env */
function getEffectiveApiKey(): string {
    return _firestoreKey || ENV_GEMINI_API_KEY;
}

// Check if API is configured
export function isAIConfigured(): boolean {
    const key = getEffectiveApiKey();
    return !!key && key.length > 10;
}

// Types for imported funnel
export interface ImportedStep {
    order: number;
    name: string;
    type: 'greeting' | 'audio' | 'text' | 'media' | 'delay' | 'closing' | 'decision';
    content: string;
    duration?: string;
    delayTime?: string;
    mediaType?: 'image' | 'video' | 'document';
    notes?: string;
}

export interface ImportedFunnel {
    name: string;
    product?: string;
    attendant?: string;
    trigger?: string;
    steps: ImportedStep[];
    missingInfo?: string[];
    questions?: string[];
}

export interface AIResponse {
    success: boolean;
    funnel?: ImportedFunnel;
    questions?: string[];
    error?: string;
}

// Helper to retry API calls with exponential backoff
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);

            // If rate limited, wait and retry
            if (response.status === 429 && attempt < maxRetries - 1) {
                const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                console.log(`Rate limited, waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            return response;
        } catch (error) {
            lastError = error as Error;
            if (attempt < maxRetries - 1) {
                const waitTime = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    throw lastError || new Error('Max retries exceeded');
}

// Parse funnel text using Gemini AI
export async function parseFunnelWithAI(funnelText: string, additionalContext?: string): Promise<AIResponse> {
    if (!isAIConfigured()) {
        return {
            success: false,
            error: 'API do Gemini não configurada. Configure a chave na tela de Configurações ou no arquivo .env'
        };
    }

    const systemPrompt = `Você é um especialista em processos de vendas. Sua tarefa é analisar textos de funis de vendas e extrair sua estrutura.

OBRIGATÓRIO - SEMPRE FAÇA PERGUNTAS PRIMEIRO:
Na sua PRIMEIRA resposta (quando NÃO houver "CONTEXTO ADICIONAL" abaixo), você DEVE OBRIGATORIAMENTE retornar 2-3 perguntas de clarificação no campo "questions". NÃO gere steps nessa primeira resposta.

Perguntas que você DEVE fazer:
1. "Qual é o objetivo final deste funil? (venda direta, agendamento, qualificação de lead?)"
2. "Existem condições ou ramificações? (ex: se o lead não responde, o que acontece?)"
3. "Há delays/esperas entre etapas? Quanto tempo?"

SOMENTE gere a estrutura completa (steps) se:
- O texto abaixo contiver "--- CONTEXTO ADICIONAL ---" (significa que o usuário já respondeu suas perguntas)

REGRAS DE EXTRAÇÃO (quando for gerar):
1. Identifique o nome do funil (geralmente no título ou cabeçalho)
2. Identifique o produto (se mencionado)
3. Identifique o atendente responsável (se mencionado)
4. Identifique o gatilho/trigger (ex: "lead chegou no WhatsApp")
5. Extraia TODAS as etapas do funil

PARA CADA ETAPA, IDENTIFIQUE:
- order: número sequencial
- name: nome da etapa (ex: "Saudação", "Benefícios")
- type: um dos seguintes:
  - "greeting" para saudações iniciais
  - "audio" para roteiros de áudio (identificados por duração ou menção a áudio)
  - "text" para mensagens de texto
  - "media" para envio de imagens/vídeos/documentos
  - "delay" para pausas/esperas
  - "decision" para pontos de decisão/ramificação
  - "closing" para etapas de fechamento
- content: o texto/roteiro da etapa
- duration: se for áudio, a duração (ex: "38 segundos")
- delayTime: se for delay, o tempo (ex: "1 hora")
- mediaType: se for mídia, o tipo ("image", "video", "document")
- notes: observações extras

IMPORTANTE:
- Se alguma informação estiver faltando ou incompleta, liste em "missingInfo"
- Se precisar de esclarecimentos, gere perguntas específicas em "questions"

Responda APENAS com JSON válido no formato:
{
  "name": "Nome do Funil",
  "product": "Produto (se identificado)",
  "attendant": "Nome do atendente (se identificado)",
  "trigger": "Gatilho do funil (se identificado)",
  "steps": [...],
  "missingInfo": ["lista de informações faltantes"],
  "questions": ["perguntas para esclarecer"]
}`;

    const userPrompt = additionalContext
        ? `${funnelText}\n\n--- CONTEXTO ADICIONAL ---\n${additionalContext}`
        : funnelText;

    try {
        const response = await fetchWithRetry(`${GEMINI_API_URL}?key=${getEffectiveApiKey()}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: systemPrompt + '\n\n--- TEXTO DO FUNIL ---\n' + userPrompt }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 4096,
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            return {
                success: false,
                error: `Erro na API: ${errorData.error?.message || response.statusText}`
            };
        }

        const data = await response.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Extract JSON from response (may be wrapped in markdown code blocks)
        let jsonStr = textResponse;
        const jsonMatch = textResponse.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        } else {
            // Try to find JSON object directly
            const jsonObjMatch = textResponse.match(/\{[\s\S]*\}/);
            if (jsonObjMatch) {
                jsonStr = jsonObjMatch[0];
            }
        }

        const parsedFunnel = JSON.parse(jsonStr) as ImportedFunnel;

        return {
            success: true,
            funnel: parsedFunnel,
            questions: parsedFunnel.questions
        };

    } catch (error) {
        console.error('Error parsing funnel with AI:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erro ao processar com IA'
        };
    }
}

// Generate flowchart nodes from parsed funnel
export function generateFlowchartFromFunnel(funnel: ImportedFunnel): {
    nodes: Array<{ id: string; type: string; title: string; description: string; position: { x: number; y: number } }>;
    edges: Array<{ id: string; source: string; target: string; label?: string }>;
} {
    const nodes: Array<{ id: string; type: string; title: string; description: string; position: { x: number; y: number } }> = [];
    const edges: Array<{ id: string; source: string; target: string; label?: string }> = [];

    // Starting node
    nodes.push({
        id: 'start',
        type: 'start',
        title: funnel.trigger || 'Início',
        description: 'Gatilho do funil',
        position: { x: 250, y: 0 }
    });

    // Create nodes for each step
    funnel.steps.forEach((step, index) => {
        const nodeId = `step-${step.order}`;
        const nodeType = step.type === 'decision' ? 'decision' : 'step';

        nodes.push({
            id: nodeId,
            type: nodeType,
            title: `${step.order}. ${step.name || 'Etapa'}`,
            description: step.content ? (step.content.substring(0, 100) + (step.content.length > 100 ? '...' : '')) : '(Sem conteúdo)',
            position: { x: 250, y: (index + 1) * 150 }
        });

        // Connect to previous
        const previousId = index === 0 ? 'start' : `step-${funnel.steps[index - 1].order}`;
        edges.push({
            id: `edge-${previousId}-${nodeId}`,
            source: previousId,
            target: nodeId,
            label: step.delayTime ? `Delay: ${step.delayTime}` : undefined
        });
    });

    // End node
    const lastStepId = `step-${funnel.steps[funnel.steps.length - 1]?.order || 1}`;
    nodes.push({
        id: 'end',
        type: 'end',
        title: 'Fim',
        description: 'Final do funil',
        position: { x: 250, y: (funnel.steps.length + 1) * 150 }
    });
    edges.push({
        id: `edge-${lastStepId}-end`,
        source: lastStepId,
        target: 'end'
    });

    return { nodes, edges };
}

// Mentor AI Generation
export async function generateMentorResponse(
    userMessage: string,
    context: {
        scripts: string[];
        objections: string[];
        flowchart?: string;
    }
): Promise<AIResponse & { responseText?: string }> {
    if (!isAIConfigured()) {
        return {
            success: false,
            error: 'API do Gemini não configurada.'
        };
    }

    const systemPrompt = `Você é um Mentor de Vendas experiente e estratégico.
Sua missão é ajudar o atendente a responder o cliente usando APENAS e EXCLUSIVAMENTE os materiais fornecidos.

CONTEXTO DISPONÍVEL:
1. SCRIPTS (Roteiros aprovados):
${context.scripts.join('\n')}

2. OBJEÇÕES (Respostas para dúvidas comuns):
${context.objections.join('\n')}

3. FLUXO (Estrutura da conversa):
${context.flowchart || 'Nenhum fluxo específico definido.'}

REGRAS RÍGIDAS:
- Use APENAS as informações dos scripts e objeções fornecidos.
- Se o script for adequado, use-o ou adapte-o levemente para o contexto sem perder a essência.
- Se houver objeção identificada, use a resposta cadastrada.
- Você pode combinar trechos, mas DEVE CITAR de onde tirou (ex: "Baseado no script X").
- Se não houver informação suficiente nos materiais para responder com qualidade, NÃO INVENTE. Em vez disso, gere perguntas de clarificação para entender melhor o cenário.

SAÍDA ESPERADA (JSON):
{
  "response": "Texto sugerido para o atendente enviar (ou explicação do mentor)",
  "questions": ["Perguntas de clarificação se necessário"],
  "usedSources": ["Nomes dos scripts/objeções usados"]
}`;

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${getEffectiveApiKey()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: systemPrompt + '\n\n--- MENSAGEM DO CLIENTE ---\n' + userMessage }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 1024,
                }
            })
        });

        if (!response.ok) throw new Error('Falha na API Gemini');

        const data = await response.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        let jsonStr = textResponse;
        const jsonMatch = textResponse.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) jsonStr = jsonMatch[1];
        else {
            const jsonObjMatch = textResponse.match(/\{[\s\S]*\}/);
            if (jsonObjMatch) jsonStr = jsonObjMatch[0];
        }

        const parsed = JSON.parse(jsonStr);

        // Ensure we handle the "Used Sources" in the response text if the UI is simple
        // or just return plain text as requested by the engine interface

        return {
            success: true,
            responseText: parsed.response,
            questions: parsed.questions,
        };

    } catch (error) {
        console.error('Error generating mentor response:', error);
        return { success: false, error: 'Erro ao gerar resposta com IA' };
    }
}

// ----------------------------------------
// Agent Chat — System Prompt Builder
// ----------------------------------------
export interface AgentConfig {
    base: string;
    tone?: string;
    handoffRule?: string;
    responseMode?: 'single' | 'split';
    maxMessages?: number;
}

export function buildAgentSystemPrompt(config: AgentConfig): string {
    const sections: string[] = [config.base.trim()];

    if (config.tone && config.tone.trim()) {
        sections.push(`\nTOM DE VOZ: responda sempre com o seguinte tom: ${config.tone.trim()}`);
    }

    if (config.handoffRule && config.handoffRule.trim()) {
        sections.push(
            `\nCONDIÇÃO DE LEAD PRONTO (OBRIGATÓRIO):
Quando a seguinte situação ocorrer — ${config.handoffRule.trim()} — você DEVE obrigatoriamente adicionar o marcador [LEAD_PRONTO] ao final absoluto da sua resposta.

Regras rigorosas para a emissão do marcador:
1. O marcador [LEAD_PRONTO] deve ser escrito exatamente dessa forma (letras maiúsculas e entre colchetes) em uma LINHA TOTALMENTE ISOLADA no final absoluto de toda a sua resposta.
2. O marcador deve ficar sempre DEPOIS da última linha de conteúdo e DEPOIS de qualquer separador de mensagens "---" (caso esteja no formato split). O marcador NÃO é uma mensagem para o cliente e NÃO deve ser tratado como uma das partes do split. Não insira outro separador "---" após o marcador.
3. Este marcador é de uso estritamente interno do sistema e invisível para o cliente. NUNCA mencione, explique ou faça referência ao marcador "[LEAD_PRONTO]" na conversa com o cliente.
4. Você deve CONTINUAR conversando e atendendo o cliente normalmente, respondendo suas dúvidas e conduzindo o fechamento como se você fosse o vendedor. NÃO pare de responder e NÃO encerre o fluxo.

Exemplo de formato de resposta quando a condição de lead pronto ocorre:
Mensagem explicativa 1 ao cliente.
---
Mensagem explicativa 2 com a pergunta de avanço comercial.
[LEAD_PRONTO]`
        );
    }

    if (config.responseMode === 'split' && config.maxMessages && config.maxMessages > 1) {
        sections.push(`\nFORMATO DE RESPOSTA: divida sua resposta em no máximo ${config.maxMessages} mensagens curtas e separadas. Separe cada mensagem com uma linha contendo exatamente '---' (três hifens), e nada mais nessa linha. Não use '---' dentro do conteúdo de uma mensagem.`);
    } else {
        sections.push(`\nFORMATO DE RESPOSTA: responda em uma única mensagem. Não use o separador '---'.`);
    }

    return sections.join('\n');
}

// ----------------------------------------
// Agent Chat — Multi-turn Gemini conversation
// ----------------------------------------
export interface ChatTurn {
    role: 'user' | 'model';
    text: string;
}

export async function chatWithAgent(
    systemPrompt: string,
    history: ChatTurn[],
    userMessage: string,
): Promise<{ success: boolean; text?: string; error?: string }> {
    if (!isAIConfigured()) {
        return { success: false, error: 'API do Gemini não configurada.' };
    }

    // Build contents array: history + current user message
    const contents = [
        ...history.map((turn) => ({
            role: turn.role,
            parts: [{ text: turn.text }],
        })),
        {
            role: 'user' as const,
            parts: [{ text: userMessage }],
        },
    ];

    try {
        const response = await fetchWithRetry(`${GEMINI_API_URL}?key=${getEffectiveApiKey()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: systemPrompt }],
                },
                contents,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024,
                },
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const msg = (errorData as { error?: { message?: string } }).error?.message || response.statusText;
            return { success: false, error: `Erro na API: ${msg}` };
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!text) {
            return { success: false, error: 'A IA não retornou resposta.' };
        }

        return { success: true, text };
    } catch (error) {
        console.error('Error in chatWithAgent:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Erro de rede ao chamar a IA.',
        };
    }
}
