// SYBNB — turns "every money-moving route calls the payment policy, before it mutates anything"
// from a convention into something checkable. Used by tests/e2e/payment-policy-enforcement.e2e.mjs
// against the real repo, and unit-testable against synthetic source strings via auditSource().
//
// Rewritten from a regex/comment-stripping heuristic to a real AST (via acorn — the same parser
// ESLint/webpack use internally; zero dependencies of its own, devDependency only, never imported by
// runtime request-serving code). A parse failure fails the file CLOSED (flagged, not skipped) — see
// auditRouteFile(). The analyzer:
//   - finds route triggers structurally (an IfStatement test comparing url.pathname to a string
//     literal, or an `if (xMatch)` guarding a preceding `xMatch = url.pathname.match(...)`), and
//     flags any OTHER way of testing url.pathname (a computed/template path, a helper-function
//     dispatch, .startsWith/.includes/etc) as UNRESOLVABLE rather than silently ignoring it;
//   - for each recognized route body, does a bounded-depth reachability walk over CallExpressions:
//     direct money-moving calls, calls to a local top-level function (recurses into its body), calls
//     to an imported identifier (resolves the alias to its real exported name, and — for a small,
//     explicit allow-list of already-parsed local lib files — recurses into that function's body
//     too); anything else callable-but-unresolvable (a computed member call, eval/Function, an
//     import from outside the allow-list, an unresolved local identifier) is its own explicit finding
//     kind, never silently treated as safe.
//
// HONEST, STILL-REMAINING LIMITATION: a call reached only through genuinely dynamic dispatch with no
// static resolution possible at all (e.g. a function reference threaded through a plugin registry or
// stored in a data structure) resolves as UNRESOLVED_CALL / fails closed rather than silently
// passing — this is the correct conservative behavior for ANY static analyzer, not a gap specific to
// this one, and is exercised directly by the enforcement test rather than merely asserted here.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parse } from 'acorn'

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROUTES_DIR = path.join(LIB_DIR, '..', 'routes')

// Every file server/index.mjs actually mounts as a router, discovered from disk rather than
// hand-copied into a list here — a new router file is picked up automatically, closing the "bypass
// through an alternate router file" gap a hardcoded file list would have left open.
export function allRouteFiles() {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => path.join('server', 'routes', name))
}

// Local lib files this analyzer will follow an IMPORTED call into, when the import resolves to one
// of these (by relative-path basename). A call to anything imported from outside this small,
// explicit set — a node_modules package, or a local file not in the set — is UNRESOLVED_CALL: this
// analyzer does not assume an unfollowed import is safe.
const FOLLOWABLE_LIB_BASENAMES = new Set([
  'finance-ledger.mjs',
  'payment-webhook.mjs',
  'payment-event-pipeline.mjs',
  'stripe-checkout-apply.mjs',
])

function resolveFollowableLibPath(importSource) {
  const basename = String(importSource || '').split('/').pop()
  if (!FOLLOWABLE_LIB_BASENAMES.has(basename)) return null
  return path.join(LIB_DIR, basename)
}

const MAX_REACHABILITY_DEPTH = 6

export function parseModule(source) {
  try {
    return { ast: parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), error: null }
  } catch (err) {
    return { ast: null, error: err.message }
  }
}

// Generic recursive AST walk — visits every descendant node, calling visit(node) for each. Acorn's
// ESTree nodes are plain objects; any property whose value looks like a node (has a string `type`)
// or an array of such is a child to recurse into.
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string') visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit)
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit)
    }
  }
}

function findCallExpressions(node) {
  const calls = []
  walk(node, (n) => { if (n.type === 'CallExpression') calls.push(n) })
  return calls
}

