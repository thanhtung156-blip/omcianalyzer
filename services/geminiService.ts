
import { GoogleGenAI } from "@google/genai";

export const analyzeOmciAnomalies = async (rawLogs: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `
      You are an expert GPON/OMCI Network Engineer. 
      Analyze the following OMCI data. The input might be a Wireshark text export or a raw hex dump (extracted from PCAP).
      
      Using ITU-T G.988 standards and logic similar to the OMCI.lua Wireshark dissector, identify:
      1. Configuration sequence health (MIB Reset -> MIB Upload -> Layer 2 Connectivity).
      2. Any orphaned Managed Entities (e.g., GEM Ports without associated T-CONTs).
      3. Invalid VLAN tagging operations based on ME 171/84 configurations.
      4. Summary of the provisioning flow and potential bottleneck or failure points.

      If you see hex strings (e.g., 48-byte frames), decode the header (Transaction ID, Message Type, ME Class, ME Instance) to provide context.

      DATA:
      ${rawLogs.substring(0, 15000)} // Truncated for token safety
      
      Respond with technical precision using professional bullet points.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
    });

    return response.text;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Analysis unavailable. Please ensure your API key is valid and the file contains recognizable OMCI data.";
  }
};
