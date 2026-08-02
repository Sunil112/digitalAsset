import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CreatePartyDto } from './dto/create-party.dto';
import { PartiesService } from './parties.service';

import { PartyActionDto } from './dto/part-action.dto';

@Controller('parties')
export class PartiesController {
  constructor(private readonly partiesService: PartiesService) {}

  @Post('parties')
  @HttpCode(HttpStatus.CREATED)
  async createParty(@Body() createPartyDto: CreatePartyDto) {
    return await this.partiesService.createParty(createPartyDto);
  }

  @Get('parties')
  async getAllParties() {
    return await this.partiesService.getAllParties();
  }

  @Get('parties/:id')
  async getParty(@Param('id') id: string) {
    return await this.partiesService.getParty(id);
  }

  @Post('parties/activate')
  @HttpCode(HttpStatus.OK)
  async activateParty(@Body() actionDto: PartyActionDto) {
    return await this.partiesService.activateParty(actionDto.partyId);
  }

  @Post('parties/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivateParty(@Body() actionDto: PartyActionDto) {
    return await this.partiesService.deactivateParty(actionDto.partyId);
  }
}
