
import React from 'react';
import { TopologyNode } from '../types';

interface TreeDiagramProps {
  node: TopologyNode;
  depth?: number;
  onSelect?: (entityId: string) => void;
}

const TreeDiagram: React.FC<TreeDiagramProps> = ({ node, depth = 0, onSelect }) => {
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'OLT': return 'bg-blue-600';
      case 'ONU': return 'bg-emerald-600';
      case 'TCONT': return 'bg-amber-600';
      case 'GEM': return 'bg-purple-600';
      case 'UNI': return 'bg-rose-600';
      case 'BRIDGE': return 'bg-indigo-600';
      default: return 'bg-slate-700';
    }
  };

  const handleClick = () => {
    if (node.entityId && onSelect) {
      onSelect(node.entityId);
    }
  };

  return (
    <div className="ml-6 border-l-2 border-slate-800 pl-4 py-1">
      <div 
        className={`flex items-center gap-2 group ${node.entityId ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={handleClick}
      >
        <div className={`w-3 h-3 rounded-full ${getTypeColor(node.type)} flex-shrink-0`}></div>
        <div className={`px-3 py-1 bg-slate-800 rounded-md border border-slate-700 transition-all ${node.entityId ? 'hover:border-blue-500 hover:bg-slate-700 active:scale-95' : ''}`}>
          <span className="text-[10px] font-semibold text-slate-500 mr-2 uppercase tracking-tighter">{node.type}</span>
          <span className="text-sm font-medium text-slate-100">{node.name}</span>
          {node.entityId && (
            <i className="fas fa-search-plus ml-3 text-[10px] text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"></i>
          )}
        </div>
      </div>
      {node.children && node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((child, i) => (
            <TreeDiagram key={i} node={child} depth={depth + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
};

export default TreeDiagram;
