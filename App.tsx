
import React, { useState, useMemo, useEffect } from 'react';
import Layout from './components/Layout';
import { parseOmciText } from './services/omciParser';
import { exportToJSON } from './services/exportUtils';
import { analyzeOmciAnomalies } from './services/geminiService';
import { AnalysisResult, OmciMessage, OmciDirection, MeStats } from './types';
import SequenceDiagram from './components/SequenceDiagram';
import TreeDiagram from './components/TreeDiagram';

type ViewMode = 'dashboard' | 'explorer' | 'service' | 'sequence' | 'tree' | 'ai';

const App: React.FC = () => {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedMsg, setSelectedMsg] = useState<OmciMessage | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showFailedList, setShowFailedList] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const result = parseOmciText(e.target?.result as string);
      setData(result);
      setViewMode('dashboard');
      setLoading(false);
    };
    reader.readAsText(file);
  };

  const handleAiAnalysis = async (context: string = 'general') => {
    if (!data) return;
    setAiLoading(true);
    setViewMode('ai');
    let content = "";
    if (context === 'service') {
      content = "Analyze this Service Model Logic based on G.988 pointers:\n" + 
                data.serviceModel.map(l => `${l.from} -> ${l.to} via ${l.label}`).join('\n');
    } else {
      content = data.messages.map(m => m.raw).join('\n').slice(0, 20000);
    }
    const result = await analyzeOmciAnomalies(content);
    setAiResult(result);
    setAiLoading(false);
  };

  const sortedMessages = useMemo(() => {
    if (!data) return [];
    return [...data.messages].sort((a, b) => a.index - b.index);
  }, [data]);

  const failedPackets = useMemo(() => {
    if (!data) return [];
    return data.messages.filter(m => m.isError);
  }, [data]);

  const serviceNodes = useMemo(() => {
    if (!data) return { connected: [], isolated: [] };
    const connectedSet = new Set<string>();
    data.serviceModel.forEach(l => {
      connectedSet.add(l.from);
      connectedSet.add(l.to);
    });

    const allEntities: string[] = [];
    Object.entries(data.stats).forEach(([name, stat]) => {
      (stat as MeStats).instances.forEach(inst => allEntities.push(`${name} (${inst})`));
    });

    return {
      connected: data.serviceModel,
      isolated: allEntities.filter(e => !connectedSet.has(e))
    };
  }, [data]);

  const processedPackets = useMemo(() => {
    if (!data) return [];
    const result: (OmciMessage | { type: 'group'; messages: OmciMessage[]; id: string })[] = [];
    let currentGroup: OmciMessage[] = [];

    sortedMessages.forEach((msg, idx) => {
      const isMib = msg.messageType.toLowerCase().includes('mib upload') || msg.messageType.toLowerCase().includes('mib next');
      if (isMib) {
        currentGroup.push(msg);
      } else {
        if (currentGroup.length > 0) {
          if (currentGroup.length > 2) {
            result.push({ type: 'group', messages: [...currentGroup], id: `group-${idx}` });
          } else {
            result.push(...currentGroup);
          }
          currentGroup = [];
        }
        result.push(msg);
      }
    });
    if (currentGroup.length > 0) result.push({ type: 'group', messages: currentGroup, id: 'group-end' });
    return result;
  }, [sortedMessages, data]);

  // Logic điều hướng và tự động mở nhóm
  const navigateToPacket = (msg: OmciMessage) => {
    // Tìm xem gói tin này có nằm trong group nào không để tự động expand
    const containingGroup = (processedPackets as any[]).find(
      p => p.type === 'group' && p.messages.some((m: OmciMessage) => m.id === msg.id)
    );

    if (containingGroup) {
      setExpandedGroups(prev => ({ ...prev, [containingGroup.id]: true }));
    }

    setSelectedMsg(msg);
    setViewMode('explorer');
  };

  // Tự động cuộn đến gói tin khi viewMode chuyển sang explorer
  useEffect(() => {
    if (viewMode === 'explorer' && selectedMsg) {
      // Delay một chút để DOM kịp render nếu vừa mới expand group
      const timer = setTimeout(() => {
        const element = document.getElementById(`packet-row-${selectedMsg.id}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [viewMode, selectedMsg]);

  const ServiceModelGrid = () => (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-blue-500 flex items-center gap-2">
           <i className="fas fa-project-diagram"></i>
           Provisioning Connectivity Graph
        </h3>
        <button 
          onClick={() => handleAiAnalysis('service')}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg flex items-center gap-2 transition-all active:scale-95"
        >
          <i className="fas fa-robot"></i> AI Model Validation
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {serviceNodes.connected.length > 0 ? serviceNodes.connected.map((link, idx) => (
          <div key={idx} className="flex items-center gap-6 p-4 bg-slate-950 rounded-xl border border-slate-800 group hover:border-blue-500 transition-all">
            <div className="flex-1 text-right">
              <span className="text-xs font-bold text-slate-300 block">{link.from.split('(')[0]}</span>
              <span className="text-[10px] font-mono text-slate-500">{link.from.match(/\(.*\)/)?.[0]}</span>
            </div>
            <div className="flex flex-col items-center min-w-[140px]">
              <span className="text-[9px] font-black text-blue-500/80 uppercase mb-1 tracking-tighter bg-blue-500/10 px-2 py-0.5 rounded">{link.label}</span>
              <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-blue-600 to-transparent relative">
                 <div className="absolute right-0 -top-1 w-2 h-2 bg-blue-600 rotate-45 shadow-[0_0_8px_rgba(37,99,235,0.6)]"></div>
              </div>
            </div>
            <div className="flex-1">
              <span className="text-xs font-bold text-emerald-400 block">{link.to}</span>
              <span className="text-[10px] text-slate-500">Resource Allocated</span>
            </div>
          </div>
        )) : (
          <div className="text-center py-10 opacity-40 italic border-2 border-dashed border-slate-800 rounded-2xl">
            No successful ME connections detected yet.
          </div>
        )}
      </div>

      {serviceNodes.isolated.length > 0 && (
        <div className="mt-10">
          <h4 className="text-[10px] font-black text-slate-500 uppercase mb-4 tracking-widest">Standalone / Isolated Entities</h4>
          <div className="flex flex-wrap gap-2">
            {serviceNodes.isolated.map((node, i) => (
              <div key={i} className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[10px] font-medium text-slate-400">
                {node}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Layout>
      {!data ? (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] p-6 text-center">
          <div className="mb-8 relative group">
            <div className="absolute inset-0 bg-blue-600 blur-3xl opacity-20 group-hover:opacity-40 transition-opacity animate-pulse"></div>
            <i className="fas fa-file-import text-8xl text-blue-500 relative z-10"></i>
          </div>
          <h2 className="text-3xl font-bold mb-4">OMCI Analyzer Pro</h2>
          <p className="text-slate-400 max-w-lg mb-8">
            Import OMCI text log to visualize service hierarchy and run AI-based G.988 compliance checks.
          </p>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-xl font-bold text-lg shadow-xl shadow-blue-900/40 transition-all flex items-center gap-3 active:scale-95">
            <i className="fas fa-upload"></i> Import OMCI Text File
            <input type="file" className="hidden" accept=".txt,.log" onChange={handleFileUpload} />
          </label>
        </div>
      ) : (
        <div className="p-6 max-w-[1600px] mx-auto space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-xl">
            <div className="flex items-center gap-4">
               <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                {(['dashboard', 'explorer', 'service', 'sequence', 'tree', 'ai'] as const).map(tab => (
                  <button key={tab} onClick={() => setViewMode(tab)} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all capitalize ${viewMode === tab ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>
                    {tab === 'explorer' ? 'Packet List' : (tab === 'service' ? 'Service Model' : (tab === 'ai' ? 'AI Insights' : tab))}
                  </button>
                ))}
              </div>
              <div className="h-8 w-px bg-slate-800 mx-2"></div>
              <div className="flex flex-col">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Active File</span>
                <span className="text-xs font-bold text-blue-400">{fileName}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button onClick={() => handleAiAnalysis()} className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white p-2 px-4 rounded-xl text-xs font-bold shadow-lg transition-all flex items-center gap-2">
                <i className="fas fa-robot"></i> Run AI Check
              </button>
              <button onClick={() => { setData(null); setViewMode('dashboard'); setFileName(''); }} className="bg-rose-600 hover:bg-rose-500 text-white p-2 px-4 rounded-xl text-xs font-bold shadow-lg transition-all flex items-center gap-2">
                <i className="fas fa-chevron-left"></i> New Analysis
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {viewMode === 'dashboard' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                    <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 text-blue-500/10 group-hover:text-blue-500/20 transition-colors">
                        <i className="fas fa-list-ol text-5xl"></i>
                      </div>
                      <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Total Frames</p>
                      <p className="text-2xl font-bold text-white relative z-10">{data.messages.length}</p>
                    </div>

                    <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 text-rose-500/10 group-hover:text-rose-500/20 transition-colors">
                        <i className="fas fa-exclamation-triangle text-5xl"></i>
                      </div>
                      <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Failed Packets</p>
                      <div className="flex items-center justify-between relative z-10">
                        <p className={`text-2xl font-bold ${failedPackets.length > 0 ? 'text-rose-500' : 'text-blue-500'}`}>
                          {failedPackets.length}
                        </p>
                        {failedPackets.length > 0 && (
                          <button 
                            onClick={() => setShowFailedList(!showFailedList)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] px-2 py-1 rounded font-bold transition-all flex items-center gap-1"
                          >
                            {showFailedList ? 'Hide' : 'Details'}
                            <i className={`fas fa-chevron-${showFailedList ? 'up' : 'down'}`}></i>
                          </button>
                        )}
                      </div>
                      
                      {showFailedList && failedPackets.length > 0 && (
                        <div className="mt-4 space-y-2 max-h-40 overflow-y-auto pr-1 relative z-10 border-t border-slate-800 pt-3">
                          {failedPackets.map((msg) => (
                            <div 
                              key={msg.id} 
                              onClick={() => navigateToPacket(msg)}
                              className="bg-slate-950 p-2 rounded border border-slate-800 hover:border-rose-500/50 cursor-pointer transition-colors group/item flex justify-between items-center"
                            >
                              <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-slate-300">#{msg.index} - {msg.messageType}</span>
                                <span className="text-[8px] font-mono text-slate-500">{msg.meClassName} ({msg.meInstance})</span>
                              </div>
                              <i className="fas fa-external-link-alt text-[8px] text-slate-600 group-hover/item:text-rose-500"></i>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 text-emerald-500/10 group-hover:text-emerald-500/20 transition-colors">
                        <i className="fas fa-heartbeat text-5xl"></i>
                      </div>
                      <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Status</p>
                      <p className={`text-lg font-black relative z-10 leading-tight uppercase ${(Object.values(data.stats) as MeStats[]).some(s => s.errors > 0) ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {(Object.values(data.stats) as MeStats[]).some(s => s.errors > 0) ? 'Anomalies Detected' : 'All Successful'}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
                    <ServiceModelGrid />
                  </div>
                </div>
              )}

              {viewMode === 'explorer' && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
                  <div className="p-4 bg-slate-950/50 border-b border-slate-800 flex justify-between items-center sticky top-0 z-20">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">Packet Explorer</h3>
                  </div>
                  <div className="overflow-auto max-h-[750px]">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="text-[10px] font-black uppercase text-slate-500 bg-slate-950/30 sticky top-0 backdrop-blur-md">
                        <tr>
                          <th className="px-6 py-4">#</th>
                          <th className="px-6 py-4">Direction</th>
                          <th className="px-6 py-4">Message</th>
                          <th className="px-6 py-4">Entity</th>
                          <th className="px-6 py-4">Inst</th>
                          <th className="px-6 py-4 text-right">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {processedPackets.map((item, i) => {
                          if ('type' in item && item.type === 'group') {
                            const isExpanded = expandedGroups[item.id];
                            return (
                              <React.Fragment key={item.id}>
                                <tr onClick={() => setExpandedGroups(prev => ({ ...prev, [item.id]: !isExpanded }))} className="bg-indigo-950/20 border-y border-indigo-500/10 cursor-pointer hover:bg-indigo-900/30">
                                  <td colSpan={6} className="px-6 py-3">
                                    <div className="flex items-center gap-3 text-indigo-400 font-bold text-xs">
                                      <i className={`fas fa-chevron-${isExpanded ? 'down' : 'right'}`}></i>
                                      MIB Sequence Block ({item.messages.length} packets)
                                    </div>
                                  </td>
                                </tr>
                                {isExpanded && item.messages.map(m => (
                                   <PacketRow key={m.id} msg={m} isSelected={selectedMsg?.id === m.id} onClick={() => setSelectedMsg(m)} />
                                ))}
                              </React.Fragment>
                            );
                          } else {
                            const msg = item as OmciMessage;
                            return <PacketRow key={msg.id} msg={msg} isSelected={selectedMsg?.id === msg.id} onClick={() => setSelectedMsg(msg)} />;
                          }
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {viewMode === 'service' && (
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl min-h-[500px]">
                   <ServiceModelGrid />
                </div>
              )}

              {viewMode === 'ai' && (
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl min-h-[500px] flex flex-col">
                   <h3 className="text-xl font-bold mb-6 text-indigo-400 flex items-center gap-2">
                     <i className="fas fa-brain"></i>
                     AI Diagnostics Report
                   </h3>
                   {aiLoading ? (
                     <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                        <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
                        <p className="text-sm text-slate-400 animate-pulse">Gemini is analyzing provisioning logic...</p>
                     </div>
                   ) : aiResult ? (
                     <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 font-mono text-sm leading-relaxed text-slate-300 whitespace-pre-wrap max-h-[600px] overflow-auto">
                        {aiResult}
                     </div>
                   ) : (
                     <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
                        <i className="fas fa-robot text-6xl mb-4"></i>
                        <p>Click "Run AI Check" to perform a deep analysis.</p>
                     </div>
                   )}
                </div>
              )}

              {viewMode === 'sequence' && (
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
                  <SequenceDiagram messages={data.messages.slice(0, 100)} />
                </div>
              )}

              {viewMode === 'tree' && (
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
                  <TreeDiagram node={data.topology} />
                </div>
              )}
            </div>

            <div className="space-y-6">
               <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl min-h-[600px] flex flex-col sticky top-24">
                  <div className="bg-blue-600/10 p-5 border-b border-blue-600/20 flex items-center justify-between">
                    <h4 className="font-bold text-sm flex items-center gap-2 text-white">
                      <i className="fas fa-search-plus text-blue-500"></i>
                      Packet Inspector
                    </h4>
                    {selectedMsg && <span className="text-[10px] font-mono text-slate-500">TX: {selectedMsg.transactionId}</span>}
                  </div>
                  <div className="p-6 flex-1 overflow-auto">
                    {selectedMsg ? (
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                            <p className="text-[8px] font-black text-slate-600 uppercase mb-1">Entity</p>
                            <p className="text-xs font-bold text-blue-400 truncate">{selectedMsg.meClassName}</p>
                          </div>
                          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                            <p className="text-[8px] font-black text-slate-600 uppercase mb-1">Instance</p>
                            <p className="text-xs font-mono font-bold text-white">{selectedMsg.meInstance}</p>
                          </div>
                        </div>

                        <div>
                           <p className="text-[10px] font-black text-slate-500 uppercase mb-3 tracking-widest">Extracted Attributes</p>
                           <div className="space-y-1.5">
                             {Object.entries(selectedMsg.data).map(([k, v]) => (
                               <div key={k} className="flex flex-col p-2.5 bg-slate-950 rounded-lg border border-slate-800/60">
                                 <span className="text-[10px] text-slate-500 font-bold mb-1">{k}</span>
                                 <span className="text-xs text-white font-mono break-all">{v}</span>
                               </div>
                             ))}
                             {Object.keys(selectedMsg.data).length === 0 && (
                               <p className="text-xs text-slate-600 italic text-center py-10 opacity-50">No detailed attributes extracted.</p>
                             )}
                           </div>
                        </div>

                        <div className="mt-8">
                           <p className="text-[10px] font-black text-slate-500 uppercase mb-3 tracking-widest">Source Block</p>
                           <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-[9px] text-slate-600 break-all leading-relaxed h-40 overflow-auto">
                             {selectedMsg.raw}
                           </div>
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                         <i className="fas fa-microchip text-5xl mb-4"></i>
                         <p className="text-sm font-medium">Select a packet to view <br/> detailed G.988 decoding.</p>
                      </div>
                    )}
                  </div>
               </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

const PacketRow: React.FC<{ msg: OmciMessage, isSelected: boolean, onClick: () => void }> = ({ msg, isSelected, onClick }) => (
  <tr 
    id={`packet-row-${msg.id}`}
    onClick={onClick} 
    className={`cursor-pointer transition-all border-b border-slate-800/50 ${isSelected ? 'bg-blue-600/20' : 'hover:bg-slate-800/40'}`}
  >
    <td className="px-6 py-4 font-mono text-slate-500 text-[11px]">{msg.index}</td>
    <td className="px-6 py-4">
      <span className={`flex items-center gap-2 font-black text-[9px] uppercase ${msg.direction === OmciDirection.OLT_TO_ONU ? 'text-blue-500' : 'text-emerald-500'}`}>
        <i className={`fas fa-arrow-${msg.direction === OmciDirection.OLT_TO_ONU ? 'right' : 'left'}`}></i>
        {msg.direction === OmciDirection.OLT_TO_ONU ? 'OLT >' : 'ONU >'}
      </span>
    </td>
    <td className="px-6 py-4 font-bold text-slate-200 text-xs">{msg.messageType}</td>
    <td className="px-6 py-4 text-blue-400 font-bold text-xs truncate max-w-[150px]">{msg.meClassName}</td>
    <td className="px-6 py-4 font-mono text-slate-400 text-xs">{msg.meInstance}</td>
    <td className="px-6 py-4 text-right">
      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${msg.isError ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'}`}>
        {msg.resultCode || 'Success'}
      </span>
    </td>
  </tr>
);

export default App;
