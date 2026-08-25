import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty()
  adminPartyId!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsOptional()
  metadata?: string | Record<string, any>;
}
