import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRelationshipDto {
  @IsString()
  @IsNotEmpty()
  fromPartyId!: string;

  @IsString()
  @IsNotEmpty()
  toPartyId!: string;

  @IsString()
  @IsIn(['HOLDER', 'ISSUER'])
  relationshipType!: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  metadata?: string | Record<string, any>;
}
