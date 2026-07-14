// ========================================
// Firebase Configuration & Services
// ========================================

// Last Unified Patch: 2026-02-06T19:40-03:00 - Ensure memory sort only
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut as firebaseSignOut,
    onAuthStateChanged,
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import {
    getFirestore,
    collection,
    doc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    Timestamp,
    serverTimestamp,
    onSnapshot,
    deleteField,
} from 'firebase/firestore';
import type { DocumentData, QueryConstraint } from 'firebase/firestore';
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
} from 'firebase/storage';
import type {
    User,
    Product,
    Funnel,
    Flowchart,
    Objection,
    Script,
    Case,
    SupportSession,
    AuditLogEntry,
    AuditAction,
    AuditEntityType,
    Agent,
    AgentObjection,
    AgentCase,
    Conversation,
} from '../types';

// ----------------------------------------
// Firebase Configuration
// ----------------------------------------
const firebaseConfig = {
    apiKey: "AIzaSyCjxcRaOXjQ1O__IPPZuif-Hn0-8dm1yCQ",
    authDomain: "mentor-de-vendas-ekoa.firebaseapp.com",
    projectId: "mentor-de-vendas-ekoa",
    storageBucket: "mentor-de-vendas-ekoa.firebasestorage.app",
    messagingSenderId: "998850770134",
    appId: "1:998850770134:web:0205ef8a0d71c284ef8577",
    measurementId: "G-VQ41H0JHQW",
};

console.log('Firebase Config loaded:', { apiKey: firebaseConfig.apiKey?.substring(0, 10) + '...' });

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ----------------------------------------
// Auth Functions
// ----------------------------------------
export const signIn = (email: string, password: string) =>
    signInWithEmailAndPassword(auth, email, password);

export const signUp = (email: string, password: string) =>
    createUserWithEmailAndPassword(auth, email, password);

export const signOut = () => firebaseSignOut(auth);

export const onAuthChange = (callback: (user: FirebaseUser | null) => void) =>
    onAuthStateChanged(auth, callback);

// ----------------------------------------
// Collection Names
// ----------------------------------------
export const COLLECTIONS = {
    users: 'users',
    products: 'products',
    funnels: 'funnels',
    flowcharts: 'flowcharts',
    objections: 'objectionLibrary',
    scripts: 'scripts',
    cases: 'cases',
    supportSessions: 'supportSessions',
    auditLog: 'auditLog',
    agents: 'agents',
    agentObjections: 'agentObjections',
    agentCases: 'agentCases',
    settings: 'settings',
    conversations: 'conversations',
} as const;

// ----------------------------------------
// Generic CRUD Helpers
// ----------------------------------------
type WithId<T> = T & { id: string };

export async function createDocument<T extends DocumentData>(
    collectionName: string,
    data: Omit<T, 'id'>
): Promise<string> {
    const docRef = await addDoc(collection(db, collectionName), {
        ...data,
        createdAt: serverTimestamp(),
    });
    return docRef.id;
}

