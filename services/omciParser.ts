
import { OmciMessage, OmciDirection, MeStats, TopologyNode, AnalysisResult, ServiceLink } from '../types';

export const parseOmciText = (text: string, forceHex: boolean = false): AnalysisResult => {
  const messages: OmciMessage[] = [];
  const stats: Record<string, MeStats> = {};
  const serviceModel: ServiceLink[] = [];
  const pendingLinks = new Map<string, ServiceLink[]>();

  // Tách text dựa trên tiêu đề cột của Wireshark: "No.     Time           Source"
  // Mỗi khối sẽ bắt đầu từ dòng tiêu đề này cho đến trước dòng tiêu đề tiếp theo.
  const rawChunks = text.split(/(?=No\.\s+Time\s+Source)/i);
  
  const packetChunks = rawChunks.filter(c => {
    const trimmed = c.trim();
    // Phải chứa từ khóa OMCI để được coi là gói tin OMCI hợp lệ
    return trimmed.length > 0 && trimmed.toLowerCase().includes('omci');
  });
  
  packetChunks.forEach((chunk, chunkIdx) => {
    const lines = chunk.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    // 1. Trích xuất Index (Số thứ tự gói tin thực tế)
    // Trong Wireshark text export, dòng dữ liệu nằm ngay sau dòng tiêu đề "No. Time..."
    // Dòng này thường bắt đầu bằng: "   174 9.664179 ..."
    let index = chunkIdx + 1;
    for (const line of lines) {
      const match = line.match(/^(\d+)\s+\d+\.\d+/);
      if (match) {
        index = parseInt(match[1]);
        break;
      }
    }

    // 2. Nhận diện hướng (Direction) chuẩn xác
    // Ưu tiên tìm trong dòng "OMCI Protocol, ..."
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
      
      // Trích xuất Type và Entity từ dòng: "OMCI Protocol, OLT> Get - ONT-G"
      const summaryMatch = protocolLine.match(/,\s*(?:OLT>|ONU<)\s*([^-]+)\s*-\s*(.+)$/i);
      if (summaryMatch) {
        summaryMsgType = summaryMatch[1].trim();
        summaryMeName = summaryMatch[2].trim();
      }
    }

    // 3. Lấy Message Type chi tiết
    let messageType = summaryMsgType || "Unknown";
    const msgTypeDetailMatch = chunk.match(/Message Type\s*=\s*([^(\n\r]+)/i);
    if (msgTypeDetailMatch) {
      messageType = msgTypeDetailMatch[1].trim();
    }

    // 4. Lấy ME Class
    let meClassName = summaryMeName || "Unknown Entity";
    let meClassId = "0";
    const meClassMatch = chunk.match(/Managed Entity Class:\s*([^(\n\r]+)\s*\((\d+|0x[0-9a-fA-F]+)\)/i);
    if (meClassMatch) {
      meClassName = meClassMatch[1].trim();
      meClassId = meClassMatch[2].trim();
    }

    // 5. Lấy ME Instance
    let meInstance = "0x0000";
    const meInstMatch = chunk.match(/Managed Entity Instance:\s*(0x[0-9a-fA-F]+|\d+)/i) || 
                       chunk.match(/Instance\s*=\s*(0x[0-9a-fA-F]+|\d+)/i);
    if (meInstMatch) {
      meInstance = meInstMatch[1].startsWith('0x') ? 
        meInstMatch[1].toLowerCase() : 
        `0x${parseInt(meInstMatch[1]).toString(16).padStart(4, '0')}`;
    }

    // 6. Lấy Transaction ID
    let transactionId = "0x0000";
    const txMatch = chunk.match(/Transaction Correlation ID:\s*(\d+)/i) || 
                   chunk.match(/Transaction ID:\s*(0x[0-9a-fA-F]+|\d+)/i);
    if (txMatch) {
      transactionId = txMatch[1].startsWith('0x') ? txMatch[1] : `0x${parseInt(txMatch[1]).toString(16).padStart(4, '0')}`;
    }

    // 7. Lấy Result (Success/Error)
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

    // Parse attributes - Trích xuất các cặp key-value
    for (const line of lines) {
      if (line.toLowerCase().includes('trailer')) break;
      if (line.includes(':') && line.length > 5 && !/no\.|frame|ethernet|omci|transaction|identifier|managed entity|message type/i.test(line)) {
        const parts = line.split(':');
        const key = parts[0].trim();
        const val = parts.slice(1).join(':').trim();
        if (key && val) {
          dataMap[key] = val;
          // Logic tạo Service Model (dựa trên pointer)
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

  // Luôn sắp xếp theo số No. thực tế trong log Wireshark
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
