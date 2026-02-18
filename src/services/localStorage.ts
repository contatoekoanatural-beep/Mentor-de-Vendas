// ========================================
// Local Storage Service - Mock Data Layer
// ========================================
// Este serviço permite que a aplicação funcione sem Firebase configurado
// Os dados são persistidos no localStorage do navegador

import type {
    Product,
    Funnel,
    Flowchart,
    Objection,
    Script,
    Case,
    SupportSession,
    AuditLogEntry,
    FunnelTransition,
    DynamicConditionNode,
} from '../types';
import { v4 as uuidv4 } from 'uuid';

// Storage keys
const STORAGE_KEYS = {
    products: 'ekoa_products',
    funnels: 'ekoa_funnels',
    flowcharts: 'ekoa_flowcharts',
    objections: 'ekoa_objections',
    scripts: 'ekoa_scripts',
    cases: 'ekoa_cases',
    supportSessions: 'ekoa_supportSessions',
    auditLog: 'ekoa_auditLog',
    funnelTransitions: 'ekoa_funnelTransitions',
    dynamicConditions: 'ekoa_dynamicConditions',
} as const;

// Helper functions
function getStorageData<T>(key: string): T[] {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function setStorageData<T>(key: string, data: T[]): void {
    localStorage.setItem(key, JSON.stringify(data));
}

function generateId(): string {
    return uuidv4();
}

function now(): string {
    return new Date().toISOString();
}

// ----------------------------------------
// Products
// ----------------------------------------
export function getLocalProducts(): Product[] {
    return getStorageData<Product>(STORAGE_KEYS.products);
}

export function getLocalActiveProducts(): Product[] {
    return getLocalProducts().filter(p => p.status === 'active');
}

export function createLocalProduct(data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Product {
    const products = getLocalProducts();
    const newProduct: Product = {
        ...data,
        id: generateId(),
        createdAt: now() as unknown as import('firebase/firestore').Timestamp,
        updatedAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    products.push(newProduct);
    setStorageData(STORAGE_KEYS.products, products);
    return newProduct;
}

export function updateLocalProduct(id: string, data: Partial<Product>): Product | null {
    const products = getLocalProducts();
    const index = products.findIndex(p => p.id === id);
    if (index === -1) return null;

    products[index] = {
        ...products[index],
        ...data,
        updatedAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    setStorageData(STORAGE_KEYS.products, products);
    return products[index];
}

export function deleteLocalProduct(id: string): boolean {
    const products = getLocalProducts();
    const filtered = products.filter(p => p.id !== id);
    if (filtered.length === products.length) return false;
    setStorageData(STORAGE_KEYS.products, filtered);
    return true;
}

// ----------------------------------------
// Funnels
// ----------------------------------------
export function getLocalFunnels(productId?: string): Funnel[] {
    const funnels = getStorageData<Funnel>(STORAGE_KEYS.funnels);
    if (productId) {
        return funnels.filter(f => f.productIds?.includes(productId));
    }
    return funnels;
}

export function getLocalFunnel(id: string): Funnel | null {
    const funnels = getLocalFunnels();
    return funnels.find(f => f.id === id) || null;
}

export function createLocalFunnel(data: Omit<Funnel, 'id' | 'createdAt' | 'updatedAt'>): Funnel {
    const funnels = getLocalFunnels();
    const newFunnel: Funnel = {
        ...data,
        id: generateId(),
        createdAt: now() as unknown as import('firebase/firestore').Timestamp,
        updatedAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    funnels.push(newFunnel);
    setStorageData(STORAGE_KEYS.funnels, funnels);
    return newFunnel;
}

export function updateLocalFunnel(id: string, data: Partial<Funnel>): Funnel | null {
    const funnels = getLocalFunnels();
    const index = funnels.findIndex(f => f.id === id);
    if (index === -1) return null;

    funnels[index] = {
        ...funnels[index],
        ...data,
        updatedAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    setStorageData(STORAGE_KEYS.funnels, funnels);
    return funnels[index];
}

export function deleteLocalFunnel(id: string): boolean {
    const funnels = getLocalFunnels();
    const filtered = funnels.filter(f => f.id !== id);
    if (filtered.length === funnels.length) return false;
    setStorageData(STORAGE_KEYS.funnels, filtered);
    return true;
}

// ----------------------------------------
// Flowcharts
// ----------------------------------------
export function getLocalFlowcharts(productId?: string, funnelId?: string): Flowchart[] {
    let flowcharts = getStorageData<Flowchart>(STORAGE_KEYS.flowcharts);
    if (productId) {
        flowcharts = flowcharts.filter(f => f.productIds?.includes(productId));
    }
    if (funnelId) {
        flowcharts = flowcharts.filter(f => f.funnelId === funnelId);
    }
    return flowcharts.sort((a, b) => b.version - a.version);
}

export function getLocalFlowchart(id: string): Flowchart | null {
    const flowcharts = getStorageData<Flowchart>(STORAGE_KEYS.flowcharts);
    return flowcharts.find(f => f.id === id) || null;
}

export function getLocalFlowchartVersions(productId: string, funnelId?: string, scope?: string): Flowchart[] {
    let flowcharts = getLocalFlowcharts(productId, funnelId);
    if (scope) {
        flowcharts = flowcharts.filter(f => f.scope === scope);
    }
    return flowcharts.sort((a, b) => b.version - a.version);
}

export function createLocalFlowchart(
    data: Omit<Flowchart, 'id' | 'createdAt' | 'version'>,
    previousFlowchartId?: string
): Flowchart {
    const flowcharts = getStorageData<Flowchart>(STORAGE_KEYS.flowcharts);

    let version = 1;
    if (previousFlowchartId) {
        const prev = flowcharts.find(f => f.id === previousFlowchartId);
        if (prev) {
            version = prev.version + 1;
        }
    }

    const newFlowchart: Flowchart = {
        ...data,
        id: generateId(),
        version,
        previousFlowchartId: previousFlowchartId || null,
        createdAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    flowcharts.push(newFlowchart);
    setStorageData(STORAGE_KEYS.flowcharts, flowcharts);
    return newFlowchart;
}

// ----------------------------------------
// Scripts (connected to flowchart nodes)
// ----------------------------------------
export function getLocalScripts(productId?: string, funnelId?: string): Script[] {
    let scripts = getStorageData<Script>(STORAGE_KEYS.scripts);
    if (productId) {
        scripts = scripts.filter(s => s.productIds?.includes(productId));
    }
    if (funnelId) {
        scripts = scripts.filter(s => s.funnelId === funnelId);
    }
    return scripts;
}

export function getLocalScript(id: string): Script | null {
    const scripts = getLocalScripts();
    return scripts.find(s => s.id === id) || null;
}

export function createLocalScript(
    data: Omit<Script, 'id' | 'createdAt' | 'version'>,
    previousScriptId?: string
): Script {
    const scripts = getStorageData<Script>(STORAGE_KEYS.scripts);

    let version = 1;
    if (previousScriptId) {
        const prev = scripts.find(s => s.id === previousScriptId);
        if (prev) {
            version = prev.version + 1;
        }
    }

    const newScript: Script = {
        ...data,
        id: generateId(),
        version,
        previousScriptId: previousScriptId || null,
        createdAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    scripts.push(newScript);
    setStorageData(STORAGE_KEYS.scripts, scripts);
    return newScript;
}

export function updateLocalScript(id: string, data: Partial<Script>): Script | null {
    const scripts = getLocalScripts();
    const index = scripts.findIndex(s => s.id === id);
    if (index === -1) return null;

    scripts[index] = {
        ...scripts[index],
        ...data,
    };
    setStorageData(STORAGE_KEYS.scripts, scripts);
    return scripts[index];
}

export function deleteLocalScript(id: string): boolean {
    const scripts = getLocalScripts();
    const filtered = scripts.filter(s => s.id !== id);
    if (filtered.length === scripts.length) return false;
    setStorageData(STORAGE_KEYS.scripts, filtered);
    return true;
}

// ----------------------------------------
// Objections
// ----------------------------------------
export function getLocalObjections(productId?: string): Objection[] {
    let objections = getStorageData<Objection>(STORAGE_KEYS.objections);
    if (productId) {
        objections = objections.filter(o => o.productIds?.includes(productId));
    }
    return objections;
}

export function getLocalObjection(id: string): Objection | null {
    const objections = getLocalObjections();
    return objections.find(o => o.id === id) || null;
}

export function createLocalObjection(data: Omit<Objection, 'id' | 'createdAt' | 'updatedAt'>): Objection {
    const objections = getStorageData<Objection>(STORAGE_KEYS.objections);
    const newObjection: Objection = {
        ...data,
        id: generateId(),
        createdAt: now() as unknown as import('firebase/firestore').Timestamp,
        updatedAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    objections.push(newObjection);
    setStorageData(STORAGE_KEYS.objections, objections);
    return newObjection;
}

export function updateLocalObjection(id: string, data: Partial<Objection>): Objection | null {
    const objections = getLocalObjections();
    const index = objections.findIndex(o => o.id === id);
    if (index === -1) return null;

    objections[index] = {
        ...objections[index],
        ...data,
        updatedAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    setStorageData(STORAGE_KEYS.objections, objections);
    return objections[index];
}

export function deleteLocalObjection(id: string): boolean {
    const objections = getLocalObjections();
    const filtered = objections.filter(o => o.id !== id);
    if (filtered.length === objections.length) return false;
    setStorageData(STORAGE_KEYS.objections, filtered);
    return true;
}

// ----------------------------------------
// Cases
// ----------------------------------------
export function getLocalCases(productId?: string, funnelId?: string, classification?: string): Case[] {
    let cases = getStorageData<Case>(STORAGE_KEYS.cases);
    if (productId) {
        cases = cases.filter(c => c.productId === productId);
    }
    if (funnelId) {
        cases = cases.filter(c => c.funnelId === funnelId);
    }
    if (classification) {
        cases = cases.filter(c => c.classification === classification);
    }
    return cases.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getLocalCase(id: string): Case | null {
    const cases = getStorageData<Case>(STORAGE_KEYS.cases);
    return cases.find(c => c.id === id) || null;
}

export function createLocalCase(data: Omit<Case, 'id' | 'createdAt'>): Case {
    const cases = getStorageData<Case>(STORAGE_KEYS.cases);
    const newCase: Case = {
        ...data,
        id: generateId(),
        createdAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    cases.push(newCase);
    setStorageData(STORAGE_KEYS.cases, cases);
    return newCase;
}

export function updateLocalCase(id: string, data: Partial<Case>): Case | null {
    const cases = getStorageData<Case>(STORAGE_KEYS.cases);
    const index = cases.findIndex(c => c.id === id);
    if (index === -1) return null;

    cases[index] = {
        ...cases[index],
        ...data,
    };
    setStorageData(STORAGE_KEYS.cases, cases);
    return cases[index];
}

export function deleteLocalCase(id: string): boolean {
    const cases = getStorageData<Case>(STORAGE_KEYS.cases);
    const filtered = cases.filter(c => c.id !== id);
    if (filtered.length === cases.length) return false;
    setStorageData(STORAGE_KEYS.cases, filtered);
    return true;
}

// ----------------------------------------
// Support Sessions
// ----------------------------------------
export function getLocalSupportSessions(productId?: string): SupportSession[] {
    let sessions = getStorageData<SupportSession>(STORAGE_KEYS.supportSessions);
    if (productId) {
        sessions = sessions.filter(s => s.productId === productId);
    }
    return sessions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function createLocalSupportSession(data: Omit<SupportSession, 'id' | 'createdAt'>): SupportSession {
    const sessions = getStorageData<SupportSession>(STORAGE_KEYS.supportSessions);
    const newSession: SupportSession = {
        ...data,
        id: generateId(),
        createdAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    sessions.push(newSession);
    setStorageData(STORAGE_KEYS.supportSessions, sessions);
    return newSession;
}

// ----------------------------------------
// Audit Log
// ----------------------------------------
export function getLocalAuditLog(): AuditLogEntry[] {
    return getStorageData<AuditLogEntry>(STORAGE_KEYS.auditLog)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 50);
}

export function logLocalAudit(
    actorId: string,
    actorName: string,
    action: 'create' | 'update' | 'delete',
    entityType: string,
    entityId: string,
    entityName: string,
    metadata: Record<string, unknown> = {}
): AuditLogEntry {
    const logs = getStorageData<AuditLogEntry>(STORAGE_KEYS.auditLog);
    const newLog: AuditLogEntry = {
        id: generateId(),
        actorId,
        actorName,
        action: action as import('../types').AuditAction,
        entityType: entityType as import('../types').AuditEntityType,
        entityId,
        entityName,
        metadata,
        createdAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    logs.unshift(newLog);
    // Keep only last 100 entries
    setStorageData(STORAGE_KEYS.auditLog, logs.slice(0, 100));
    return newLog;
}

// ----------------------------------------
// File Upload (using data URLs)
// ----------------------------------------
export async function uploadLocalFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ----------------------------------------
// Funnel Transitions (Lead Journey)
// ----------------------------------------
export function getLocalFunnelTransitions(productId: string): FunnelTransition[] {
    const transitions = getStorageData<FunnelTransition>(STORAGE_KEYS.funnelTransitions);
    return transitions.filter(t => t.productId === productId);
}

export function createLocalFunnelTransition(
    data: Omit<FunnelTransition, 'id' | 'createdAt'>
): FunnelTransition {
    const transitions = getStorageData<FunnelTransition>(STORAGE_KEYS.funnelTransitions);
    const newTransition: FunnelTransition = {
        ...data,
        id: generateId(),
        createdAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    transitions.push(newTransition);
    setStorageData(STORAGE_KEYS.funnelTransitions, transitions);
    return newTransition;
}

export function deleteLocalFunnelTransition(id: string): boolean {
    const transitions = getStorageData<FunnelTransition>(STORAGE_KEYS.funnelTransitions);
    const filtered = transitions.filter(t => t.id !== id);
    if (filtered.length === transitions.length) return false;
    setStorageData(STORAGE_KEYS.funnelTransitions, filtered);
    return true;
}

// ----------------------------------------
// Dynamic Condition Nodes
// ----------------------------------------
export function getLocalDynamicConditions(productId?: string, funnelId?: string): DynamicConditionNode[] {
    let conditions = getStorageData<DynamicConditionNode>(STORAGE_KEYS.dynamicConditions);
    if (productId) {
        conditions = conditions.filter(c => c.productId === productId);
    }
    if (funnelId) {
        conditions = conditions.filter(c => c.funnelId === funnelId);
    }
    return conditions;
}

export function getLocalDynamicCondition(id: string): DynamicConditionNode | null {
    const conditions = getStorageData<DynamicConditionNode>(STORAGE_KEYS.dynamicConditions);
    return conditions.find(c => c.id === id) || null;
}

export function createLocalDynamicCondition(
    data: Omit<DynamicConditionNode, 'id' | 'createdAt' | 'updatedAt'>
): DynamicConditionNode {
    const conditions = getStorageData<DynamicConditionNode>(STORAGE_KEYS.dynamicConditions);
    const newCondition: DynamicConditionNode = {
        ...data,
        id: generateId(),
        createdAt: now() as unknown as import('firebase/firestore').Timestamp,
        updatedAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    conditions.push(newCondition);
    setStorageData(STORAGE_KEYS.dynamicConditions, conditions);
    return newCondition;
}

export function updateLocalDynamicCondition(
    id: string,
    data: Partial<DynamicConditionNode>
): DynamicConditionNode | null {
    const conditions = getStorageData<DynamicConditionNode>(STORAGE_KEYS.dynamicConditions);
    const index = conditions.findIndex(c => c.id === id);
    if (index === -1) return null;

    conditions[index] = {
        ...conditions[index],
        ...data,
        updatedAt: now() as unknown as import('firebase/firestore').Timestamp,
    };
    setStorageData(STORAGE_KEYS.dynamicConditions, conditions);
    return conditions[index];
}

export function deleteLocalDynamicCondition(id: string): boolean {
    const conditions = getStorageData<DynamicConditionNode>(STORAGE_KEYS.dynamicConditions);
    const filtered = conditions.filter(c => c.id !== id);
    if (filtered.length === conditions.length) return false;
    setStorageData(STORAGE_KEYS.dynamicConditions, filtered);
    return true;
}

// ----------------------------------------
// Initialize with sample data if empty
// ----------------------------------------
export function initializeSampleData(): void {
    const products = getLocalProducts();
    if (products.length === 0) {
        // Create a sample product
        createLocalProduct({
            name: 'Ekoa Cosméticos',
            description: 'Linha completa de cosméticos naturais',
            status: 'active',
            ownerId: 'owner-1',
        });
    }
}
