import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { CreatePartyDto } from './dto/create-party.dto';
import { DamlService } from '../daml/daml-ledger.service';
import { PartyStatus } from './types/party.types';

export interface Party {
  id: string;
  partyId: string;
  organizationName: string;
  partyType: string;
  leiCode?: string;
  metadata?: Record<string, any>;
  damlContractId?: string;
  active?: boolean;
  status?: PartyStatus;
}

@Injectable()
export class PartiesService {
  private readonly logger = new Logger(PartiesService.name);
  private readonly dataFilePath = join(process.cwd(), 'data', 'parties.json');
  private readonly parties = new Map<string, Party>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly damlLedgerService: DamlService) {}

  async createParty(createPartyDto: CreatePartyDto): Promise<Party> {
    await this.ensureInitialized();

    const cleanedPartyId = createPartyDto.partyId.trim();
    const organizationName = createPartyDto.organizationName.trim();

    let damlContract: { contractId: string; payload: { active?: boolean } } | null = null;

    if (this.damlLedgerService.hasParticipantSyncConfig()) {
      try {
        damlContract = await this.damlLedgerService.createParticipant(cleanedPartyId, true);
      } catch (error) {
        this.logger.warn(`DAML participant creation failed for ${cleanedPartyId}: ${String(error)}`);
      }
    }

    const party: Party = {
      id: randomUUID(),
      partyId: cleanedPartyId,
      organizationName,
      partyType: createPartyDto.partyType,
      leiCode: createPartyDto.leiCode,
      metadata: this.normalizeMetadata(createPartyDto.metadata),
      damlContractId: damlContract?.contractId,
      active: damlContract ? Boolean(damlContract.payload.active) : true,
      status: PartyStatus.ACTIVE,
    };

    this.parties.set(party.id, party);
    await this.saveDataToDisk();
    return party;
  }

  async getAllParties(): Promise<Party[]> {
    await this.ensureInitialized();
    return Array.from(this.parties.values());
  }

  async findOne(id: string): Promise<Party | undefined> {
    await this.ensureInitialized();
    return this.findPartyByIdentifier(id);
  }

  async getParty(id: string): Promise<Party> {
    await this.ensureInitialized();

    const party = this.findPartyByIdentifier(id);
    if (!party) {
      throw new NotFoundException(`Party with identifier ${id} was not found.`);
    }

    if (!this.damlLedgerService.hasParticipantSyncConfig()) {
      return party;
    }

    try {
      const contract = await this.damlLedgerService.findParticipantContract(party.partyId);
      if (contract) {
        party.damlContractId = contract.contractId;
        const isActive = Boolean(contract.payload?.active);
        party.active = isActive;
        party.status = isActive ? PartyStatus.ACTIVE : PartyStatus.DEACTIVATED;
        this.parties.set(party.id, party);
        await this.saveDataToDisk();
      }
    } catch (error) {
      this.logger.warn(`DAML lookup failed for ${party.partyId}: ${String(error)}`);
    }

    return party;
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
      const payload = JSON.parse(content) as { parties?: Party[] };
      (payload.parties ?? []).forEach((party) => this.parties.set(party.id, party));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async saveDataToDisk(): Promise<void> {
    const payload = {
      parties: Array.from(this.parties.values()),
    };

    await fs.mkdir(dirname(this.dataFilePath), { recursive: true });
    await fs.writeFile(this.dataFilePath, JSON.stringify(payload, null, 2), 'utf-8');
  }


  async activateParty(partyId: string): Promise<Party> {
    await this.ensureInitialized();

    const party = this.findPartyByIdentifier(partyId);
    if (!party) {
      throw new NotFoundException(`Party with identifier ${partyId} was not found.`);
    }

    if (party.status === PartyStatus.ACTIVE) {
      return party;
    }

    try {
      if (this.damlLedgerService.hasParticipantSyncConfig()) {
        const contractId = await this.damlLedgerService.activateParticipant(party.partyId);
        party.damlContractId = contractId;
      }

      party.status = PartyStatus.ACTIVE;
      party.active = true;
      party.metadata = {
        ...(party.metadata ?? {}),
        damlSyncStatus: this.damlLedgerService.hasParticipantSyncConfig() ? 'SYNCED' : 'SKIPPED',
      };
    } catch (error) {
      this.logger.warn(`DAML activation failed for ${party.partyId}: ${String(error)}`);
      party.status = PartyStatus.ACTIVE;
      party.active = true;
      party.metadata = {
        ...(party.metadata ?? {}),
        damlSyncStatus: 'LOCAL_ONLY',
      };
    }

    this.parties.set(party.id, party);
    await this.saveDataToDisk();
    return party;
  }

  async deactivateParty(partyId: string): Promise<Party> {
    await this.ensureInitialized();

    const party = this.findPartyByIdentifier(partyId);
    if (!party) {
      throw new NotFoundException(`Party with identifier ${partyId} was not found.`);
    }

    if (party.status === PartyStatus.DEACTIVATED) {
      return party;
    }

    try {
      if (this.damlLedgerService.hasParticipantSyncConfig()) {
        const contractId = await this.damlLedgerService.deactivateParticipant(party.partyId);
        party.damlContractId = contractId;
      }

      party.status = PartyStatus.DEACTIVATED;
      party.active = false;
      party.metadata = {
        ...(party.metadata ?? {}),
        damlSyncStatus: this.damlLedgerService.hasParticipantSyncConfig() ? 'SYNCED' : 'SKIPPED',
      };
    } catch (error) {
      this.logger.warn(`DAML deactivation failed for ${party.partyId}: ${String(error)}`);
      party.status = PartyStatus.DEACTIVATED;
      party.active = false;
      party.metadata = {
        ...(party.metadata ?? {}),
        damlSyncStatus: 'LOCAL_ONLY',
      };
    }

    this.parties.set(party.id, party);
    await this.saveDataToDisk();
    return party;
  }

  private findPartyByIdentifier(identifier: string): Party | undefined {
    const normalizedId = identifier.trim();
    return Array.from(this.parties.values()).find(
      (party) => party.id === normalizedId || party.partyId === normalizedId,
    );
  }
}
