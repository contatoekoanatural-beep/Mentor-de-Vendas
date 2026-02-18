// ========================================
// AI Service - Gemini Integration
// ========================================

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyDev2BNegZQVnBFN6Z0gWXCv6SH7wyAvJU';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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

// Check if API is configured
export function isAIConfigured(): boolean {
    return !!GEMINI_API_KEY && GEMINI_API_KEY.length > 10;
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
            error: 'API do Gemini não configurada. Adicione VITE_GEMINI_API_KEY no arquivo .env'
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
        const response = await fetchWithRetry(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
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
        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
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
