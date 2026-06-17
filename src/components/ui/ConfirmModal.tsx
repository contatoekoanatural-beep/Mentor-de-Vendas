import { AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
    isDestructive?: boolean;
}

export const ConfirmModal = ({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    isDestructive = false
}: ConfirmModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: '400px' }}>
                <div className="modal-header">
                    <div className="flex items-center gap-2">
                        {isDestructive && <AlertTriangle className="text-red-500" size={24} />}
                        <h3 className="modal-title text-lg">{title}</h3>
                    </div>
                </div>
                <div className="modal-body">
                    <p className="text-muted text-sm">{message}</p>
                </div>
                <div className="modal-footer flex justify-end gap-2 p-4 pt-0 border-t-0">
                    <button onClick={onCancel} className="btn btn-secondary">
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`btn ${isDestructive ? 'btn-danger' : 'btn-primary'}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};
