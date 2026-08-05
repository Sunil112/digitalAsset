import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { WhitelistDto } from './dto/whitelist.dto';
import { RelationshipsService } from './relationships.service';

@Controller('relationships')
export class RelationshipsController {
  constructor(private readonly service: RelationshipsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createRelationship(@Body() dto: CreateRelationshipDto) {
    return await this.service.createRelationship(dto);
  }

  @Get()
  async getAllRelationships() {
    return await this.service.getAllRelationships();
  }

  @Post('whitelist')
  @HttpCode(HttpStatus.OK)
  async whitelistParty(@Body() dto: WhitelistDto) {
    return await this.service.whitelistParty(dto);
  }

  @Delete('whitelist')
  @HttpCode(HttpStatus.OK)
  async revokeWhitelist(@Body() dto: WhitelistDto) {
    return await this.service.revokeWhitelist(dto);
  }
}
