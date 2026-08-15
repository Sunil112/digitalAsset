export enum AssetStatus {
  ENABLED = 'ENABLED',
  DISABLED = 'DISABLED',
}

export interface Asset {
  id: string;
  adminPartyId: string;
  assetId: string;
  metadata?: Record<string, any>;
  damlContractId?: string | Record<string, unknown>;
  enabled: boolean;
  status: AssetStatus;
}
