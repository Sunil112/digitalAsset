import { IsNotEmpty, IsString } from 'class-validator';

export class PartyActionDto {
  @IsString()
  @IsNotEmpty()
  partyId!: string;
}