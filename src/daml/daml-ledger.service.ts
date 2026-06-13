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

export interface DamlContract<T = any> {
  contractId: string;
  payload: T;
}

export interface ParticipantPayload {
  admin: string;
  participant: string;
  active: boolean;
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

  private get requestUrls(): string[] {
    if (!this.baseUrl) {
      return [];
    }

    if (!this.baseUrl.includes("localhost")) {
      return [this.baseUrl];
    }

    return [this.baseUrl, this.baseUrl.replace("localhost", "127.0.0.1")];
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (process.env.DAML_JSON_API_TOKEN) {
      headers.Authorization = "Bearer " + process.env.DAML_JSON_API_TOKEN;
    }

    return headers;
  }

  private async fetchJson<T>(endpoint: string, body: JsonObject): Promise<T> {
    if (this.requestUrls.length === 0) {
      throw new ServiceUnavailableException("DAML_JSON_API_URL is not configured");
    }

    const fetchFn = (globalThis as any).fetch;
    if (!fetchFn) {
      throw new InternalServerErrorException("Global fetch is not available in this runtime. Use Node 18+ or add a fetch polyfill.");
    }

    let lastError: unknown;

    for (const baseUrl of this.requestUrls) {
      const url = baseUrl + endpoint;
      try {
        const response = await fetchFn(url, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(body),
        });

        const json = await response.json();
        if (!response.ok) {
          const apiError = json as DamlJsonApiError;
          const errorMessage = Array.isArray(apiError.errors)
            ? apiError.errors.join("; ")
            : JSON.stringify(json);
          this.logger.warn("Daml JSON API returned " + response.status + ": " + errorMessage);
          throw new Error(errorMessage);
        }

        return json as T;
      } catch (error) {
        lastError = error;
        this.logger.warn("Daml JSON API request failed for " + url + ": " + error);
      }
    }

    throw new ServiceUnavailableException(
      "Daml JSON API is unavailable. Last error: " + (lastError ?? "unknown"),
    );
  }

  async createParticipant(participant: string, active = true): Promise<DamlContract<ParticipantPayload>> {
    const adminParty = process.env.DAML_ADMIN_PARTY || participant;
    const payload = {
      templateId: {
        moduleName: "Common.Registry",
        entityName: "Participant",
      },
      payload: {
        admin: adminParty,
        participant,
        active,
      },
      party: adminParty,
    };

    return await this.fetchJson<DamlContract<ParticipantPayload>>("/v1/create", payload);
  }

  async listParticipants(): Promise<DamlContract<ParticipantPayload>[]> {
    const queryBody = {
      templateIds: [
        {
          moduleName: "Common.Registry",
          entityName: "Participant",
        },
      ],
      query: {},
    };

    const result = await this.fetchJson<DamlJsonApiSuccess<DamlContract<ParticipantPayload>[]>>("/v1/query", queryBody);
    return result.result;
  }

  isEnabled(): boolean {
    return process.env.DAML_ENABLED?.toLowerCase() === "true" && Boolean(this.baseUrl);
  }

  hasParticipantSyncConfig(): boolean {
    return this.isEnabled() && Boolean(process.env.DAML_ADMIN_PARTY);
  }
}
