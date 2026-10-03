import { Module } from '@nestjs/common';
import { BurnController } from './burn.controller';
import { BurnService } from './burn.service';
import { DamlService } from '../daml/daml-ledger.service';

@Module({
  controllers: [BurnController],
  providers: [BurnService, DamlService],
})
export class BurnModule {}
