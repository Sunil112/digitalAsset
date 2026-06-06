import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PartiesModule } from './parties/parties.module';

@Module({
  imports: [PartiesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
