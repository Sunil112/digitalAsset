import { IsNotEmpty, IsString } from 'class-validator';

export class AcceptSwapDto {
  @IsString()
  @IsNotEmpty()
  swapRequestId!: string;

  @IsString()
  @IsNotEmpty()
  partyBId!: string;

  @IsString()
  @IsNotEmpty()
  escrowPartyId!: string;
}

export class CancelSwapDto {
  @IsString()
  @IsNotEmpty()
  swapRequestId!: string;

  @IsString()
  @IsNotEmpty()
  partyAId!: string;
}

export class LockLegADto {
  @IsString()
  @IsNotEmpty()
  swapRequestId!: string;

  @IsString()
  @IsNotEmpty()
  partyAId!: string;

  @IsString()
  @IsNotEmpty()
  escrowPartyId!: string;

  @IsString()
  @IsNotEmpty()
  legAAdminPartyId!: string;
}

export class LockLegBDto {
  @IsString()
  @IsNotEmpty()
  swapRequestId!: string;

  @IsString()
  @IsNotEmpty()
  partyBId!: string;

  @IsString()
  @IsNotEmpty()
  escrowPartyId!: string;

  @IsString()
  @IsNotEmpty()
  legBAdminPartyId!: string;
}

export class SettleSwapDto {
  @IsString()
  @IsNotEmpty()
  swapRequestId!: string;

  @IsString()
  @IsNotEmpty()
  escrowPartyId!: string;

  @IsString()
  @IsNotEmpty()
  legAAdminPartyId!: string;

  @IsString()
  @IsNotEmpty()
  legBAdminPartyId!: string;
}

export class AbortSwapDto {
  @IsString()
  @IsNotEmpty()
  swapRequestId!: string;

  @IsString()
  @IsNotEmpty()
  escrowPartyId!: string;

  @IsString()
  @IsNotEmpty()
  legAAdminPartyId!: string;

  @IsString()
  @IsNotEmpty()
  legBAdminPartyId!: string;
}
