import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from "@nestjs/common";

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

interface DamlDamlCreatedContract {
  contractId: string;
  payload: JsonObject;
}

interface DamlParty{
  identfier:string;
  displayName?:string;
  isLocal:boolean;
}

interface FetchErrorWithCause extends Error {
  cause?:{
    code?:string;
    address?:string;
  }
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
  private readonly baseUrl = process.env.DAML_JSON_API_URL?.replace(/\/+$/, "");
  private readonly requestTimeoutMs= Number(process.env.DAML_REQUEST_TIMEOUT_MS) ?? 5000;
  private readonly participantTemplateId = process.env.DAML_PARTICIPANT ?? "Common.Registry.Participant";
  private readonly kycApplicationTemplateId = process.env.DAML_KYC_APPLICATION ?? "Common.Registry.KycApplication";
  private readonly assetDirectoryTemplateId = process.env.DAML_ASSET_DIRECTORY ?? "Common.Registry.AssetDirectory";
  private readonly assetPermissionTemplateId = process.env.DAML_ASSET_PERMISSION ?? "Common.Registry.AssetPermission";
  private readonly adminRoleTemplateId = process.env.DAML_ADMIN_ROLE ?? "Common.Governance.AdminRole";
  private readonly pauseSwitchTemplateId = process.env.DAML_PAUSE_SWITCH ?? "Common.Governance.PauseSwitch";
  private readonly mintRequestTemplateId = process.env.DAML_MINT_REQUEST ?? "Asset.Standard.MintRequest";
  private readonly burnRequestTemplateId = process.env.DAML_BURN_REQUEST ?? "Asset.Standard.BurnRequest";
  private readonly swapRequestTemplateId = process.env.DAML_SWAP_REQUEST ?? "Flow.Swap.SwapRequest";
  private readonly swapEscrowTemplateId = process.env.DAML_SWAP_ESCROW ?? "Flow.Swap.SwapEscrow";
  private readonly v1CompatibilityWarning = 
  'Legacy DAML JSON API endpoints ("/v1/") are deprecated and will be removed in a future release. Please update to the new endpoints ("/v2/") and ensure your Daml JSON API is version 2.0.0 or later.';
  private readonly unKnownSubmitterWarning = 
  'DAML JSON API request did not specify a submitter party. Ensure that your requests include a valid submitter and that the DAML_ADMIN_PARTY environment variable is set correctly if using the default participant template.';

  private getRequestUrls(endpoint: string): string[] {
    if (!this.baseUrl) {
      return [];
    }

    const primaryUrl = '${this.baseUrl}${endpoint}';

    if (!this.baseUrl.includes("localhost")) {
      return [primaryUrl];
    }

    return [primaryUrl, `${this.baseUrl.replace("localhost", "127.0.0.1")}${endpoint}`];  
  }

  private get token(): string | undefined {
    return process.env.DAML_JSON_API_TOKEN;
  }

  private get adminParty(): string | undefined {
    return process.env.DAML_ADMIN_PARTY;
  }

  isEnabled(): boolean {
    return process.env.DAML_ENABLED === "true" && Boolean(this.baseUrl);
  }

  hasParticipantSyncConfig(): boolean {
    return this.isEnabled() && Boolean(this.adminParty);
  }



  // private get requestUrls(): string[] {
  //   if (!this.baseUrl) {
  //     return [];
  //   }

  //   if (!this.baseUrl.includes("localhost")) {
  //     return [this.baseUrl];
  //   }

  //   return [this.baseUrl, this.baseUrl.replace("localhost", "127.0.0.1")];
  // }

  // private get headers(): Record<string, string> {
  //   const headers: Record<string, string> = {
  //     "Content-Type": "application/json",
  //   };

  //   if (process.env.DAML_JSON_API_TOKEN) {
  //     headers.Authorization = "Bearer " + process.env.DAML_JSON_API_TOKEN;
  //   }

  //   return headers;
  // }

  async assertReady(): Promise<void> {
    if (!this.isEnabled()) return;

    const retries= 10;
    const readyUrls = this.getRequestUrls('/readyz');
    const liveUrls = this.getRequestUrls('/livez');

    for (let i = 0; i < retries; i++) {
      try {
        let healthy = false;

        for (const url of [...readyUrls, ...liveUrls]) {
          const response = await this.fetchWithTimeout(url, { method: "GET" });
          if (response.ok) {
            healthy = true;
            break;
          }
        }

        if (healthy) {
          this.logger.log("Daml JSON API is healthy");

          //warm-up query
          await this.post('v1/query', {
            templateIds: [this.participantTemplateId],    
            query: {},  
          });
          this.logger.log('DAML command pipeline ready');
          return;
        }
      } catch (err) {
        const message = err as instanceof Error ? err.message : String(err);
        this.logger.warn('Waiting for DAML Json API(attempt ${i+1}): ${message}' );
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new ServiceUnavailableException(
      'Daml JSON API is not ready after ${retries} attempts'
    );
  }


  getPartipantAdmin(): string {
    if (!this.adminParty) {
      throw new InternalServerErrorException(
        'DAML_ADMIN_PARTY is required for participant synchronization but is not set in the environment variables.'   
      );
    }
    return this.adminParty;
  }
  private isFullpartyidentifier(value: string): boolean {
    return value.includes('::');
  }

  private async resolvePartyIdentifier(value: string): Promise<string> {
    const trimmedValue =value.trim();
    if(!trimmedValue){
      throw new InternalServerErrorException('Party identifier is empty or whitespace.');
    }

    const parties = await this.get<DamlParty[]>('v1/parties');
    const identiferHint = this.isFullpartyidentifier(trimmedValue)
     ? trimmedValue.split('::')[0]
     : trimmedValue;

     const existingParty =parties.find(party) =>{
      const shortIdentifier = party.identfier.split('::')[0];
      return {
        party.identifier === trimmedValue ||
        party.displayName === trimmedValue 
        shortIdentifier === identiferHint || 
        shortIdentifier === trimmedValue
      );
    });
       
    if(existingParty){
      return existingParty.identfier;
    }

    const allocated = await this.post<DamlParty>('v1/parties/allocate', {
      identifierHint,
      displayName: identifierHint,
    });
    
    this.logger.log('Allocated new party: ${allocated.identifier} with display name: ${allocated.displayName}');
    return allocated.identifier;
  }
          



  async createParticipant(participant: string, active=false): Promise<DamlCreatedContract> {
    const resolvedAdmin = await this.resolvePartyIdentifier(this.getPartipantAdmin());
    const resolvedParticipant = await this.resolvePartyIdentifier(participant);

    const contract= await this.create(this.participantTemplateId, {
      admin: resolvedAdmin,
      participant: resolvedParticipant,
      active
    });

    this.logger.log(
      `Created participant contract with ID: ${contract.contractId}`
    );
    
    return contract;
  }
















}
