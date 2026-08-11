export enum RelationshipStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

export enum RelationshipType {
  HOLDER = 'HOLDER',
  ISSUER = 'ISSUER',
}

export interface Relationship {
  id: string;
  fromPartyId: string;
  toPartyId: string;
  relationshipType: string;
  assetId?: string;
  metadata?: Record<string, any>;
  damlContractId?: string | Record<string, any>;
  active?: boolean;
  status?: RelationshipStatus;
}
