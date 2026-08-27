import { useEffect, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import {
  claimPrototypeWalletGift,
  fetchPrototypeWalletGift,
  type PlatformWallet,
  type PlatformWalletGift,
} from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'
import {
  GiftAdminAudit,
  GiftCodeVerify,
  GiftErrorStates,
  GiftRecipientLanding,
  GiftRedeemedSuccess,
} from './gift-flow'
export { isGiftFlowRoute } from './giftRoutes'

type GiftFlowRoutesProps = {
  lang: Lang
  path: string
}

type ClaimResult = {
  gift: PlatformWalletGift
  wallet: PlatformWallet
}

export function GiftFlowRoutes({ lang, path }: GiftFlowRoutesProps) {
  const claimMatch = path.match(/^\/wallet\/gift\/claim(?:\/([^/]+))?$/)
  const codeMatch = path.match(/^\/wallet\/gift\/code(?:\/([^/]+))?$/)
  const giftId = claimMatch?.[1] || codeMatch?.[1] || ''
  const [phone, setPhone] = useState('+963900000001')
  const [giftPreview, setGiftPreview] = useState<PlatformWalletGift | null>(null)
  const [giftPreviewFailed, setGiftPreviewFailed] = useState(false)
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null)

  useEffect(() => {
    setGiftPreview(null)
    setGiftPreviewFailed(false)
    if (!giftId) return
    void fetchPrototypeWalletGift(giftId)
      .then(setGiftPreview)
      .catch(() => setGiftPreviewFailed(true))
  }, [giftId])

  if (codeMatch) {
    return (
      <GiftCodeVerify
        lang={lang}
        phoneMasked={maskPhone(phone)}
        onBack={() => navigate(giftId ? `/wallet/gift/claim/${giftId}` : '/wallet/gift/claim')}
        onVerified={(code) => {
          return finishGiftClaim(giftId, phone, code, setClaimResult)
        }}
      />
    )
  }

  if (path === '/wallet/gift/success') {
    return (
      <GiftRedeemedSuccess
        lang={lang}
        amount={claimResult ? moneyText(claimResult.gift.amountMinor, claimResult.gift.currency, lang) : undefined}
        balance={claimResult ? moneyText(claimResult.wallet.cachedBalanceMinor, claimResult.wallet.currency, lang) : undefined}
        reference={claimResult ? claimResult.gift.id.slice(0, 8).toUpperCase() : undefined}
        onWallet={() => navigate('/wallet')}
        onRide={() => navigate('/ride')}
        onBrowse={() => navigate('/')}
      />
    )
  }

  if (path === '/wallet/gift/error') {
    return (
      <GiftErrorStates
        lang={lang}
        onPrimary={() => navigate('/wallet/gift/claim')}
        onSupport={() => navigate('/immocontact')}
      />
    )
  }

  if (path === '/wallet/admin/gift-audit') {
    return <GiftAdminAudit lang={lang} />
  }

  // No gift id in the URL, or the lookup failed (bad/expired link) — show the real "not found" state
  // instead of rendering the claim form with no data. GiftRecipientLanding has no honest fallback for
  // a missing sender/amount, so it must never be reached without a real, fetched gift.
  if (!giftId || giftPreviewFailed) {
    return (
      <GiftErrorStates
        lang={lang}
        initialState="not_found"
        onPrimary={() => navigate('/wallet/gift/claim')}
        onSupport={() => navigate('/immocontact')}
      />
    )
  }

  if (!giftPreview) return null

  return (
    <GiftRecipientLanding
      lang={lang}
      amount={moneyText(giftPreview.amountMinor, giftPreview.currency, lang)}
      senderName={giftPreview.sender?.displayName}
      codeLast4={giftPreview.id.slice(-4).toUpperCase()}
      onContinue={({ phone: nextPhone }) => {
        setPhone(nextPhone)
        navigate(`/wallet/gift/code/${giftId}`)
      }}
    />
  )
}

async function finishGiftClaim(
  giftId: string,
  phone: string,
  code: string,
  setClaimResult: (result: ClaimResult | null) => void,
): Promise<true | { code?: string; message?: string }> {
  if (!giftId) {
    // Never fabricate a claim success with no real gift ID / no API call — reroute to the claim
    // entry screen instead of a fake "redeemed" confirmation.
    navigate('/wallet/gift/claim')
    return { code: 'GIFT_NOT_FOUND' }
  }

  try {
    const result = await claimPrototypeWalletGift(giftId, phone, code)
    setClaimResult({ gift: result.gift, wallet: result.wallet })
    navigate('/wallet/gift/success')
    return true
  } catch (error) {
    const err = error as (Error & { code?: string }) | undefined
    return { code: err?.code, message: err?.message }
  }
}

function maskPhone(phone: string) {
  const trimmed = phone.trim()
  if (trimmed.length <= 6) return trimmed || '+963 9•• ••• •••'
  return `${trimmed.slice(0, 6)}•••${trimmed.slice(-2)}`
}
