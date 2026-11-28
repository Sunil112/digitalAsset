import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSwapRequestDto {
  @IsString()
  @IsNotEmpty()
  swapId!: string;

  @IsString()
  @IsNotEmpty()
  partyAId!: string;

  @IsString()
  @IsNotEmpty()
  partyBId!: string;

  @IsString()
  @IsNotEmpty()
  escrowPartyId!: string;

  @IsString()
  @IsNotEmpty()
  pauseOwnerPartyId!: string;

  @IsString()
  @IsNotEmpty()
  legAHoldingContractId!: string;

  @IsNumber()
  @Min(0.000001)
  legAQty!: number;

  @IsString()
  @IsNotEmpty()
  legAAdminPartyId!: string;

  @IsString()
  @IsNotEmpty()
  legBHoldingContractId!: string;

  @IsNumber()
  @Min(0.000001)
  legBQty!: number;

  @IsString()
  @IsNotEmpty()
  legBAdminPartyId!: string;

  @IsString()
  @IsOptional()
  expiryTime?: string;
}
