import type { Logger } from "./types/logger";
import { fetchWithRetry } from "./utils/fetch-with-retry";

export interface ArkveilParams {
  serviceUrl: string;
  apiKey: string;
  version?: "v1";
  timeout?: number;
  retryAttempts?: number;
  logger?: Logger;

  getUserId?: (req: any) => string | Promise<string>;
  getUserAttributes?: (
    req: any
  ) => Record<string, any> | Promise<Record<string, any>>;
  getResourceAttributes?: (
    req: any
  ) => Record<string, any> | Promise<Record<string, any>>;
  getContextAttributes?: (
    req: any
  ) => Record<string, any> | Promise<Record<string, any>>;
  onDenied?: (req: any, res: any, reason?: string) => void | Promise<void>;
}

export interface PermissionCheckRequest {
  actionId: string;
  user: Record<string, any>;
  context: Record<string, any>;
}

export interface PermissionCheckResponse {
  granted: boolean;
}

export class Arkveil {
  private serviceUrl: string;
  private apiKey: string;
  private version: ArkveilParams["version"] = "v1";

  protected getUserId?: (req: any) => string | Promise<string>;
  protected getUserAttributes?: (
    req: any
  ) => Record<string, any> | Promise<Record<string, any>>;
  protected getResourceAttributes?: (
    req: any
  ) => Record<string, any> | Promise<Record<string, any>>;
  protected getContextAttributes?: (
    req: any
  ) => Record<string, any> | Promise<Record<string, any>>;
  protected onDenied?: (req: any, res: any) => void | Promise<void>;

  protected logger?: Logger;

  constructor(params: ArkveilParams) {
    this.serviceUrl = params.serviceUrl.replace(/\/$/, "");
    this.apiKey = params.apiKey;
    this.version = params.version || "v1";

    this.getUserId = params.getUserId;
    this.getUserAttributes = params.getUserAttributes;
    this.getResourceAttributes = params.getResourceAttributes;
    this.getContextAttributes = params.getContextAttributes;
    this.onDenied = params.onDenied;
    this.logger = params.logger;
  }

  /**
   * Check if a user has permission to perform an action
   */
  public async checkPermission(
    request: PermissionCheckRequest
  ): Promise<PermissionCheckResponse> {
    const url = `${this.serviceUrl}/${this.version}/permissions/check`;

    try {
      const response = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(
          `Permission check failed: ${response.status} ${response.statusText}`
        );
      }

      return (await response.json()) as PermissionCheckResponse;
    } catch (error) {
      this.logger?.error("Permission check failed:", error);
      return {
        granted: false,
      };
    }
  }

  /**
   * Handle denied access - runtime agnostic base implementation
   * Platform-specific SDKs should override this method
   *
   * @param req - Request object
   * @param res - Response object
   * @param next - Next function (optional)
   * @param onDenied - Custom denial handler (optional)
   */
  protected handleDenied(
    req: any,
    res: any,
    next: any,
    onDenied?: (req: any, res: any) => void | Promise<void>
  ) {
    const customHandler = onDenied || this.onDenied;

    if (customHandler) {
      return customHandler(req, res);
    }

    // Platform-specific implementations (Node.js, etc.) should override this method
    throw new Error(
      "Access denied. No custom onDenied handler provided. " +
        "Either provide an onDenied handler in the constructor or use a platform-specific SDK."
    );
  }
}
