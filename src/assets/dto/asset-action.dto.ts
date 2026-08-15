import { IsNotEmpty, IsString } from 'class-validator';

export class AssetActionDto {
  @IsString()
  @IsNotEmpty()
  adminPartyId!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;
}
