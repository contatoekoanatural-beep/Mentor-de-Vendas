import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
    id: string;
    title?: string;
    message: string;
    type: ToastType;
    duration?: number;
}

interface ToastContextData {
    addToast: (message: string, type?: ToastType, duration?: number, title?: string) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextData>({} as ToastContextData);

export const useToast = () => useContext(ToastContext);

// Component de Icone separado
const ToastIcon = ({ type }: { type: ToastType }) => {
    switch (type) {
        case 'success': return <CheckCircle size={20} className="toast-icon" />;
        case 'error': return <AlertCircle size={20} className="toast-icon" />;
        case 'warning': return <AlertTriangle size={20} className="toast-icon" />;
        case 'info': default: return <Info size={20} className="toast-icon" />;
    }
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts(state => state.filter(t => t.id !== id));
    }, []);

    const addToast = useCallback((message: string, type: ToastType = 'info', duration = 3000, title?: string) => {
        const id = uuidv4();
        const newToast: Toast = { id, message, type, duration, title };

        setToasts(state => [...state, newToast]);

        if (duration) {
            setTimeout(() => {
                removeToast(id);
            }, duration);
        }
    }, [removeToast]);

    return (
        <ToastContext.Provider value={{ addToast, removeToast }}>
            {children}
            <div className="toast-container">
                {toasts.map(toast => (
                    <div key={toast.id} className={`toast toast-${toast.type}`} role="alert">
                        <ToastIcon type={toast.type} />
                        <div className="toast-content">
                            {toast.title && <div className="toast-title">{toast.title}</div>}
                            <div className="toast-message">{toast.message}</div>
                        </div>
                        <button onClick={() => removeToast(toast.id)} className="toast-close">
                            <X size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};
