import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PartiesModule } from './parties/parties.module';
import { RelationshipsModule } from './relationships/relationships.module';
import { AssetsModule } from './assets/assets.module';
import { MintModule } from './mint/mint.module';
import { BurnModule } from './burn/burn.module';
import { SwapModule } from './swap/swap.module';
import { CustomersModule } from './customers/customers.module';

@Module({
  imports: [
    PartiesModule,
    RelationshipsModule,
    AssetsModule,
    MintModule,
    BurnModule,
    SwapModule,
    CustomersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

