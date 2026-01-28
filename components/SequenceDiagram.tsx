
import React, { useState, useMemo } from 'react';
import { OmciMessage, OmciDirection } from '../types';

interface SequenceDiagramProps {
  messages: OmciMessage[];
  onSelectMsg?: (msg: OmciMessage) => void;
  selectedMsgId?: string;
}

const SequenceDiagram: React.FC<SequenceDiagramProps> = ({ messages, onSelectMsg, selectedMsgId }) => {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const rowHeight = 50;
  const groupHeaderHeight = 40;
  const width = 800;
  const padding = 120;

  // Logic gom nhóm tương tự App.tsx
  const processedItems = useMemo(() => {
    const result: (OmciMessage | { type: 'group'; messages: OmciMessage[]; id: string })[] = [];
    let currentGroup: OmciMessage[] = [];

    messages.forEach((msg, idx) => {
      const isMib = /mib upload|mib next|mib reset/i.test(msg.messageType);
      if (isMib) {
        currentGroup.push(msg);
      } else {
        if (currentGroup.length > 0) {
          if (currentGroup.length > 1) {
            result.push({ type: 'group', messages: [...currentGroup], id: `seq-group-${idx}` });
          } else {
            result.push(...currentGroup);
          }
          currentGroup = [];
        }
        result.push(msg);
      }
    });
    if (currentGroup.length > 0) {
      result.push({ type: 'group', messages: currentGroup, id: 'seq-group-end' });
    }
    return result;
  }, [messages]);

  // Tính toán chiều cao tổng và vị trí Y cho từng item
  let currentY = 80;
  const itemsWithPos = processedItems.map((item) => {
    const pos = currentY;
    if ('type' in item && item.type === 'group') {
      const isExpanded = expandedGroups[item.id];
      currentY += groupHeaderHeight + (isExpanded ? item.messages.length * rowHeight : 0);
    } else {
      currentY += rowHeight;
    }
    return { item, y: pos };
  });

  const totalHeight = currentY + 50;

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 flex flex-col h-[600px]">
      <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50 rounded-t-xl">
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Interaction Sequence</h3>
        <span className="text-[10px] text-slate-500 italic">Click arrows to inspect packets</span>
      </div>
      <div className="overflow-auto flex-1 p-4 custom-scrollbar">
        <svg width={width} height={totalHeight} className="mx-auto">
          {/* Lifelines */}
          <line x1={padding} y1={40} x2={padding} y2={totalHeight - 40} stroke="#334155" strokeWidth="2" strokeDasharray="5,5" />
          <line x1={width - padding} y1={40} x2={width - padding} y2={totalHeight - 40} stroke="#334155" strokeWidth="2" strokeDasharray="5,5" />
          
          {/* Lifeline Labels */}
          <g>
            <rect x={padding - 45} y={5} width={90} height={30} rx={8} fill="#1e293b" stroke="#3b82f6" strokeWidth="1" />
            <text x={padding} y={25} textAnchor="middle" fill="#3b82f6" fontSize="11" fontWeight="800">OLT</text>
          </g>
          
          <g>
            <rect x={width - padding - 45} y={5} width={90} height={30} rx={8} fill="#1e293b" stroke="#10b981" strokeWidth="1" />
            <text x={width - padding} y={25} textAnchor="middle" fill="#10b981" fontSize="11" fontWeight="800">ONU</text>
          </g>

          {itemsWithPos.map(({ item, y }, idx) => {
            if ('type' in item && item.type === 'group') {
              const isExpanded = expandedGroups[item.id];
              return (
                <g key={item.id}>
                  {/* Group Header */}
                  <rect 
                    x={padding - 10} y={y} width={width - 2 * padding + 20} height={30} rx={4} 
                    fill={isExpanded ? "#312e81" : "#1e1b4b"} 
                    className="cursor-pointer hover:fill-indigo-800 transition-colors"
                    onClick={() => setExpandedGroups(prev => ({ ...prev, [item.id]: !isExpanded }))}
                  />
                  <text 
                    x={width / 2} y={y + 19} textAnchor="middle" fill="#818cf8" fontSize="10" fontWeight="bold" 
                    className="pointer-events-none"
                  >
                    {isExpanded ? '▼' : '▶'} MIB Upload Sequence ({item.messages.length} packets)
                  </text>
                  
                  {isExpanded && item.messages.map((msg, mIdx) => {
                    const msgY = y + groupHeaderHeight + mIdx * rowHeight;
                    return (
                      <MessageArrow 
                        key={msg.id} 
                        msg={msg} 
                        y={msgY} 
                        padding={padding} 
                        width={width} 
                        isSelected={selectedMsgId === msg.id}
                        onSelect={onSelectMsg}
                      />
                    );
                  })}
                </g>
              );
            } else {
              const msg = item as OmciMessage;
              return (
                <MessageArrow 
                  key={msg.id} 
                  msg={msg} 
                  y={y} 
                  padding={padding} 
                  width={width} 
                  isSelected={selectedMsgId === msg.id}
                  onSelect={onSelectMsg}
                />
              );
            }
          })}

          {/* Marker Definition */}
          <defs>
            <marker id="arrowhead-blue" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
            </marker>
            <marker id="arrowhead-green" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#10b981" />
            </marker>
          </defs>
        </svg>
      </div>
    </div>
  );
};

const MessageArrow: React.FC<{ 
  msg: OmciMessage; 
  y: number; 
  padding: number; 
  width: number; 
  isSelected: boolean;
  onSelect?: (msg: OmciMessage) => void;
}> = ({ msg, y, padding, width, isSelected, onSelect }) => {
  const isOltToOnu = msg.direction === OmciDirection.OLT_TO_ONU;
  const x1 = isOltToOnu ? padding : width - padding;
  const x2 = isOltToOnu ? width - padding : padding;
  const color = msg.isError ? '#f43f5e' : (isOltToOnu ? '#3b82f6' : '#10b981');
  const markerId = isOltToOnu ? "url(#arrowhead-blue)" : "url(#arrowhead-green)";

  return (
    <g 
      className="cursor-pointer group" 
      onClick={() => onSelect?.(msg)}
    >
      {/* Background highlight for selection */}
      {isSelected && (
        <rect x={Math.min(x1, x2) - 10} y={y - 20} width={Math.abs(x1 - x2) + 20} height={40} rx={6} fill="#3b82f6" fillOpacity="0.1" />
      )}
      
      {/* Interaction target area */}
      <rect x={Math.min(x1, x2)} y={y - 15} width={Math.abs(x1 - x2)} height={30} fill="transparent" />
      
      <line 
        x1={x1} y1={y} x2={x2} y2={y} 
        stroke={color} 
        strokeWidth={isSelected ? "2.5" : "1.5"} 
        markerEnd={markerId}
        className="group-hover:stroke-white transition-all"
      />
      <text 
        x={(x1 + x2) / 2} y={y - 8} 
        textAnchor="middle" 
        fill={isSelected ? "#fff" : "#cbd5e1"} 
        fontSize="10" 
        fontWeight={isSelected ? "bold" : "500"}
        className="mono group-hover:fill-white transition-all"
      >
        {msg.messageType}
      </text>
      <text 
        x={(x1 + x2) / 2} y={y + 12} 
        textAnchor="middle" 
        fill="#64748b" 
        fontSize="8"
        className="group-hover:fill-slate-400"
      >
        {msg.meClassName} ({msg.meInstance})
      </text>
    </g>
  );
};

export default SequenceDiagram;
