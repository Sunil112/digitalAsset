import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { DamlService } from '../daml/daml-ledger.service';
import { CreateSwapRequestDto } from './dto/create-swap-request.dto';
import {
  AbortSwapDto,
  AcceptSwapDto,
  CancelSwapDto,
  LockLegADto,
  LockLegBDto,
  SettleSwapDto,
} from './dto/swap-action.dto';
import { SwapRequestRecord, SwapStatus } from './types/swap.types';

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);
  private readonly dataFilePath = join(process.cwd(), 'data', 'swap-requests.json');
  private readonly requests = new Map<string, SwapRequestRecord>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly damlService: DamlService) {}


  private async saveToDisk(): Promise<void> {
    const data = JSON.stringify(Array.from(this.requests.values()), null, 2);
    await fs.mkdir(join(process.cwd(), 'data'), { recursive: true });
    await fs.writeFile(this.dataFilePath, data, 'utf-8');
  }
}
