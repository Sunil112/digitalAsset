import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { MintService } from './mint.service';
import { CreateMintRequestDto } from './dto/create-mint-request.dto';
import { ApproveMintDto, CancelMintDto } from './dto/mint-action.dto';

@Controller('mint')
export class MintController {
  constructor(private readonly mintService: MintService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createMintRequest(@Body() dto: CreateMintRequestDto) {
    return await this.mintService.createMintRequest(dto);
  }

  @Get()
  async listMintRequests(
    @Query('adminPartyId') adminPartyId?: string,
    @Query('assetId') assetId?: string,
  ) {
    return await this.mintService.getAllMintRequests(adminPartyId, assetId);
  }

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  async approveMintRequest(@Body() dto: ApproveMintDto) {
    return await this.mintService.approveMintRequest(dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancelMintRequest(@Body() dto: CancelMintDto) {
    return await this.mintService.cancelMintRequest(dto);
  }
}
