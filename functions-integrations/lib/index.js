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
exports.respondechatWebhook = exports.disconnectRespondechat = exports.getRespondechatStatus = exports.toggleRespondechatAutoReply = exports.connectRespondechat = exports.getWebhooksConfig = exports.testCustomWebhook = exports.saveCustomWebhook = exports.testWhatsApp = exports.getWhatsAppStatus = exports.disconnectWhatsApp = exports.connectWhatsApp = exports.getClaudeAIStatus = exports.disconnectClaudeAI = exports.connectClaudeAI = exports.checkDeliveryLogzz = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
admin.initializeApp();
exports.checkDeliveryLogzz = (0, https_1.onCall)({ memory: '256MiB' }, async (request) => {
    var _a;
    const { city, uf, product_id, offer_id } = request.data;
    if (!city || !uf) {
        throw new https_1.HttpsError('invalid-argument', 'The function must be called with city and uf.');
    }
    try {
        const logzzEndpoint = 'https://entrega.logzz.com.br';
        const logzzUrl = new URL(`${logzzEndpoint}/get-city-operation`);
        logzzUrl.searchParams.append('city', city);
        logzzUrl.searchParams.append('uf', uf);
        if (product_id)
            logzzUrl.searchParams.append('product_id', String(product_id));
        if (offer_id)
            logzzUrl.searchParams.append('offer_id', String(offer_id));
        const response = await fetch(logzzUrl.toString(), {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        let available = false;
        let days = [];
        if (response.ok) {
            const logzzData = await response.json();
            if (logzzData.hasOperation && ((_a = logzzData.delivery_day_options) === null || _a === void 0 ? void 0 : _a.length) > 0) {
                available = true;
                const allDays = logzzData.delivery_day_options.flatMap((opt) => { var _a; return ((_a = opt.dates) === null || _a === void 0 ? void 0 : _a.map((d) => d.weekdayName)) || []; }).filter(Boolean);
                days = [...new Set(allDays)];
            }
        }
        else {
            console.error(`Logzz API returned ${response.status}: ${await response.text()}`);
            throw new https_1.HttpsError('internal', 'Logzz API failed to check delivery');
        }
        return {
            available,
            days
        };
    }
    catch (error) {
        console.error('Error in checkDeliveryLogzz:', error);
        throw new https_1.HttpsError('internal', 'Internal error while checking delivery');
    }
});
// ========================================
// Integration Module — Gemini AI
// ========================================
const INTEGRATIONS_COLLECTION = 'integrations';
const db = admin.firestore();
/**
 * connectClaudeAI — Validates API key with a test request to Anthropic, stores in Firestore.
 * The frontend NEVER stores the key.
 */
exports.connectClaudeAI = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    const { apiKey } = data;
    if (!apiKey || apiKey.trim().length < 10) {
        throw new functions.https.HttpsError('invalid-argument', 'API Key inválida.');
    }
    try {
        // Validate API key by making a minimal request to Anthropic Claude API
        const testResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey.trim(),
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 10,
                messages: [{ role: 'user', content: 'Hello' }]
            })
        });
        if (!testResponse.ok) {
            const errorData = await testResponse.json().catch(() => ({}));
            const errorMsg = ((_a = errorData === null || errorData === void 0 ? void 0 : errorData.error) === null || _a === void 0 ? void 0 : _a.message) || `HTTP ${testResponse.status}`;
            console.error('Claude API validation failed:', errorMsg);
            return { success: false, error: `API Key inválida: ${errorMsg}` };
        }
        // Store in Firestore
        await db.collection(INTEGRATIONS_COLLECTION).doc('claude_ai').set({
            apiKey: apiKey.trim(),
            connected: true,
            connectedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            connectedBy: context.auth.uid,
        });
        return { success: true };
    }
    catch (error) {
        console.error('Error connecting Claude AI:', error);
        return { success: false, error: error.message || 'Erro interno ao validar API Key.' };
    }
});
/**
 * disconnectClaudeAI — Deletes the integration document.
 */
exports.disconnectClaudeAI = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    try {
        await db.collection(INTEGRATIONS_COLLECTION).doc('claude_ai').delete();
        return { success: true };
    }
    catch (error) {
        console.error('Error disconnecting Claude AI:', error);
        return { success: false, error: error.message };
    }
});
/**
 * getClaudeAIStatus — Returns connection status. NEVER exposes the API key.
 */