export async function createDocumentWithId<T extends DocumentData>(
    collectionName: string,
    id: string,
    data: Omit<T, 'id'>
): Promise<void> {
    const docRef = doc(db, collectionName, id);
    await setDoc(docRef, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
}

export async function updateDocument<T extends DocumentData>(
    collectionName: string,
    id: string,
    data: Partial<T>
): Promise<void> {
    const docRef = doc(db, collectionName, id);
    await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

export async function deleteDocument(
    collectionName: string,
    id: string
): Promise<void> {
    const docRef = doc(db, collectionName, id);
    await deleteDoc(docRef);
}

export async function getDocument<T>(
    collectionName: string,
    id: string
): Promise<WithId<T> | null> {
    const docRef = doc(db, collectionName, id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as WithId<T>;
    }
    return null;
}

export async function getDocuments<T>(
    collectionName: string,
    ...constraints: QueryConstraint[]
): Promise<WithId<T>[]> {
    const q = query(collection(db, collectionName), ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as WithId<T>));
}

// ----------------------------------------
// User Functions
// ----------------------------------------
export const getUser = (id: string) => getDocument<User>(COLLECTIONS.users, id);

// ----------------------------------------
// Product Functions
// ----------------------------------------
export const getProducts = () =>
    getDocuments<Product>(COLLECTIONS.products, orderBy('name'));

export const getActiveProducts = () =>
    getDocuments<Product>(
        COLLECTIONS.products,
        where('status', '==', 'active'),
        orderBy('name')
    );

export const createProduct = (data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) =>
    createDocument<Product>(COLLECTIONS.products, data as unknown as Omit<Product, 'id'>);

export const updateProduct = (id: string, data: Partial<Product>) =>
    updateDocument<Product>(COLLECTIONS.products, id, data);

export const deleteProduct = (id: string) =>
    deleteDocument(COLLECTIONS.products, id);

// ----------------------------------------
// Funnel Functions
// ----------------------------------------
export const getFunnels = (productId?: string) => {
    if (productId) {
        return getDocuments<Funnel>(
            COLLECTIONS.funnels,
            where('productIds', 'array-contains', productId)
        );
    }
    return getDocuments<Funnel>(COLLECTIONS.funnels);
};

export const getFunnel = (id: string) => getDocument<Funnel>(COLLECTIONS.funnels, id);

export const createFunnel = (data: Omit<Funnel, 'id' | 'createdAt' | 'updatedAt'>) =>
    createDocument<Funnel>(COLLECTIONS.funnels, data as unknown as Omit<Funnel, 'id'>);

export const updateFunnel = (id: string, data: Partial<Funnel>) =>
    updateDocument<Funnel>(COLLECTIONS.funnels, id, data);

export const deleteFunnel = (id: string) => deleteDocument(COLLECTIONS.funnels, id);

// ----------------------------------------
// Flowchart Functions (Single version per funnel)
// ----------------------------------------
export const saveFunnelFlowchart = async (
    funnelId: string,
    data: Omit<Flowchart, 'id' | 'createdAt' | 'version' | 'previousFlowchartId'>,
    userId: string
): Promise<string> => {
    // Check if flowchart already exists for this funnel
    const existing = await getActiveFunnelFlowchart(funnelId);

    if (existing) {
        console.log(`[FlowchartDebug] Atualizando fluxograma existente: ${existing.id}`);
        // Update existing
        await updateDocument(COLLECTIONS.flowcharts, existing.id, {
            ...data,
            version: (existing.version || 0) + 1,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
        });
        console.log(`[FlowchartDebug] Atualização concluída com sucesso`);
        return existing.id;
    } else {
        console.log(`[FlowchartDebug] Criando NOVO fluxograma`);
        // Create new
        const newId = await createDocument<Flowchart>(COLLECTIONS.flowcharts, {
            ...data,
            funnelId,
            version: 1, // Default version 1 for compat
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: userId,
        } as unknown as Omit<Flowchart, 'id'>);
        console.log(`[FlowchartDebug] Criação concluída com ID: ${newId}`);
        return newId;
    }
};

// Função unificada para buscar o fluxograma ATIVO (mais recente) de um funil
export const getActiveFunnelFlowchart = async (funnelId: string) => {
    console.log(`[FlowchartDebug] Buscando fluxograma para o funil: ${funnelId}`);
    const results = await getDocuments<Flowchart>(
        COLLECTIONS.flowcharts,
        where('funnelId', '==', funnelId)
    );

    console.log(`[FlowchartDebug] Encontrados ${results.length} documentos`);

    if (results.length === 0) return null;

    // Ordenar em memória para evitar a necessidade de criar um índice composto no Firebase
    const sorted = [...results].sort((a, b) => {
        const getTime = (val: any) => {
            // Se o valor é nulo ou um objeto sem as propriedades de milissegundos, 
            // provavelmente é um serverTimestamp() pendente. Tratamos como o mais novo.
            if (!val) return Date.now() + 60000;

            if (val instanceof Timestamp) return val.toMillis();

            if (typeof val === 'object') {
                if ('toMillis' in val && typeof val.toMillis === 'function') return val.toMillis();
                if ('seconds' in val) return (val.seconds || 0) * 1000;
                // Se for um FieldValue ou objeto desconhecido, tratamos como recém-criado
                return Date.now() + 60000;
            }

            if (typeof val === 'string') {
                const d = new Date(val);
                return isNaN(d.getTime()) ? 0 : d.getTime();
            }
            return 0;
        };
        const timeA = getTime(a.updatedAt || a.createdAt);
        const timeB = getTime(b.updatedAt || b.createdAt);
        return timeB - timeA;
    });

    if (sorted.length > 0) {
        console.log(`[FlowchartDebug] Versão selecionada: ${sorted[0].id} (v${sorted[0].version}) - Atualizada em: ${sorted[0].updatedAt}`);
    }
    return sorted[0] || null;
};

// ----------------------------------------
// Flowchart Functions (Legacy/Versioning)
// ----------------------------------------
export const getFlowcharts = (productId?: string, funnelId?: string) => {
    const constraints: QueryConstraint[] = [];
    if (productId) {
        constraints.push(where('productIds', 'array-contains', productId));
    }
    if (funnelId) {
        constraints.push(where('funnelId', '==', funnelId));
    }
    return getDocuments<Flowchart>(COLLECTIONS.flowcharts, ...constraints);
};

export const getFlowchart = (id: string) => getDocument<Flowchart>(COLLECTIONS.flowcharts, id);

export const getFlowchartVersions = (productId: string, funnelId?: string, scope?: string) => {
    const constraints: QueryConstraint[] = [
        where('productIds', 'array-contains', productId),
    ];
    if (funnelId) {
        constraints.push(where('funnelId', '==', funnelId));
    }
    if (scope) {
        constraints.push(where('scope', '==', scope));
    }
    return getDocuments<Flowchart>(COLLECTIONS.flowcharts, ...constraints);
};

export const createFlowchart = async (
    data: Omit<Flowchart, 'id' | 'createdAt' | 'version'>,
    previousFlowchartId?: string
): Promise<string> => {
    let version = 1;
    if (previousFlowchartId) {
        const prev = await getFlowchart(previousFlowchartId);
        if (prev) {
            version = prev.version + 1;
        }
    }
    return createDocument<Flowchart>(COLLECTIONS.flowcharts, {
        ...data,
        version,
        previousFlowchartId: previousFlowchartId || null,
    } as unknown as Omit<Flowchart, 'id'>);
};

// ----------------------------------------
// Script Functions (with versioning)
// ----------------------------------------
export const getScripts = (productId?: string, funnelId?: string) => {
    const constraints: QueryConstraint[] = [];
    if (productId) {
        constraints.push(where('productIds', 'array-contains', productId));
    }
    if (funnelId) {
        constraints.push(where('funnelId', '==', funnelId));
    }
    return getDocuments<Script>(COLLECTIONS.scripts, ...constraints);
};

export const getScript = (id: string) => getDocument<Script>(COLLECTIONS.scripts, id);

export const createScript = async (
    data: Omit<Script, 'id' | 'createdAt' | 'version'>,
    previousScriptId?: string
): Promise<string> => {
    let version = 1;
    if (previousScriptId) {
        const prev = await getScript(previousScriptId);
        if (prev) {
            version = prev.version + 1;
        }
    }
    return createDocument<Script>(COLLECTIONS.scripts, {
        ...data,
        version,
        previousScriptId: previousScriptId || null,
    } as unknown as Omit<Script, 'id'>);
};

export const updateScript = (id: string, data: Partial<Script>) =>
    updateDocument<Script>(COLLECTIONS.scripts, id, data);

export const deleteScript = (id: string) => deleteDocument(COLLECTIONS.scripts, id);

// ----------------------------------------
// Objection Functions
// ----------------------------------------
export const getObjections = (productId?: string) => {
    if (productId) {
        return getDocuments<Objection>(
            COLLECTIONS.objections,
            where('productIds', 'array-contains', productId)
        );
    }
    return getDocuments<Objection>(COLLECTIONS.objections);
};

export const getObjection = (id: string) => getDocument<Objection>(COLLECTIONS.objections, id);

export const createObjection = (data: Omit<Objection, 'id' | 'createdAt' | 'updatedAt'>) =>
    createDocument<Objection>(COLLECTIONS.objections, data as unknown as Omit<Objection, 'id'>);

export const updateObjection = (id: string, data: Partial<Objection>) =>
    updateDocument<Objection>(COLLECTIONS.objections, id, data);

export const deleteObjection = (id: string) => deleteDocument(COLLECTIONS.objections, id);

// ----------------------------------------
// Case Functions
// ----------------------------------------
export const getCases = (productId?: string, funnelId?: string, classification?: string) => {
    const constraints: QueryConstraint[] = [];
    if (productId) {
        constraints.push(where('productId', '==', productId));
    }
    if (funnelId) {
        constraints.push(where('funnelId', '==', funnelId));
    }
    if (classification) {
        constraints.push(where('classification', '==', classification));
    }
    return getDocuments<Case>(COLLECTIONS.cases, ...constraints);
};

export const getCase = (id: string) => getDocument<Case>(COLLECTIONS.cases, id);

export const createCase = (data: Omit<Case, 'id' | 'createdAt'>) =>
    createDocument<Case>(COLLECTIONS.cases, data as unknown as Omit<Case, 'id'>);

export const updateCase = (id: string, data: Partial<Case>) =>
    updateDocument<Case>(COLLECTIONS.cases, id, data);

export const deleteCase = (id: string) => deleteDocument(COLLECTIONS.cases, id);

// ----------------------------------------
// Support Session Functions
// ----------------------------------------
export const getSupportSessions = (productId?: string) => {
    if (productId) {
        return getDocuments<SupportSession>(
            COLLECTIONS.supportSessions,
            where('productId', '==', productId)
        );
    }
    return getDocuments<SupportSession>(COLLECTIONS.supportSessions);
};

export const createSupportSession = (data: Omit<SupportSession, 'id' | 'createdAt'>) =>
    createDocument<SupportSession>(COLLECTIONS.supportSessions, data as unknown as Omit<SupportSession, 'id'>);

// ----------------------------------------
// Audit Log Functions
// ----------------------------------------
export const getAuditLog = (entityType?: AuditEntityType) => {
    if (entityType) {
        return getDocuments<AuditLogEntry>(
            COLLECTIONS.auditLog,
            where('entityType', '==', entityType)
        );
    }
    return getDocuments<AuditLogEntry>(COLLECTIONS.auditLog);
};

export const logAudit = (
    actorId: string,
    actorName: string,
    action: AuditAction,
    entityType: AuditEntityType,
    entityId: string,
    entityName: string,
    metadata: Record<string, unknown> = {}
) =>
    createDocument<AuditLogEntry>(COLLECTIONS.auditLog, {
        actorId,
        actorName,
        action,
        entityType,
        entityId,
        entityName,
        metadata,
    } as unknown as Omit<AuditLogEntry, 'id'>);

// ----------------------------------------
// Agent Functions
// ----------------------------------------
export const getAgents = (productId: string) =>
    getDocuments<Agent>(COLLECTIONS.agents, where('productId', '==', productId));

export const getAgent = (id: string) =>
    getDocument<Agent>(COLLECTIONS.agents, id);

export const createAgent = (data: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>) =>
    createDocument<Agent>(COLLECTIONS.agents, data as unknown as Omit<Agent, 'id'>);

export const updateAgent = (id: string, data: Partial<Agent>) =>
    updateDocument<Agent>(COLLECTIONS.agents, id, data);

export const deleteAgent = (id: string) =>
    deleteDocument(COLLECTIONS.agents, id);

// ----------------------------------------
// Agent Objection Functions
// ----------------------------------------
export const getAgentObjections = (agentId: string) =>
    getDocuments<AgentObjection>(COLLECTIONS.agentObjections, where('agentId', '==', agentId));

export const createAgentObjection = (data: Omit<AgentObjection, 'id' | 'createdAt' | 'updatedAt'>) =>
    createDocument<AgentObjection>(COLLECTIONS.agentObjections, data as unknown as Omit<AgentObjection, 'id'>);

export const updateAgentObjection = (id: string, data: Partial<AgentObjection>) =>
    updateDocument<AgentObjection>(COLLECTIONS.agentObjections, id, data);

export const deleteAgentObjection = (id: string) =>
    deleteDocument(COLLECTIONS.agentObjections, id);

// ----------------------------------------
// Agent Case Functions
// ----------------------------------------
export const getAgentCases = (agentId: string) =>
    getDocuments<AgentCase>(COLLECTIONS.agentCases, where('agentId', '==', agentId));

export const createAgentCase = (data: Omit<AgentCase, 'id' | 'createdAt' | 'updatedAt'>) =>
    createDocument<AgentCase>(COLLECTIONS.agentCases, data as unknown as Omit<AgentCase, 'id'>);

export const updateAgentCase = (id: string, data: Partial<AgentCase>) =>
    updateDocument<AgentCase>(COLLECTIONS.agentCases, id, data);

export const deleteAgentCase = (id: string) =>
    deleteDocument(COLLECTIONS.agentCases, id);

// ----------------------------------------
// App Settings Functions
// ----------------------------------------
export async function getAppSettings(): Promise<Record<string, unknown> | null> {
    const docRef = doc(db, COLLECTIONS.settings, 'app');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return docSnap.data() as Record<string, unknown>;
    }
    return null;
}

