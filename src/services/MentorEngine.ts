import {
    getScripts,
    getObjections,
    getActiveFunnelFlowchart
} from './firebase';
import type {
    Script,
    Objection,
    Flowchart
} from '../types';
import { generateMentorResponse } from './aiService';

// ========================================
// Mentor Engine Configuration
// ========================================

export type MentorMode = 'rules' | 'ai';
export const MENTOR_MODE: MentorMode = 'ai'; // Use AI mode by default

// ========================================
// Mentor Engine Interface
// ========================================

export interface MentorAttachment {
    type: 'image' | 'audio';
    url: string;
}

export interface MentorInput {
    productId: string;
    funnelId?: string;
    userMessage: string;
    attachments?: MentorAttachment[];
    mode?: MentorMode; // Allow override per request
}

export interface MentorResponse {
    response: string;
    suggestedScriptIds: string[];
    suggestedObjectionIds: string[];
    clarifyingQuestions: string[];
    contextUsed: {
        scriptCount: number;
        objectionCount: number;
        hasFlowchart: boolean;
    };
}

// ========================================
// Mentor Engine Implementation
// ========================================

class MentorEngineService {

    /**
     * Main entry point to process a user request
     */
    async processRequest(input: MentorInput): Promise<MentorResponse> {
        // Enforce rules mode unless explicitly requested otherwise (though user wants strict mode)
        // We stick to the global default which is now 'rules'
        const mode = input.mode || MENTOR_MODE;
        console.log(`MentorEngine: Processing request [Mode: ${mode}]`, input);

        // 1. Fetch Context
        const context = await this.fetchContext(input.productId, input.funnelId);

        // 2. Analyze Intent & Find Matches
        // Use strict keyword matching for both modes to ensure relevance
        const relevantScripts = this.findRelevantScripts(input.userMessage, context.scripts, mode === 'ai');
        const relevantObjections = this.findRelevantObjections(input.userMessage, context.objections, mode === 'ai');

        // 3. Generate Response
        if (mode === 'ai') {
            return this.generateResponseAI(input.userMessage, relevantScripts, relevantObjections, context.flowcharts[0]);
        } else {
            const ruleResult = this.generateResponseRules(relevantScripts, relevantObjections);
            return {
                response: ruleResult.text,
                suggestedScriptIds: relevantScripts.map(s => s.id),
                suggestedObjectionIds: relevantObjections.map(o => o.id),
                clarifyingQuestions: ruleResult.questions,
                contextUsed: {
                    scriptCount: context.scripts.length,
                    objectionCount: context.objections.length,
                    hasFlowchart: context.flowcharts.length > 0
                }
            };
        }
    }

    /**
     * Fetch all relevant data from Firebase
     */
    private async fetchContext(productId: string, funnelId?: string) {
        try {
            const [scripts, objections, flowchart] = await Promise.all([
                getScripts(productId, funnelId),
                getObjections(productId),
                funnelId ? getActiveFunnelFlowchart(funnelId) : Promise.resolve(null)
            ]);

            return { scripts, objections, flowcharts: flowchart ? [flowchart] : [] };
        } catch (error) {
            console.error('MentorEngine: Error fetching context', error);
            return { scripts: [], objections: [], flowcharts: [] };
        }
    }

    /**
     * Find scripts based on keyword matching
     * In AI mode, we broaden the search to include more candidates
     */
    private findRelevantScripts(message: string, scripts: Script[], isAI: boolean = false): Script[] {
        if (!message) return [];
        const lowerMessage = message.toLowerCase();

        // Return more candidates for AI to choose from
        const limit = isAI ? 10 : 3;

        return scripts.filter(script => {
            // Match against name (Higher priority)
            if (script.name.toLowerCase().includes(lowerMessage)) return true;

            // Match against tags
            if (script.tags && script.tags.some(tag => lowerMessage.includes(tag.toLowerCase()))) return true;

            // Match keywords in content or name
            const keywords = script.name.split(' ').filter(w => w.length > 3);
            if (keywords.some(k => lowerMessage.includes(k.toLowerCase()))) return true;

            return false;
        }).slice(0, limit);
    }

