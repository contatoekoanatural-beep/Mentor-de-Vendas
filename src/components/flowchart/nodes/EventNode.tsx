
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap, Radio } from 'lucide-react';

const EventNode = ({ data }: NodeProps) => {
    return (
        <div
            style={{
                background: '#fff7ed',
                border: '2px solid #f97316',
                borderRadius: '24px',
                padding: '8px 16px',
                minWidth: '150px',
                boxShadow: '0 2px 4px rgba(249, 115, 22, 0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            }}
        >
            <Handle type="target" position={Position.Top} style={{ background: '#f97316' }} />

            <div style={{
                background: '#f97316',
                borderRadius: '50%',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white'
            }}>
                {data.nodeType === 'webhook' ? <Radio size={16} /> : <Zap size={16} />}
            </div>

            <div style={{ flex: 1 }}>
                <div style={{
                    fontWeight: 600,
                    fontSize: '13px',
                    color: '#9a3412',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                }}>
                    {data.label as string}
                </div>
            </div>

            {/* Eventos geralmente são terminais ou de passagem única */}
            <Handle type="source" position={Position.Bottom} style={{ background: '#f97316' }} />
        </div>
    );
};

export default memo(EventNode);
