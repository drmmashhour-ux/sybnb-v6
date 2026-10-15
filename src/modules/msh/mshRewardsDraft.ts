export type MshRewardActivity = {
  mode: 'draft'; enabled: false; issuedTokens: 0; redeemableTokens: 0; rule: null
  limitPerService: number; truncated: boolean
  entries: { reference: string; kind: 'stay' | 'ride'; eligibility: 'eligible' | 'payment' | 'refund' }[]
}
export function calculateRewardsDraft(activity: MshRewardActivity, stay: string, ride: string) {
  const parse = (text: string) => {
    if (!/^(0|[1-9]\d{0,2})$/.test(text) || Number(text) > 100) throw new Error('RULE_INVALID')
    return Number(text)
  }
  const stayRate = parse(stay), rideRate = parse(ride)
  if (stayRate === 0 && rideRate === 0) throw new Error('RULE_INVALID')
  const eligible = activity.entries.filter(e => e.eligibility === 'eligible')
  return { tokens: eligible.reduce((sum, e) => sum + (e.kind === 'stay' ? stayRate : rideRate), 0), eligible: eligible.length, held: activity.entries.length - eligible.length }
}