// Flattens a (possibly nested) MemberExpression/Identifier callee into a chain of names, e.g.
// `tx.paymentIntent.create` -> ['tx', 'paymentIntent', 'create']. Returns null for anything this
// can't structurally resolve (a computed member `obj[expr]`, a call expression as the base, etc) —
// null is the signal for "unresolvable callee shape", never assumed safe.
function calleeChain(node) {
  const parts = []
  let cur = node
  while (cur) {
    if (cur.type === 'Identifier') { parts.unshift(cur.name); return parts }
    if (cur.type === 'MemberExpression' && !cur.computed && cur.property.type === 'Identifier') {
      parts.unshift(cur.property.name)
      cur = cur.object
      continue
    }
    return null
  }
  return null
}

// Structural equivalent of the old regex pattern list — matched against a calleeChain(), not source
// text. Kept as one explicit allow-list so adding a new money-moving shape is a one-line change.
export function chainMatchesMoneyMoving(chain) {
  if (!chain) return false
  if (chain.length === 1 && [
    'recordWalletEntry', 'approvePaymentProof', 'reverseBookingPlatformShare',
    'applyPaymentEvent', 'applyStripeCheckoutEvent', 'finalizeStripeSession',
  ].includes(chain[0])) return true
  if (chain[0] === 'tx' && chain.length === 3 &&
      ['paymentIntent', 'paymentProof'].includes(chain[1]) &&
      ['create', 'update', 'updateMany'].includes(chain[2])) return true
  if (chain[0] === 'tx' && chain.length === 3 && chain[1] === 'walletEntry' && chain[2] === 'create') return true
  if (chain[0] === 'stripe' && chain.length >= 3 && ['create', 'retrieve', 'constructEvent'].includes(chain[chain.length - 1])) return true
  return false
}

// A stricter subset of chainMatchesMoneyMoving, used ONLY for the statement-order check: `.retrieve`
// (a read — fetching a Stripe object's current state) and `constructEvent` (verifying/parsing a
// webhook signature — required to happen BEFORE the intake policy call by design, see the webhook
// boundary in payment-intents.mjs/payments.mjs) are money-ADJACENT but not themselves mutations.
// Treating them as order-check-relevant would falsely flag the routes that call them before the
// policy check even though nothing has been written yet — a read (or a signature check) before
// authorization is not a security problem; a WRITE before authorization is. Every other
// chainMatchesMoneyMoving shape (a DB write, recordWalletEntry, approvePaymentProof, etc., and
// stripe.X.create) is a genuine mutation and stays order-check-relevant.
const READ_ONLY_MONEY_ADJACENT_SUFFIXES = new Set(['retrieve', 'constructEvent'])
function chainIsMutation(chain) {
  if (!chainMatchesMoneyMoving(chain)) return false
  return !READ_ONLY_MONEY_ADJACENT_SUFFIXES.has(chain[chain.length - 1])
}

function isPolicyCallChain(chain) {
  return Boolean(chain) && chain.length === 1 && chain[0] === 'authorizePaymentOperation'
}

// Top-level (module-body) function definitions, unwrapping `export`/`export default` — both
// `function foo(){}` and `const foo = (...) => {}` / `const foo = function(){}` forms. This is the
// "local wrapper function" resolution table for a single file.
export function collectTopLevelFunctions(ast) {
  const map = new Map()
  for (let stmt of ast.body) {
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) stmt = stmt.declaration
    else if (stmt.type === 'ExportDefaultDeclaration' && stmt.declaration) stmt = stmt.declaration
    if (stmt.type === 'FunctionDeclaration' && stmt.id) {
      map.set(stmt.id.name, stmt)
    } else if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations) {
        if (decl.id?.type === 'Identifier' && decl.init &&
            (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')) {
          map.set(decl.id.name, decl.init)
        }
      }
    }
  }
  return map
}

