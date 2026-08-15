import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PartiesModule } from './parties/parties.module';
import { RelationshipsModule } from './relationships/relationships.module';

@Module({
  imports: [PartiesModule, RelationshipsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
