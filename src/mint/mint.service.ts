import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { DamlService } from '../daml/daml-ledger.service';
import { CreateMintRequestDto } from './dto/create-mint-request.dto';
import { ApproveMintDto, CancelMintDto } from './dto/mint-action.dto';
import { MintRequest, MintStatus } from './types/mint.types';

@Injectable()
export class MintService {
  private readonly logger = new Logger(MintService.name);
  private readonly dataFilePath = join(process.cwd(), 'data', 'mint-requests.json');
  private readonly requests = new Map<string, MintRequest>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly damlService: DamlService) {}

  async createMintRequest(dto: CreateMintRequestDto): Promise<MintRequest> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const mintRequest: MintRequest = {
      id: randomUUID(),
      adminPartyId: dto.adminPartyId.trim(),
      assetId: dto.assetId.trim(),
      issuerPartyId: dto.issuerPartyId.trim(),
      targetOwnerPartyId: dto.targetOwnerPartyId.trim(),
      qty: dto.qty,
      status: MintStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    };

    if (this.damlService.isEnabled()) {
      try {
        const { mintContractId } = await this.damlService.createMintRequest(
          mintRequest.adminPartyId,
          mintRequest.assetId,
          mintRequest.issuerPartyId,
          mintRequest.targetOwnerPartyId,
          mintRequest.qty,
        );
        mintRequest.damlContractId = mintContractId;
        mintRequest.metadata = { damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML mint request creation failed: ${String(error)}`);
        mintRequest.metadata = {
          damlSyncStatus: 'LOCAL_ONLY',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      mintRequest.metadata = { damlSyncStatus: 'SKIPPED' };
    }

    this.requests.set(mintRequest.id, mintRequest);
    await this.saveToDisk();
    return mintRequest;
  }

  async getAllMintRequests(adminPartyId?: string, assetId?: string): Promise<MintRequest[]> {
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

  async approveMintRequest(dto: ApproveMintDto): Promise<MintRequest> {
    await this.ensureInitialized();

    const mintRequest = this.requests.get(dto.mintRequestId);
    if (!mintRequest) {
      throw new NotFoundException(`MintRequest ${dto.mintRequestId} not found`);
    }

    if (mintRequest.status !== MintStatus.PENDING) {
      throw new BadRequestException(`MintRequest ${dto.mintRequestId} is not in PENDING state`);
    }

    let holdingContractId: string | undefined;
    let syncFailed = false;

    if (this.damlService.isEnabled()) {
      try {
        const contractId = mintRequest.damlContractId;
        if (!contractId) {
          throw new Error('No DAML contract ID associated with this mint request');
        }
        holdingContractId = await this.damlService.approveMintRequest(
          dto.adminPartyId.trim(),
          dto.issuerPartyId.trim(),
          mintRequest.assetId,
          contractId,
        );
        mintRequest.metadata = { ...(mintRequest.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML ApproveMint failed: ${String(error)}`);
        mintRequest.metadata = {
          ...(mintRequest.metadata ?? {}),
          damlSyncStatus: 'SYNC_FAILED',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
        syncFailed = true;
      }
    }

    // Sync failed: keep the request PENDING instead of advancing it to APPROVED.
    if (syncFailed) {
      this.requests.set(mintRequest.id, mintRequest);
      await this.saveToDisk();
      return mintRequest;
    }

    mintRequest.status = MintStatus.APPROVED;
    mintRequest.holdingContractId = holdingContractId;
    mintRequest.updatedAt = new Date().toISOString();

    this.requests.set(mintRequest.id, mintRequest);
    await this.saveToDisk();
    return mintRequest;
  }

  async cancelMintRequest(dto: CancelMintDto): Promise<MintRequest> {
    await this.ensureInitialized();

    const mintRequest = this.requests.get(dto.mintRequestId);
    if (!mintRequest) {
      throw new NotFoundException(`MintRequest ${dto.mintRequestId} not found`);
    }

    if (mintRequest.status !== MintStatus.PENDING) {
      throw new BadRequestException(`MintRequest ${dto.mintRequestId} is not in PENDING state`);
    }

    let syncFailed = false;

    if (this.damlService.isEnabled()) {
      try {
        const contractId = mintRequest.damlContractId;
        if (!contractId) {
          throw new Error('No DAML contract ID associated with this mint request');
        }
        await this.damlService.cancelMintRequest(
          dto.issuerPartyId.trim(),
          mintRequest.assetId,
          contractId,
        );
        mintRequest.metadata = { ...(mintRequest.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML CancelMint failed: ${String(error)}`);
        mintRequest.metadata = {
          ...(mintRequest.metadata ?? {}),
          damlSyncStatus: 'SYNC_FAILED',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
        syncFailed = true;
      }
    }

    // Sync failed: keep the request PENDING instead of advancing it to CANCELLED.
    if (syncFailed) {
      this.requests.set(mintRequest.id, mintRequest);
      await this.saveToDisk();
      return mintRequest;
    }

    mintRequest.status = MintStatus.CANCELLED;
    mintRequest.updatedAt = new Date().toISOString();

    this.requests.set(mintRequest.id, mintRequest);
    await this.saveToDisk();
    return mintRequest;
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
      const parsed = JSON.parse(raw) as MintRequest[];
      for (const req of parsed) {
        this.requests.set(req.id, req);
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn(`Failed to load mint requests from disk: ${String(error)}`);
      }
    }
  }

  private async saveToDisk(): Promise<void> {
    const data = JSON.stringify(Array.from(this.requests.values()), null, 2);
    await fs.mkdir(join(process.cwd(), 'data'), { recursive: true });
    await fs.writeFile(this.dataFilePath, data, 'utf-8');
  }
}
