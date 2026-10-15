export const MSH_CONTRACT = '0x4343d04D4331F54e875007FB725E80f029Cf83d8'
export const MSH_CHAIN = 11155111
export type MshWallet = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>
  on?: (event: string, listener: () => void) => void
  removeListener?: (event: string, listener: () => void) => void
}
export type MshSnapshot = { account: string; balance: string; block: number; checkedAt: string }
export class MshReadError extends Error {
  readonly reason: 'network' | 'account' | 'contract' | 'changed' | 'response'
  constructor(reason: 'network' | 'account' | 'contract' | 'changed' | 'response') { super(reason); this.reason = reason }
}
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value)
function integer(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[\da-f]+$/i.test(value) || value.length > 66) throw new MshReadError('response')
  return BigInt(value)
}
function abiText(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[\da-f]+$/i.test(value) || value.length < 130) throw new MshReadError('response')
  const data = value.slice(2)
  const offset = Number(BigInt('0x' + data.slice(0, 64))) * 2
  if (!Number.isSafeInteger(offset) || offset < 64 || offset + 64 > data.length) throw new MshReadError('response')
  const length = Number(BigInt('0x' + data.slice(offset, offset + 64)))
  if (length > 100 || offset + 64 + length * 2 > data.length) throw new MshReadError('response')
  return new TextDecoder().decode(Uint8Array.from(data.slice(offset + 64, offset + 64 + length * 2).match(/../g) || [], value => parseInt(value, 16)))
}
export function mshBalance(units: bigint): string {
  const whole = (units / 10n ** 18n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = (units % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  return whole + (fraction ? '.' + fraction : '')
}
// This module issues wallet permission and read requests only. No transaction or signing API.
export async function readMsh(wallet: MshWallet, requestAccess = false): Promise<MshSnapshot> {
  const chain = integer(await wallet.request({ method: 'eth_chainId' }))
  if (chain !== BigInt(MSH_CHAIN)) throw new MshReadError('network')
  const accounts = await wallet.request({ method: requestAccess ? 'eth_requestAccounts' : 'eth_accounts' })
  if (!Array.isArray(accounts) || !address(accounts[0])) throw new MshReadError('account')
  const account = accounts[0]
  const block = await wallet.request({ method: 'eth_blockNumber' })
  const blockNumber = Number(integer(block))
  if (!Number.isSafeInteger(blockNumber)) throw new MshReadError('response')
  const code = await wallet.request({ method: 'eth_getCode', params: [MSH_CONTRACT, block] })
  if (typeof code !== 'string' || !/^0x[\da-f]+$/i.test(code) || code.length <= 2) throw new MshReadError('contract')
  const call = (data: string) => wallet.request({ method: 'eth_call', params: [{ to: MSH_CONTRACT, data }, block] })
  const [name, symbol, decimals, supply, balance] = await Promise.all([
    call('0x06fdde03'), call('0x95d89b41'), call('0x313ce567'), call('0x18160ddd'), call('0x70a08231' + account.slice(2).toLowerCase().padStart(64, '0')),
  ])
  if (abiText(name) !== 'MSH Test Token' || abiText(symbol) !== 'MSH' || integer(decimals) !== 18n || integer(supply) !== 1000000n * 10n ** 18n) throw new MshReadError('contract')
  const [finalChain, finalAccounts] = await Promise.all([wallet.request({ method: 'eth_chainId' }), wallet.request({ method: 'eth_accounts' })])
  if (integer(finalChain) !== chain || !Array.isArray(finalAccounts) || finalAccounts[0]?.toLowerCase() !== account.toLowerCase()) throw new MshReadError('changed')
  return { account, balance: mshBalance(integer(balance)), block: blockNumber, checkedAt: new Date().toISOString() }
}
