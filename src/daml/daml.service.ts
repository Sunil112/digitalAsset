import { Injectable, Logger } from '@nestjs/common';

export interface DamlContract<T = any> {
  contractId: string;
  templateId: {
    moduleName: string;
    entityName: string;
  };
  payload: T;
}

export interface ParticipantPayload {
  admin: string;
  participant: string;
  active: boolean;
}

@Injectable()
export class DamlService {
  private readonly logger = new Logger(DamlService.name);

  private get jsonApiUrl(): string {
    return process.env.DAML_JSON_API_URL || 'http://localhost:7575';
  }

  private get submittingParty(): string {
    return process.env.DAML_LEDGER_PARTY || '';
  }

  private async fetchJson(path: string, body: unknown): Promise<any> {
    const fetchFn = (globalThis as any).fetch;
    if (!fetchFn) {
      throw new Error('Global fetch is not available in this runtime. Use Node 18+ or add a fetch polyfill.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = process.env.DAML_JSON_API_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetchFn(`${this.jsonApiUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const json = await response.json();
    if (!response.ok) {
      this.logger.error('Daml JSON API error', json);
      throw new Error(json.message || `Daml JSON API returned ${response.status}`);
    }
    return json;
  }

  async createParticipant(participant: string, active = true): Promise<DamlContract<ParticipantPayload>> {
    const adminParty = this.submittingParty || participant;
    const payload = {
      templateId: {
        moduleName: 'Common.Registry',
        entityName: 'Participant',
      },
      payload: {
        admin: adminParty,
        participant,
        active,
      },
      party: adminParty,
    };

    return await this.fetchJson('/v1/create', payload);
  }

  async listParticipants(): Promise<DamlContract<ParticipantPayload>[]> {
    const queryBody = {
      templateIds: [
        {
          moduleName: 'Common.Registry',
          entityName: 'Participant',
        },
      ],
      query: {},
    };

    const result = await this.fetchJson('/v1/query', queryBody);
    return result.result;
  }
}
