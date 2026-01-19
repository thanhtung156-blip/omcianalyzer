
import { OmciMessage, OmciDirection, MeStats, TopologyNode, AnalysisResult, ServiceLink } from '../types';

export const parseOmciText = (text: string, forceHex: boolean = false): AnalysisResult => {
  const messages: OmciMessage[] = [];
  const stats: Record<string, MeStats> = {};
  const serviceModel: ServiceLink[] = [];
  const pendingLinks = new Map<string, ServiceLink[]>();

  const packetChunks = text.split(/(?=Frame\s+\d+:|No\.\s+\d+\s+\d+\.\d+)/i);
  
  packetChunks.forEach((chunk, chunkIdx) => {
    if (!chunk.trim() || !chunk.toLowerCase().includes('omci')) return;

    const lines = chunk.split('\n').map(l => l.trim());
    const frameMatch = chunk.match(/Frame\s+(\d+):/i) || chunk.match(/No\.\s+(\d+)/i);
    const index = frameMatch ? parseInt(frameMatch[1]) : messages.length + 1;

    let direction = OmciDirection.OLT_TO_ONU;
    if (chunk.includes('ONU<') || chunk.includes('OLT<') || chunk.includes('ONU > OLT')) {
      direction = OmciDirection.ONU_TO_OLT;
    } else if (chunk.includes('OLT>') || chunk.includes('ONU>') || chunk.includes('OLT > ONU')) {
      direction = OmciDirection.OLT_TO_ONU;
    }

    let messageType = "Unknown";
    const msgTypeMatch = chunk.match(/Message Type\s*=\s*([^(\n\r]+)/i) || chunk.match(/Message Type:\s*([^(\n\r]+)/i);
    if (msgTypeMatch) {
      messageType = msgTypeMatch[1].trim().split(/\r?\n/)[0].trim();
    }

    let meClassName = "Unknown Entity";
    let meClassId = "0";
    const meClassMatch = chunk.match(/Managed Entity Class:\s*([^(\n\r]+)\s*\((\d+|0x[0-9a-fA-F]+)\)/i);
    if (meClassMatch) {
      meClassName = meClassMatch[1].trim();
      meClassId = meClassMatch[2].trim();
    } else {
      const meLineMatch = chunk.match(/ME Class\s*=\s*([^,]+)/i);
      if (meLineMatch) meClassName = meLineMatch[1].trim();
    }

    let meInstance = "0x0000";
    const meInstMatch = chunk.match(/Managed Entity Instance:\s*(0x[0-9a-fA-F]+|\d+)/i) || chunk.match(/Instance\s*=\s*(0x[0-9a-fA-F]+|\d+)/i);
    if (meInstMatch) {
      meInstance = meInstMatch[1].startsWith('0x') ? meInstMatch[1].toLowerCase() : `0x${parseInt(meInstMatch[1]).toString(16).padStart(4, '0')}`;
    }

    let transactionId = "0x0000";
    const txMatch = chunk.match(/Transaction Correlation ID:\s*(\d+)/i) || chunk.match(/Transaction ID:\s*(0x[0-9a-fA-F]+|\d+)/i);
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
      if (!/success|processed successfully|00|0x00/i.test(rawRes)) {
        isError = true;
      }
    }

    const dataMap: Record<string, string> = {};
    const currentPendingLinks: ServiceLink[] = [];

    lines.forEach(line => {
      if (line.includes(':') && line.length > 5 && !/frame|ethernet|omci|transaction|identifier|managed entity|message type/i.test(line)) {
        const parts = line.split(':');
        const key = parts[0].trim();
        const val = parts.slice(1).join(':').trim();
        if (key && val) {
          dataMap[key] = val;
          // Phát hiện liên kết dựa trên từ khóa G.988 (Pointer, T-CONT, GEM, ANI, UNI, Bridge)
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
    });

    // Nếu là lệnh Request từ OLT, lưu vào hàng đợi chờ phản hồi success
    if (direction === OmciDirection.OLT_TO_ONU && currentPendingLinks.length > 0) {
      pendingLinks.set(transactionId, currentPendingLinks);
    }

    // Nếu là phản hồi ONU Success, đẩy các liên kết đã lưu vào model chính
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
    const key = `${msg.meClassName} (${msg.meInstance})`;
    if (!stats[msg.meClassName]) {
      stats[msg.meClassName] = { className: msg.meClassName, count: 0, instances: [], errors: 0 };
    }
    stats[msg.meClassName].count++;
    if (msg.isError) stats[msg.meClassName].errors++;
    if (!stats[msg.meClassName].instances.includes(msg.meInstance)) {
      stats[msg.meClassName].instances.push(msg.meInstance);
    }
  });

  const topology: TopologyNode = {
    name: 'GPON OLT',
    type: 'OLT',
    children: []
  };

  return { messages, stats, serviceModel, anomalies: [], topology };
};
