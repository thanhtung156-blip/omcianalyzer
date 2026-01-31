
import { OmciMessage, OmciDirection, MeStats, TopologyNode, AnalysisResult, ServiceLink } from '../types';

export const parseOmciText = (text: string, forceHex: boolean = false): AnalysisResult => {
  const messages: OmciMessage[] = [];
  const stats: Record<string, MeStats> = {};
  const serviceModel: ServiceLink[] = [];
  const pendingLinks = new Map<string, ServiceLink[]>();

  const rawChunks = text.split(/(?=No\.\s+Time\s+Source)/i);
  
  const packetChunks = rawChunks.filter(c => {
    const trimmed = c.trim();
    return trimmed.length > 0 && trimmed.toLowerCase().includes('omci');
  });
  
  packetChunks.forEach((chunk, chunkIdx) => {
    const lines = chunk.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let index = chunkIdx + 1;
    for (const line of lines) {
      const match = line.match(/^(\d+)\s+\d+\.\d+/);
      if (match) {
        index = parseInt(match[1]);
        break;
      }
    }

    let direction = OmciDirection.OLT_TO_ONU;
    let summaryMeName = "";
    let summaryMsgType = "";
    
    const protocolLine = lines.find(l => l.includes('OMCI Protocol'));
    if (protocolLine) {
      if (protocolLine.includes('ONU<') || protocolLine.includes('ONU <')) {
        direction = OmciDirection.ONU_TO_OLT;
      } else if (protocolLine.includes('OLT>') || protocolLine.includes('OLT >')) {
        direction = OmciDirection.OLT_TO_ONU;
      }
      
      const summaryMatch = protocolLine.match(/,\s*(?:OLT>|ONU<)\s*([^-]+)\s*-\s*(.+)$/i);
      if (summaryMatch) {
        summaryMsgType = summaryMatch[1].trim();
        summaryMeName = summaryMatch[2].trim();
      }
    }

    let messageType = summaryMsgType || "Unknown";
    const msgTypeDetailMatch = chunk.match(/Message Type\s*=\s*([^(\n\r]+)/i);
    if (msgTypeDetailMatch) {
      messageType = msgTypeDetailMatch[1].trim();
    }

    let meClassName = summaryMeName || "Unknown Entity";
    let meClassId = "0";
    const meClassMatch = chunk.match(/Managed Entity Class:\s*([^(\n\r]+)\s*\((\d+|0x[0-9a-fA-F]+)\)/i) ||
                        chunk.match(/ME Class:\s*([^(\n\r]+)\s*\((\d+|0x[0-9a-fA-F]+)\)/i);
    if (meClassMatch) {
      meClassName = meClassMatch[1].trim();
      meClassId = meClassMatch[2].trim();
    }

    let meInstance = "0x0000";
    const meInstMatch = chunk.match(/Managed Entity Instance:\s*(0x[0-9a-fA-F]+|\d+)/i) || 
                       chunk.match(/Instance\s*=\s*(0x[0-9a-fA-F]+|\d+)/i) ||
                       chunk.match(/ME Instance:\s*(0x[0-9a-fA-F]+|\d+)/i);
    if (meInstMatch) {
      meInstance = meInstMatch[1].startsWith('0x') ? 
        meInstMatch[1].toLowerCase() : 
        `0x${parseInt(meInstMatch[1]).toString(16).padStart(4, '0')}`;
    }

    let transactionId = "0x0000";
    const txMatch = chunk.match(/Transaction Correlation ID:\s*(\d+)/i) || 
                   chunk.match(/Transaction ID:\s*(0x[0-9a-fA-F]+|\d+)/i) ||
                   chunk.match(/TX:\s*(0x[0-9a-fA-F]+)/i);
    if (txMatch) {
      transactionId = txMatch[1].startsWith('0x') ? txMatch[1] : `0x${parseInt(txMatch[1]).toString(16).padStart(4, '0')}`;
    }

    let resultCode: string | undefined = undefined;
    let isError = false;
    const resultMatch = chunk.match(/Result:\s*([^(]+)\s*\((\d+|0x[0-9a-fA-F]+)\)/i) || 
                       chunk.match(/Result:\s*([^\n\r]+)/i);
    
    if (resultMatch) {
      const rawRes = resultMatch[1].trim();
      resultCode = rawRes;
      if (!/success|processed successfully|00|0x00|command processed successfully/i.test(rawRes)) {
        isError = true;
      }
    }

    const dataMap: Record<string, string> = {};
    const currentPendingLinks: ServiceLink[] = [];

    // REFINED ATTRIBUTE PARSING
    for (const line of lines) {
      if (line.toLowerCase().includes('trailer')) break;
      
      // LOẠI BỎ CÁC DÒNG ĐIỀU KHIỂN VÀ HEADER TRIỆT ĐỂ
      const isBitFlagLine = /^[01\.\s]+\s*=\s*/.test(line); 
      const isWiresharkSummary = /^\d+\s+\d+\.\d+\s+/.test(line); 
      const isMacAddrLine = /^[0-9a-f]{2}:[0-9a-f]{2}_[0-9a-f]{2}:[0-9a-f]{2}/i.test(line);
      const isOmciSummary = line.includes('OLT>') || line.includes('ONU<');
      const isProtocolMeta = /^(Transaction Correlation|Message Type|Device Identifier|Message Identifier|Managed Entity|Attribute Mask|OMCI Protocol|Frame \d+)/i.test(line);

      if (line.includes(':') && !isBitFlagLine && !isWiresharkSummary && !isMacAddrLine && !isOmciSummary && !isProtocolMeta) {
        const parts = line.split(':');
        const key = parts[0].trim();
        const val = parts.slice(1).join(':').trim();
        
        // Bỏ các key rỗng hoặc key chỉ là bitflags
        if (key && val && !/^[0\.]/.test(key)) {
          dataMap[key] = val;
          // Logic mapping service model
          if (direction === OmciDirection.OLT_TO_ONU && (messageType.includes('Create') || messageType.includes('Set')) && 
              val.startsWith('0x') && /pointer|t-cont|gem|ani-g|uni|bridge|tp|iw/i.test(key)) {
             currentPendingLinks.push({
               from: `${meClassName} (${meInstance})`,
               to: val,
               label: key
             });
          }
        }
      }
    }

    if (direction === OmciDirection.OLT_TO_ONU && currentPendingLinks.length > 0) {
      pendingLinks.set(transactionId, currentPendingLinks);
    }

    if (direction === OmciDirection.ONU_TO_OLT && !isError && pendingLinks.has(transactionId)) {
      const links = pendingLinks.get(transactionId);
      if (links) serviceModel.push(...links);
      pendingLinks.delete(transactionId);
    }

    messages.push({
      id: `msg-${index}-${chunkIdx}`, index, timestamp: new Date().toLocaleTimeString(),
      direction, transactionId, messageType, meClass: meClassId, meClassName, meInstance,
      data: dataMap, raw: chunk, isValid: true, resultCode, isError
    });
  });

  messages.sort((a, b) => a.index - b.index);

  messages.forEach(msg => {
    if (!stats[msg.meClassName]) {
      stats[msg.meClassName] = { className: msg.meClassName, count: 0, instances: [], errors: 0 };
    }
    stats[msg.meClassName].count++;
    if (msg.isError) stats[msg.meClassName].errors++;
    if (!stats[msg.meClassName].instances.includes(msg.meInstance)) {
      stats[msg.meClassName].instances.push(msg.meInstance);
    }
  });

  return { messages, stats, serviceModel, anomalies: [], topology: { name: 'GPON OLT', type: 'OLT', children: [] } };
};
