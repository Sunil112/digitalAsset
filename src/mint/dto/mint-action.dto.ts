import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ApproveMintDto {
  @IsString()
  @IsNotEmpty()
  adminPartyId!: string;

  @IsString()
  @IsNotEmpty()
  issuerPartyId!: string;

  @IsString()
  @IsNotEmpty()
  mintRequestId!: string;
}

export class CancelMintDto {
  @IsString()
  @IsNotEmpty()
  issuerPartyId!: string;

  @IsString()
  @IsNotEmpty()
  mintRequestId!: string;
}

export class ListMintRequestsDto {
  @IsString()
  @IsOptional()
  adminPartyId?: string;

  @IsString()
  @IsOptional()
  assetId?: string;
}
