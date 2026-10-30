export enum SwapStatus {
  PROPOSED = 'PROPOSED',
  ACCEPTED = 'ACCEPTED',
  LEG_A_LOCKED = 'LEG_A_LOCKED',
  LEG_B_LOCKED = 'LEG_B_LOCKED',
  READY_TO_SETTLE = 'READY_TO_SETTLE',
  SETTLED = 'SETTLED',
  ABORTED = 'ABORTED',
  CANCELLED = 'CANCELLED',
}

export interface SwapRequestRecord {
  id: string;
  swapId: string;
  partyAId: string;
  partyBId: string;
  escrowPartyId: string;
  pauseOwnerPartyId: string;
  legAHoldingContractId: string;
  legAQty: number;
  legAAdminPartyId: string;
  legBHoldingContractId: string;
  legBQty: number;
  legBAdminPartyId: string;
  expiryTime?: string;
  status: SwapStatus;
  damlSwapRequestContractId?: string;
  damlSwapEscrowContractId?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