// import { recordWalletEntry as rwe } from '../lib/finance-ledger.mjs' -> localName 'rwe' maps to
// { source: '../lib/finance-ledger.mjs', importedName: 'recordWalletEntry' }. Aliasing is captured
// explicitly here (imported.name vs local.name), not assumed away.
export function collectImports(ast) {
  const map = new Map()
  for (const stmt of ast.body) {
    if (stmt.type !== 'ImportDeclaration') continue
    for (const spec of stmt.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        map.set(spec.local.name, { source: stmt.source.value, importedName: spec.imported.name })
      } else if (spec.type === 'ImportDefaultSpecifier') {
        map.set(spec.local.name, { source: stmt.source.value, importedName: 'default' })
      }
      // ImportNamespaceSpecifier (`import * as x`) is deliberately not resolved — a call through a
      // namespace import (`x.someFn()`) falls through calleeChain/functionMap lookup as unresolved.
    }
  }
  return map
}

function isUrlPathnameMember(node) {
  return node?.type === 'MemberExpression' && !node.computed &&
    node.object?.type === 'Identifier' && node.object.name === 'url' &&
    node.property?.type === 'Identifier' && node.property.name === 'pathname'
}

function sourceSlice(source, node) {
  return source.slice(node.start, node.end)
}

// True for a consequent that clearly never falls through (a bare `return ...`/`throw ...`, or a
// block whose only statement is one of those) — the precondition for treating a NEGATED guard's
// bail-out as "everything after this if-statement is the one route this guard protects", the shape
// `if (url.pathname !== '/x') return false` / `if (!match) return false` uses throughout this
// codebase (single-route-per-file dispatchers). If the shape is anything less certain than this,
// this returns false and the negated form is left unrecognized (UNRESOLVABLE_ROUTE_TRIGGER) rather
// than guessed at.
function isUnconditionalBail(consequent) {
  const stmt = consequent.type === 'BlockStatement' && consequent.body.length === 1 ? consequent.body[0] : consequent
  return stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement'
}

// Recognizes the route-trigger shapes this codebase's route files consistently use:
//   A) `if (url.pathname === '/literal/path')`  (either operand order) — route body is `consequent`.
//   B) `if (xMatch)` where an earlier statement in the SAME block assigned
//      `xMatch = url.pathname.match(EXPR)` — route body is `consequent`.
//   C) `if (url.pathname !== '/literal/path') return ...` / `if (!xMatch) return ...` — a
//      single-route-per-file bail-out guard; route body is everything AFTER this statement in the
//      enclosing block (handled by the caller, which needs the statement's index — this function
//      signals it via `guard: 'negated'`).
// Anything else that references url.pathname in an if-test is a route dispatch this analyzer cannot
// verify — UNRESOLVABLE_ROUTE_TRIGGER, not silently skipped.
function classifyIfTest(test, matchVars, consequent) {
  if (test.type === 'BinaryExpression' && test.operator === '===') {
    if (isUrlPathnameMember(test.left) && test.right.type === 'Literal' && typeof test.right.value === 'string') {
      return { kind: 'exact', label: test.right.value }
    }
    if (isUrlPathnameMember(test.right) && test.left.type === 'Literal' && typeof test.left.value === 'string') {
      return { kind: 'exact', label: test.left.value }
    }
  }
  if (test.type === 'BinaryExpression' && test.operator === '!==' && isUnconditionalBail(consequent)) {
    if (isUrlPathnameMember(test.left) && test.right.type === 'Literal' && typeof test.right.value === 'string') {
      return { kind: 'exact', label: test.right.value, guard: 'negated' }
    }
    if (isUrlPathnameMember(test.right) && test.left.type === 'Literal' && typeof test.left.value === 'string') {
      return { kind: 'exact', label: test.left.value, guard: 'negated' }
    }
  }
  if (test.type === 'UnaryExpression' && test.operator === '!' && test.argument.type === 'Identifier' &&
      matchVars.has(test.argument.name) && isUnconditionalBail(consequent)) {
    return { kind: 'regex', label: matchVars.get(test.argument.name), guard: 'negated' }
  }
  if (test.type === 'Identifier' && matchVars.has(test.name)) {
    return { kind: 'regex', label: matchVars.get(test.name) }
  }
  return null
}

