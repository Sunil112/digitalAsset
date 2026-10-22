import { Injectable } from '@nestjs/common';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomersService {
  private customers: any[] = [];

  create(createCustomerDto: CreateCustomerDto) {
    const newCustomer = { id: Date.now(), ...createCustomerDto };
    this.customers.push(newCustomer);
    return newCustomer;
  }
}
