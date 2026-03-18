import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { LndGrpcConfig, LndTransport } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROTO_PATH = join(__dirname, "..", "proto", "lightning.proto");

export function createGrpcTransport(config: LndGrpcConfig): LndTransport {
  const tlsCert =
    typeof config.tlsCert === "string"
      ? Buffer.from(config.tlsCert, "utf-8")
      : config.tlsCert;

  const macaroonHex =
    typeof config.macaroon === "string"
      ? config.macaroon
      : config.macaroon.toString("hex");

  const sslCreds = grpc.credentials.createSsl(tlsCert);

  const macaroonCreds = grpc.credentials.createFromMetadataGenerator(
    (_params, callback) => {
      const metadata = new grpc.Metadata();
      metadata.add("macaroon", macaroonHex);
      callback(null, metadata);
    },
  );

  const combinedCreds = grpc.credentials.combineChannelCredentials(
    sslCreds,
    macaroonCreds,
  );

  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const lnrpc = grpc.loadPackageDefinition(packageDefinition).lnrpc as any;
  const client = new lnrpc.Lightning(config.host, combinedCreds);

  function promisify<TReq, TRes>(
    method: (req: TReq, cb: (err: any, res: TRes) => void) => void,
  ): (req: TReq) => Promise<TRes> {
    return (req: TReq) =>
      new Promise((resolve, reject) => {
        method.call(client, req, (err: any, res: TRes) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
  }

  const grpcAddInvoice = promisify(client.addInvoice);
  const grpcSendPaymentSync = promisify(client.sendPaymentSync);
  const grpcLookupInvoice = promisify(client.lookupInvoice);

  return {
    async addInvoice(params) {
      const res: any = await grpcAddInvoice(params);
      return {
        r_hash: Buffer.from(res.r_hash).toString("hex"),
        payment_request: res.payment_request,
      };
    },
    async sendPaymentSync(params) {
      const res: any = await grpcSendPaymentSync(params);
      return {
        payment_preimage: Buffer.from(res.payment_preimage).toString("hex"),
        payment_error: res.payment_error,
        payment_hash: Buffer.from(res.payment_hash).toString("hex"),
      };
    },
    async lookupInvoice(params) {
      const res: any = await grpcLookupInvoice(params);
      return {
        state: res.state,
        r_preimage: Buffer.from(res.r_preimage).toString("hex"),
        value: res.value,
      };
    },
    close() {
      client.close();
    },
  };
}
