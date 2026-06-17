import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

admin.initializeApp();

// ========================================
// Existing: Check Delivery Logzz (Gen 2)
// ========================================

interface CheckDeliveryRequest {
    city: string;
    uf: string;
    product_id?: number | string;
    offer_id?: number | string;
}

export const checkDeliveryLogzz = onCall({ memory: '256MiB' }, async (request) => {
    const { city, uf, product_id, offer_id } = request.data as CheckDeliveryRequest;

    if (!city || !uf) {
        throw new HttpsError('invalid-argument', 'The function must be called with city and uf.');
    }

    try {
        const logzzEndpoint = 'https://entrega.logzz.com.br';
        const logzzUrl = new URL(`${logzzEndpoint}/get-city-operation`);
        logzzUrl.searchParams.append('city', city);
        logzzUrl.searchParams.append('uf', uf);

        if (product_id) logzzUrl.searchParams.append('product_id', String(product_id));
        if (offer_id) logzzUrl.searchParams.append('offer_id', String(offer_id));

        const response = await fetch(logzzUrl.toString(), {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        let available = false;
        let days: string[] = [];

        if (response.ok) {
            const logzzData = await response.json();
            if (logzzData.hasOperation && logzzData.delivery_day_options?.length > 0) {
                available = true;
                const allDays = logzzData.delivery_day_options.flatMap((opt: any) =>
                    opt.dates?.map((d: any) => d.weekdayName) || []
                ).filter(Boolean);
                days = [...new Set(allDays)] as string[];
            }
        } else {
            console.error(`Logzz API returned ${response.status}: ${await response.text()}`);
            throw new HttpsError('internal', 'Logzz API failed to check delivery');
        }

        return {
            available,
            days
        };
    } catch (error) {
        console.error('Error in checkDeliveryLogzz:', error);
        throw new HttpsError('internal', 'Internal error while checking delivery');
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
export const connectClaudeAI = functions.https.onCall(async (data: { apiKey: string }, context) => {
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
            const errorMsg = errorData?.error?.message || `HTTP ${testResponse.status}`;
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
    } catch (error: any) {
        console.error('Error connecting Claude AI:', error);
        return { success: false, error: error.message || 'Erro interno ao validar API Key.' };
    }
});

/**
 * disconnectClaudeAI — Deletes the integration document.
 */
export const disconnectClaudeAI = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }

    try {
        await db.collection(INTEGRATIONS_COLLECTION).doc('claude_ai').delete();
        return { success: true };
    } catch (error: any) {
        console.error('Error disconnecting Claude AI:', error);
        return { success: false, error: error.message };
    }
});

/**
 * getClaudeAIStatus — Returns connection status. NEVER exposes the API key.
 */
export const getClaudeAIStatus = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }

    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('claude_ai').get();
        if (!doc.exists) {
            return { connected: false };
        }

        const data = doc.data()!;
        return {
            connected: data.connected || false,
            connectedAt: data.connectedAt?.toDate?.()?.toISOString?.() || null,
        };
    } catch (error: any) {
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
export const connectWhatsApp = functions.https.onCall(async (data: { instance: string; token: string; notificationPhone: string }, context) => {
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
    } catch (error: any) {
        console.error('Error connecting WhatsApp:', error);
        return { success: false, error: error.message || 'Erro ao validar credenciais Z-API.' };
    }
});

/**
 * disconnectWhatsApp — Deletes the integration document.
 */
export const disconnectWhatsApp = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }

    try {
        await db.collection(INTEGRATIONS_COLLECTION).doc('whatsapp').delete();
        return { success: true };
    } catch (error: any) {
        console.error('Error disconnecting WhatsApp:', error);
        return { success: false, error: error.message };
    }
});

/**
 * getWhatsAppStatus — Returns connection status. NEVER exposes token.
 */
export const getWhatsAppStatus = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }

    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('whatsapp').get();
        if (!doc.exists) {
            return { connected: false };
        }

        const data = doc.data()!;
        return {
            connected: data.connected || false,
            connectedAt: data.connectedAt?.toDate?.()?.toISOString?.() || null,
            notificationPhone: data.notificationPhone || null,
            instance: data.instance || null,
        };
    } catch (error: any) {
        console.error('Error getting WhatsApp status:', error);
        return { connected: false };
    }
});

/**
 * testWhatsApp — Sends a test message.
 */
export const testWhatsApp = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }

    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('whatsapp').get();
        if (!doc.exists) {
            return { success: false, error: 'WhatsApp não configurado.' };
        }

        const config = doc.data()!;
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
    } catch (error: any) {
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
export const saveCustomWebhook = functions.https.onCall(async (data: { type: string; url: string; ativo: boolean; userId: string }, context) => {
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
    } catch {
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
    } catch (error: any) {
        console.error('Error saving webhook:', error);
        return { success: false, error: error.message };
    }
});

/**
 * testCustomWebhook — Sends a mock payload to test the webhook URL.
 */
export const testCustomWebhook = functions.https.onCall(async (data: { type: string }, context) => {
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

        const config = doc.data()!;
        const webhook = config[type];
        if (!webhook?.url) {
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
    } catch (error: any) {
        console.error('Error testing webhook:', error);
        return { success: false, error: error.message || 'Erro ao enviar teste.' };
    }
});

/**
 * getWebhooksConfig — Returns all webhook configurations.
 */
export const getWebhooksConfig = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }

    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('custom_webhooks').get();
        if (!doc.exists) {
            return {};
        }

        const data = doc.data()!;
        // Return config but serialize timestamps
        const result: any = {};
        for (const key of Object.keys(data)) {
            result[key] = {
                url: data[key]?.url || '',
                ativo: data[key]?.ativo || false,
                atualizadoEm: data[key]?.atualizadoEm?.toDate?.()?.toISOString?.() || null,
            };
        }
        return result;
    } catch (error: any) {
        console.error('Error getting webhooks config:', error);
        return {};
    }
});

// ========================================
// Respondechat — Configuração
// ========================================

export const connectRespondechat = functions.https.onCall(async (data, context) => {
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
    } catch (error: any) {
        console.error('Error connecting Respondechat:', error);
        throw new functions.https.HttpsError('internal', 'Erro ao conectar Respondechat.');
    }
});

export const toggleRespondechatAutoReply = functions.https.onCall(async (data, context) => {
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

export const getRespondechatStatus = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }

    try {
        const doc = await db.collection(INTEGRATIONS_COLLECTION).doc('respondechat').get();
        if (!doc.exists) {
            return { connected: false, autoReplyEnabled: false };
        }
        const d = doc.data()!;
        return {
            connected: d.connected || false,
            autoReplyEnabled: d.autoReplyEnabled || false,
            connectedAt: d.connectedAt?.toDate?.()?.toISOString?.() || null,
        };
    } catch (error: any) {
        console.error('Error getting respondechat status:', error);
        return { connected: false, autoReplyEnabled: false };
    }
});

export const disconnectRespondechat = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário deve estar logado.');
    }

    await db.collection(INTEGRATIONS_COLLECTION).doc('respondechat').delete();
    return { success: true };
});

// ========================================
// AI Attendant — Webhook (re-export)
// ========================================
export { respondechatWebhook } from './aiAttendant';
