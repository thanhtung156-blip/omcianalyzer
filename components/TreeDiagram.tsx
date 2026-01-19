
import React from 'react';
import { TopologyNode } from '../types';

interface TreeDiagramProps {
  node: TopologyNode;
  depth?: number;
}

const TreeDiagram: React.FC<TreeDiagramProps> = ({ node, depth = 0 }) => {
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'OLT': return 'bg-blue-600';
      case 'ONU': return 'bg-emerald-600';
      case 'TCONT': return 'bg-amber-600';
      case 'GEM': return 'bg-purple-600';
      default: return 'bg-slate-700';
    }
  };

  return (
    <div className="ml-6 border-l-2 border-slate-800 pl-4 py-1">
      <div className="flex items-center gap-2 group cursor-default">
        <div className={`w-3 h-3 rounded-full ${getTypeColor(node.type)}`}></div>
        <div className="px-3 py-1 bg-slate-800 rounded-md border border-slate-700 group-hover:border-blue-500 transition-colors">
          <span className="text-xs font-semibold text-slate-400 mr-2">{node.type}</span>
          <span className="text-sm font-medium text-slate-100">{node.name}</span>
        </div>
      </div>
      {node.children && node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((child, i) => (
            <TreeDiagram key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default TreeDiagram;
