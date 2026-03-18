import { describe, expect, it } from 'vitest'
import { bytesToHex, hexToBytes, verifyPreimage } from './preimage.js'

describe('hexToBytes', () => {
  it('converts hex string to bytes', () => {
    const bytes = hexToBytes('deadbeef')
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  it('handles empty string', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array([]))
  })
})

describe('bytesToHex', () => {
  it('converts bytes to hex string', () => {
    const hex = bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    expect(hex).toBe('deadbeef')
  })

  it('pads single digit bytes', () => {
    const hex = bytesToHex(new Uint8Array([0x0a, 0x00, 0xff]))
    expect(hex).toBe('0a00ff')
  })
})

describe('verifyPreimage', () => {
  it('returns true for valid preimage', async () => {
    // sha256 of 32 zero bytes
    const preimage = '0000000000000000000000000000000000000000000000000000000000000000'
    // sha256('0x00...00') = 66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925
    const hash = '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925'
    expect(await verifyPreimage(preimage, hash)).toBe(true)
  })

  it('returns false for invalid preimage', async () => {
    const preimage = '0000000000000000000000000000000000000000000000000000000000000001'
    const hash = '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925'
    expect(await verifyPreimage(preimage, hash)).toBe(false)
  })

  it('is case-insensitive for payment hash', async () => {
    const preimage = '0000000000000000000000000000000000000000000000000000000000000000'
    const hash = '66687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925'
    expect(await verifyPreimage(preimage, hash)).toBe(true)
  })
})
