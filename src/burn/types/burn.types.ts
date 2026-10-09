export enum BurnStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  CANCELLED = 'CANCELLED',
}

export interface BurnRequest {
  id: string;
  adminPartyId: string;
  assetId: string;
  requestedByPartyId: string;
  holdingContractId: string;
  qty: number;
  status: BurnStatus;
  damlContractId?: string;
  resultingHoldingContractId?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
