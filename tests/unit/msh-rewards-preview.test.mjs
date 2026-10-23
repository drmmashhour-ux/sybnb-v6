import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activityPreview, readRewardsActivity } from '../../server/lib/msh-rewards-preview.mjs'
import { calculateRewardsDraft } from '../../src/modules/msh/mshRewardsDraft.ts'
const user = 'account-a'
const payment = (patch={}) => ({ status:'APPROVED', currency:'XXX', amountMinor:50, reservedRefundMinor:0, succeededRefundMinor:0, acceptedRefundMinor:0, ...patch })
const stay = (patch={}) => ({ id:'s1', guestId:user, status:'COMPLETED', amountMinor:50, currency:'XXX', payments:[payment()], ...patch })
const ride = (patch={}) => ({ id:'r1', riderId:user, status:'COMPLETED', fareMinor:50, currency:'XXX', paymentProofs:[payment()], ...patch })
test('preview scopes to owner/completed state, deduplicates and never issues or redeems',()=>{
 const a=activityPreview(user,[stay(),stay(),stay({id:'foreign',guestId:'other'}),stay({id:'cancelled',status:'CANCELLED'})],[ride(),ride({id:'pending',status:'IN_PROGRESS'})])
 assert.equal(a.entries.length,2);assert.equal(a.enabled,false);assert.equal(a.rule,null);assert.equal(a.issuedTokens,0);assert.equal(a.redeemableTokens,0)
 assert.deepEqual(calculateRewardsDraft(a,'2','1'),{tokens:3,eligible:2,held:0})
 assert.deepEqual(activityPreview(user,[stay()],[ride()]),activityPreview(user,[stay()],[ride()]))
})
test('full approved same-currency payment is required; free/unknown amounts are held',()=>{
 for(const patch of [{payments:[]},{payments:[payment({status:'PENDING_ADMIN_REVIEW'})]},{payments:[payment({currency:'OTHER'})]},{payments:[payment({amountMinor:49})]},{amountMinor:0},{amountMinor:null}]) assert.equal(activityPreview(user,[stay(patch)],[]).entries[0].eligibility,'payment')
 assert.equal(activityPreview(user,[stay({payments:[payment({amountMinor:25}),payment({amountMinor:25})]})],[]).entries[0].eligibility,'eligible')
})
test('pending, succeeded, accepted and historical refunded proofs all hold the reward',()=>{
 for(const patch of [{reservedRefundMinor:1},{succeededRefundMinor:1},{acceptedRefundMinor:1},{status:'REFUNDED'}]) {
  const a=activityPreview(user,[stay({payments:[payment(),payment(patch)]})],[ride({paymentProofs:[payment(patch)]})]);assert.ok(a.entries.every(e=>e.eligibility==='refund'));assert.equal(calculateRewardsDraft(a,'100','100').tokens,0)
 }
})
test('draft rules reject empty, fractional, negative, excessive, exponent and all-zero input',()=>{
 const a=activityPreview(user,[stay()],[ride()])
 for(const rate of ['','-1','1.1','101','1e2',' 1','01']) assert.throws(()=>calculateRewardsDraft(a,rate,'1'))
 assert.throws(()=>calculateRewardsDraft(a,'0','0'))
 assert.equal(calculateRewardsDraft(a,'0','100').tokens,100)
})
test('bounded preview reports truncation and is not a lifetime total',()=>{
 const a=activityPreview(user,Array.from({length:101},(_,i)=>stay({id:String(i)})),[])
 assert.equal(a.truncated,true);assert.equal(a.entries.length,100)
})
test('database adapter restricts both queries to authenticated account and uses read-only consistent snapshot',async()=>{
 const queries=[]
 const tx={booking:{findMany:async q=>{queries.push(q);return[stay()]}},rideRequest:{findMany:async q=>{queries.push(q);return[ride()]}}}
 const database={$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');return fn(tx)}}
 const a=await readRewardsActivity(database,user)
 assert.deepEqual(queries.map(q=>q.where),[{guestId:user,status:'COMPLETED'},{riderId:user,status:'COMPLETED'}])
 assert.ok(queries.every(q=>q.take===101));assert.equal(a.entries.length,2)
 await assert.rejects(readRewardsActivity(database,''));assert.throws(()=>activityPreview('',[],[]))
})
test('real me route denies anonymous GET and mutation methods before database access',async()=>{
 const {handleMe}=await import('../../server/routes/me.mjs')
 const url=new URL('http://localhost/api/me/msh-rewards-preview?userId=other')
 const response={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}}
 await assert.rejects(handleMe({method:'GET'},response,url,{}),{code:'AUTH_REQUIRED',statusCode:401})
 await handleMe({method:'POST'},response,url,{user:{id:user}})
 assert.equal(response.status,405);assert.equal(response.headers.allow,'GET')
})
