import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';

type JsonObject = Record<string, unknown>;

interface DamlJsonApiSuccess<T> {
  status: number;
  result: T;
  warnings?: unknown;
}

interface DamlJsonApiError {
  status?: number;
  errors?: string[];
  warnings?: unknown;
  ledgerApiError?: {
    message?: string;
    code?: number;
    details?: unknown;
  };
}

interface DamlCreatedContract {
  contractId: string;
  payload: JsonObject;
}

interface DamlParty {
  identifier?: string;
  identfier?: string;
  displayName?: string;
  isLocal?: boolean;
}

export interface DamlHoldingSummary {
  contractId: string;
  assetId: string;
  owner: string;
  amount: number;
  assetAdmin: string;
}

@Injectable()
export class DamlService {
  private readonly logger = new Logger(DamlService.name);
  private readonly baseUrl = process.env.DAML_JSON_API_URL?.replace(/\/+$/, '');
  private readonly requestTimeoutMs = Number(process.env.DAML_REQUEST_TIMEOUT_MS) ?? 5000;
  private readonly participantTemplateId = process.env.DAML_PARTICIPANT ?? 'Common.Registry.Participant';
  private readonly kycApplicationTemplateId = process.env.DAML_KYC_APPLICATION ?? 'Common.Registry.KycApplication';
  private readonly assetDirectoryTemplateId = process.env.DAML_ASSET_DIRECTORY ?? 'Common.Registry.AssetDirectory';
  private readonly assetPermissionTemplateId = process.env.DAML_ASSET_PERMISSION ?? 'Common.Registry.AssetPermission';
  private readonly adminRoleTemplateId = process.env.DAML_ADMIN_ROLE ?? 'Common.Governance.AdminRole';
  private readonly pauseSwitchTemplateId = process.env.DAML_PAUSE_SWITCH ?? 'Common.Governance.PauseSwitch';
  private readonly mintRequestTemplateId = process.env.DAML_MINT_REQUEST ?? 'Asset.Standard.MintRequest';
  private readonly burnRequestTemplateId = process.env.DAML_BURN_REQUEST ?? 'Asset.Standard.BurnRequest';
  private readonly swapRequestTemplateId = process.env.DAML_SWAP_REQUEST ?? 'Flow.Swap.SwapRequest';
  private readonly swapEscrowTemplateId = process.env.DAML_SWAP_ESCROW ?? 'Flow.Swap.SwapEscrow';
  private readonly v1CompatibilityWarning =
    'Legacy DAML JSON API endpoints ("/v1/") are deprecated and will be removed in a future release. Please update to the new endpoints ("/v2/") and ensure your Daml JSON API is version 2.0.0 or later.';
  private readonly unKnownSubmitterWarning =
    'DAML JSON API request did not specify a submitter party. Ensure that your requests include a valid submitter and that the DAML_ADMIN_PARTY environment variable is set correctly if using the default participant template.';

  private getRequestUrls(endpoint: string): string[] {
    if (!this.baseUrl) {
      return [];
    }

    const primaryUrl = `${this.baseUrl}${endpoint}`;

    if (!this.baseUrl.includes('localhost')) {
      return [primaryUrl];
    }

    return [primaryUrl, `${this.baseUrl.replace('localhost', '127.0.0.1')}${endpoint}`];
  }

  private get token(): string | undefined {
    return process.env.DAML_JSON_API_TOKEN;
  }

  private get adminParty(): string | undefined {
    return process.env.DAML_ADMIN_PARTY;
  }

  private get jwtSecret(): string | undefined {
    return process.env.DAML_JWT_SECRET;
  }

  private generateTokenForParties(parties: string[]): string | undefined {
    const secret = this.jwtSecret;
    if (!secret) return undefined;

    const now = Math.floor(Date.now() / 1000);
    const payload: any = {
      exp: now + 60 * 60,
      'https://daml.com/ledger-api': {
        ledgerId: process.env.DAML_LEDGER_ID ?? 'sandbox',
        applicationId: process.env.DAML_APPLICATION_ID ?? 'digitalAsset',
        actAs: parties,
        readAs: parties,
      },
    };

    const header = { alg: 'HS256', typ: 'JWT' };
    const base64url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
    const unsigned = `${base64url(header)}.${base64url(payload)}`;
    const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
    return `${unsigned}.${sig}`;
  }

