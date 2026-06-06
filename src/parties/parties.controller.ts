import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { CreatePartyDto } from './dto/create-party.dto';
import { PartiesService } from './parties.service';

@Controller('parties')
export class PartiesController {
  constructor(private readonly partiesService: PartiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createPartyDto: CreatePartyDto) {
    return await this.partiesService.createParty(createPartyDto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const party = this.partiesService.findOne(id);
    if (!party) {
      throw new NotFoundException(`Party with id ${id} not found`);
    }
    return party;
  }
}
