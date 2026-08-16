import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { DamlService } from '../daml/daml-ledger.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { Asset, AssetStatus } from './types/asset.types';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly dataFilePath = join(process.cwd(), 'data', 'assets.json');
  private readonly assets = new Map<string, Asset>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly damlLedgerService: DamlService) {}

  async createAsset(createAssetDto: CreateAssetDto): Promise<Asset> {
    await this.ensureInitialized();

    const adminPartyId = createAssetDto.adminPartyId.trim();
    const assetId = createAssetDto.assetId.trim();
    const existing = this.findAssetByKey(adminPartyId, assetId);

    if (existing) {
      if (createAssetDto.metadata) {
        existing.metadata = {
          ...(existing.metadata ?? {}),
          ...(this.normalizeMetadata(createAssetDto.metadata) ?? {}),
        };
      }

      if (existing.metadata?.damlSyncStatus !== 'SYNCED') {
        await this.syncCreateAssetToDaml(existing);
        this.assets.set(existing.id, existing);
        await this.saveDataToDisk();
      }

      return existing;
    }

    const asset: Asset = {
      id: randomUUID(),
      adminPartyId,
      assetId,
      metadata: this.normalizeMetadata(createAssetDto.metadata),
      enabled: false,
      status: AssetStatus.DISABLED,
    };

    await this.syncCreateAssetToDaml(asset);

    this.assets.set(asset.id, asset);
    await this.saveDataToDisk();
    return asset;
  }

  async getAllAssets(): Promise<Asset[]> {
    await this.ensureInitialized();
    return Array.from(this.assets.values());
  }

  async enableAsset(adminPartyId: string, assetId: string): Promise<Asset> {
    await this.ensureInitialized();

    const asset = await this.getOrCreateAsset(adminPartyId, assetId);

    if (asset.status === AssetStatus.ENABLED) {
      return asset;
    }

    try {
      if (this.damlLedgerService.isEnabled()) {
        const damlResult = await this.damlLedgerService.enableAsset(asset.adminPartyId, asset.assetId);
        asset.damlContractId = this.normalizeDamlContractId(damlResult) ?? asset.damlContractId;
      }

      asset.enabled = true;
      asset.status = AssetStatus.ENABLED;
      const metadata: Record<string, any> = {
        ...(asset.metadata ?? {}),
        damlSyncStatus: this.damlLedgerService.isEnabled() ? 'SYNCED' : 'SKIPPED',
      };
      delete metadata.damlSyncError;
      asset.metadata = metadata;
    } catch (error) {
      this.logger.warn(`DAML enable asset failed for ${asset.assetId}: ${String(error)}`);
      // Sync failed: keep the asset in its previous status instead of advancing it.
      asset.metadata = {
        ...(asset.metadata ?? {}),
        damlSyncStatus: 'SYNC_FAILED',
        damlSyncError: error instanceof Error ? error.message : String(error),
      };
    }

    this.assets.set(asset.id, asset);
    await this.saveDataToDisk();
    return asset;
  }

  async disableAsset(adminPartyId: string, assetId: string): Promise<Asset> {
    await this.ensureInitialized();

    const asset = this.findAssetByKey(adminPartyId.trim(), assetId.trim());
    if (!asset) {
      throw new NotFoundException(`Asset ${assetId} for admin ${adminPartyId} was not found.`);
    }

    if (asset.status === AssetStatus.DISABLED) {
      return asset;
    }

    try {
      if (this.damlLedgerService.isEnabled()) {
        const damlResult = await this.damlLedgerService.disableAsset(asset.adminPartyId, asset.assetId);
        asset.damlContractId = this.normalizeDamlContractId(damlResult) ?? asset.damlContractId;
      }

      asset.enabled = false;
      asset.status = AssetStatus.DISABLED;
      const metadata: Record<string, any> = {
        ...(asset.metadata ?? {}),
        damlSyncStatus: this.damlLedgerService.isEnabled() ? 'SYNCED' : 'SKIPPED',
      };
      delete metadata.damlSyncError;
      asset.metadata = metadata;
    } catch (error) {
      this.logger.warn(`DAML disable asset failed for ${asset.assetId}: ${String(error)}`);
      // Sync failed: keep the asset in its previous status instead of advancing it.
      asset.metadata = {
        ...(asset.metadata ?? {}),
        damlSyncStatus: 'SYNC_FAILED',
        damlSyncError: error instanceof Error ? error.message : String(error),
      };
    }

    this.assets.set(asset.id, asset);
    await this.saveDataToDisk();
    return asset;
  }

  private async getOrCreateAsset(adminPartyId: string, assetId: string): Promise<Asset> {
    const existing = this.findAssetByKey(adminPartyId.trim(), assetId.trim());
    if (existing) {
      return existing;
    }

    return this.createAsset({ adminPartyId, assetId });
  }

  private async syncCreateAssetToDaml(asset: Asset): Promise<void> {
    if (!this.damlLedgerService.isEnabled()) {
      asset.metadata = { ...(asset.metadata ?? {}), damlSyncStatus: 'SKIPPED' };
      return;
    }

    try {
      const contract = await this.damlLedgerService.createAssetDirectory(asset.adminPartyId, asset.assetId);
      asset.damlContractId = contract.contractId;
      const metadata: Record<string, any> = { ...(asset.metadata ?? {}), damlSyncStatus: 'SYNCED' };
      delete metadata.damlSyncError;
      asset.metadata = metadata;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DAML create asset failed for ${asset.assetId}: ${errorText}`);
      asset.metadata = {
        ...(asset.metadata ?? {}),
        damlSyncStatus: 'LOCAL_ONLY',
        damlSyncError: errorText,
      };
    }
  }

  private normalizeDamlContractId(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object' && value !== null && 'exerciseResult' in value) {
      const exerciseResult = (value as Record<string, unknown>).exerciseResult;
      if (typeof exerciseResult === 'string') {
        return exerciseResult;
      }
    }

    return undefined;
  }

  private findAssetByKey(adminPartyId: string, assetId: string): Asset | undefined {
    return Array.from(this.assets.values()).find(
      (asset) => asset.adminPartyId === adminPartyId && asset.assetId === assetId,
    );
  }

  private normalizeMetadata(metadata?: string | Record<string, any>): Record<string, any> | undefined {
    if (!metadata) {
      return undefined;
    }

    if (typeof metadata === 'string') {
      try {
        return JSON.parse(metadata) as Record<string, any>;
      } catch {
        return { value: metadata };
      }
    }

    return metadata;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadDataFromDisk();
    }

    await this.initPromise;
  }

  private async loadDataFromDisk(): Promise<void> {
    try {
      const content = await fs.readFile(this.dataFilePath, 'utf-8');
      const payload = JSON.parse(content) as { assets?: Asset[] };
      (payload.assets ?? []).forEach((asset) => this.assets.set(asset.id, asset));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async saveDataToDisk(): Promise<void> {
    const payload = {
      assets: Array.from(this.assets.values()),
    };

    await fs.mkdir(dirname(this.dataFilePath), { recursive: true });
    await fs.writeFile(this.dataFilePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}
