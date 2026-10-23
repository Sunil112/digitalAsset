import { Module } from '@nestjs/common';
import { DamlService } from './daml-ledger.service';

@Module({
  providers: [DamlService],
  exports: [DamlService],
})
export class DamlModule {}
