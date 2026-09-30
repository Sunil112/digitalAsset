import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateMintRequestDto {
  @IsString()
  @IsNotEmpty()
  adminPartyId!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsString()
  @IsNotEmpty()
  issuerPartyId!: string;

  @IsString()
  @IsNotEmpty()
  targetOwnerPartyId!: string;

  @IsNumber()
  @Min(0.000001)
  qty!: number;
}