export async function saveAppSettings(data: Record<string, unknown>): Promise<void> {
    const docRef = doc(db, COLLECTIONS.settings, 'app');
    await setDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

/**
 * Grava os chips (canais). Como settings é salvo com merge, apagar um chip do
 * objeto não basta — a chave antiga sobreviveria no Firestore. Por isso os
 * slugs removidos entram como deleteField() para sumirem de verdade. Renomear
 * um slug conta como remover o antigo + criar o novo, então também limpa certo.
 */
export async function saveCanais(
    canais: Record<string, unknown>,
    slugsRemovidos: string[] = [],
): Promise<void> {
    const docRef = doc(db, COLLECTIONS.settings, 'app');
    const canaisPayload: Record<string, unknown> = { ...canais };
    for (const slug of slugsRemovidos) {
        if (!(slug in canaisPayload)) {
            canaisPayload[slug] = deleteField();
        }
    }
    await setDoc(docRef, {
        canais: canaisPayload,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

// ----------------------------------------
// Conversation Functions
// ----------------------------------------
export const getConversations = () =>
    getDocuments<Conversation>(COLLECTIONS.conversations);

export const subscribeConversations = (
    callback: (conversations: WithId<Conversation>[]) => void
) => {
    const q = query(collection(db, COLLECTIONS.conversations));
    return onSnapshot(q, (snapshot) => {
        const conversations = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
        } as WithId<Conversation>));
        callback(conversations);
    }, (error) => {
        console.error("Erro no listener de conversas:", error);
    });
};

// ----------------------------------------
// Saúde dos chips (vigia de entrega)
// ----------------------------------------
// Espelha settings/chipSaude, gravado pela função agendada vigiaSaudeChips.
export interface ChipSaude {
    nome: string;
    status: 'ok' | 'suspeito';
    enviados: number;
    comResposta: number;
    desde: number | null;
}

export interface ChipSaudeDoc {
    atualizadoEm?: unknown;
    janelaMin?: number;
    minEnvios?: number;
    canais: Record<string, ChipSaude>;
}

/** Assina o diagnóstico de saúde dos chips em tempo real. */
export const subscribeChipSaude = (
    callback: (doc: ChipSaudeDoc | null) => void
) => {
    const docRef = doc(db, COLLECTIONS.settings, 'chipSaude');
    return onSnapshot(docRef, (snap) => {
        callback(snap.exists() ? (snap.data() as ChipSaudeDoc) : null);
    }, (error) => {
        console.error('Erro no listener de saúde dos chips:', error);
    });
};

export const setConversationAtivo = (id: string, ativo: boolean) =>
    updateDocument(COLLECTIONS.conversations, id, { ativo });

export const setConversationRemarketing = (id: string, remarketingAtivo: boolean) =>
    updateDocument(COLLECTIONS.conversations, id, { remarketingAtivo });

export const setConversationArquivada = (id: string, arquivada: boolean) =>
    updateDocument(COLLECTIONS.conversations, id, { arquivada });

/** Baixa o alerta de falha da IA depois que o vendedor assumiu a conversa. */
export const limparFalhaIA = (id: string) =>
    updateDocument(COLLECTIONS.conversations, id, { falhaIA: false });

export const resetConversation = (id: string) =>
    updateDocument(COLLECTIONS.conversations, id, {
        messages: [],
        ativo: false,
        ultimaMensagemTs: null,
        leadPronto: false,
        remarketingEnviado: false,
        falhaIA: false,
        updatedAt: serverTimestamp()
    });

export const deleteConversation = (id: string) =>
    deleteDocument(COLLECTIONS.conversations, id);

// ----------------------------------------
// Storage Functions
// ----------------------------------------
export const uploadFile = async (
    file: File,
    path: string
): Promise<string> => {
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
};

// Re-export useful Firestore types
export { Timestamp, serverTimestamp, where, orderBy, query };
