import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { DamlModule } from '../daml/daml.module'; // Assuming DamlModule exists and exports DamlService

@Module({
  imports: [DamlModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
