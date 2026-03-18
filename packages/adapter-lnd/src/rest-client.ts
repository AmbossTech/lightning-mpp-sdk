import {
  ConnectionError,
  base64ToHex,
  hexToBase64Url,
} from "@ambosstech/lightning-mpp-core";
import type { LndRestConfig, LndTransport } from "./types.js";

export function createRestTransport(config: LndRestConfig): LndTransport {
  const baseUrl = config.url.replace(/\/$/, "");

  const macaroonHex =
    typeof config.macaroon === "string"
      ? config.macaroon
      : config.macaroon.toString("hex");

  const fetchFn = config.fetch ?? globalThis.fetch;

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetchFn(url, {
        ...options,
        headers: {
          "Grpc-Metadata-macaroon": macaroonHex,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    } catch (error) {
      throw new ConnectionError(`LND REST request failed: ${url}`, {
        cause: error,
      });
    }

    const body = (await response.json()) as any;
    if (!response.ok) {
      const err: any = new Error(
        body.message ?? body.error ?? `HTTP ${response.status}`,
      );
      err.code = body.code;
      err.details = body.message ?? body.error;
      throw err;
    }
    return body as T;
  }

  return {
    async addInvoice(params) {
      const body: any = { value: String(params.value) };
      if (params.memo) body.memo = params.memo;
      if (params.expiry) body.expiry = String(params.expiry);

      const res = await request<{ r_hash: string; payment_request: string }>(
        "/v1/invoices",
        { method: "POST", body: JSON.stringify(body) },
      );

      return {
        r_hash: base64ToHex(res.r_hash),
        payment_request: res.payment_request,
      };
    },

    async sendPaymentSync(params) {
      const body: any = { payment_request: params.payment_request };
      if (params.fee_limit) {
        body.fee_limit = { fixed: String(params.fee_limit.fixed) };
      }

      const res = await request<{
        payment_preimage: string;
        payment_error: string;
        payment_hash: string;
      }>("/v1/channels/transactions", {
        method: "POST",
        body: JSON.stringify(body),
      });

      return {
        payment_preimage: res.payment_preimage
          ? base64ToHex(res.payment_preimage)
          : "",
        payment_error: res.payment_error ?? "",
        payment_hash: res.payment_hash ? base64ToHex(res.payment_hash) : "",
      };
    },

    async lookupInvoice(params) {
      const hashUrl = hexToBase64Url(params.r_hash_str);
      const res = await request<{
        state: string;
        r_preimage: string;
        value: string;
      }>(`/v1/invoice/${hashUrl}`);

      return {
        state: res.state,
        r_preimage: res.r_preimage ? base64ToHex(res.r_preimage) : "",
        value: res.value ?? "0",
      };
    },

    close() {
      // no-op for REST
    },
  };
}
