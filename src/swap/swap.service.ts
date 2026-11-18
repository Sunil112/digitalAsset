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

  async createSwapRequest(dto: CreateSwapRequestDto): Promise<SwapRequestRecord> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const request: SwapRequestRecord = {
      id: randomUUID(),
      swapId: dto.swapId.trim(),
      partyAId: dto.partyAId.trim(),
      partyBId: dto.partyBId.trim(),
      escrowPartyId: dto.escrowPartyId.trim(),
      pauseOwnerPartyId: dto.pauseOwnerPartyId.trim(),
      legAHoldingContractId: dto.legAHoldingContractId.trim(),
      legAQty: dto.legAQty,
      legAAdminPartyId: dto.legAAdminPartyId.trim(),
      legBHoldingContractId: dto.legBHoldingContractId.trim(),
      legBQty: dto.legBQty,
      legBAdminPartyId: dto.legBAdminPartyId.trim(),
      expiryTime: dto.expiryTime,
      status: SwapStatus.PROPOSED,
      createdAt: now,
      updatedAt: now,
    };

    if (this.damlService.isEnabled()) {
      try {
        const { swapRequestContractId } = await this.damlService.createSwapRequest({
          swapId: request.swapId,
          partyA: request.partyAId,
          partyB: request.partyBId,
          escrow: request.escrowPartyId,
          pauseOwner: request.pauseOwnerPartyId,
          expiryTime: request.expiryTime,
          legA: {
            holdingCid: request.legAHoldingContractId,
            qty: request.legAQty,
            assetAdmin: request.legAAdminPartyId,
          },
          legB: {
            holdingCid: request.legBHoldingContractId,
            qty: request.legBQty,
            assetAdmin: request.legBAdminPartyId,
          },
        });
        request.damlSwapRequestContractId = swapRequestContractId;
        request.metadata = { damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML swap request creation failed: ${String(error)}`);
        request.metadata = {
          damlSyncStatus: 'LOCAL_ONLY',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      request.metadata = { damlSyncStatus: 'SKIPPED' };
    }

    this.requests.set(request.id, request);
    await this.saveToDisk();
    return request;
  }

    async acceptSwapRequest(dto: AcceptSwapDto): Promise<SwapRequestRecord> {
    await this.ensureInitialized();

    const request = this.requests.get(dto.swapRequestId);
    if (!request) {
      throw new NotFoundException(`SwapRequest ${dto.swapRequestId} not found`);
    }

    if (request.status !== SwapStatus.PROPOSED) {
      throw new BadRequestException(`SwapRequest ${dto.swapRequestId} is not in PROPOSED state`);
    }

    let syncFailed = false;

    if (this.damlService.isEnabled()) {
      try {
        const contractId = request.damlSwapRequestContractId;
        if (!contractId) {
          throw new Error('No DAML swap request contract ID associated with this swap request');
        }

        const swapEscrowContractId = await this.damlService.acceptSwapRequest(
          dto.partyBId.trim(),
          dto.escrowPartyId.trim(),
          request.swapId,
          contractId,
        );

        request.damlSwapEscrowContractId = swapEscrowContractId;
        request.metadata = { ...(request.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML Accept swap failed: ${String(error)}`);
        request.metadata = {
          ...(request.metadata ?? {}),
          damlSyncStatus: 'SYNC_FAILED',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
        syncFailed = true;
      }
    }

    // Sync failed: keep the request PROPOSED instead of advancing it to ACCEPTED.
    if (syncFailed) {
      this.requests.set(request.id, request);
      await this.saveToDisk();
      return request;
    }

    request.status = SwapStatus.ACCEPTED;
    request.updatedAt = new Date().toISOString();

    this.requests.set(request.id, request);
    await this.saveToDisk();
    return request;
  }

    async cancelSwapRequest(dto: CancelSwapDto): Promise<SwapRequestRecord> {
    await this.ensureInitialized();

    const request = this.requests.get(dto.swapRequestId);
    if (!request) {
      throw new NotFoundException(`SwapRequest ${dto.swapRequestId} not found`);
    }

    if (request.status !== SwapStatus.PROPOSED) {
      throw new BadRequestException(`SwapRequest ${dto.swapRequestId} is not in PROPOSED state`);
    }

    let syncFailed = false;

    if (this.damlService.isEnabled()) {
      try {
        const contractId = request.damlSwapRequestContractId;
        if (!contractId) {
          throw new Error('No DAML swap request contract ID associated with this swap request');
        }

        await this.damlService.cancelSwapRequest(
          dto.partyAId.trim(),
          request.swapId,
          contractId,
        );

        request.metadata = { ...(request.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML Cancel swap failed: ${String(error)}`);
        request.metadata = {
          ...(request.metadata ?? {}),
          damlSyncStatus: 'SYNC_FAILED',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
        syncFailed = true;
      }
    }

    // Sync failed: keep the request PROPOSED instead of advancing it to CANCELLED.
    if (syncFailed) {
      this.requests.set(request.id, request);
      await this.saveToDisk();
      return request;
    }

    request.status = SwapStatus.CANCELLED;
    request.updatedAt = new Date().toISOString();

    this.requests.set(request.id, request);
    await this.saveToDisk();
    return request;
  }

   async lockLegA(dto: LockLegADto): Promise<SwapRequestRecord> {
    await this.ensureInitialized();

    const request = this.getRequestOrThrow(dto.swapRequestId);
    this.assertCanLock(request);

    let syncFailed = false;

    if (this.damlService.isEnabled()) {
      try {
        const swapEscrowContractId = this.getEscrowContractOrThrow(request);
        const nextEscrowId = await this.damlService.lockSwapLegA(
          dto.partyAId.trim(),
          dto.escrowPartyId.trim(),
          dto.legAAdminPartyId.trim(),
          request.swapId,
          swapEscrowContractId,
        );
        request.damlSwapEscrowContractId = nextEscrowId;
        request.metadata = { ...(request.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML LockLegA failed: ${String(error)}`);
        request.metadata = {
          ...(request.metadata ?? {}),
          damlSyncStatus: 'SYNC_FAILED',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
        syncFailed = true;
      }
    }

    // Sync failed: keep the request in its previous status instead of advancing it.
    if (syncFailed) {
      this.requests.set(request.id, request);
      await this.saveToDisk();
      return request;
    }

    request.status = request.status === SwapStatus.LEG_B_LOCKED ? SwapStatus.READY_TO_SETTLE : SwapStatus.LEG_A_LOCKED;
    request.updatedAt = new Date().toISOString();

    this.requests.set(request.id, request);
    await this.saveToDisk();
    return request;
  }
  async lockLegB(dto: LockLegBDto): Promise<SwapRequestRecord> {
    await this.ensureInitialized();

    const request = this.getRequestOrThrow(dto.swapRequestId);
    this.assertCanLock(request);

    let syncFailed = false;

    if (this.damlService.isEnabled()) {
      try {
        const swapEscrowContractId = this.getEscrowContractOrThrow(request);
        const nextEscrowId = await this.damlService.lockSwapLegB(
          dto.partyBId.trim(),
          dto.escrowPartyId.trim(),
          dto.legBAdminPartyId.trim(),
          request.swapId,
          swapEscrowContractId,
        );
        request.damlSwapEscrowContractId = nextEscrowId;
        request.metadata = { ...(request.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML LockLegB failed: ${String(error)}`);
        request.metadata = {
          ...(request.metadata ?? {}),
          damlSyncStatus: 'SYNC_FAILED',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
        syncFailed = true;
      }
    }

    // Sync failed: keep the request in its previous status instead of advancing it.
    if (syncFailed) {
      this.requests.set(request.id, request);
      await this.saveToDisk();
      return request;
    }

    request.status = request.status === SwapStatus.LEG_A_LOCKED ? SwapStatus.READY_TO_SETTLE : SwapStatus.LEG_B_LOCKED;
    request.updatedAt = new Date().toISOString();

    this.requests.set(request.id, request);
    await this.saveToDisk();
    return request;
  }

  async settleAtomicSwap(dto: SettleSwapDto): Promise<SwapRequestRecord> {
    await this.ensureInitialized();

    const request = this.getRequestOrThrow(dto.swapRequestId);
    if (request.status !== SwapStatus.READY_TO_SETTLE) {
      throw new BadRequestException(`SwapRequest ${dto.swapRequestId} is not in READY_TO_SETTLE state`);
    }

    let syncFailed = false;

    if (this.damlService.isEnabled()) {
      try {
        const swapEscrowContractId = this.getEscrowContractOrThrow(request);
        await this.damlService.settleAtomicSwap(
          dto.escrowPartyId.trim(),
          dto.legAAdminPartyId.trim(),
          dto.legBAdminPartyId.trim(),
          request.swapId,
          swapEscrowContractId,
        );
        request.metadata = { ...(request.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML SettleAtomic failed: ${String(error)}`);
        request.metadata = {
          ...(request.metadata ?? {}),
          damlSyncStatus: 'SYNC_FAILED',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
        syncFailed = true;
      }
    }

    // Sync failed: keep the request READY_TO_SETTLE instead of advancing it to SETTLED.
    if (syncFailed) {
      this.requests.set(request.id, request);
      await this.saveToDisk();
      return request;
    }

    request.status = SwapStatus.SETTLED;
    request.updatedAt = new Date().toISOString();

    this.requests.set(request.id, request);
    await this.saveToDisk();
    return request;
  }

   async abortAtomicSwap(dto: AbortSwapDto): Promise<SwapRequestRecord> {
    await this.ensureInitialized();

    const request = this.getRequestOrThrow(dto.swapRequestId);
    const allowed = [
      SwapStatus.ACCEPTED,
      SwapStatus.LEG_A_LOCKED,
      SwapStatus.LEG_B_LOCKED,
      SwapStatus.READY_TO_SETTLE,
    ];

    if (!allowed.includes(request.status)) {
      throw new BadRequestException(`SwapRequest ${dto.swapRequestId} cannot be aborted from ${request.status}`);
    }

    let syncFailed = false;

    if (this.damlService.isEnabled()) {
      try {
        const swapEscrowContractId = this.getEscrowContractOrThrow(request);
        await this.damlService.abortAtomicSwap(
          dto.escrowPartyId.trim(),
          dto.legAAdminPartyId.trim(),
          dto.legBAdminPartyId.trim(),
          request.swapId,
          swapEscrowContractId,
        );
        request.metadata = { ...(request.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      } catch (error) {
        this.logger.warn(`DAML Abort swap failed: ${String(error)}`);
        request.metadata = {
          ...(request.metadata ?? {}),
          damlSyncStatus: 'SYNC_FAILED',
          damlSyncError: error instanceof Error ? error.message : String(error),
        };
        syncFailed = true;
      }
    }

    // Sync failed: keep the request in its previous status instead of advancing it to ABORTED.
    if (syncFailed) {
      this.requests.set(request.id, request);
      await this.saveToDisk();
      return request;
    }

    request.status = SwapStatus.ABORTED;
    request.updatedAt = new Date().toISOString();

    this.requests.set(request.id, request);
    await this.saveToDisk();
    return request;
  }


  private async saveToDisk(): Promise<void> {
    const data = JSON.stringify(Array.from(this.requests.values()), null, 2);
    await fs.mkdir(join(process.cwd(), 'data'), { recursive: true });
    await fs.writeFile(this.dataFilePath, data, 'utf-8');
  }
}
