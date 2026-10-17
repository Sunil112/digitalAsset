import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { BurnService } from './burn.service';
import { CreateBurnRequestDto } from './dto/create-burn-request.dto';
import { ApproveBurnDto, CancelBurnDto } from './dto/burn-action.dto';

@Controller('burn')
export class BurnController {
  constructor(private readonly burnService: BurnService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createBurnRequest(@Body() dto: CreateBurnRequestDto) {
    return await this.burnService.createBurnRequest(dto);
  }

  @Get()
  async listBurnRequests(
    @Query('adminPartyId') adminPartyId?: string,
    @Query('assetId') assetId?: string,
  ) {
    return await this.burnService.getAllBurnRequests(adminPartyId, assetId);
  }

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  async approveBurnRequest(@Body() dto: ApproveBurnDto) {
    return await this.burnService.approveBurnRequest(dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancelBurnRequest(@Body() dto: CancelBurnDto) {
    return await this.burnService.cancelBurnRequest(dto);
  }
}
