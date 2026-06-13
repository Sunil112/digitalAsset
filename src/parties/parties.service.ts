import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { CreatePartyDto } from './dto/create-party.dto';
import { DamlService, ParticipantPayload } from '../daml/daml-ledger.service';

export interface Party {
  id: string;
  partyId: string;
  organizationName: string;
  partyType: string;
  leiCode?: string;
  metadata?: string;
  damlContractId?: string;
  active?: boolean;
}

@Injectable()
export class PartiesService {
  private readonly logger = new Logger(PartiesService.name);
  private readonly dataFilePath = join(resolve(__dirname, '..'), 'data', 'parties.json');
  private readonly parties = new Map<string, Party>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly damlService: DamlService) {}

  async createParty(createPartyDto: CreatePartyDto): Promise<Party> {
    await this.ensureInitialized();

    const cleanedPartyId = createPartyDto.partyId.trim();
    const damlContract = await this.damlService.createParticipant(cleanedPartyId, true);

    const party: Party = {
      id: randomUUID(),
      partyId: cleanedPartyId,
      organizationName: createPartyDto.organizationName.trim(),
      partyType: createPartyDto.partyType,
      leiCode: createPartyDto.leiCode,
      metadata: createPartyDto.metadata,
      damlContractId: damlContract.contractId,
      active: damlContract.payload.active,
    };

    this.parties.set(party.id, party);
    await this.saveDataToDisk();
    return party;
  }

  async findOne(id: string): Promise<Party | undefined> {
    await this.ensureInitialized();
    return this.parties.get(id);
  }

  async findAll(): Promise<Party[]> {
    await this.ensureInitialized();
    const damlParticipants = await this.damlService.listParticipants();

    return Array.from(this.parties.values()).map((party) => {
      const contract = damlParticipants.find(
        (item) => item.payload.participant === party.partyId,
      );
      return {
        ...party,
        damlContractId: contract?.contractId,
        active: contract?.payload.active ?? party.active,
      };
    });
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
}
