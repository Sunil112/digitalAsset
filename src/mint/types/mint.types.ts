export enum MintStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  CANCELLED = 'CANCELLED',
}

export interface MintRequest {
  id: string;
  adminPartyId: string;
  assetId: string;
  issuerPartyId: string;
  targetOwnerPartyId: string;
  qty: number;
  status: MintStatus;
  damlContractId?: string;
  holdingContractId?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
