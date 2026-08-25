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

export interface CreateSwapRequestParams {
  swapId: string;
  partyA: string;
  partyB: string;
  escrow: string;
  pauseOwner: string;
  expiryTime?: string;
  legA: {
    holdingCid: string;
    qty: number;
    assetAdmin: string;
  };
  legB: {
    holdingCid: string;
    qty: number;
    assetAdmin: string;
  };
}

@Injectable()
export class DamlService {
  private readonly logger = new Logger(DamlService.name);
  private readonly baseUrl = process.env.DAML_JSON_API_URL?.replace(/\/+$/, '');
  private readonly requestTimeoutMs = Number(process.env.DAML_REQUEST_TIMEOUT_MS) ?? 5000;
  private readonly packageId = process.env.DAML_PACKAGE_ID;
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
  private packageIdsPromise: Promise<string[]> | null = null;
  private readonly resolvedTemplateIdCache = new Map<string, string>();

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
      const partyIdentifier = party.identifier ?? '';
      const shortIdentifier = partyIdentifier.split('::')[0];
      return partyIdentifier === trimmedValue || party.displayName === trimmedValue || shortIdentifier === identifierHint || shortIdentifier === trimmedValue;
    });

    if (existingParty) {
      return existingParty.identifier ?? trimmedValue;
    }

    const allocatedResponse = await this.post<DamlParty | DamlJsonApiSuccess<DamlParty>>('v1/parties/allocate', {
      identifierHint,
      displayName: identifierHint,
    });
    const allocated = this.unwrapResult<DamlParty>(allocatedResponse);

    const allocatedIdentifier = allocated.identifier ?? identifierHint;
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

  async findAssetPermissionContract(admin: string, assetId: string): Promise<DamlCreatedContract | null> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const token = this.generateTokenForParties([resolvedAdmin]);
    const results = await this.query<DamlCreatedContract>(this.assetPermissionTemplateId, {
      admin: resolvedAdmin,
      assetId,
    }, token);

    return results[0] ?? null;
  }

  async findAssetDirectoryContract(admin: string, assetId: string): Promise<DamlCreatedContract | null> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const token = this.generateTokenForParties([resolvedAdmin]);
    const results = await this.query<DamlCreatedContract>(this.assetDirectoryTemplateId, {
      admin: resolvedAdmin,
      assetId,
    }, token);

    return results[0] ?? null;
  }

  async createAssetDirectory(admin: string, assetId: string): Promise<DamlCreatedContract> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const token = this.generateTokenForParties([resolvedAdmin]);
    const existing = await this.findAssetDirectoryContract(resolvedAdmin, assetId);

    if (existing) {
      return existing;
    }

    const contract = await this.create<DamlCreatedContract>(this.assetDirectoryTemplateId, {
      admin: resolvedAdmin,
      assetId,
      enabled: false,
      viewers: [],
    }, token);

    this.logger.log(`Created AssetDirectory contract with ID: ${contract.contractId}`);
    return contract;
  }

  private async findOrCreateAssetDirectory(admin: string, assetId: string): Promise<DamlCreatedContract> {
    const existing = await this.findAssetDirectoryContract(admin, assetId);
    if (existing) {
      return existing;
    }
    return this.createAssetDirectory(admin, assetId);
  }

  async enableAsset(admin: string, assetId: string): Promise<string | Record<string, unknown>> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const contract = await this.findOrCreateAssetDirectory(resolvedAdmin, assetId);
    const token = this.generateTokenForParties([resolvedAdmin]);

    const updatedContractId = await this.exercise<string | Record<string, unknown>>(
      this.assetDirectoryTemplateId,
      contract.contractId,
      'EnableAsset',
      {},
      token,
    );

    this.logger.log(`EnableAsset exercised for asset ${assetId}: ${JSON.stringify(updatedContractId)}`);
    return updatedContractId;
  }

  async disableAsset(admin: string, assetId: string): Promise<string | Record<string, unknown>> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const contract = await this.findAssetDirectoryContract(resolvedAdmin, assetId);

    if (!contract) {
      throw new ServiceUnavailableException(`AssetDirectory contract for asset ${assetId} not found`);
    }

    const token = this.generateTokenForParties([resolvedAdmin]);

    const updatedContractId = await this.exercise<string | Record<string, unknown>>(
      this.assetDirectoryTemplateId,
      contract.contractId,
      'DisableAsset',
      {},
      token,
    );

    this.logger.log(`DisableAsset exercised for asset ${assetId}: ${JSON.stringify(updatedContractId)}`);
    return updatedContractId;
  }

  async createAssetPermission(admin: string, assetId: string): Promise<DamlCreatedContract> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const token = this.generateTokenForParties([resolvedAdmin]);

    const contract = await this.create<DamlCreatedContract>(this.assetPermissionTemplateId, {
      admin: resolvedAdmin,
      assetId,
      enabled: false,
      allowedHolders: [],
      allowedIssuers: [],
      viewers: [],
    }, token);

    this.logger.log(`Created AssetPermission contract with ID: ${contract.contractId}`);
    return contract;
  }

  private async findOrCreateAssetPermission(admin: string, assetId: string): Promise<DamlCreatedContract> {
    const existing = await this.findAssetPermissionContract(admin, assetId);
    if (existing) {
      return existing;
    }
    return this.createAssetPermission(admin, assetId);
  }

  async allowHolder(admin: string, assetId: string, holder: string): Promise<string> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const resolvedHolder = await this.resolvePartyIdentifier(holder);
    const contract = await this.findOrCreateAssetPermission(resolvedAdmin, assetId);
    const token = this.generateTokenForParties([resolvedAdmin, resolvedHolder]);

    const updatedContractId = await this.exercise<string>(
      this.assetPermissionTemplateId,
      contract.contractId,
      'AllowHolder',
      { holder: resolvedHolder },
      token,
    );

    this.logger.log(`AllowHolder exercised for ${resolvedHolder} on asset ${assetId}: ${updatedContractId}`);
    return updatedContractId;
  }

  async blockHolder(admin: string, assetId: string, holder: string): Promise<string> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const resolvedHolder = await this.resolvePartyIdentifier(holder);
    const contract = await this.findAssetPermissionContract(resolvedAdmin, assetId);
    if (!contract) {
      throw new ServiceUnavailableException(`AssetPermission contract for asset ${assetId} not found`);
    }
    const token = this.generateTokenForParties([resolvedAdmin, resolvedHolder]);

    const updatedContractId = await this.exercise<string>(
      this.assetPermissionTemplateId,
      contract.contractId,
      'BlockHolder',
      { holder: resolvedHolder },
      token,
    );

    this.logger.log(`BlockHolder exercised for ${resolvedHolder} on asset ${assetId}: ${updatedContractId}`);
    return updatedContractId;
  }

  async allowIssuer(admin: string, assetId: string, issuer: string): Promise<string> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const resolvedIssuer = await this.resolvePartyIdentifier(issuer);
    const contract = await this.findOrCreateAssetPermission(resolvedAdmin, assetId);
    const token = this.generateTokenForParties([resolvedAdmin, resolvedIssuer]);

    const updatedContractId = await this.exercise<string>(
      this.assetPermissionTemplateId,
      contract.contractId,
      'AllowIssuer',
      { issuer: resolvedIssuer },
      token,
    );

    this.logger.log(`AllowIssuer exercised for ${resolvedIssuer} on asset ${assetId}: ${updatedContractId}`);
    return updatedContractId;
  }

  async revokeIssuer(admin: string, assetId: string, issuer: string): Promise<string> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const resolvedIssuer = await this.resolvePartyIdentifier(issuer);
    const contract = await this.findAssetPermissionContract(resolvedAdmin, assetId);
    if (!contract) {
      throw new ServiceUnavailableException(`AssetPermission contract for asset ${assetId} not found`);
    }
    const token = this.generateTokenForParties([resolvedAdmin, resolvedIssuer]);

    const updatedContractId = await this.exercise<string>(
      this.assetPermissionTemplateId,
      contract.contractId,
      'RevokeIssuer',
      { issuer: resolvedIssuer },
      token,
    );

    this.logger.log(`RevokeIssuer exercised for ${resolvedIssuer} on asset ${assetId}: ${updatedContractId}`);
    return updatedContractId;
  }

  async findAdminRoleContract(admin: string): Promise<DamlCreatedContract | null> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const token = this.generateTokenForParties([resolvedAdmin]);
    const results = await this.query<DamlCreatedContract>(this.adminRoleTemplateId, { superAdmin: resolvedAdmin }, token);
    return results[0] ?? null;
  }

  private async findOrCreateAdminRole(admin: string): Promise<DamlCreatedContract> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const existing = await this.findAdminRoleContract(resolvedAdmin);
    if (existing) {
      return existing;
    }
    const token = this.generateTokenForParties([resolvedAdmin]);
    const contract = await this.create<DamlCreatedContract>(this.adminRoleTemplateId, {
      superAdmin: resolvedAdmin,
      admins: [],
    }, token);
    this.logger.log(`Created AdminRole contract with ID: ${contract.contractId}`);
    return contract;
  }

  async findPauseSwitchContract(admin: string): Promise<DamlCreatedContract | null> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const token = this.generateTokenForParties([resolvedAdmin]);
    const results = await this.query<DamlCreatedContract>(this.pauseSwitchTemplateId, { owner: resolvedAdmin }, token);
    return results[0] ?? null;
  }

  private async findOrCreatePauseSwitch(admin: string): Promise<DamlCreatedContract> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const existing = await this.findPauseSwitchContract(resolvedAdmin);
    if (existing) {
      return existing;
    }
    const adminRole = await this.findOrCreateAdminRole(resolvedAdmin);
    const token = this.generateTokenForParties([resolvedAdmin]);
    const contract = await this.create<DamlCreatedContract>(this.pauseSwitchTemplateId, {
      owner: resolvedAdmin,
      viewers: [],
      adminRoleCid: adminRole.contractId,
      paused: false,
    }, token);
    this.logger.log(`Created PauseSwitch contract with ID: ${contract.contractId}`);
    return contract;
  }

  async createMintRequest(
    admin: string,
    assetId: string,
    issuer: string,
    targetOwner: string,
    qty: number,
  ): Promise<{ mintContractId: string }> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const resolvedIssuer = await this.resolvePartyIdentifier(issuer);
    const resolvedTargetOwner = await this.resolvePartyIdentifier(targetOwner);

    const [dirContract, permContract, pauseContract] = await Promise.all([
      this.findOrCreateAssetDirectory(resolvedAdmin, assetId),
      this.findOrCreateAssetPermission(resolvedAdmin, assetId),
      this.findOrCreatePauseSwitch(resolvedAdmin),
    ]);

    const token = this.generateTokenForParties([resolvedAdmin, resolvedIssuer, resolvedTargetOwner]);

    const created = await this.create<DamlCreatedContract>(this.mintRequestTemplateId, {
      assetAdmin: resolvedAdmin,
      assetId,
      issuer: resolvedIssuer,
      targetOwner: resolvedTargetOwner,
      qty: qty.toFixed(10),
      directoryCid: dirContract.contractId,
      permissionCid: permContract.contractId,
      pauseCid: pauseContract.contractId,
    }, token);

    const submitted = await this.exercise<string>(
      this.mintRequestTemplateId,
      created.contractId,
      'SubmitMint',
      {},
      token,
    );

    const mintContractId = typeof submitted === 'string' ? submitted : created.contractId;
    this.logger.log(`MintRequest submitted, contractId: ${mintContractId}`);
    return { mintContractId };
  }

  async approveMintRequest(admin: string, issuer: string, assetId: string, mintContractId: string): Promise<string> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const resolvedIssuer = await this.resolvePartyIdentifier(issuer);
    const token = this.generateTokenForParties([resolvedAdmin, resolvedIssuer]);

    const holdingContractId = await this.exercise<string>(
      this.mintRequestTemplateId,
      mintContractId,
      'ApproveMint',
      {},
      token,
    );

    this.logger.log(`ApproveMint exercised for asset ${assetId}, holding: ${holdingContractId}`);
    return typeof holdingContractId === 'string' ? holdingContractId : JSON.stringify(holdingContractId);
  }

  async cancelMintRequest(issuer: string, assetId: string, mintContractId: string): Promise<void> {
    const resolvedIssuer = await this.resolvePartyIdentifier(issuer);
    const token = this.generateTokenForParties([resolvedIssuer]);

    await this.exercise<unknown>(
      this.mintRequestTemplateId,
      mintContractId,
      'CancelMint',
      {},
      token,
    );

    this.logger.log(`CancelMint exercised for asset ${assetId}, contract: ${mintContractId}`);
  }

  async createBurnRequest(
    admin: string,
    assetId: string,
    requestedBy: string,
    holdingContractId: string,
    qty: number,
  ): Promise<{ burnContractId: string }> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const resolvedRequestedBy = await this.resolvePartyIdentifier(requestedBy);

    const [dirContract, permContract, pauseContract] = await Promise.all([
      this.findOrCreateAssetDirectory(resolvedAdmin, assetId),
      this.findOrCreateAssetPermission(resolvedAdmin, assetId),
      this.findOrCreatePauseSwitch(resolvedAdmin),
    ]);

    const token = this.generateTokenForParties([resolvedAdmin, resolvedRequestedBy]);

    const created = await this.create<DamlCreatedContract>(this.burnRequestTemplateId, {
      assetAdmin: resolvedAdmin,
      requestedBy: resolvedRequestedBy,
      holdingCid: holdingContractId,
      qty: qty.toFixed(10),
      directoryCid: dirContract.contractId,
      permissionCid: permContract.contractId,
      pauseCid: pauseContract.contractId,
    }, token);

    const submitted = await this.exercise<string>(
      this.burnRequestTemplateId,
      created.contractId,
      'SubmitBurn',
      {},
      token,
    );

    const burnContractId = typeof submitted === 'string' ? submitted : created.contractId;
    this.logger.log(`BurnRequest submitted for asset ${assetId}, contractId: ${burnContractId}`);
    return { burnContractId };
  }

  async approveBurnRequest(admin: string, assetId: string, burnContractId: string): Promise<string> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const token = this.generateTokenForParties([resolvedAdmin]);

    const holdingContractId = await this.exercise<string>(
      this.burnRequestTemplateId,
      burnContractId,
      'ApproveBurn',
      {},
      token,
    );

    this.logger.log(`ApproveBurn exercised for asset ${assetId}, resulting holding: ${holdingContractId}`);
    return typeof holdingContractId === 'string' ? holdingContractId : JSON.stringify(holdingContractId);
  }

  async cancelBurnRequest(requestedBy: string, assetId: string, burnContractId: string): Promise<void> {
    const resolvedRequestedBy = await this.resolvePartyIdentifier(requestedBy);
    const token = this.generateTokenForParties([resolvedRequestedBy]);

    await this.exercise<unknown>(
      this.burnRequestTemplateId,
      burnContractId,
      'CancelBurn',
      {},
      token,
    );

    this.logger.log(`CancelBurn exercised for asset ${assetId}, contract: ${burnContractId}`);
  }

  async queryBurnRequests(admin: string, assetId?: string): Promise<DamlCreatedContract[]> {
    const resolvedAdmin = await this.resolvePartyIdentifier(admin);
    const token = this.generateTokenForParties([resolvedAdmin]);
    const query: JsonObject = { assetAdmin: resolvedAdmin };
    if (assetId) {
      query.assetId = assetId;
    }
    return this.query<DamlCreatedContract>(this.burnRequestTemplateId, query, token);
  }

  async createSwapRequest(params: CreateSwapRequestParams): Promise<{ swapRequestContractId: string }> {
    const resolvedPartyA = await this.resolvePartyIdentifier(params.partyA);
    const resolvedPartyB = await this.resolvePartyIdentifier(params.partyB);
    const resolvedEscrow = await this.resolvePartyIdentifier(params.escrow);
    const resolvedPauseOwner = await this.resolvePartyIdentifier(params.pauseOwner);
    const resolvedLegAAdmin = await this.resolvePartyIdentifier(params.legA.assetAdmin);
    const resolvedLegBAdmin = await this.resolvePartyIdentifier(params.legB.assetAdmin);

    const pauseContract = await this.findOrCreatePauseSwitch(resolvedPauseOwner);

    const token = this.generateTokenForParties([
      resolvedPartyA,
      resolvedPartyB,
      resolvedEscrow,
      resolvedPauseOwner,
      resolvedLegAAdmin,
      resolvedLegBAdmin,
    ]);

    const created = await this.create<DamlCreatedContract>(this.swapRequestTemplateId, {
      partyA: resolvedPartyA,
      partyB: resolvedPartyB,
      escrow: resolvedEscrow,
      swapId: params.swapId,
      expiry: params.expiryTime ?? null,
      legA: {
        holdingCid: params.legA.holdingCid,
        qty: params.legA.qty.toFixed(10),
        assetAdmin: resolvedLegAAdmin,
      },
      legB: {
        holdingCid: params.legB.holdingCid,
        qty: params.legB.qty.toFixed(10),
        assetAdmin: resolvedLegBAdmin,
      },
      pauseCid: pauseContract.contractId,
    }, token);

    await this.exercise<unknown>(
      this.swapRequestTemplateId,
      created.contractId,
      'Propose',
      {},
      token,
    );

    this.logger.log(`SwapRequest proposed, contractId: ${created.contractId}`);
    return { swapRequestContractId: created.contractId };
  }

  async acceptSwapRequest(partyB: string, escrow: string, swapId: string, swapRequestContractId: string): Promise<string> {
    const resolvedPartyB = await this.resolvePartyIdentifier(partyB);
    const resolvedEscrow = await this.resolvePartyIdentifier(escrow);
    const token = this.generateTokenForParties([resolvedPartyB, resolvedEscrow]);

    const swapEscrowContractId = await this.exercise<string>(
      this.swapRequestTemplateId,
      swapRequestContractId,
      'Accept',
      {},
      token,
    );

    this.logger.log(`SwapRequest accepted for ${swapId}, escrow contract: ${swapEscrowContractId}`);
    return typeof swapEscrowContractId === 'string' ? swapEscrowContractId : JSON.stringify(swapEscrowContractId);
  }

  async cancelSwapRequest(partyA: string, swapId: string, swapRequestContractId: string): Promise<void> {
    const resolvedPartyA = await this.resolvePartyIdentifier(partyA);
    const token = this.generateTokenForParties([resolvedPartyA]);

    await this.exercise<unknown>(
      this.swapRequestTemplateId,
      swapRequestContractId,
      'Cancel',
      {},
      token,
    );

    this.logger.log(`SwapRequest cancelled for ${swapId}, contract: ${swapRequestContractId}`);
  }

  async lockSwapLegA(
    partyA: string,
    escrow: string,
    legAAdmin: string,
    swapId: string,
    swapEscrowContractId: string,
  ): Promise<string> {
    const resolvedPartyA = await this.resolvePartyIdentifier(partyA);
    const resolvedEscrow = await this.resolvePartyIdentifier(escrow);
    const resolvedLegAAdmin = await this.resolvePartyIdentifier(legAAdmin);
    const token = this.generateTokenForParties([resolvedPartyA, resolvedEscrow, resolvedLegAAdmin]);

    const nextEscrowId = await this.exercise<string>(
      this.swapEscrowTemplateId,
      swapEscrowContractId,
      'LockLegA',
      {},
      token,
    );

    this.logger.log(`LockLegA exercised for swap ${swapId}, new escrow contract: ${nextEscrowId}`);
    return typeof nextEscrowId === 'string' ? nextEscrowId : JSON.stringify(nextEscrowId);
  }

  async lockSwapLegB(
    partyB: string,
    escrow: string,
    legBAdmin: string,
    swapId: string,
    swapEscrowContractId: string,
  ): Promise<string> {
    const resolvedPartyB = await this.resolvePartyIdentifier(partyB);
    const resolvedEscrow = await this.resolvePartyIdentifier(escrow);
    const resolvedLegBAdmin = await this.resolvePartyIdentifier(legBAdmin);
    const token = this.generateTokenForParties([resolvedPartyB, resolvedEscrow, resolvedLegBAdmin]);

    const nextEscrowId = await this.exercise<string>(
      this.swapEscrowTemplateId,
      swapEscrowContractId,
      'LockLegB',
      {},
      token,
    );

    this.logger.log(`LockLegB exercised for swap ${swapId}, new escrow contract: ${nextEscrowId}`);
    return typeof nextEscrowId === 'string' ? nextEscrowId : JSON.stringify(nextEscrowId);
  }

  async settleAtomicSwap(
    escrow: string,
    legAAdmin: string,
    legBAdmin: string,
    swapId: string,
    swapEscrowContractId: string,
  ): Promise<void> {
    const resolvedEscrow = await this.resolvePartyIdentifier(escrow);
    const resolvedLegAAdmin = await this.resolvePartyIdentifier(legAAdmin);
    const resolvedLegBAdmin = await this.resolvePartyIdentifier(legBAdmin);
    const token = this.generateTokenForParties([resolvedEscrow, resolvedLegAAdmin, resolvedLegBAdmin]);

    await this.exercise<unknown>(
      this.swapEscrowTemplateId,
      swapEscrowContractId,
      'SettleAtomic',
      {},
      token,
    );

    this.logger.log(`SettleAtomic exercised for swap ${swapId}, escrow contract: ${swapEscrowContractId}`);
  }

  async abortAtomicSwap(
    escrow: string,
    legAAdmin: string,
    legBAdmin: string,
    swapId: string,
    swapEscrowContractId: string,
  ): Promise<void> {
    const resolvedEscrow = await this.resolvePartyIdentifier(escrow);
    const resolvedLegAAdmin = await this.resolvePartyIdentifier(legAAdmin);
    const resolvedLegBAdmin = await this.resolvePartyIdentifier(legBAdmin);
    const token = this.generateTokenForParties([resolvedEscrow, resolvedLegAAdmin, resolvedLegBAdmin]);

    await this.exercise<unknown>(
      this.swapEscrowTemplateId,
      swapEscrowContractId,
      'Abort',
      {},
      token,
    );

    this.logger.log(`Abort exercised for swap ${swapId}, escrow contract: ${swapEscrowContractId}`);
  }

  private async get<T>(endpoint: string, token?: string): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, token);
  }

  private async post<T>(endpoint: string, body?: JsonObject, token?: string): Promise<T> {
    return this.request<T>('POST', endpoint, body, token);
  }

  private async create<T>(templateId: string, payload: JsonObject, token?: string): Promise<T> {
    const candidateTemplateIds = await this.resolveTemplateCandidates(templateId);
    let lastError: unknown;

    for (const candidateTemplateId of candidateTemplateIds) {
      try {
        const response = await this.post<T | DamlJsonApiSuccess<T>>(
          'v1/create',
          { templateId: candidateTemplateId, payload },
          token,
        );
        this.resolvedTemplateIdCache.set(templateId, candidateTemplateId);
        return this.unwrapResult<T>(response);
      } catch (error) {
        lastError = error;
        if (!this.isTemplateResolutionError(error)) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async query<T>(templateId: string, query: JsonObject, token?: string): Promise<T[]> {
    const candidateTemplateIds = await this.resolveTemplateCandidates(templateId);
    let lastError: unknown;

    for (const candidateTemplateId of candidateTemplateIds) {
      try {
        const response = await this.post<T[] | DamlJsonApiSuccess<T[]>>(
          'v1/query',
          {
            templateIds: [candidateTemplateId],
            query,
          },
          token,
        );
        this.resolvedTemplateIdCache.set(templateId, candidateTemplateId);
        return this.unwrapResult<T[]>(response) ?? [];
      } catch (error) {
        lastError = error;
        if (!this.isTemplateResolutionError(error)) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async exercise<T>(templateId: string, contractId: string, choice: string, argument: JsonObject, token?: string): Promise<T> {
    const candidateTemplateIds = await this.resolveTemplateCandidates(templateId);
    let lastError: unknown;

    for (const candidateTemplateId of candidateTemplateIds) {
      try {
        const response = await this.post<T | DamlJsonApiSuccess<T>>(
          'v1/exercise',
          {
            templateId: candidateTemplateId,
            contractId,
            choice,
            argument,
          },
          token,
        );
        this.resolvedTemplateIdCache.set(templateId, candidateTemplateId);
        return this.unwrapResult<T>(response);
      } catch (error) {
        lastError = error;
        if (!this.isTemplateResolutionError(error)) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private unwrapResult<T>(payload: T | DamlJsonApiSuccess<T>): T {
    if (typeof payload === 'object' && payload !== null && 'result' in payload && 'status' in payload) {
      return (payload as DamlJsonApiSuccess<T>).result;
    }
    return payload as T;
  }

  private async resolveTemplateCandidates(templateId: string): Promise<string[]> {
    const cached = this.resolvedTemplateIdCache.get(templateId);
    if (cached) {
      return [cached];
    }

    if ((templateId.match(/:/g) ?? []).length === 2) {
      return [templateId];
    }

    const parts = templateId.split('.').filter(Boolean);
    if (parts.length < 2) {
      return [templateId];
    }

    const entity = parts[parts.length - 1];
    const moduleName = parts.slice(0, -1).join('.');
    const packageIds = await this.getPackageIds();
    return packageIds.map((packageId) => `${packageId}:${moduleName}:${entity}`);
  }

  private async getPackageIds(): Promise<string[]> {
    if (!this.packageIdsPromise) {
      this.packageIdsPromise = this.loadPackageIds();
    }

    return this.packageIdsPromise;
  }

  private async loadPackageIds(): Promise<string[]> {
    const discoveredResponse = await this.get<string[] | DamlJsonApiSuccess<string[]>>('v1/packages');
    const discoveredPackageIds = this.unwrapResult<string[]>(discoveredResponse) ?? [];

    const candidates: string[] = [];
    if (this.packageId) {
      candidates.push(this.packageId);
    }
    candidates.push(...discoveredPackageIds);

    const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));

    if (!uniqueCandidates.length) {
      throw new ServiceUnavailableException(
        'No DAML package IDs were returned by /v1/packages. Set DAML_PACKAGE_ID explicitly.',
      );
    }

    if (uniqueCandidates.length > 1) {
      this.logger.warn(
        `Multiple DAML packages detected; attempting ${uniqueCandidates.length} package IDs for template resolution.`,
      );
    }

    return uniqueCandidates;
  }

  private isTemplateResolutionError(error: unknown): boolean {
    const message = this.extractErrorMessage(error).toLowerCase();
    return message.includes('cannot resolve any template id from request');
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return String(error);
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
      throw new InternalServerErrorException(this.buildDamlErrorMessage(payload));
    }

    return payload as T;
  }

  private isDamlErrorPayload(payload: unknown): payload is DamlJsonApiError {
    return typeof payload === 'object' && payload !== null && ('errors' in payload || 'ledgerApiError' in payload);
  }

  private buildDamlErrorMessage(payload: DamlJsonApiError): string {
    const parts: string[] = [];

    if (typeof payload.status === 'number') {
      parts.push(`status=${payload.status}`);
    }

    if (payload.ledgerApiError?.code !== undefined) {
      parts.push(`ledgerCode=${payload.ledgerApiError.code}`);
    }

    if (payload.ledgerApiError?.message) {
      parts.push(`ledgerMessage=${payload.ledgerApiError.message}`);
    }

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      parts.push(`errors=${payload.errors.join(' | ')}`);
    }

    if (!parts.length) {
      return 'DAML request returned an error payload.';
    }

    return `DAML request returned an error payload: ${parts.join('; ')}`;
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