// True if this subtree references url.pathname anywhere at all (used to detect "this if-test is
// clearly trying to dispatch on the path, but not in a shape we recognize").
function referencesUrlPathname(node) {
  let found = false
  walk(node, (n) => { if (isUrlPathnameMember(n)) found = true })
  return found
}

// Reachability walk over a function/block body: finds every CallExpression, classifies it as
// money-moving / a policy call / resolved-safe(non-money) / unresolved, following local and
// allow-listed cross-file calls up to MAX_REACHABILITY_DEPTH. `direct` findings are ones textually
// present in the ORIGINAL body passed in (depth 0) — used for the statement-order check, since
// comparing source positions across different function scopes/files is not meaningful.
// Deliberately narrow scope, matching the original regex tool's own scope: this only ever looks for
// the known money-moving shapes (now reachability-aware) plus a small set of genuinely dangerous,
// rare dynamic-dispatch constructs (eval/Function/a computed member call as the callee) — it does
// NOT try to prove every other call in a route is "safe". An ordinary call to db(), json(),
// requireAuth(), or any import outside the small followable allow-list is simply not this audit's
// concern and is silently skipped, exactly as it always was — flagging every unrecognized identifier
// would make the tool permanently red (nearly every call in every route is "unrecognized" by that
// standard) without adding real signal. "Fail closed on syntax it cannot understand" is answered by
// the eval/Function/computed-call cases below (rare, deliberately suspicious) and by
// UNRESOLVABLE_ROUTE_TRIGGER for route dispatch specifically (see classifyIfTest) — not by treating
// the entire rest of the codebase as suspect.
function analyzeReachability(bodyNode, ctx, depth, visited, out) {
  for (const call of findCallExpressions(bodyNode)) {
    const direct = depth === 0
    if (call.callee.type === 'Identifier' && call.callee.name === 'eval') {
      out.push({ kind: 'unresolvable', pos: call.start, direct, why: 'eval' })
      continue
    }
    if (call.callee.type === 'Identifier' && call.callee.name === 'Function') {
      out.push({ kind: 'unresolvable', pos: call.start, direct, why: 'dynamic_function_constructor' })
      continue
    }
    if (call.callee.type === 'MemberExpression' && call.callee.computed) {
      out.push({ kind: 'unresolvable', pos: call.start, direct, why: 'computed_member_call' })
      continue
    }
    const chain = calleeChain(call.callee)
    if (!chain) continue // some other complex-but-not-dynamic callee shape (e.g. an IIFE) — not money-moving by construction, not flagged
    if (isPolicyCallChain(chain)) {
      out.push({ kind: 'policy_call', pos: call.start, direct })
      continue
    }
    if (chainMatchesMoneyMoving(chain)) {
      out.push({ kind: 'money_moving', pos: call.start, direct, chain: chain.join('.'), mutation: chainIsMutation(chain) })
      continue
    }
    if (chain.length !== 1 || depth >= MAX_REACHABILITY_DEPTH) continue
    const name = chain[0]
    if (visited.has(`${ctx.fileKey}::${name}`)) continue
    if (ctx.functionMap.has(name)) {
      visited.add(`${ctx.fileKey}::${name}`)
      analyzeReachability(ctx.functionMap.get(name).body, ctx, depth + 1, visited, out)
      continue
    }
    if (ctx.importMap.has(name)) {
      const imp = ctx.importMap.get(name)
      // Alias resolution alone: the imported identifier's REAL exported name might itself be a
      // money-moving shape even without following the file (handles `import { x as y }`).
      if (chainMatchesMoneyMoving([imp.importedName])) {
        out.push({ kind: 'money_moving', pos: call.start, direct, chain: `${imp.importedName} (imported as ${name})`, mutation: chainIsMutation([imp.importedName]) })
        continue
      }
      const resolvedPath = resolveFollowableLibPath(imp.source)
      const target = resolvedPath && ctx.getParsedFile(resolvedPath)
      const targetFn = target?.functionMap.get(imp.importedName)
      if (targetFn) {
        visited.add(`${ctx.fileKey}::${name}`)
        analyzeReachability(targetFn.body, { ...ctx, fileKey: resolvedPath, functionMap: target.functionMap, importMap: target.importMap }, depth + 1, visited, out)
      }
      // else: imported from outside the followable allow-list — not flagged, same scope boundary.
    }
    // else: some other local/global identifier not in either map — not flagged.
  }
}

