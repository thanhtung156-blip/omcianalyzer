
export enum OmciDirection {
  OLT_TO_ONU = 'OLT -> ONU',
  ONU_TO_OLT = 'ONU -> OLT'
}

export interface OmciMessage {
  id: string;
  index: number;
  timestamp: string;
  direction: OmciDirection;
  transactionId: string;
  messageType: string;
  meClass: string;
  meClassName: string;
  meInstance: string;
  data: Record<string, string>;
  raw: string;
  isValid: boolean;
  resultCode?: string;
  isError?: boolean;
}

export interface MeStats {
  className: string;
  count: number;
  instances: string[];
  errors: number;
}

export interface ServiceLink {
  from: string;
  to: string;
  label: string;
}

export interface AnalysisResult {
  messages: OmciMessage[];
  stats: Record<string, MeStats>;
  serviceModel: ServiceLink[];
  anomalies: string[];
  topology: TopologyNode;
}

export interface TopologyNode {
  name: string;
  type: 'OLT' | 'ONU' | 'TCONT' | 'GEM' | 'UNI' | 'BRIDGE';
  entityId?: string;
  children?: TopologyNode[];
}