    /**
     * Find objections based on keyword matching
     */
    private findRelevantObjections(message: string, objections: Objection[], isAI: boolean = false): Objection[] {
        if (!message) return [];
        const lowerMessage = message.toLowerCase();
        const limit = isAI ? 5 : 2;

        return objections.filter(obj => {
            if (obj.title.toLowerCase().includes(lowerMessage)) return true;
            const keywords = obj.title.split(' ').filter(w => w.length > 3);
            if (keywords.some(k => lowerMessage.includes(k.toLowerCase()))) return true;
            return false;
        }).slice(0, limit);
    }

    /**
     * AI-Driven Response Generation
     */
    private async generateResponseAI(
        userMessage: string,
        scripts: Script[],
        objections: Objection[],
        flowchart?: Flowchart
    ): Promise<MentorResponse> {

        // Prepare context strings
        const scriptContext = scripts.map(s => `[ID: ${s.id}] ${s.name}: ${s.content}`);
        const objectionContext = objections.map(o => `[ID: ${o.id}] ${o.title}: ${o.bestResponses?.join(' | ')}`);
        const flowchartContext = flowchart
            ? `Fluxo: ${flowchart.title} (${flowchart.scope}) - Nodes: ${flowchart.nodes.map(n => n.title).join(', ')}`
            : undefined;

        // Call AI Service
        const aiResult = await generateMentorResponse(userMessage, {
            scripts: scriptContext,
            objections: objectionContext,
            flowchart: flowchartContext
        });

        if (aiResult.success && aiResult.responseText) {
            return {
                response: aiResult.responseText,
                suggestedScriptIds: scripts.map(s => s.id), // AI implicitly considers all provided
                suggestedObjectionIds: objections.map(o => o.id),
                clarifyingQuestions: aiResult.questions || [],
                contextUsed: {
                    scriptCount: scripts.length,
                    objectionCount: objections.length,
                    hasFlowchart: !!flowchart
                }
            };
        }

        // Fallback to rules if AI fails
        console.warn('MentorEngine: AI generation failed, falling back to rules');
        const ruleResult = this.generateResponseRules(scripts, objections);
        return {
            response: "[Fallback Rules] " + ruleResult.text,
            suggestedScriptIds: scripts.map(s => s.id),
            suggestedObjectionIds: objections.map(o => o.id),
            clarifyingQuestions: ruleResult.questions,
            contextUsed: {
                scriptCount: scripts.length,
                objectionCount: objections.length,
                hasFlowchart: !!flowchart
            }
        };
    }

    /**
     * Rule-Based Response Generation (Strict Consultation)
     */
    private generateResponseRules(
        relevantScripts: Script[],
        relevantObjections: Objection[]
    ): { text: string, questions: string[] } {

        const questions: string[] = [];
        let responseParts: string[] = [];

        // 1. Handle Objections
        if (relevantObjections.length > 0) {
            relevantObjections.forEach(obj => {
                if (obj.bestResponses && obj.bestResponses.length > 0) {
                    responseParts.push(`**Sobre "${obj.title}":**\n${obj.bestResponses[0]}\n\n(Baseado na objeção: ${obj.title})`);
                }
            });
        }

        // 2. Handle Scripts
        if (relevantScripts.length > 0) {
            relevantScripts.forEach(script => {
                responseParts.push(`${script.content}\n\n(Baseado no script: ${script.name})`);
            });
        }

        // 3. Construct Final Output or Fallback
        if (responseParts.length === 0) {
            // Rule: If not enough base, ask clarifying questions only.
            // Do NOT generate advice.
            questions.push("Em que parte do atendimento isso aconteceu?");
            questions.push("O cliente já recebeu explicação do produto?");
            questions.push("Qual é a principal dúvida ou objeção?");

            // Special empty response marker for UI to show only questions or a specific empty state
            // But usually we need some text.
            return {
                text: "", // UI should handle empty text by showing questions prominent, or we give a helper text
                questions
            };
        }

        // Combine parts
        let finalResponse = responseParts.join("\n\n---\n\n");

        return { text: finalResponse, questions };
    }
}

export const mentorEngine = new MentorEngineService();
