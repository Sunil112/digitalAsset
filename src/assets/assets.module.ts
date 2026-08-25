import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { DamlService } from '../daml/daml-ledger.service';

@Module({
  controllers: [AssetsController],
  providers: [AssetsService, DamlService],
})
export class AssetsModule {}
