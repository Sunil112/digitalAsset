import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateBurnRequestDto {
  @IsString()
  @IsNotEmpty()
  adminPartyId!: string;

  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsString()
  @IsNotEmpty()
  requestedByPartyId!: string;

  @IsString()
  @IsNotEmpty()
  holdingContractId!: string;

  @IsNumber()
  @Min(0.000001)
  qty!: number;
}
