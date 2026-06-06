import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { CreatePartyDto } from './dto/create-party.dto';

export interface Party {
  id: string;
  partyId: string;
  organizationName: string;
  partyType: string;
  leiCode?: string;
  metadata?: string;
}

@Injectable()
export class PartiesService {
  private readonly dataFilePath = join(resolve(__dirname, '..'), 'data', 'parties.json');
  private readonly parties = new Map<string, Party>();
  private initPromise: Promise<void> | null = null;

  async createParty(createPartyDto: CreatePartyDto): Promise<Party> {
    await this.ensureInitialized();

    const party: Party = {
      id: randomUUID(),
      partyId: createPartyDto.partyId.trim(),
      organizationName: createPartyDto.organizationName.trim(),
      partyType: createPartyDto.partyType,
      leiCode: createPartyDto.leiCode,
      metadata: createPartyDto.metadata,
    };

    this.parties.set(party.id, party);
    await this.saveDataToDisk();
    return party;
  }

  findOne(id: string): Party | undefined {
    return this.parties.get(id);
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
