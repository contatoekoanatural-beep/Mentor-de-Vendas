"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.respondechatWebhook = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
// ========================================
// Buscar materiais de venda do Firestore
// ========================================
async function fetchSalesContext() {
    const parts = [];
    // 1. Buscar produtos ativos (com instruções da IA)
    const productsSnap = await db.collection('products')
        .where('status', '==', 'active').get();
    if (!productsSnap.empty) {
        parts.push('=== PRODUTOS ===');
        productsSnap.forEach(doc => {
            const p = doc.data();
            parts.push(`Produto: ${p.name}`);
            if (p.description)
                parts.push(`Descrição: ${p.description}`);
            if (p.descriptionText)
                parts.push(`Detalhes: ${p.descriptionText}`);
            if (p.price)
                parts.push(`Preço: R$ ${p.price}`);
            if (p.promotionalPrice)
                parts.push(`Preço Promocional: R$ ${p.promotionalPrice}`);
            if (p.aiInstructions)
                parts.push(`Instruções IA: ${p.aiInstructions}`);
            parts.push('---');
        });
    }
    // 2. Buscar scripts de vendas
    const scriptsSnap = await db.collection('scripts').limit(30).get();
    if (!scriptsSnap.empty) {
        parts.push('\n=== SCRIPTS DE VENDAS ===');
        scriptsSnap.forEach(doc => {
            const s = doc.data();
            if (s.content) {
                parts.push(`[${s.name || 'Script'}]: ${s.content}`);
            }
        });
    }
    // 3. Buscar objeções e respostas
    const objectionsSnap = await db.collection('objectionLibrary').limit(20).get();
    if (!objectionsSnap.empty) {
        parts.push('\n=== OBJEÇÕES COMUNS E COMO RESPONDER ===');
        objectionsSnap.forEach(doc => {
            var _a;
            const o = doc.data();
            parts.push(`Objeção: "${o.title}"`);
            if (o.whatItMeans)
                parts.push(`  Significado: ${o.whatItMeans}`);
            if ((_a = o.bestResponses) === null || _a === void 0 ? void 0 : _a.length) {
                parts.push(`  Melhores respostas:`);
                o.bestResponses.forEach((r) => parts.push(`    - ${r}`));
            }
            if (o.hiddenIntent)
                parts.push(`  Intenção oculta: ${o.hiddenIntent}`);
            parts.push('---');
        });
    }
    // 4. Buscar funis ativos
    const funnelsSnap = await db.collection('funnels')
        .where('status', '==', 'active').limit(10).get();
    if (!funnelsSnap.empty) {
        parts.push('\n=== FUNIS DE VENDAS ATIVOS ===');
        funnelsSnap.forEach(doc => {
            const f = doc.data();
            parts.push(`Funil: ${f.name} (${f.type})`);
            if (f.objective)
                parts.push(`  Objetivo: ${f.objective}`);
            if (f.description)
                parts.push(`  Descrição: ${f.description}`);
        });
    }
    return parts.join('\n');
}
// ========================================
// Buscar histórico da conversa
// ========================================
async function getConversationHistory(phoneNumber) {
    const convRef = db.collection('ai_conversations').doc(phoneNumber);
    const messagesSnap = await convRef.collection('messages')
        .orderBy('timestamp', 'desc').limit(10).get();
    const messages = [];
    messagesSnap.forEach(doc => {
        messages.push(doc.data());
    });
    return messages.reverse(); // Ordem cronológica
}
// ========================================
// Salvar mensagem na conversa
// ========================================
async function saveMessage(phoneNumber, contactName, role, content) {
    const convRef = db.collection('ai_conversations').doc(phoneNumber);
    // Atualizar/criar documento da conversa
    await convRef.set({
        contactName,
        phoneNumber,
        lastMessage: content,
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    // Adicionar mensagem ao histórico
    await convRef.collection('messages').add({
        role,
        content,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
}
// ========================================
// Chamar Claude AI (Anthropic)
// ========================================
async function callClaudeAI(clientMessage, clientName, salesContext, conversationHistory) {
    var _a, _b, _c;
    // Buscar chave do Claude no Firestore (integrations/claude_ai)
    const claudeDoc = await db.collection('integrations').doc('claude_ai').get();
    if (!claudeDoc.exists || !((_a = claudeDoc.data()) === null || _a === void 0 ? void 0 : _a.apiKey)) {
        console.error('Claude API key not found in integrations');
        return '';
    }
    const apiKey = claudeDoc.data().apiKey;
    // Montar histórico para o Claude
    const historyText = conversationHistory.map(msg => {
        const sender = msg.role === 'client' ? clientName : 'Você (Vendedor)';
        return `${sender}: ${msg.content}`;
    }).join('\n');
    const systemPrompt = `Você é um vendedor especialista e amigável. Seu trabalho é atender clientes pelo WhatsApp de forma natural, humana e persuasiva.

REGRAS IMPORTANTES:
- Responda de forma curta e natural, como uma pessoa real no WhatsApp
- Use emojis com moderação (1-2 por mensagem no máximo)
- NUNCA diga que é uma IA ou robô
- NUNCA invente informações que não estão nos materiais abaixo
- Se não souber algo, diga que vai verificar e volta logo
- Use o nome do cliente para personalizar
- Seja prestativo mas não insistente
- Foque em resolver a dúvida do cliente
- Use os scripts e respostas a objeções como guia, não copie palavra por palavra

${salesContext}

${historyText ? `\n=== HISTÓRICO DA CONVERSA ===\n${historyText}` : ''}`;
    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 300,
                system: systemPrompt,
                messages: [{
                        role: 'user',
                        content: `Cliente (${clientName}): ${clientMessage}\n\nResponda como o vendedor:`
                    }]
            })
        });
        if (!response.ok) {
            console.error('Claude API error:', response.status, await response.text());
            return '';
        }
        const result = await response.json();
        return ((_c = (_b = result.content) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.text) || '';
    }
    catch (error) {
        console.error('Error calling Claude:', error);
        return '';
    }
}
// ========================================
// Enviar resposta via Respondechat
// ========================================
async function sendReplyViaRespondechat(phoneNumber, message) {
    var _a;
    // Buscar token do Respondechat no Firestore
    const configDoc = await db.collection('integrations').doc('respondechat').get();
    if (!configDoc.exists || !((_a = configDoc.data()) === null || _a === void 0 ? void 0 : _a.token)) {
        console.error('Respondechat token not found');
        return false;
    }
    const token = configDoc.data().token;
    try {
        const response = await fetch('https://backend.respondechat.ai/api/messages/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                number: phoneNumber,
                body: message,
            })
        });
        if (!response.ok) {
            console.error('Respondechat send error:', response.status, await response.text());
            return false;
        }
        console.log(`Message sent to ${phoneNumber}`);
        return true;
    }
    catch (error) {
        console.error('Error sending via Respondechat:', error);
        return false;
    }
}
// ========================================
// Webhook Principal — Recebe mensagens
// ========================================
exports.respondechatWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    // Só aceitar POST
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    try {
        const body = req.body;
        // LOG COMPLETO do payload para debug
        console.log('[Webhook] Payload recebido:', JSON.stringify(body).substring(0, 2000));
        // Ignorar eventos de status (disconnected, connected, etc.)
        const validEvents = ['mensagem.upsert', 'messages.upsert', 'message.upsert'];
        if ((body === null || body === void 0 ? void 0 : body.event) && !validEvents.includes(body.event)) {
            console.log(`[Webhook] Evento de status ignorado: ${body.event}`);
            res.status(200).send('OK');
            return;
        }
        // Ignorar payloads sem mensagem
        if (!(body === null || body === void 0 ? void 0 : body.message)) {
            console.log('[Webhook] Payload sem message, ignorando');
            res.status(200).send('OK');
            return;
        }
        const raw = ((_a = body.message) === null || _a === void 0 ? void 0 : _a.raw) || {};
        const key = (raw === null || raw === void 0 ? void 0 : raw.key) || {};
        // Ignorar mensagens enviadas por nós (fromMe = true ou IsFromMe = true)
        if (key.fromMe === true || (raw === null || raw === void 0 ? void 0 : raw.IsFromMe) === true) {
            console.log('[Webhook] Mensagem enviada por nós, ignorando');
            res.status(200).send('OK');
            return;
        }
        // ============================================
        // EXTRAIR TEXTO DA MENSAGEM
        // Tentar em ordem: body > raw.extendedTextMessage.text > raw.conversation > raw.message.*
        // ============================================
        let clientMessage = ((_b = body.message) === null || _b === void 0 ? void 0 : _b.body) || '';
        if (!clientMessage) {
            clientMessage = ((_c = raw === null || raw === void 0 ? void 0 : raw.extendedTextMessage) === null || _c === void 0 ? void 0 : _c.text) ||
                (raw === null || raw === void 0 ? void 0 : raw.conversation) ||
                ((_e = (_d = raw === null || raw === void 0 ? void 0 : raw.message) === null || _d === void 0 ? void 0 : _d.extendedTextMessage) === null || _e === void 0 ? void 0 : _e.text) ||
                ((_f = raw === null || raw === void 0 ? void 0 : raw.message) === null || _f === void 0 ? void 0 : _f.conversation) ||
                '';
        }
        if (!clientMessage || clientMessage === 'Mensagem pode ser visualizada apenas no celular.') {
            console.log('[Webhook] Mensagem sem texto ou não suportada, ignorando (tipo:', (_g = body.message) === null || _g === void 0 ? void 0 : _g.type, ')');
            res.status(200).send('OK');
            return;
        }
        // ============================================
        // EXTRAIR NÚMERO DE TELEFONE
        // Fontes: key.remoteJid > contato.número > contato.numero > whatsapp.number
        // remoteJid format: "5511999999999@s.whatsapp.net"
        // ============================================
        let phoneNumber = '';
        // 1. Do raw.key.remoteJid (formato mais comum do Baileys/Evolution)
        if (key.remoteJid) {
            phoneNumber = key.remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
        }
        // 2. Do campo contact (formato REAL do Respondechat - em inglês)
        if (!phoneNumber && ((_h = body.contact) === null || _h === void 0 ? void 0 : _h.number)) {
            phoneNumber = body.contact.number;
        }
        // 3. Do campo contato (formato PT-BR alternativo)
        if (!phoneNumber && body.contato) {
            phoneNumber = body.contato['número'] || body.contato['numero'] ||
                body.contato['number'] || body.contato['whatsapp'] || '';
        }
        // 4. Do campo whatsapp (formato de eventos)
        if (!phoneNumber && ((_j = body.whatsapp) === null || _j === void 0 ? void 0 : _j.number)) {
            phoneNumber = body.whatsapp.number;
        }
        // 5. Campo phone direto
        if (!phoneNumber && body.phone) {
            phoneNumber = body.phone;
        }
        // ============================================
        // EXTRAIR NOME DO CONTATO
        // ============================================
        let clientName = ((_k = body.contact) === null || _k === void 0 ? void 0 : _k.name) ||
            (raw === null || raw === void 0 ? void 0 : raw.pushName) ||
            ((_l = body.contato) === null || _l === void 0 ? void 0 : _l.nome) ||
            ((_m = body.contato) === null || _m === void 0 ? void 0 : _m.name) ||
            body.pushName ||
            'Cliente';
        console.log(`[Webhook] Dados extraídos - Nome: ${clientName}, Telefone: ${phoneNumber}, Mensagem: ${clientMessage.substring(0, 100)}`);
        if (!phoneNumber) {
            console.error('[Webhook] Sem número de telefone. Keys disponíveis:', Object.keys(body));
            console.error('[Webhook] raw.key:', JSON.stringify(key));
            res.status(200).send('OK');
            return;
        }
        // ============================================
        // IGNORAR GRUPOS (remoteJid com @g.us)
        // ============================================
        if (key.remoteJid && key.remoteJid.includes('@g.us')) {
            console.log('[Webhook] Mensagem de grupo, ignorando');
            res.status(200).send('OK');
            return;
        }
        // Verificar se o atendimento automático está ativado
        const configDoc = await db.collection('integrations').doc('respondechat').get();
        if (!configDoc.exists || !((_o = configDoc.data()) === null || _o === void 0 ? void 0 : _o.autoReplyEnabled)) {
            // Mesmo com auto-reply desabilitado, salvar a mensagem para visualização
            console.log('[Webhook] Auto-reply desabilitado, salvando mensagem apenas');
            await saveMessage(phoneNumber, clientName, 'client', clientMessage);
            res.status(200).send('OK');
            return;
        }
        // Evitar processar duplicatas (pelo ID da mensagem)
        const msgId = ((_p = body.message) === null || _p === void 0 ? void 0 : _p.id) || key.id || `${phoneNumber}-${Date.now()}`;
        const msgRef = db.collection('ai_processed_messages').doc(msgId);
        const msgDoc = await msgRef.get();
        if (msgDoc.exists) {
            console.log('[Webhook] Mensagem duplicada, ignorando:', msgId);
            res.status(200).send('OK');
            return;
        }
        await msgRef.set({ processedAt: admin.firestore.FieldValue.serverTimestamp() });
        console.log(`[Webhook] Processando mensagem de ${clientName} (${phoneNumber}): ${clientMessage}`);
        // 1. Salvar mensagem do cliente
        await saveMessage(phoneNumber, clientName, 'client', clientMessage);
        // 2. Buscar contexto de vendas (scripts, objeções, produtos)
        const salesContext = await fetchSalesContext();
        // 3. Buscar histórico da conversa
        const history = await getConversationHistory(phoneNumber);
        // 4. Gerar resposta com Claude AI (Anthropic)
        const aiResponse = await callClaudeAI(clientMessage, clientName, salesContext, history);
        if (!aiResponse) {
            console.error('[Webhook] Resposta IA vazia, pulando envio');
            res.status(200).send('OK');
            return;
        }
        // 5. Enviar resposta via Respondechat
        const sent = await sendReplyViaRespondechat(phoneNumber, aiResponse);
        if (sent) {
            // 6. Salvar resposta no histórico
            await saveMessage(phoneNumber, clientName, 'assistant', aiResponse);
            console.log(`[Webhook] Resposta enviada com sucesso para ${phoneNumber}`);
        }
        res.status(200).send('OK');
    }
    catch (error) {
        console.error('[Webhook] Erro no processamento:', error);
        res.status(200).send('OK'); // Sempre 200 para evitar retentativas
    }
});
//# sourceMappingURL=aiAttendant.js.map