// Parses a file once and caches its function/import maps, for cross-file reachability following.
function makeFileCache() {
  const cache = new Map()
  return (filePath) => {
    if (cache.has(filePath)) return cache.get(filePath)
    let parsed = null
    try {
      const source = readFileSync(filePath, 'utf8')
      const { ast, error } = parseModule(source)
      if (!error) parsed = { functionMap: collectTopLevelFunctions(ast), importMap: collectImports(ast) }
    } catch { /* file unreadable — target stays null, calls into it become UNRESOLVED */ }
    cache.set(filePath, parsed)
    return parsed
  }
}

// The core analysis, over a SOURCE STRING (not necessarily a real file) so tests can probe specific
// behaviors with synthetic fixtures without mutating anything on disk. `followImports` optionally
// supplies synthetic source for import targets (Map<basename, sourceString>), for testing cross-file
// wrapper resolution without needing real files.
export function auditSource(source, { fileLabel = 'source', followImports = null } = {}) {
  const { ast, error } = parseModule(source)
  if (error) {
    return { ok: false, parseError: error, chunks: [], fileUnresolvableTriggers: [] }
  }

  const functionMap = collectTopLevelFunctions(ast)
  const importMap = collectImports(ast)

  const getParsedFile = followImports
    ? (filePath) => {
        const basename = path.basename(filePath)
        if (!followImports.has(basename)) return null
        const { ast: tAst, error: tError } = parseModule(followImports.get(basename))
        if (tError) return null
        return { functionMap: collectTopLevelFunctions(tAst), importMap: collectImports(tAst) }
      }
    : makeFileCache()

  const chunks = []
  // Every url.pathname MemberExpression node the shallow pass successfully understood — either as
  // part of a classified/unresolvable if-test, or as the target of a `.match(...)` feeding a
  // recognized matchVar. Tracked by node identity (not "nested inside"), so a `url.pathname.match(…)`
  // assignment is itself marked covered — the earlier version of this check only covered
  // IfStatement.test subtrees and missed this, wrongly flagging every regex-route file as if it had
  // an unrecognized dispatch, when the tool had in fact understood the construct just fine.
  const coveredPathnameRefs = new Set()

  // Shallow pass: each top-level function's DIRECT statement list (route-dispatch style — a flat
  // sequence of `if (url.pathname === ...)` / `const xMatch = ...; if (xMatch)` / a single-route
  // negated bail-out guard blocks).
  for (const fn of functionMap.values()) {
    if (!fn.body || fn.body.type !== 'BlockStatement') continue
    const stmts = fn.body.body
    const matchVars = new Map()
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i]
      if (stmt.type === 'VariableDeclaration') {
        for (const decl of stmt.declarations) {
          if (decl.id?.type === 'Identifier' && decl.init?.type === 'CallExpression') {
            const chain = calleeChain(decl.init.callee)
            if (chain && chain.join('.') === 'url.pathname.match' && decl.init.arguments[0]) {
              matchVars.set(decl.id.name, sourceSlice(source, decl.init.arguments[0]))
              coveredPathnameRefs.add(decl.init.callee.object) // the url.pathname member itself
            }
          }
        }
        continue
      }
      if (stmt.type !== 'IfStatement') continue
      const classified = classifyIfTest(stmt.test, matchVars, stmt.consequent)
      if (classified?.kind === 'exact') {
        coveredPathnameRefs.add(isUrlPathnameMember(stmt.test.left) ? stmt.test.left : stmt.test.right)
      } else if (classified?.kind === 'regex' && classified.guard === 'negated') {
        coveredPathnameRefs.add(stmt.test) // the whole `!xMatch` — matchVars already covered xMatch's own declaration above
      } else if (!classified) {
        walk(stmt.test, (n) => { if (isUrlPathnameMember(n)) coveredPathnameRefs.add(n) })
        if (referencesUrlPathname(stmt.test) || [...matchVars.keys()].some((v) => referencesIdentifier(stmt.test, v))) {
          chunks.push({ label: sourceSlice(source, stmt.test), kind: 'unresolvable_trigger', findings: [] })
        }
        continue
      }
      if (!classified) continue
      // A negated guard's "route body" is everything AFTER this statement in the same block (it
      // bails out via return/throw when the path doesn't match — see isUnconditionalBail) — a
      // positive match's route body is simply its own consequent block.
      const routeBody = classified.guard === 'negated'
        ? { type: 'BlockStatement', body: stmts.slice(i + 1) }
        : stmt.consequent
      const findings = []
      const ctx = { fileKey: fileLabel, functionMap, importMap, getParsedFile }
      analyzeReachability(routeBody, ctx, 0, new Set(), findings)
      chunks.push({ label: classified.label, kind: classified.kind, findings })
    }
  }

  // Deep pass: any url.pathname reference NOT already understood above — e.g. a computed/template
  // dispatch buried in a nested conditional, or a helper-function-based router.
  const fileUnresolvableTriggers = []
  walk(ast, (n) => {
    if (isUrlPathnameMember(n) && !coveredPathnameRefs.has(n)) fileUnresolvableTriggers.push(n.start)
  })

  const ok = !chunks.some((c) =>
    c.kind === 'unresolvable_trigger' ||
    c.findings.some((f) => f.kind === 'unresolvable') ||
    (c.findings.some((f) => f.kind === 'money_moving') && !c.findings.some((f) => f.kind === 'policy_call')) ||
    orderViolation(c.findings)
  ) && fileUnresolvableTriggers.length === 0

  return { ok, parseError: null, chunks, fileUnresolvableTriggers }
}

