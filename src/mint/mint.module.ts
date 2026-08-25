import { Module } from '@nestjs/common';
import { MintController } from './mint.controller';
import { MintService } from './mint.service';
import { DamlService } from '../daml/daml-ledger.service';

@Module({
  controllers: [MintController],
  providers: [MintService, DamlService],
})
export class MintModule {}
