# Mentor Vendas

Assistente de IA para vendas via WhatsApp. Recebe mensagens de leads, responde
automaticamente com Gemini seguindo um prompt configurável por agente, detecta
quando o lead está pronto para fechar, e dispara remarketing automático em
conversas inativas. Inclui uma "bancada" web onde o vendedor acompanha e
intervém nas conversas em tempo real.

## Stack

- **Frontend:** React 19 + TypeScript + Vite + React Router
- **Backend:** Firebase (Cloud Functions + Firestore)
- **IA:** Google Gemini API (2.5 Flash)
- **Integrações:** WhatsApp, Responde Chat, Logzz (logística), Claude AI
- **Hospedagem:** Firebase Hosting
- **UI:** Lucide React, XYFlow + Dagre (fluxos visuais)

## Estrutura de pastas

```
src/                       Frontend React
├── pages/                 Login, Produtos, AgentesList, AgenteDetalhe, Conversas, Configuracoes
├── components/            layout, ui (AgentChat), funnels (fluxos visuais)
├── services/               aiService (Gemini), firebase, MentorEngine, ConditionEvaluator
└── contexts/               Auth, Product, Toast

functions/                 Cloud Functions principais (JS)
└── index.js                ping, webhookRespondeChat, ativarAgente, verificarRemarketingAgendado

functions-integrations/    Cloud Functions de integrações (TS)
└── src/index.ts            conecta/desconecta WhatsApp, Claude, Responde Chat, Logzz, webhooks customizados
```

Firebase usa 2 codebases: `mentor` (functions/) e `integrations` (functions-integrations/).

## Funções principais

- **`webhookRespondeChat()`** — núcleo do sistema: recebe mensagem WhatsApp,
  transcreve áudio/imagem se houver, monta prompt com casos de treino, chama
  Gemini, detecta `[LEAD_PRONTO]`, envia resposta (com suporte a split em
  várias mensagens).
- **`verificarRemarketingAgendado()`** — roda de hora em hora, identifica
  leads inativos (~22h) e dispara remarketing.
- **`ativarAgente()`** — liga/desliga a IA de um agente.
- **`connectWhatsApp` / `connectClaudeAI` / `connectRespondechat` /
  `checkDeliveryLogzz`** — configuram integrações de canais e logística
  (functions-integrations).
- **`Conversas.tsx`** — bancada de chat em tempo real com leads.
- **`AgenteDetalhe.tsx`** — configuração de prompt, tom e regras do agente.
- **`Configuracoes.tsx`** — configuração de webhooks e canais.
- **`FunnelCopilotService.ts`** — gera fluxos de vendas via IA a partir de
  descrição em texto.

## Modelo de dados (Firestore)

Users → Products → Agents → Conversations, mais Funnels/FunnelTransitions
para os fluxos visuais e Integrations para as chaves/tokens de terceiros.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
