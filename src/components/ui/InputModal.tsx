import { useState, useEffect, type FormEvent } from 'react';

interface InputModalProps {
    isOpen: boolean;
    title: string;
    message?: string;
    initialValue?: string;
    placeholder?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
}

export const InputModal = ({
    isOpen,
    title,
    message,
    initialValue = '',
    placeholder = 'Digite aqui...',
    onConfirm,
    onCancel,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar'
}: InputModalProps) => {
    const [inputValue, setInputValue] = useState(initialValue);

    useEffect(() => {
        if (isOpen) {
            setInputValue(initialValue);
        }
    }, [isOpen, initialValue]);

    if (!isOpen) return null;

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        onConfirm(inputValue);
    };

    return (
        <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: '400px' }}>
                <form onSubmit={handleSubmit}>
                    <div className="modal-header">
                        <h3 className="modal-title text-lg">{title}</h3>
                    </div>
                    <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                        {message && <p className="text-muted text-sm">{message}</p>}
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder={placeholder}
                            autoFocus
                            required
                            style={{
                                width: '100%',
                                padding: 'var(--spacing-sm) var(--spacing-md)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                backgroundColor: 'var(--color-bg)',
                                color: 'var(--color-text)',
                            }}
                        />
                    </div>
                    <div className="modal-footer flex justify-end gap-2 p-4 pt-0 border-t-0">
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            {cancelText}
                        </button>
                        <button type="submit" className="btn btn-primary">
                            {confirmText}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
