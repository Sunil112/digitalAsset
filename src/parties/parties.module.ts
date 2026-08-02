import { Module } from '@nestjs/common';
import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';
import { DamlService } from '../daml/daml-ledger.service';

@Module({
  controllers: [PartiesController],
  providers: [PartiesService, DamlService],
})
export class PartiesModule {}
