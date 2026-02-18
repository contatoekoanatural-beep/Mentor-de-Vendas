
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitBranch } from 'lucide-react';

const DecisionNode = ({ data }: NodeProps) => {
    return (
        <div style={{ position: 'relative', width: 200, height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Handle type="target" position={Position.Top} style={{ background: '#555', zIndex: 10 }} />

            {/* Forma de Diamante */}
            <div style={{
                position: 'absolute',
                width: '60px',
                height: '60px',
                background: '#eef2ff',
                border: '2px solid #6366f1',
                borderRadius: '4px',
                transform: 'rotate(45deg)',
                zIndex: 0,
                boxShadow: '0 2px 4px rgba(99, 102, 241, 0.1)'
            }} />

            {/* Ícone central */}
            <div style={{ zIndex: 1, color: '#6366f1' }}>
                <GitBranch size={24} />
            </div>

            {/* Labels laterais (opcional) */}
            <div style={{
                position: 'absolute',
                bottom: -30,
                width: '100%',
                textAlign: 'center',
                fontWeight: 600,
                fontSize: '12px',
                color: 'var(--color-text-primary)',
                background: 'var(--color-bg-primary)',
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid var(--color-border)',
                zIndex: 5
            }}>
                {data.label as string}
            </div>

            {/* Múltiplos handles de saída para simular decisão */}
            {/* Nota: Em uma implementação real, a lógica decidiria qual saída usar. 
                Aqui colocamos handles nas pontas do diamante */}

            <Handle
                type="source"
                position={Position.Left}
                id="false"
                style={{ background: '#ef4444', left: 70 }}
                title="Não / Falso"
            />
            <Handle
                type="source"
                position={Position.Right}
                id="true"
                style={{ background: '#22c55e', right: 70 }}
                title="Sim / Verdadeiro"
            />
            <Handle
                type="source"
                position={Position.Bottom}
                id="next"
                style={{ background: '#555' }}
                title="Próximo"
            />
        </div>
    );
};

export default memo(DecisionNode);
