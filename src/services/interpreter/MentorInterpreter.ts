import type { FlowDraft } from '../../types';
import { GEMINI_API_URL } from '../geminiModel';

export interface InterpretationResult {
    type: 'questions' | 'draft';
    content: string[] | FlowDraft;
}

export class MentorInterpreter {
    static async analyzeScript(
        text: string,
        _funnelId?: string,
        _productId?: string,
        userAnswers?: string[]
    ): Promise<InterpretationResult> {
        const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

        if (!GEMINI_API_KEY) {
            return {
                type: 'questions',
                content: ['A chave da API do Google Gemini não foi encontrada no ambiente (VITE_GEMINI_API_KEY).']
            };
        }

        const systemPrompt = "Você é um Analista de Scripts de Vendas e Engenheiro de Fluxogramas.\n" +
            "Sua tarefa é analisar um texto de script (que pode estar bagunçado) e estruturá-lo em etapas lógicas de um funil de vendas.\n\n" +
            "OBJETIVO:\n" +
            "Criar uma estrutura sequencial de etapas (FlowDraft) baseada no conteúdo fornecido.\n\n" +
            "REGRAS:\n" +
            "1. Se o texto for ambíguo, curto demais ou faltar contexto crítico, GERE PERGUNTAS DE CLARIFICAÇÃO.\n" +
            "2. Se o texto for suficiente, GERE A ESTRUTURA (steps e edges).\n" +
            "3. Não use marcadores rígidos como [ETAPA X] se não existirem. Infira pelo contexto.\n" +
            "4. Identifique objetivos claros para cada etapa (ex: 'Saudação', 'Qualificação', 'Oferta').\n\n" +
            "FORMATO DE RESPOSTA (JSON):\n" +
            "Deve ser EXCLUSIVAMENTE um objeto JSON com UMA das chaves:\n" +
            "- 'questions': array de strings (se precisar de mais info)\n" +
            "- 'draft': objeto FlowDraft { title, steps: [{key, name, goal, notes}], edges: [{from, to, label}] }\n\n" +
            "Contexto extra (respostas do usuário anteriores): " + (userAnswers?.join(' | ') || 'Nenhum');

        try {
            const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{ text: systemPrompt + '\n\n--- SCRIPT PARA ANALISAR ---\n' + text }]
                    }],
                    generationConfig: {
                        temperature: 0.2,
                        responseMimeType: "application/json"
                    }
                })
            });

            if (!response.ok) {
                console.error('Gemini API Error:', response.statusText);
                throw new Error('Falha na comunicação com a IA');
            }

            const data = await response.json();
            const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

            let result;
            try {
                result = JSON.parse(textResponse);
            } catch (e) {
                // Fallback for markdown code blocks
                const match = textResponse.match(/```json\s*([\s\S]*?)\s*```/) || textResponse.match(/\{[\s\S]*\}/);
                if (match) {
                    result = JSON.parse(match[1] || match[0]);
                } else {
                    throw new Error('Falha ao processar resposta da IA');
                }
            }

            if (result.questions && Array.isArray(result.questions) && result.questions.length > 0) {
                return {
                    type: 'questions',
                    content: result.questions
                };
            }

            if (result.draft) {
                const draft = result.draft as FlowDraft;
                return {
                    type: 'draft',
                    content: draft
                };
            }

            return {
                type: 'questions',
                content: ['Não consegui identificar uma estrutura clara. Pode descrever melhor o fluxo?']
            };

        } catch (error) {
            console.error('Error analyzing script:', error);
            return {
                type: 'questions',
                content: ['Houve um erro ao processar o script. Tente novamente.']
            };
        }
    }
}
