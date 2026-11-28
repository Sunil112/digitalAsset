import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SwapService } from './swap.service';
import { CreateSwapRequestDto } from './dto/create-swap-request.dto';
import {
  AbortSwapDto,
  AcceptSwapDto,
  CancelSwapDto,
  LockLegADto,
  LockLegBDto,
  SettleSwapDto,
} from './dto/swap-action.dto';

@Controller('swap')
export class SwapController {
  constructor(private readonly swapService: SwapService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSwapRequest(@Body() dto: CreateSwapRequestDto) {
    return await this.swapService.createSwapRequest(dto);
  }

  @Get()
  async listSwapRequests() {
    return await this.swapService.getAllSwapRequests();
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async acceptSwapRequest(@Body() dto: AcceptSwapDto) {
    return await this.swapService.acceptSwapRequest(dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancelSwapRequest(@Body() dto: CancelSwapDto) {
    return await this.swapService.cancelSwapRequest(dto);
  }

  @Post('lock-leg-a')
  @HttpCode(HttpStatus.OK)
  async lockLegA(@Body() dto: LockLegADto) {
    return await this.swapService.lockLegA(dto);
  }

  @Post('lock-leg-b')
  @HttpCode(HttpStatus.OK)
  async lockLegB(@Body() dto: LockLegBDto) {
    return await this.swapService.lockLegB(dto);
  }

  @Post('settle')
  @HttpCode(HttpStatus.OK)
  async settleAtomic(@Body() dto: SettleSwapDto) {
    return await this.swapService.settleAtomicSwap(dto);
  }

  @Post('abort')
  @HttpCode(HttpStatus.OK)
  async abortSwap(@Body() dto: AbortSwapDto) {
    return await this.swapService.abortAtomicSwap(dto);
  }
}
