
import React, { useState, useMemo, useEffect } from 'react';
import Layout from './components/Layout';
import { parseOmciText } from './services/omciParser';
import { analyzeOmciAnomalies } from './services/geminiService';
import { AnalysisResult, OmciMessage, OmciDirection, MeStats, TopologyNode } from './types';
import SequenceDiagram from './components/SequenceDiagram';
import TreeDiagram from './components/TreeDiagram';

type ViewMode = 'dashboard' | 'explorer' | 'service' | 'sequence' | 'tree' | 'ai';
type DirectionFilter = 'both' | 'olt' | 'onu';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('both');
  const [onlyErrors, setOnlyErrors] = useState(false);
  
  const [isExternalNav, setIsExternalNav] = useState(false);

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
    let msgs = [...data.messages];
    if (onlyErrors) msgs = msgs.filter(m => m.isError);
    if (directionFilter === 'olt') msgs = msgs.filter(m => m.direction === OmciDirection.OLT_TO_ONU);
    else if (directionFilter === 'onu') msgs = msgs.filter(m => m.direction === OmciDirection.ONU_TO_OLT);

    if (searchTerm) {
      msgs = msgs.filter(m => 
        m.meClassName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.meInstance.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.messageType.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    return msgs.sort((a, b) => a.index - b.index);
  }, [data, searchTerm, directionFilter, onlyErrors]);

  const processedPackets = useMemo(() => {
    if (!data) return [];
    if (searchTerm || directionFilter !== 'both' || onlyErrors) {
      return sortedMessages;
    }

    const result: (OmciMessage | { type: 'group'; messages: OmciMessage[]; id: string; groupType: 'mib' | 'avc' })[] = [];
    let i = 0;
    
    while (i < sortedMessages.length) {
      const msg = sortedMessages[i];
      const isMib = /mib upload|mib next|mib reset/i.test(msg.messageType);
      const isAvc = /attribute value change/i.test(msg.messageType);

      if (isMib) {
        let group = [msg];
        let j = i + 1;
        while (j < sortedMessages.length && /mib upload|mib next|mib reset/i.test(sortedMessages[j].messageType)) {
          group.push(sortedMessages[j]);
          j++;
        }
        if (group.length > 1) {
          result.push({ type: 'group', messages: group, id: `mib-group-${i}`, groupType: 'mib' });
          i = j;
          continue;
        }
      }

      if (isAvc) {
        let group = [msg];
        let j = i + 1;
        while (j < sortedMessages.length && /attribute value change/i.test(sortedMessages[j].messageType)) {
          group.push(sortedMessages[j]);
          j++;
        }
        if (group.length > 5) {
          result.push({ type: 'group', messages: group, id: `avc-group-${i}`, groupType: 'avc' });
          i = j;
          continue;
        }
      }

      result.push(msg);
      i++;
    }
    return result;
  }, [sortedMessages, data, searchTerm, directionFilter, onlyErrors]);

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

  const meSuggestions = useMemo(() => {
    if (!data || !searchTerm || viewMode !== 'dashboard') return [];
    return Object.keys(data.stats).filter(name => 
      name.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 8);
  }, [data, searchTerm, viewMode]);

  const navigateToPacket = (msg: OmciMessage) => {
    const containingGroup = (processedPackets as any[]).find(
      p => p.type === 'group' && p.messages.some((m: OmciMessage) => m.id === msg.id)
    );
    if (containingGroup) setExpandedGroups(prev => ({ ...prev, [containingGroup.id]: true }));
    setIsExternalNav(true);
    setSelectedMsg(msg);
    setViewMode('explorer');
  };

  const handleEntityClick = (entityStr: string) => {
    if (!data) return;
    const found = data.messages.find(m => `${m.meClassName} (${m.meInstance})` === entityStr);
    if (found) setSelectedMsg(found);
  };

  const handleSelectSuggestion = (meName: string) => {
    setSearchTerm(meName);
    setViewMode('explorer');
  };

  useEffect(() => {
    if (viewMode === 'explorer' && selectedMsg && isExternalNav) {
      const timer = setTimeout(() => {
        const element = document.getElementById(`packet-row-${selectedMsg.id}`);
        const container = document.getElementById('packet-explorer-container');
        if (element && container) {
          container.scrollTo({ top: element.offsetTop - 40, behavior: 'smooth' });
        }
        setIsExternalNav(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [viewMode, selectedMsg, isExternalNav]);

  const dynamicTopology = useMemo(() => {
    if (!data) return { name: 'GPON OLT', type: 'OLT', children: [] } as TopologyNode;
    const meClasses: TopologyNode[] = Object.entries(data.stats).map(([className, stat]) => {
      const instances: TopologyNode[] = (stat as MeStats).instances.map(inst => ({
        name: `Instance ${inst}`,
        type: 'GEM',
        entityId: `${className} (${inst})`
      }));
      return { name: className, type: 'BRIDGE', children: instances };
    });
    return { name: 'ONU Device', type: 'ONU', children: meClasses } as TopologyNode;
  }, [data]);

  /**
   * GIẢI MÃ VLAN FILTER LIST (ME 84)
   */
  const decodeVlanFilterList = (hexData: string) => {
    const cleanHex = hexData.replace(/[^0-9a-fA-F]/g, '');
    if (!cleanHex || cleanHex.length < 4) return null;
    
    // Mỗi VLAN ID chiếm 2 bytes (4 hex chars)
    const vlanIds = cleanHex.match(/.{1,4}/g) || [];
    const validVlans = vlanIds
      .map(hex => parseInt(hex, 16))
      .filter(id => id > 0 && id <= 4095);

    if (validVlans.length === 0) return null;

    return (
      <div className="mt-4 space-y-2 select-text font-mono text-[10px]">
        <div className="bg-emerald-950/40 border-l-2 border-emerald-500 p-2 mb-1">
          <h5 className="text-[9px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
            <i className="fas fa-filter"></i> VLAN FILTER LIST DECODER
          </h5>
        </div>
        <div className="flex flex-wrap gap-2 p-2 bg-slate-900 border border-slate-800 rounded">
          {validVlans.map((vlan, i) => (
            <span key={i} className="px-2 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-bold">
              VLAN {vlan}
            </span>
          ))}
          <span className="text-[8px] text-slate-500 self-center ml-2 italic">Total: {validVlans.length} IDs</span>
        </div>
      </div>
    );
  };

  /**
   * GIẢI MÃ BIT-LEVEL THEO CHUẨN G.988 (Table 9.3.13-1)
   */
  const decodeVlanTableEnhanced = (hexData: string) => {
    const cleanHex = hexData.replace(/[^0-9a-fA-F]/g, '');
    if (cleanHex.length < 32) return null;
    
    const entries = cleanHex.match(/.{1,32}/g) || [];

    const getVid = (v: number) => v === 4096 || v === 0x800 ? 'Any (4096)' : (v === 4095 ? 'Untagged (4095)' : v);
    const getPri = (p: number) => p === 15 ? 'Any (15)' : (p === 8 ? 'Untagged (8)' : p);

    return (
      <div className="mt-4 space-y-4 select-text font-mono text-[10px]">
        <div className="bg-indigo-950/40 border-l-2 border-indigo-500 p-2 mb-2">
          <h5 className="text-[9px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
            <i className="fas fa-microchip"></i> VLAN TAGGING OPERATION TABLE DECODER
          </h5>
        </div>
        
        {entries.map((entryHex, idx) => {
          if (entryHex.length < 32) return null;
          const b = entryHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16));
          
          const fOuterPri = (b[0] >> 4) & 0x0F;
          const fOuterVid = ((b[0] & 0x0F) << 8) | b[1];
          const fInnerPri = (b[2] >> 4) & 0x0F;
          const fInnerVid = ((b[2] & 0x0F) << 8) | b[3];
          const fEthType = b[4] & 0x03;

          const removeTags = (b[5] >> 6) & 0x03;
          const tOuterPri = (b[6] >> 4) & 0x0F;
          const tOuterVid = ((b[6] & 0x0F) << 8) | b[7];
          const tInnerPri = (b[8] >> 4) & 0x0F;
          const tInnerVid = ((b[8] & 0x0F) << 8) | b[9];

          return (
            <div key={idx} className="bg-slate-900 border border-slate-800 rounded p-2">
              <div className="text-indigo-400 font-bold mb-1">ENTRY {idx}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-slate-500 uppercase text-[8px] font-black">Filter</div>
                  <div>Outer Priority: {getPri(fOuterPri)}</div>
                  <div>Outer VLAN ID: {getVid(fOuterVid)}</div>
                  <div>Inner Priority: {getPri(fInnerPri)}</div>
                  <div>Inner VLAN ID: {getVid(fInnerVid)}</div>
                  <div>Ether Type: 0x0{fEthType}</div>
                </div>
                <div>
                  <div className="text-slate-500 uppercase text-[8px] font-black">Treatment (Remove Tags={removeTags})</div>
                  <div>Outer Priority: {tOuterPri === 15 ? 'Copy' : tOuterPri}</div>
                  <div>Outer VLAN ID: {tOuterVid === 4096 ? 'Copy' : tOuterVid}</div>
                  <div>Inner Priority: {tInnerPri === 15 ? 'Copy' : tInnerPri}</div>
                  <div>Inner VLAN ID: {tInnerVid === 4096 ? 'Copy' : tInnerVid}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /**
   * PACKET INSPECTOR COMPONENT:
   * Chỉ hiển thị nội dung giao thức OMCI sạch sẽ.
   */
  const WiresharkInspector = ({ msg }: { msg: OmciMessage }) => {
    const isMe171 = msg.meClass === '171' || msg.meClass === '00ab' || msg.meClassName.toLowerCase().includes('extended vlan');
    const isMe84 = msg.meClass === '84' || msg.meClassName.toLowerCase().includes('vlan tagging filter');
    const isOltToOnu = msg.direction === OmciDirection.OLT_TO_ONU;

    // Lọc nội dung text protocol
    const protocolStartIndex = msg.raw.indexOf('OMCI Protocol');
    let omciTextRaw = protocolStartIndex !== -1 ? msg.raw.substring(protocolStartIndex) : msg.raw;
    
    const forbiddenTerms = [
      "Transaction Correlation ID",
      "Trailer",
      "Device Identifier",
      "Destination Bit",
      "Acknowledge Request",
      "Acknowledgement",
      "Attribute Mask",
      "CPCS-UU and CPI",
      "CPCS-SDU Length",
      "CRC32"
    ];

    const bitmaskRegex = /^[.\s01]+\s*=\s*/;
    const summaryTerms = ["Message Type", "Managed Entity Class", "Managed Entity Instance"];

    const lines = omciTextRaw.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return false;
      if (bitmaskRegex.test(trimmedLine)) return false;
      if (summaryTerms.some(term => trimmedLine.includes(term)) && !trimmedLine.includes('OMCI Protocol')) return false;
      return !forbiddenTerms.some(term => line.includes(term));
    });

    const isTableAttr6 = (line: string) => line.includes('06') || line.toLowerCase().includes('tagging operation table');
    const isVlanFilterListAttr = (line: string) => line.toLowerCase().includes('filter list') || line.includes('01:');

    const getAssociationTypeLabel = (val: string) => {
      const num = parseInt(val.match(/\d+/)?.[0] || "-1");
      const labels: Record<number, string> = {
        0: "MAC bridge port configuration data",
        1: "IEEE 802.1p mapper service profile",
        2: "Physical path termination point Ethernet UNI",
        3: "IP host config data or IPv6 host config data",
        4: "Physical path termination point xDSL UNI",
        5: "GEM interworking termination point",
        6: "Multicast GEM interworking termination point",
        7: "Physical path termination point MoCA UNI",
        9: "Ethernet flow termination point",
        10: "Virtual Ethernet interface point",
        11: "MPLS pseudowire termination point"
      };
      return labels[num] ? `${val} (${labels[num]})` : val;
    };

    return (
      <div className="flex flex-col gap-6 animate-in fade-in duration-300">
        
        {/* Tóm tắt thông tin quan trọng phía trên */}
        <div className="grid grid-cols-1 gap-3 px-2">
          <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 shadow-xl space-y-2">
             <div className="flex justify-between items-center border-b border-slate-800 pb-2">
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Message Type</span>
               <span className="text-[12px] font-bold text-blue-400">{msg.messageType}</span>
             </div>
             <div className="flex justify-between items-center border-b border-slate-800 pb-2">
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Entity Class</span>
               <span className="text-[12px] font-bold text-white">{msg.meClassName} ({msg.meClass})</span>
             </div>
             <div className="flex justify-between items-center">
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Instance ID</span>
               <span className="text-[12px] font-mono font-bold text-emerald-400">{msg.meInstance}</span>
             </div>
          </div>
        </div>

        {/* Protocol Attributes Section */}
        <div className="bg-slate-950/80 rounded-2xl border border-slate-800 shadow-2xl p-6 overflow-hidden">
          <div className="font-mono text-[11px] leading-relaxed select-text space-y-1">
            {filteredLines.map((line, idx) => {
              const isHeader = line.includes('OMCI Protocol');
              const isAttrList = line.includes('Attribute List');
              
              let displayLine = line;
              if (isMe171 && line.toLowerCase().includes('association type')) {
                displayLine = getAssociationTypeLabel(line);
              }

              const hexMatch = line.match(/\(([0-9a-fA-F]{4,})\)/) || line.match(/([0-9a-fA-F]{4,})/);
              const hexValue = hexMatch ? hexMatch[1] : '';

              return (
                <div key={idx} className="group">
                  <div className={`
                    ${isHeader ? 'text-white font-bold text-[13px] mb-2' : ''}
                    ${isAttrList ? 'text-white font-bold mt-4 mb-2' : ''}
                    ${!isHeader && !isAttrList ? 'text-slate-400' : ''}
                  `}>
                    {displayLine}
                  </div>
                  
                  {/* Giải mã Extended VLAN (ME 171) */}
                  {isMe171 && isOltToOnu && isTableAttr6(line) && hexValue.length >= 32 && (
                    <div className="pl-4">
                      {decodeVlanTableEnhanced(hexValue)}
                    </div>
                  )}

                  {/* Giải mã VLAN Filter List (ME 84) */}
                  {isMe84 && isVlanFilterListAttr(line) && hexValue.length >= 4 && (
                    <div className="pl-4">
                      {decodeVlanFilterList(hexValue)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Raw Frame Section - Hiển thị đúng text structure */}
        <div className="space-y-2">
           <h4 className="text-[9px] font-black text-slate-600 uppercase tracking-widest px-2">Raw File Context</h4>
           <div className="bg-slate-950 p-4 rounded-xl border border-slate-900 shadow-inner max-h-[250px] overflow-auto custom-scrollbar">
              <pre className="font-mono text-[10px] text-slate-700 whitespace-pre leading-relaxed select-all">
                {msg.raw}
              </pre>
           </div>
        </div>
      </div>
    );
  };

  const ServiceModelGrid = () => (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-blue-500 flex items-center gap-2">
           <i className="fas fa-project-diagram"></i> OMCI Service Model
        </h3>
        <button onClick={() => handleAiAnalysis('service')} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg flex items-center gap-2 transition-all active:scale-95">
          <i className="fas fa-robot"></i> AI Model Validation
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {serviceNodes.connected.length > 0 ? serviceNodes.connected.map((link, idx) => (
          <div key={idx} className="flex items-center gap-6 p-4 bg-slate-950 rounded-xl border border-slate-800 group hover:border-blue-500 transition-all">
            <div className="flex-1 text-right cursor-pointer hover:text-blue-400 transition-colors" onClick={() => handleEntityClick(link.from)}>
              <span className="text-xs font-bold text-slate-300 block group-hover:text-blue-400">{link.from.split('(')[0]}</span>
              <span className="text-[10px] font-mono text-slate-500">{link.from.match(/\(.*\)/)?.[0]}</span>
            </div>
            <div className="flex flex-col items-center min-w-[140px]">
              <span className="text-[9px] font-black text-blue-500/80 uppercase mb-1 tracking-tighter bg-blue-500/10 px-2 py-0.5 rounded">{link.label}</span>
              <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-blue-600 to-transparent relative">
                 <div className="absolute right-0 -top-1 w-2 h-2 bg-blue-600 rotate-45 shadow-[0_0_8px_rgba(37,99,235,0.6)]"></div>
              </div>
            </div>
            <div className="flex-1 cursor-pointer hover:text-emerald-300 transition-colors" onClick={() => handleEntityClick(link.to)}>
              <span className="text-xs font-bold text-emerald-400 block group-hover:text-emerald-300">{link.to}</span>
              <span className="text-[10px] text-slate-500">Resource Allocated</span>
            </div>
          </div>
        )) : <div className="text-center py-10 opacity-40 italic border-2 border-dashed border-slate-800 rounded-2xl">No successful ME connections detected yet.</div>}
      </div>
      {serviceNodes.isolated.length > 0 && (
        <div className="mt-10">
          <h4 className="text-[10px] font-black text-slate-500 uppercase mb-4 tracking-widest">Standalone / Isolated Entities</h4>
          <div className="flex flex-wrap gap-2">
            {serviceNodes.isolated.map((node, i) => (
              <div key={i} onClick={() => handleEntityClick(node)} className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[10px] font-medium text-slate-400 cursor-pointer hover:border-blue-500 hover:text-blue-400 transition-all">{node}</div>
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
          <h2 className="text-3xl font-bold mb-4">OMCI Analyzer Pro <span className="text-blue-500 text-sm">v0.1</span></h2>
          <p className="text-slate-400 max-w-lg mb-8">Import OMCI text log to visualize service hierarchy and run AI-based G.988 compliance checks.</p>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-xl font-bold text-lg shadow-xl shadow-blue-900/40 transition-all flex items-center gap-3 active:scale-95">
            <i className="fas fa-upload"></i> Import OMCI Text File
            <input type="file" className="hidden" accept=".txt,.log" onChange={handleFileUpload} />
          </label>
        </div>
      ) : (
        <div className="p-6 max-w-[1600px] mx-auto space-y-6">
          <div className="space-y-4">
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
                <button onClick={() => { setData(null); setViewMode('dashboard'); setFileName(''); setSearchTerm(''); setOnlyErrors(false); setDirectionFilter('both'); }} className="bg-rose-600 hover:bg-rose-500 text-white p-2 px-4 rounded-xl text-xs font-bold shadow-lg transition-all flex items-center gap-2">
                  <i className="fas fa-chevron-left"></i> New Analysis
                </button>
              </div>
            </div>
            <div className="relative z-40">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><i className="fas fa-search text-slate-500 text-sm"></i></div>
              <input type="text" placeholder="Search OMCI ME (Class, Instance or Type)..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-900/50 border border-slate-800 text-slate-200 text-sm rounded-2xl py-3 pl-11 pr-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all shadow-inner" />
              {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-slate-300"><i className="fas fa-times-circle"></i></button>}
              {meSuggestions.length > 0 && viewMode === 'dashboard' && (
                <div className="absolute mt-2 w-full bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                   <div className="p-2 border-b border-slate-800 text-[10px] font-black uppercase text-slate-500 px-4">Detected Managed Entities</div>
                   {meSuggestions.map((name, idx) => (
                     <button key={idx} onClick={() => handleSelectSuggestion(name)} className="w-full text-left px-4 py-3 text-xs font-bold text-slate-300 hover:bg-blue-600/20 hover:text-white transition-colors flex items-center justify-between group"><span className="flex items-center gap-2"><i className="fas fa-microchip text-blue-500 group-hover:scale-110 transition-transform"></i>{name}</span><i className="fas fa-arrow-right text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"></i></button>
                   ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {viewMode === 'dashboard' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                    <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 text-blue-500/10 group-hover:text-blue-500/20 transition-colors"><i className="fas fa-list-ol text-5xl"></i></div>
                      <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Total Frames</p>
                      <p className="text-2xl font-bold text-white relative z-10">{data.messages.length}</p>
                    </div>
                    <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 text-rose-500/10 group-hover:text-rose-500/20 transition-colors"><i className="fas fa-exclamation-triangle text-5xl"></i></div>
                      <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Failed Packets</p>
                      <div className="flex items-center justify-between relative z-10">
                        <p className={`text-2xl font-bold ${failedPackets.length > 0 ? 'text-rose-500' : 'text-blue-500'}`}>{failedPackets.length}</p>
                        {failedPackets.length > 0 && <button onClick={() => setShowFailedList(!showFailedList)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] px-2 py-1 rounded font-bold transition-all flex items-center gap-1">{showFailedList ? 'Hide' : 'Details'}<i className={`fas fa-chevron-${showFailedList ? 'up' : 'down'}`}></i></button>}
                      </div>
                      {showFailedList && failedPackets.length > 0 && (
                        <div className="mt-4 space-y-2 max-h-40 overflow-y-auto pr-1 relative z-10 border-t border-slate-800 pt-3">
                          {failedPackets.map((msg) => (
                            <div key={msg.id} onClick={() => navigateToPacket(msg)} className="bg-slate-950 p-2 rounded border border-slate-800 hover:border-rose-500/50 cursor-pointer transition-colors group/item flex justify-between items-center"><div className="flex flex-col"><span className="text-[9px] font-bold text-slate-300">#{msg.index} - {msg.messageType}</span><span className="text-[8px] font-mono text-slate-500">{msg.meClassName} ({msg.meInstance})</span></div><i className="fas fa-external-link-alt text-[8px] text-slate-600 group-hover/item:text-rose-500"></i></div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 text-emerald-500/10 group-hover:text-emerald-500/20 transition-colors"><i className="fas fa-heartbeat text-5xl"></i></div>
                      <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Status</p>
                      <p className={`text-lg font-black relative z-10 leading-tight uppercase ${(Object.values(data.stats) as MeStats[]).some(s => s.errors > 0) ? 'text-rose-500' : 'text-emerald-500'}`}>{(Object.values(data.stats) as MeStats[]).some(s => s.errors > 0) ? 'Anomalies Detected' : 'All Successful'}</p>
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl"><ServiceModelGrid /></div>
                </div>
              )}
              {viewMode === 'explorer' && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden h-full flex flex-col">
                  <div className="p-4 bg-slate-950/50 border-b border-slate-800 flex flex-wrap justify-between items-center sticky top-0 z-20 gap-3">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">{searchTerm ? `Search Results: ${searchTerm}` : 'Packet Explorer'}</h3>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setOnlyErrors(!onlyErrors)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border ${onlyErrors ? 'bg-rose-600 border-rose-500 text-white shadow-lg' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'}`}><i className="fas fa-exclamation-circle"></i> FAILED ONLY</button>
                      <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
                        <span className="text-[9px] font-black text-slate-500 uppercase px-2">Direction</span>
                        {(['both', 'olt', 'onu'] as DirectionFilter[]).map(f => (
                          <button key={f} onClick={() => setDirectionFilter(f)} className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${directionFilter === f ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>{f === 'both' ? 'Both' : f.toUpperCase()}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div id="packet-explorer-container" className="overflow-auto max-h-[700px] flex-1 scroll-smooth">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="text-[10px] font-black uppercase text-slate-500 bg-slate-950/30 sticky top-0 backdrop-blur-md z-10">
                        <tr><th className="px-6 py-4">#</th><th className="px-6 py-4">Direction</th><th className="px-6 py-4">Message</th><th className="px-6 py-4">Entity</th><th className="px-6 py-4">Inst</th><th className="px-6 py-4 text-right">Result</th></tr>
                      </thead>
                      <tbody>
                        {processedPackets.map((item) => {
                          if ('type' in item && item.type === 'group') {
                            const isExpanded = expandedGroups[item.id];
                            const groupTitle = item.groupType === 'mib' ? 'MIB Setup Sequence' : 'Attribute Value Change Block';
                            return (
                              <React.Fragment key={item.id}>
                                <tr onClick={() => setExpandedGroups(prev => ({ ...prev, [item.id]: !isExpanded }))} className="bg-indigo-950/20 border-y border-indigo-500/10 cursor-pointer hover:bg-indigo-900/30 group"><td colSpan={6} className="px-6 py-3"><div className="flex items-center gap-3 text-indigo-400 font-bold text-xs"><i className={`fas fa-chevron-${isExpanded ? 'down' : 'right'} transition-transform`}></i><span className="flex items-center gap-2"><i className="fas fa-layer-group opacity-50"></i>{groupTitle} ({item.messages.length} packets)</span></div></td></tr>
                                {isExpanded && item.messages.map(m => <PacketRow key={m.id} msg={m} isSelected={selectedMsg?.id === m.id} onClick={() => { setSelectedMsg(m); setIsExternalNav(false); }} />)}
                              </React.Fragment>
                            );
                          } else {
                            const msg = item as OmciMessage;
                            return <PacketRow key={msg.id} msg={msg} isSelected={selectedMsg?.id === msg.id} onClick={() => { setSelectedMsg(msg); setIsExternalNav(false); }} />;
                          }
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {viewMode === 'service' && <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl min-h-[500px]"><ServiceModelGrid /></div>}
              {viewMode === 'ai' && (
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl min-h-[500px] flex flex-col">
                   <h3 className="text-xl font-bold mb-6 text-indigo-400 flex items-center gap-2"><i className="fas fa-brain"></i> AI Diagnostics Report</h3>
                   {aiLoading ? <div className="flex-1 flex flex-col items-center justify-center space-y-4"><div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div><p className="text-sm text-slate-400 animate-pulse">Gemini is analyzing provisioning logic...</p></div> : aiResult ? <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 font-mono text-sm leading-relaxed text-slate-300 whitespace-pre-wrap max-h-[600px] overflow-auto">{aiResult}</div> : <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40"><i className="fas fa-robot text-6xl mb-4"></i><p>Click "Run AI Check" to perform a deep analysis.</p></div>}
                </div>
              )}
              {viewMode === 'sequence' && <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl"><SequenceDiagram messages={data.messages} onSelectMsg={(msg) => setSelectedMsg(msg)} selectedMsgId={selectedMsg?.id} /></div>}
              {viewMode === 'tree' && <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl h-[700px] overflow-auto custom-scrollbar"><h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-6 px-6">OMCI Managed Entity Tree</h3><TreeDiagram node={dynamicTopology} onSelect={handleEntityClick} /></div>}
            </div>

            <div className="space-y-6">
               <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl min-h-[600px] flex flex-col sticky top-24">
                  <div className="bg-blue-600/10 p-4 border-b border-blue-600/20 flex items-center justify-between">
                    <h4 className="font-bold text-sm flex items-center gap-2 text-white"><i className="fas fa-search-plus text-blue-500"></i> Packet Inspector</h4>
                    {selectedMsg && <span className="text-[9px] font-mono text-slate-500">TX: {selectedMsg.transactionId}</span>}
                  </div>
                  <div className="p-5 flex-1 overflow-auto bg-slate-900/40 custom-scrollbar">
                    {selectedMsg ? (
                      <WiresharkInspector msg={selectedMsg} />
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                         <i className="fas fa-microchip text-5xl mb-4"></i>
                         <p className="text-sm font-medium px-10">Select an OMCI packet from the list to view its decoded G.988 attributes.</p>
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
  <tr id={`packet-row-${msg.id}`} onClick={onClick} className={`cursor-pointer transition-all border-b border-slate-800/50 ${isSelected ? 'bg-blue-600/20' : 'hover:bg-slate-800/40'}`}>
    <td className="px-6 py-4 font-mono text-slate-500 text-[11px]">{msg.index}</td>
    <td className="px-6 py-4"><span className={`flex items-center gap-2 font-black text-[9px] uppercase ${msg.direction === OmciDirection.OLT_TO_ONU ? 'text-blue-500' : 'text-emerald-500'}`}><i className={`fas fa-arrow-${msg.direction === OmciDirection.OLT_TO_ONU ? 'right' : 'left'}`}></i>{msg.direction === OmciDirection.OLT_TO_ONU ? 'OLT to ONU' : 'ONU to OLT'}</span></td>
    <td className="px-6 py-4 font-bold text-slate-200 text-xs">{msg.messageType}</td>
    <td className="px-6 py-4 text-blue-400 font-bold text-xs truncate max-w-[150px]">{msg.meClassName}</td>
    <td className="px-6 py-4 font-mono text-slate-400 text-xs">{msg.meInstance}</td>
    <td className="px-6 py-4 text-right"><span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${msg.isError ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'}`}>{msg.resultCode || 'Success'}</span></td>
  </tr>
);

export default App;
