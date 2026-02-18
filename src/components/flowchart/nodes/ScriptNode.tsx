
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { FileText } from 'lucide-react';

const ScriptNode = ({ data }: any) => {
    return (
        <div
            style={{
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                minWidth: '200px',
                maxWidth: '300px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                display: 'flex',
                alignItems: 'stretch'
            }}
        >
            <Handle type="target" position={Position.Top} style={{ background: '#555' }} />

            {/* Ícone lateral */}
            <div style={{
                background: '#f3f4f6',
                padding: '12px',
                borderRight: '1px solid var(--color-border)',
                borderTopLeftRadius: '8px',
                borderBottomLeftRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280'
            }}>
                <FileText size={20} />
            </div>

            {/* Conteúdo */}
            <div style={{ padding: '12px', flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px', color: 'var(--color-text-primary)' }}>
                    {data.label as string}
                </div>
                {data.description && (
                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>
                        {String(data.description)}
                    </div>
                )}
            </div>

            <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
        </div>
    );
};

export default memo(ScriptNode);
