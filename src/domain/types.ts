// Modelo de domínio. Independente de UI e de armazenamento,
// para permitir trocar localStorage por banco de dados no futuro.

export type PackageStatus = 'pending' | 'delivered' | 'failed';

export interface Package {
  id: string;
  /** Rótulo exibido: "#113" ou "+1" (pacote adicional sem número). */
  label: string;
  /** Número da etiqueta, quando existe. Pacotes "+N" não têm número. */
  number: number | null;
  /** true para pacotes indicados como +1, +2... */
  extra: boolean;
  /** Código de rastreio (planilha), quando disponível. */
  tracking?: string;
  /** Complemento específico deste pacote (planilha). */
  complement?: string;
  status: PackageStatus;
  failReason?: string;
  updatedAt?: number;
}

export type PropertyType = 'casa' | 'predio' | 'comercio' | 'desconhecido';

export interface Address {
  street: string;
  number: string;
  district?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Linha completa como veio do arquivo. */
  raw: string;
}

export type GeoPrecision = 'shopee' | 'numero' | 'rua' | 'aproximado' | 'manual' | 'gps';

export interface GeoPoint {
  lat: number;
  lng: number;
  precision: GeoPrecision;
  /** Coordenada conferida pelo entregador (manual ou GPS na porta). */
  verified: boolean;
  source: string;
  displayName?: string;
}

export interface Stop {
  id: string;
  /** Endereço original da Shopee — nunca é alterado. */
  original: Address;
  /** Correção manual (se houver). Prevalece sobre o original para localizar e rotear. */
  corrected?: Address;
  correctionNote?: string;
  complement: string;
  notes: string;
  propertyType: PropertyType;
  /** 'informado' = veio do arquivo/inferido do texto; 'confirmado' = conferido pelo entregador. */
  propertyTypeSource: 'inferido' | 'confirmado' | 'nenhum';
  packages: Package[];
  geo?: GeoPoint;
  /** Grupo/ordem do arquivo importado (PDF), preservados para comparação. */
  importedGroup?: number;
  importedSeq?: number;
  /** Lado da avenida divisora (+1/-1), calculado após geocodificar. */
  dividerSide?: number;
  /** Alertas detectados na importação (ex.: divergência de endereço citada na observação). */
  flags: string[];
}

export interface Group {
  index: number; // 1..N
  colorKey: string;
  name?: string; // ex.: "Norte" (do PDF)
  stopIds: string[];
}

export type RouteMethod = 'importado' | 'linha-reta' | 'malha-viaria';

export interface RoutePlan {
  method: RouteMethod;
  /** Ordem global das paradas. Os grupos são fatias contíguas desta ordem. */
  order: string[];
  groups: Group[];
  createdAt: number;
  /** Tempo estimado de deslocamento (s), quando calculado por matriz. */
  totalSeconds?: number;
  /** Tempo da ordem importada medido na mesma matriz, para comparação. */
  importedSeconds?: number;
  notes: string[];
  /** true quando endereços foram corrigidos depois do cálculo. */
  stale?: boolean;
}

export type IssueLevel = 'erro' | 'aviso' | 'info';
export interface ImportIssue {
  level: IssueLevel;
  message: string;
}

export interface ImportResult {
  source: 'pdf' | 'planilha';
  fileName: string;
  title?: string;
  stops: Stop[];
  groups: Group[]; // grupos do arquivo (PDF) ou vazio
  issues: ImportIssue[];
  declared?: { packages?: number; stops?: number };
}

export interface AuditEntry {
  at: number;
  kind: 'saiu-com-pendencia' | 'atravessou-com-pendencia' | 'nao-entregue' | 'pulou' | 'correcao';
  stopId: string;
  justification: string;
  pendingStopIds: string[];
}