exports.getClaudeAIStatus = functions.https.onCall(async (_data, context) => {
    var _a, _b, _c, _d;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('claude_ai').get();
        if (!doc.exists) {
            return { connected: false };
        }
        const data = doc.data();
        return {
            connected: data.connected || false,
            connectedAt: ((_d = (_c = (_b = (_a = data.connectedAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString) === null || _d === void 0 ? void 0 : _d.call(_c)) || null,
        };
    }
    catch (error) {
        console.error('Error getting Claude AI status:', error);
        return { connected: false };
    }
});
// ========================================
// Integration Module — WhatsApp (Z-API)
// ========================================
/**
 * connectWhatsApp — Validates Z-API credentials and stores them.
 */
exports.connectWhatsApp = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    const { instance, token, notificationPhone } = data;
    if (!instance || !token || !notificationPhone) {
        throw new functions.https.HttpsError('invalid-argument', 'Todos os campos são obrigatórios.');
    }
    try {
        // Validate by checking Z-API instance status
        const statusUrl = `https://api.z-api.io/instances/${instance}/token/${token}/status`;
        const response = await fetch(statusUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) {
            return { success: false, error: 'Credenciais Z-API inválidas. Verifique Instance ID e Token.' };
        }
        // Store in Firestore
        await db.collection(INTEGRATIONS_COLLECTION).doc('whatsapp').set({
            instance,
            token,
            notificationPhone,
            connected: true,
            connectedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            connectedBy: context.auth.uid,
        });
        return { success: true };
    }
    catch (error) {
        console.error('Error connecting WhatsApp:', error);
        return { success: false, error: error.message || 'Erro ao validar credenciais Z-API.' };
    }
});
/**
 * disconnectWhatsApp — Deletes the integration document.
 */
exports.disconnectWhatsApp = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    try {
        await db.collection(INTEGRATIONS_COLLECTION).doc('whatsapp').delete();
        return { success: true };
    }
    catch (error) {
        console.error('Error disconnecting WhatsApp:', error);
        return { success: false, error: error.message };
    }
});
/**
 * getWhatsAppStatus — Returns connection status. NEVER exposes token.
 */
exports.getWhatsAppStatus = functions.https.onCall(async (_data, context) => {
    var _a, _b, _c, _d;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('whatsapp').get();
        if (!doc.exists) {
            return { connected: false };
        }
        const data = doc.data();
        return {
            connected: data.connected || false,
            connectedAt: ((_d = (_c = (_b = (_a = data.connectedAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString) === null || _d === void 0 ? void 0 : _d.call(_c)) || null,
            notificationPhone: data.notificationPhone || null,
            instance: data.instance || null,
        };
    }
    catch (error) {
        console.error('Error getting WhatsApp status:', error);
        return { connected: false };
    }
});
/**
 * testWhatsApp — Sends a test message.
 */
exports.testWhatsApp = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('whatsapp').get();
        if (!doc.exists) {
            return { success: false, error: 'WhatsApp não configurado.' };
        }
        const config = doc.data();
        const { instance, token, notificationPhone } = config;
        const sendUrl = `https://api.z-api.io/instances/${instance}/token/${token}/send-text`;
        const response = await fetch(sendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: notificationPhone,
                message: '✅ *Mentor de Vendas — Teste de Integração*\n\nSua integração com o WhatsApp está funcionando corretamente! 🎉',
            }),
        });
        if (!response.ok) {
            const errText = await response.text();
            console.error('WhatsApp test failed:', errText);
            return { success: false, error: `Falha ao enviar: HTTP ${response.status}` };
        }
        return { success: true };
    }
    catch (error) {
        console.error('Error testing WhatsApp:', error);
        return { success: false, error: error.message || 'Erro ao enviar mensagem de teste.' };
    }
});
// ========================================
// Integration Module — Custom Webhooks
// ========================================
/**
 * saveCustomWebhook — Saves webhook configuration.
 */
exports.saveCustomWebhook = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    const { type, url, ativo, userId } = data;
    if (!type || !url) {
        throw new functions.https.HttpsError('invalid-argument', 'Tipo e URL são obrigatórios.');
    }
    // Validate URL format
    try {
        new URL(url);
    }
    catch (_a) {
        throw new functions.https.HttpsError('invalid-argument', 'URL inválida.');
    }
    try {
        const docRef = db.collection(INTEGRATIONS_COLLECTION).doc('custom_webhooks');
        await docRef.set({
            [type]: {
                url,
                ativo,
                atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
                atualizadoPor: userId || context.auth.uid,
            },
        }, { merge: true });
        return { success: true };
    }
    catch (error) {
        console.error('Error saving webhook:', error);
        return { success: false, error: error.message };
    }
});
/**
 * testCustomWebhook — Sends a mock payload to test the webhook URL.
 */
