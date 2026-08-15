import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class WhitelistDto {
  @IsString()
  @IsNotEmpty()
  adminPartyId!: string;

  @IsString()
  @IsNotEmpty()
  partyId!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsString()
  @IsIn(['HOLDER', 'ISSUER'])
  role!: string;
}
