import { Module } from '@nestjs/common';
import { RelationshipsController } from './relationships.controller';
import { RelationshipsService } from './relationships.service';
import { DamlService } from '../daml/daml-ledger.service';

@Module({
  controllers: [RelationshipsController],
  providers: [RelationshipsService, DamlService],
})
export class RelationshipsModule {}
