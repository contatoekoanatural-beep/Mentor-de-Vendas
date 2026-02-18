
import type { Script, FlowchartNode } from '../../types';

// ========================================
// Funnel Copilot Service
// ========================================

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyDev2BNegZQVnBFN6Z0gWXCv6SH7wyAvJU';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export interface CopilotMessage {
    id: string;
    role: 'user' | 'ai' | 'system';
    content: string;
    timestamp: Date;
    // Se a mensagem propõe uma ação, ela vem anexada aqui
    proposedAction?: CopilotAction;
}

export interface CopilotAction {
    type: 'create_script' | 'update_script' | 'delete_script' | 'update_flowchart';
    summary: string; // Descrição curta p/ o botão: "Criar Script de Boas Vindas"
    payload: any;
    status: 'pending' | 'applied' | 'rejected';
}

export interface CopilotContext {
    funnelName: string;
    productName: string;
    scripts: Script[];
    flowchartNodes: FlowchartNode[];
}

export class FunnelCopilotService {

    static async sendMessage(
        userMessage: string,
        chatHistory: CopilotMessage[],
        context: CopilotContext
    ): Promise<{ text: string; action?: CopilotAction }> {

        if (!GEMINI_API_KEY) {
            return { text: 'Erro: Chave de API não configurada.' };
        }

        // 1. Preparar o Prompt
        // Incluímos o contexto compactado para economizar tokens, mas suficiente para a IA entender
        const contextSummary = `
CONTEXTO DO FUNIL ATUAL:
- Nome: ${context.funnelName}
- Produto: ${context.productName}
- Scripts Existentes: ${context.scripts.map(s => `- [${s.id}] ${s.name}: ${s.content.substring(0, 50)}...`).join('\n')}
- Nós do Fluxograma: ${context.flowchartNodes.map(n => `- [${n.nodeId}] ${n.title} (${n.type})`).join('\n')}
        `.trim();

        const toolsDefinition = `
FERRAMENTAS DISPONÍVEIS (Tools):
Você pode "chamar" ferramentas respondendo no formato JSON específico.
Se o usuário pedir para criar ou alterar algo, USE UMA TOOL.
Se for apenas conversa, responda texto normal.

Tool: create_script
Use para: Criar um novo script de venda.
JSON Esperado:
{
  "tool": "create_script",
  "data": {
    "name": "Nome sugerido",
    "content": "Conteúdo completo do script..."
  },
  "explanation": "Por que você está criando isso."
}

Tool: update_script
Use para: Sugerir melhoria ou reescrita de um script existente.
JSON Esperado:
{
  "tool": "update_script",
  "data": {
    "scriptId": "ID do script (veja contexto)",
    "content": "Novo conteúdo..."
  },
  "explanation": "Explicação da mudança."
}

Tool: suggest_flow_structure
Use para: Sugerir uma estrutura de nós para o fluxograma.
JSON Esperado:
{
  "tool": "update_flowchart",
  "data": {
    "steps": [
       { "title": "Nome da etapa", "type": "step|decision|start|end", "description": "Objetivo..." }
    ]
  },
  "explanation": "Explicação da estrutura."
}
`;

        const systemPrompt = `
Você é o "Copilot do Funil", um assistente especialista em Vendas e Copywriting.
Seu objetivo é ajudar o usuário a construir funis de vendas de alta conversão.

${contextSummary}

${toolsDefinition}

BOTE DA IA:
- Seja direto e prestativo.
- Se o usuário pedir algo vago (ex: "melhore esse funil"), analise o que falta e SUGIRA AÇÕES (Tools).
- Quando retornar um JSON de tool, NÃO coloque markdown em volta (sem \`\`\`json). Apenas o JSON cru se for possível, ou detectarei no texto.
- Se não for tool, apenas responda texto.
`;

        let attempt = 0;
        const MAX_RETRIES = 3;

        while (attempt < MAX_RETRIES) {
            try {
                // Conversão do histórico para formato Gemini (simplificado)
                const contents = [
                    {
                        role: 'user',
                        parts: [{ text: systemPrompt }]
                    },
                    ...chatHistory.filter(m => m.role !== 'system').map(m => ({
                        role: m.role === 'ai' ? 'model' : 'user',
                        parts: [{ text: m.content }]
                    })),
                    {
                        role: 'user',
                        parts: [{ text: userMessage }]
                    }
                ];

                const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents,
                        generationConfig: {
                            temperature: 0.4,
                        }
                    })
                });

                if (response.status === 429) {
                    attempt++;
                    if (attempt >= MAX_RETRIES) {
                        return { text: 'O sistema está sobrecarregado no momento (Muitas requisições). Tente novamente em alguns segundos.' };
                    }
                    // Exponential backoff: 2s, 4s, 8s...
                    const delay = Math.pow(2, attempt) * 1000;
                    console.log(`Erro 429. Tentando novamente em ${delay}ms... (Tentativa ${attempt}/${MAX_RETRIES})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                if (!response.ok) throw new Error(`API Error: ${response.statusText}`);

                const data = await response.json();
                const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

                // Tentar detectar JSON de Tool na resposta
                // A IA pode misturar texto e JSON, ou mandar só JSON
                let action: CopilotAction | undefined;
                let finalResponseText = rawText;

                // Regex simples para capturar JSON
                const jsonMatch = rawText.match(/\{[\s\S]*"tool"[\s\S]*\}/);

                if (jsonMatch) {
                    try {
                        const toolCall = JSON.parse(jsonMatch[0]);

                        // Remover o JSON do texto visível se quiser limpar, 
                        // ou mantê-lo parcialmente. Vamos limpar o texto principal.
                        finalResponseText = rawText.replace(jsonMatch[0], '').trim();
                        if (!finalResponseText) finalResponseText = toolCall.explanation || "Gerei uma sugestão para você:";

                        if (toolCall.tool === 'create_script') {
                            action = {
                                type: 'create_script',
                                summary: `Criar script: ${toolCall.data.name}`,
                                payload: toolCall.data,
                                status: 'pending'
                            };
                        } else if (toolCall.tool === 'update_script') {
                            // Encontrar nome do script p/ summary
                            const targetScript = context.scripts.find(s => s.id === toolCall.data.scriptId);
                            const scriptName = targetScript ? targetScript.name : 'script';
                            action = {
                                type: 'update_script',
                                summary: `Atualizar script: ${scriptName}`,
                                payload: toolCall.data,
                                status: 'pending'
                            };
                        } else if (toolCall.tool === 'update_flowchart') {
                            action = {
                                type: 'update_flowchart',
                                summary: `Atualizar Fluxograma (${toolCall.data.steps.length} etapas)`,
                                payload: toolCall.data,
                                status: 'pending'
                            };
                        }

                    } catch (e) {
                        console.error('Falha ao parsear tool JSON', e);
                        // Falha silenciosa, mostra texto bruto
                    }
                }

                return {
                    text: finalResponseText,
                    action
                };

            } catch (error) {
                console.error('Copilot Error:', error);
                return { text: 'Desculpe, tive um erro ao processar sua solicitação.' };
            }
        }

        return { text: 'Desculpe, não consegui conectar à IA após várias tentativas.' };
    }
}
