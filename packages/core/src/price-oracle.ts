export interface PriceOracle {
  toSats(params: { amount: number; currency: string }): Promise<number>
  fromSats(params: { amountSats: number; currency: string }): Promise<number>
}
