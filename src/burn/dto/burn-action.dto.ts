import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ApproveBurnDto {
  @IsString()
  @IsNotEmpty()
  adminPartyId!: string;

  @IsString()
  @IsNotEmpty()
  burnRequestId!: string;
}

export class CancelBurnDto {
  @IsString()
  @IsNotEmpty()
  requestedByPartyId!: string;

  @IsString()
  @IsNotEmpty()
  burnRequestId!: string;
}

export class ListBurnRequestsDto {
  @IsString()
  @IsOptional()
  adminPartyId?: string;

  @IsString()
  @IsOptional()
  assetId?: string;
}
