import{ IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { PartyType } from  '../types/party.types';

export class CreatePartyDto {
  
    @IsString()
    @IsNotEmpty()
    partyId: string;

    @IsString()
    @IsNotEmpty()
    organizationName: string;

    @IsEnum(PartyType)
    @IsNotEmpty()
    partyType: PartyType;

    @IsOptional()
    leiCode?: string;

    @IsOptional()
    @IsString()
    metadata?: string;

}
