import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { LndConfig } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PROTO_PATH = join(__dirname, '..', 'proto', 'lightning.proto')

export interface LndGrpcClient {
  addInvoice(params: {
    value: number
    memo?: string
    expiry?: number
  }): Promise<{ r_hash: Buffer; payment_request: string }>

  sendPaymentSync(params: {
    payment_request: string
    fee_limit?: { fixed: number }
  }): Promise<{
    payment_preimage: Buffer
    payment_error: string
    payment_hash: Buffer
  }>

  lookupInvoice(params: {
    r_hash_str: string
  }): Promise<{
    state: string
    r_preimage: Buffer
    value: string
  }>

  close(): void
}

export function createGrpcClient(config: LndConfig): LndGrpcClient {
  const tlsCert =
    typeof config.tlsCert === 'string'
      ? Buffer.from(config.tlsCert, 'utf-8')
      : config.tlsCert

  const macaroonHex =
    typeof config.macaroon === 'string'
      ? config.macaroon
      : config.macaroon.toString('hex')

  const sslCreds = grpc.credentials.createSsl(tlsCert)

  const macaroonCreds = grpc.credentials.createFromMetadataGenerator(
    (_params, callback) => {
      const metadata = new grpc.Metadata()
      metadata.add('macaroon', macaroonHex)
      callback(null, metadata)
    },
  )

  const combinedCreds = grpc.credentials.combineChannelCredentials(
    sslCreds,
    macaroonCreds,
  )

  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })

  const lnrpc = grpc.loadPackageDefinition(packageDefinition).lnrpc as any
  const client = new lnrpc.Lightning(config.host, combinedCreds)

  function promisify<TReq, TRes>(
    method: (req: TReq, cb: (err: any, res: TRes) => void) => void,
  ): (req: TReq) => Promise<TRes> {
    return (req: TReq) =>
      new Promise((resolve, reject) => {
        method.call(client, req, (err: any, res: TRes) => {
          if (err) reject(err)
          else resolve(res)
        })
      })
  }

  return {
    addInvoice: promisify(client.addInvoice),
    sendPaymentSync: promisify(client.sendPaymentSync),
    lookupInvoice: promisify(client.lookupInvoice),
    close() {
      client.close()
    },
  }
}
