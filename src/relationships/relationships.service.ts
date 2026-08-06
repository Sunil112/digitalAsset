import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { WhitelistDto } from './dto/whitelist.dto';
import { Relationship, RelationshipStatus } from './types/relationship.types';
import { DamlService } from '../daml/daml-ledger.service';

@Injectable()
export class RelationshipsService {
  private readonly logger = new Logger(RelationshipsService.name);
  private readonly dataFilePath = join(process.cwd(), 'data', 'relationships.json');
  private readonly relationships = new Map<string, Relationship>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly damlLedgerService: DamlService) {}

  private buildRelationshipKey(
    fromPartyId: string,
    toPartyId: string,
    relationshipType: string,
    assetId?: string,
  ): string {
    return [fromPartyId, toPartyId, relationshipType, assetId ?? ''].join('::');
  }

  private findExistingActiveRelationship(
    fromPartyId: string,
    toPartyId: string,
    relationshipType: string,
    assetId?: string,
  ): Relationship | undefined {
    const key = this.buildRelationshipKey(fromPartyId, toPartyId, relationshipType, assetId);
    return Array.from(this.relationships.values()).find(
      (relationship) =>
        relationship.active &&
        this.buildRelationshipKey(
          relationship.fromPartyId,
          relationship.toPartyId,
          relationship.relationshipType,
          relationship.assetId,
        ) === key,
    );
  }

  private async syncRelationshipToDaml(relationship: Relationship): Promise<void> {
    const relationshipType = relationship.relationshipType.trim().toUpperCase();

    if (!relationship.assetId || !this.damlLedgerService.isEnabled()) {
      relationship.metadata = { ...(relationship.metadata ?? {}), damlSyncStatus: 'SKIPPED' };
      return;
    }

    try {
      const contractId =
        relationshipType === 'ISSUER'
          ? await this.damlLedgerService.allowIssuer(relationship.fromPartyId, relationship.assetId, relationship.toPartyId)
          : await this.damlLedgerService.allowHolder(relationship.fromPartyId, relationship.assetId, relationship.toPartyId);

      relationship.damlContractId = contractId;
      const metadata: Record<string, any> = {
        ...(relationship.metadata ?? {}),
        damlSyncStatus: 'SYNCED',
      };
      delete metadata.damlSyncError;
      relationship.metadata = metadata;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DAML whitelist sync failed for relationship ${relationship.id}: ${errorText}`);
      relationship.metadata = {
        ...(relationship.metadata ?? {}),
        damlSyncStatus: 'LOCAL_ONLY',
        damlSyncError: errorText,
      };
    }
  }

  async createRelationship(createDto: CreateRelationshipDto): Promise<Relationship> {
    await this.ensureInitialized();

    const fromPartyId = createDto.fromPartyId.trim();
    const toPartyId = createDto.toPartyId.trim();
    const relationshipType = createDto.relationshipType.trim().toUpperCase();

    const existing = this.findExistingActiveRelationship(
      fromPartyId,
      toPartyId,
      relationshipType,
      createDto.assetId,
    );
    if (existing) {
      const normalizedMetadata = this.normalizeMetadata(createDto.metadata);
      if (normalizedMetadata) {
        existing.metadata = { ...(existing.metadata ?? {}), ...normalizedMetadata };
      }

      const damlSyncStatus = existing.metadata?.damlSyncStatus;
      if (damlSyncStatus !== 'SYNCED') {
        await this.syncRelationshipToDaml(existing);
        this.relationships.set(existing.id, existing);
        await this.saveDataToDisk();
      }

      return existing;
    }

    const rel: Relationship = {
      id: randomUUID(),
      fromPartyId,
      toPartyId,
      relationshipType,
      assetId: createDto.assetId,
      metadata: this.normalizeMetadata(createDto.metadata),
      active: true,
      status: RelationshipStatus.ACTIVE,
    };

    await this.syncRelationshipToDaml(rel);

    this.relationships.set(rel.id, rel);
    await this.saveDataToDisk();
    return rel;
  }

  async getAllRelationships(): Promise<Relationship[]> {
    await this.ensureInitialized();
    return Array.from(this.relationships.values());
  }

  async whitelistParty(whitelistDto: WhitelistDto): Promise<{ contractId: string | null; damlSyncStatus: string }> {
    const role = whitelistDto.role.trim().toUpperCase();

    if (!this.damlLedgerService.isEnabled()) {
      return { contractId: null, damlSyncStatus: 'SKIPPED' };
    }

    const contractId =
      role === 'ISSUER'
        ? await this.damlLedgerService.allowIssuer(whitelistDto.adminPartyId, whitelistDto.assetId, whitelistDto.partyId)
        : await this.damlLedgerService.allowHolder(whitelistDto.adminPartyId, whitelistDto.assetId, whitelistDto.partyId);

    return { contractId, damlSyncStatus: 'SYNCED' };
  }

  async revokeWhitelist(whitelistDto: WhitelistDto): Promise<{ contractId: string | null; damlSyncStatus: string }> {
    const role = whitelistDto.role.trim().toUpperCase();

    if (!this.damlLedgerService.isEnabled()) {
      return { contractId: null, damlSyncStatus: 'SKIPPED' };
    }

    const contractId =
      role === 'ISSUER'
        ? await this.damlLedgerService.revokeIssuer(whitelistDto.adminPartyId, whitelistDto.assetId, whitelistDto.partyId)
        : await this.damlLedgerService.blockHolder(whitelistDto.adminPartyId, whitelistDto.assetId, whitelistDto.partyId);

    return { contractId, damlSyncStatus: 'SYNCED' };
  }

  private normalizeMetadata(metadata?: string | Record<string, any>): Record<string, any> | undefined {
    if (!metadata) return undefined;
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
    if (!this.initPromise) this.initPromise = this.loadDataFromDisk();
    await this.initPromise;
  }

  private async loadDataFromDisk(): Promise<void> {
    try {
      const content = await fs.readFile(this.dataFilePath, 'utf-8');
      const payload = JSON.parse(content) as { relationships?: Relationship[] };
      (payload.relationships ?? []).forEach((r) => this.relationships.set(r.id, r));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async saveDataToDisk(): Promise<void> {
    const payload = { relationships: Array.from(this.relationships.values()) };
    await fs.mkdir(dirname(this.dataFilePath), { recursive: true });
    await fs.writeFile(this.dataFilePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}