  isEnabled(): boolean {
    return process.env.DAML_ENABLED === 'true' && Boolean(this.baseUrl);
  }

  hasParticipantSyncConfig(): boolean {
    return this.isEnabled() && Boolean(this.adminParty);
  }

  async assertReady(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const retries = 10;
    const readyUrls = this.getRequestUrls('/readyz');
    const liveUrls = this.getRequestUrls('/livez');

    for (let i = 0; i < retries; i++) {
      try {
        let healthy = false;

        for (const url of [...readyUrls, ...liveUrls]) {
          const response = await this.fetchWithTimeout(url, { method: 'GET' });
          if (response.ok) {
            healthy = true;
            break;
          }
        }

        if (healthy) {
          this.logger.log('Daml JSON API is healthy');
          await this.post<DamlJsonApiSuccess<unknown>>('v1/query', {
            templateIds: [this.participantTemplateId],
            query: {},
          });
          this.logger.log('DAML command pipeline ready');
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Waiting for DAML Json API (attempt ${i + 1}): ${message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new ServiceUnavailableException(`Daml JSON API is not ready after ${retries} attempts`);
  }

  getPartipantAdmin(): string {
    if (!this.adminParty) {
      throw new InternalServerErrorException(
        'DAML_ADMIN_PARTY is required for participant synchronization but is not set in the environment variables.',
      );
    }
    return this.adminParty;
  }

  private isFullPartyIdentifier(value: string): boolean {
    return value.includes('::');
  }

  private async resolvePartyIdentifier(value: string): Promise<string> {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      throw new InternalServerErrorException('Party identifier is empty or whitespace.');
    }

    const partiesResponse = await this.get<DamlParty[] | DamlJsonApiSuccess<DamlParty[]>>('v1/parties');
    const parties = this.unwrapResult<DamlParty[]>(partiesResponse);
    const identifierHint = this.isFullPartyIdentifier(trimmedValue) ? trimmedValue.split('::')[0] : trimmedValue;

    const existingParty = parties.find((party) => {
      const partyIdentifier = party.identifier ?? party.identfier ?? '';
      const shortIdentifier = partyIdentifier.split('::')[0];
      return partyIdentifier === trimmedValue || party.displayName === trimmedValue || shortIdentifier === identifierHint || shortIdentifier === trimmedValue;
    });

    if (existingParty) {
      return existingParty.identifier ?? existingParty.identfier ?? trimmedValue;
    }

    const allocatedResponse = await this.post<DamlParty | DamlJsonApiSuccess<DamlParty>>('v1/parties/allocate', {
      identifierHint,
      displayName: identifierHint,
    });
    const allocated = this.unwrapResult<DamlParty>(allocatedResponse);

    const allocatedIdentifier = allocated.identifier ?? allocated.identfier ?? identifierHint;
    this.logger.log(`Allocated new party: ${allocatedIdentifier}`);
    return allocatedIdentifier;
  }

  async createParticipant(participant: string, active = false): Promise<DamlCreatedContract> {
    const resolvedAdmin = await this.resolvePartyIdentifier(this.getPartipantAdmin());
    const resolvedParticipant = await this.resolvePartyIdentifier(participant);

    const token = this.generateTokenForParties([resolvedAdmin, resolvedParticipant]);

    const contract = await this.create<DamlCreatedContract>(this.participantTemplateId, {
      admin: resolvedAdmin,
      participant: resolvedParticipant,
      active,
    }, token);

    this.logger.log(`Created participant contract with ID: ${contract.contractId}`);
    return contract;
  }

  async findParticipantContract(participant: string): Promise<DamlCreatedContract | null> {
    const resolvedAdmin = await this.resolvePartyIdentifier(this.getPartipantAdmin());
    const resolvedParticipant = await this.resolvePartyIdentifier(participant);

    const token = this.generateTokenForParties([resolvedAdmin, resolvedParticipant]);
    const results = await this.query<DamlCreatedContract>(this.participantTemplateId, {
      admin: resolvedAdmin,
      participant: resolvedParticipant,
    }, token);

    return results[0] ?? null;
  }

  async activateParticipant(participant: string): Promise<string> {
    const contract = await this.findParticipantContract(participant);
    if (!contract) {
      const createdContract = await this.createParticipant(participant, true);
      return createdContract.contractId;
    }
    const resolvedAdmin = await this.resolvePartyIdentifier(this.getPartipantAdmin());
    const resolvedParticipant = await this.resolvePartyIdentifier(participant);
    const token = this.generateTokenForParties([resolvedAdmin, resolvedParticipant]);
    const activatedContract = await this.exercise<string>(
      this.participantTemplateId,
      contract.contractId,
      'Activate',
      {},
      token,
    );

    this.logger.log(`Activated participant contract with ID: ${activatedContract}`);
    return activatedContract;
  }

  async deactivateParticipant(participant: string): Promise<string> {
    const contract = await this.findParticipantContract(participant);
    if (!contract) {
      throw new ServiceUnavailableException(`Participant contract for ${participant} not found`);
    }
    const resolvedAdmin = await this.resolvePartyIdentifier(this.getPartipantAdmin());
    const resolvedParticipant = await this.resolvePartyIdentifier(participant);
    const token = this.generateTokenForParties([resolvedAdmin, resolvedParticipant]);
    const deactivatedContract = await this.exercise<string>(
      this.participantTemplateId,
      contract.contractId,
      'Deactivate',
      {},
      token,
    );

    this.logger.log(`Deactivated participant contract with ID: ${deactivatedContract}`);
    return deactivatedContract;
  }

  private async get<T>(endpoint: string, token?: string): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, token);
  }

  private async post<T>(endpoint: string, body?: JsonObject, token?: string): Promise<T> {
    return this.request<T>('POST', endpoint, body, token);
  }

  private async create<T>(templateId: string, payload: JsonObject, token?: string): Promise<T> {
    const response = await this.post<T | DamlJsonApiSuccess<T>>('v1/create', { templateId, payload }, token);
    return this.unwrapResult<T>(response);
  }

  private async query<T>(templateId: string, query: JsonObject, token?: string): Promise<T[]> {
    const response = await this.post<T[] | DamlJsonApiSuccess<T[]>>('v1/query', {
      templateIds: [templateId],
      query,
    }, token);
    return this.unwrapResult<T[]>(response) ?? [];
  }

  private async exercise<T>(templateId: string, contractId: string, choice: string, argument: JsonObject, token?: string): Promise<T> {
    const response = await this.post<T | DamlJsonApiSuccess<T>>('v1/exercise', {
      templateId,
      contractId,
      choice,
      argument,
    }, token);
    return this.unwrapResult<T>(response);
  }

  private unwrapResult<T>(payload: T | DamlJsonApiSuccess<T>): T {
    if (typeof payload === 'object' && payload !== null && 'result' in payload && 'status' in payload) {
      return (payload as DamlJsonApiSuccess<T>).result;
    }
    return payload as T;
  }

  private async request<T>(method: string, endpoint: string, body?: JsonObject, overrideToken?: string): Promise<T> {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException('DAML_JSON_API_URL is not configured.');
    }

    const url = `${this.baseUrl}/${endpoint.replace(/^\/+/, '')}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    const authToken = overrideToken ?? this.token ?? undefined;
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await this.fetchWithTimeout(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new InternalServerErrorException(`DAML request failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as T | DamlJsonApiError;
    if (this.isDamlErrorPayload(payload)) {
      throw new InternalServerErrorException(payload.ledgerApiError?.message ?? 'DAML request returned an error payload.');
    }

    return payload as T;
  }

  private isDamlErrorPayload(payload: unknown): payload is DamlJsonApiError {
    return typeof payload === 'object' && payload !== null && ('errors' in payload || 'ledgerApiError' in payload);
  }

  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}