exports.testCustomWebhook = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    const { type } = data;
    if (!type) {
        throw new functions.https.HttpsError('invalid-argument', 'Tipo é obrigatório.');
    }
    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('custom_webhooks').get();
        if (!doc.exists) {
            return { success: false, error: 'Nenhum webhook configurado.' };
        }
        const config = doc.data();
        const webhook = config[type];
        if (!(webhook === null || webhook === void 0 ? void 0 : webhook.url)) {
            return { success: false, error: `Webhook '${type}' não configurado.` };
        }
        // Send mock payload
        const mockPayload = {
            event: `test_${type}`,
            source: 'mentor_de_vendas',
            timestamp: new Date().toISOString(),
            data: {
                message: 'Teste de webhook do Mentor de Vendas',
                type,
            },
        };
        const response = await fetch(webhook.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Mentor-Event': `test_${type}`,
                'X-Mentor-Timestamp': new Date().toISOString(),
            },
            body: JSON.stringify(mockPayload),
        });
        return {
            success: response.ok,
            statusCode: response.status,
            error: response.ok ? undefined : `HTTP ${response.status}`,
        };
    }
    catch (error) {
        console.error('Error testing webhook:', error);
        return { success: false, error: error.message || 'Erro ao enviar teste.' };
    }
});
/**
 * getWebhooksConfig — Returns all webhook configurations.
 */
exports.getWebhooksConfig = functions.https.onCall(async (_data, context) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('custom_webhooks').get();
        if (!doc.exists) {
            return {};
        }
        const data = doc.data();
        // Return config but serialize timestamps
        const result = {};
        for (const key of Object.keys(data)) {
            result[key] = {
                url: ((_a = data[key]) === null || _a === void 0 ? void 0 : _a.url) || '',
                ativo: ((_b = data[key]) === null || _b === void 0 ? void 0 : _b.ativo) || false,
                atualizadoEm: ((_g = (_f = (_e = (_d = (_c = data[key]) === null || _c === void 0 ? void 0 : _c.atualizadoEm) === null || _d === void 0 ? void 0 : _d.toDate) === null || _e === void 0 ? void 0 : _e.call(_d)) === null || _f === void 0 ? void 0 : _f.toISOString) === null || _g === void 0 ? void 0 : _g.call(_f)) || null,
            };
        }
        return result;
    }
    catch (error) {
        console.error('Error getting webhooks config:', error);
        return {};
    }
});
// ========================================
// Respondechat — Configuração
// ========================================
exports.connectRespondechat = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    const { token } = data;
    if (!token) {
        throw new functions.https.HttpsError('invalid-argument', 'Token é obrigatório.');
    }
    try {
        await db.collection(INTEGRATIONS_COLLECTION).doc('respondechat').set({
            token,
            connected: true,
            autoReplyEnabled: false,
            connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { success: true, message: 'Respondechat conectado com sucesso!' };
    }
    catch (error) {
        console.error('Error connecting Respondechat:', error);
        throw new functions.https.HttpsError('internal', 'Erro ao conectar Respondechat.');
    }
});
exports.toggleRespondechatAutoReply = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    const { enabled } = data;
    await db.collection(INTEGRATIONS_COLLECTION).doc('respondechat').set({
        autoReplyEnabled: !!enabled,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { success: true, autoReplyEnabled: !!enabled };
});
exports.getRespondechatStatus = functions.https.onCall(async (_data, context) => {
    var _a, _b, _c, _d;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('respondechat').get();
        if (!doc.exists) {
            return { connected: false, autoReplyEnabled: false };
        }
        const d = doc.data();
        return {
            connected: d.connected || false,
            autoReplyEnabled: d.autoReplyEnabled || false,
            connectedAt: ((_d = (_c = (_b = (_a = d.connectedAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString) === null || _d === void 0 ? void 0 : _d.call(_c)) || null,
        };
    }
    catch (error) {
        console.error('Error getting respondechat status:', error);
        return { connected: false, autoReplyEnabled: false };
    }
});
exports.disconnectRespondechat = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }
    await db.collection(INTEGRATIONS_COLLECTION).doc('respondechat').delete();
    return { success: true };
});
// ========================================
// AI Attendant — Webhook (re-export)
// ========================================
var aiAttendant_1 = require("./aiAttendant");
Object.defineProperty(exports, "respondechatWebhook", { enumerable: true, get: function () { return aiAttendant_1.respondechatWebhook; } });
//# sourceMappingURL=index.js.map