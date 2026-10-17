import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { DamlService } from '../daml/daml-ledger.service';
import { CreateBurnRequestDto } from './dto/create-burn-request.dto';
import { ApproveBurnDto, CancelBurnDto } from './dto/burn-action.dto';
import { BurnRequest, BurnStatus } from './types/burn.types';

@Injectable()
export class BurnService {
  private readonly logger = new Logger(BurnService.name);
  private readonly dataFilePath = join(process.cwd(), 'data', 'burn-requests.json');
  private readonly requests = new Map<string, BurnRequest>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly damlService: DamlService) {}

  async createBurnRequest(dto: CreateBurnRequestDto): Promise<BurnRequest> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const burnRequest: BurnRequest = {
      id: randomUUID(),
      adminPartyId: dto.adminPartyId.trim(),
      assetId: dto.assetId.trim(),
      requestedByPartyId: dto.requestedByPartyId.trim(),
      holdingContractId: dto.holdingContractId.trim(),
      qty: dto.qty,
      status: BurnStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    };

    if (this.damlService.isEnabled()) {
      try {
        const { burnContractId } = await this.damlService.createBurnRequest(
          burnRequest.adminPartyId,
          burnRequest.assetId,
          burnRequest.requestedByPartyId,
          burnRequest.holdingContractId,
          burnRequest.qty,
        );
        burnRequest.damlContractId = burnContractId;
        burnRequest.metadata = { damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML burn request creation failed: ${String(error)}`);
        burnRequest.metadata = {
          damlSyncStatus: 'LOCAL_ONLY',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      burnRequest.metadata = { damlSyncStatus: 'SKIPPED' };
    }

    this.requests.set(burnRequest.id, burnRequest);
    await this.saveToDisk();
    return burnRequest;
  }

  async getAllBurnRequests(adminPartyId?: string, assetId?: string): Promise<BurnRequest[]> {
    await this.ensureInitialized();
    let results = Array.from(this.requests.values());
    if (adminPartyId) {
      results = results.filter((r) => r.adminPartyId === adminPartyId.trim());
    }
    if (assetId) {
      results = results.filter((r) => r.assetId === assetId.trim());
    }
    return results;
  }

  async approveBurnRequest(dto: ApproveBurnDto): Promise<BurnRequest> {
    await this.ensureInitialized();

    const burnRequest = this.requests.get(dto.burnRequestId);
    if (!burnRequest) {
      throw new NotFoundException(`BurnRequest ${dto.burnRequestId} not found`);
    }

    if (burnRequest.status !== BurnStatus.PENDING) {
      throw new BadRequestException(`BurnRequest ${dto.burnRequestId} is not in PENDING state`);
    }

    let resultingHoldingContractId: string | undefined;
    let syncFailed = false;

    if (this.damlService.isEnabled()) {
      try {
        const contractId = burnRequest.damlContractId;
        if (!contractId) {
          throw new Error('No DAML contract ID associated with this burn request');
        }

        resultingHoldingContractId = await this.damlService.approveBurnRequest(
          dto.adminPartyId.trim(),
          burnRequest.assetId,
          contractId,
        );

        burnRequest.metadata = { ...(burnRequest.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML ApproveBurn failed: ${String(error)}`);
        burnRequest.metadata = {
          ...(burnRequest.metadata ?? {}),
          damlSyncStatus: 'SYNC_FAILED',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
        syncFailed = true;
      }
    }

    // Sync failed: keep the request PENDING instead of advancing it to APPROVED.
    if (syncFailed) {
      this.requests.set(burnRequest.id, burnRequest);
      await this.saveToDisk();
      return burnRequest;
    }

    burnRequest.status = BurnStatus.APPROVED;
    burnRequest.resultingHoldingContractId = resultingHoldingContractId;
    burnRequest.updatedAt = new Date().toISOString();

    this.requests.set(burnRequest.id, burnRequest);
    await this.saveToDisk();
    return burnRequest;
  }

  async cancelBurnRequest(dto: CancelBurnDto): Promise<BurnRequest> {
    await this.ensureInitialized();

    const burnRequest = this.requests.get(dto.burnRequestId);
    if (!burnRequest) {
      throw new NotFoundException(`BurnRequest ${dto.burnRequestId} not found`);
    }

    if (burnRequest.status !== BurnStatus.PENDING) {
      throw new BadRequestException(`BurnRequest ${dto.burnRequestId} is not in PENDING state`);
    }

    let syncFailed = false;

    if (this.damlService.isEnabled()) {
      try {
        const contractId = burnRequest.damlContractId;
        if (!contractId) {
          throw new Error('No DAML contract ID associated with this burn request');
        }

        await this.damlService.cancelBurnRequest(
          dto.requestedByPartyId.trim(),
          burnRequest.assetId,
          contractId,
        );

        burnRequest.metadata = { ...(burnRequest.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML CancelBurn failed: ${String(error)}`);
        burnRequest.metadata = {
          ...(burnRequest.metadata ?? {}),
          damlSyncStatus: 'SYNC_FAILED',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
        syncFailed = true;
      }
    }

    // Sync failed: keep the request PENDING instead of advancing it to CANCELLED.
    if (syncFailed) {
      this.requests.set(burnRequest.id, burnRequest);
      await this.saveToDisk();
      return burnRequest;
    }

    burnRequest.status = BurnStatus.CANCELLED;
    burnRequest.updatedAt = new Date().toISOString();

    this.requests.set(burnRequest.id, burnRequest);
    await this.saveToDisk();
    return burnRequest;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadFromDisk();
    }
    return this.initPromise;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.dataFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as BurnRequest[];
      for (const req of parsed) {
        this.requests.set(req.id, req);
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn(`Failed to load burn requests from disk: ${String(error)}`);
      }
    }
  }

  private async saveToDisk(): Promise<void> {
    const data = JSON.stringify(Array.from(this.requests.values()), null, 2);
    await fs.mkdir(join(process.cwd(), 'data'), { recursive: true });
    await fs.writeFile(this.dataFilePath, data, 'utf-8');
  }
}