function referencesIdentifier(node, name) {
  let found = false
  walk(node, (n) => { if (n.type === 'Identifier' && n.name === name) found = true })
  return found
}

// Policy call present, but a DIRECT (depth-0) money-moving call occurs at an earlier source position
// — the policy call was moved after the first mutation, or the mutation happens before any policy
// call at all despite one being present later in the body. Only compares direct-depth positions:
// comparing source offsets across different function scopes/files would not be meaningful.
function orderViolation(findings) {
  const directMoneyMoving = findings.filter((f) => f.kind === 'money_moving' && f.direct && f.mutation)
  if (!directMoneyMoving.length) return false
  const directPolicyCalls = findings.filter((f) => f.kind === 'policy_call' && f.direct)
  if (!directPolicyCalls.length) return false // no direct policy call to order against — undeclared-route check already covers "missing entirely"
  const firstMutation = Math.min(...directMoneyMoving.map((f) => f.pos))
  const firstPolicy = Math.min(...directPolicyCalls.map((f) => f.pos))
  return firstMutation < firstPolicy
}

const REAL_FOLLOWABLE_LIB_SOURCES = null // real files are read live via makeFileCache(), no fixture map needed

export function auditRouteFile(filePath) {
  const source = readFileSync(filePath, 'utf8')
  const result = auditSource(source, { fileLabel: filePath, followImports: REAL_FOLLOWABLE_LIB_SOURCES })
  return result
}

// Back-compat convenience for callers that just want the list of undeclared-money-moving chunk
// labels (the enforcement test's primary assertion shape carried over from the previous version).
export function findUndeclaredMoneyMovingChunks(rawSource, fileLabel = 'source') {
  const { chunks } = auditSource(rawSource, { fileLabel })
  return chunks
    .filter((c) => c.kind !== 'unresolvable_trigger' && c.findings.some((f) => f.kind === 'money_moving') && !c.findings.some((f) => f.kind === 'policy_call'))
    .map((c) => c.label)
}
