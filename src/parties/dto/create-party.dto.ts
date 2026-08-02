import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PartyType } from '../types/party.types';

export class CreatePartyDto {
  @IsString()
  @IsNotEmpty()
  partyId!: string;

  @IsString()
  @IsNotEmpty()
  organizationName!: string;

  @IsEnum(PartyType)
  @IsNotEmpty()
  partyType!: PartyType;

  @IsOptional()
  @IsString()
  leiCode?: string;

  @IsOptional()
  metadata?: Record<string, any> | string;
}
