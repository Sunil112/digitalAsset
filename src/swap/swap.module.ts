import { Module } from '@nestjs/common';
import { SwapController } from './swap.controller';
import { SwapService } from './swap.service';
import { DamlService } from '../daml/daml-ledger.service';

@Module({
  controllers: [SwapController],
  providers: [SwapService, DamlService],
})
export class SwapModule {}
