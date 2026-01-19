
import React from 'react';
import { OmciMessage, OmciDirection } from '../types';

interface SequenceDiagramProps {
  messages: OmciMessage[];
}

const SequenceDiagram: React.FC<SequenceDiagramProps> = ({ messages }) => {
  const rowHeight = 60;
  const width = 800;
  const height = Math.max(messages.length * rowHeight + 100, 400);
  const padding = 100;

  return (
    <div className="overflow-x-auto bg-slate-900 p-4 rounded-xl border border-slate-800">
      <svg width={width} height={height} className="mx-auto">
        {/* Lifelines */}
        <line x1={padding} y1={50} x2={padding} y2={height - 50} stroke="#475569" strokeWidth="2" strokeDasharray="5,5" />
        <line x1={width - padding} y1={50} x2={width - padding} y2={height - 50} stroke="#475569" strokeWidth="2" strokeDasharray="5,5" />
        
        {/* Lifeline Labels */}
        <rect x={padding - 40} y={10} width={80} height={30} rx={4} fill="#1e293b" stroke="#334155" />
        <text x={padding} y={30} textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="600">OLT</text>
        
        <rect x={width - padding - 40} y={10} width={80} height={30} rx={4} fill="#1e293b" stroke="#334155" />
        <text x={width - padding} y={30} textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="600">ONU</text>

        {/* Message Arrows */}
        {messages.map((msg, i) => {
          const y = 80 + i * rowHeight;
          const isOltToOnu = msg.direction === OmciDirection.OLT_TO_ONU;
          const x1 = isOltToOnu ? padding : width - padding;
          const x2 = isOltToOnu ? width - padding : padding;
          const color = msg.messageType.toLowerCase().includes('response') ? '#10b981' : '#3b82f6';

          return (
            <g key={msg.id}>
              <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth="1.5" markerEnd="url(#arrowhead)" />
              <text x={(x1 + x2) / 2} y={y - 10} textAnchor="middle" fill="#f1f5f9" fontSize="10" className="mono">
                {msg.messageType} ({msg.meClassName})
              </text>
              <text x={(x1 + x2) / 2} y={y + 15} textAnchor="middle" fill="#94a3b8" fontSize="9">
                TX: {msg.transactionId} | Inst: {msg.meInstance}
              </text>
            </g>
          );
        })}

        {/* Marker Definitions */}
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
          </marker>
        </defs>
      </svg>
    </div>
  );
};

export default SequenceDiagram;
