import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { CreatePartyDto } from './dto/create-party.dto';
import { PartiesService } from './parties.service';

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
  async findOne(@Param('id') id: string) {
    return await this.partiesService.findOne(id);
  }


}
