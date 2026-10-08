import { useEffect, useMemo, useState } from 'react'
import { localeForLang } from '../../../shared/country/presentation'
import type { CSSProperties } from 'react'
import {
  fetchPrototypeAdminAuditLog,
  fetchPrototypeReviewQueue,
  reviewPrototypeQueueEntity,
  type PlatformAdminAuditLog,
  type PlatformReviewQueue,
} from '../../../shared/api/platformApi'
import { moneyText, statusText } from '../../../shared/i18n/display'

import type { Lang } from '../../../engines/language/languageEngine'
type AdminGiftAction = 'allow' | 'block' | 'request_review'

type GiftRecord = {
  id?: string
  senderUserId?: string
  recipientUserId?: string | null
  recipientPhoneHash?: string
  amountMinor?: number
  currency?: string
  message?: string | null
  status?: string
  createdAt?: string
  expiresAt?: string
}

type GiftAdminAuditProps = {
  lang?: Lang
  onAction?: (payload: { action: AdminGiftAction; note: string }) => void
}

const T = {
  ar: {
    title: 'مراجعة هدايا المحفظة',
    ownerOnly: 'للمالك / الإدارة فقط',
    subtitle: 'هدايا عالية القيمة أو مقفلة تظهر هنا من قاعدة البيانات للمراجعة قبل السماح بالمطالبة.',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    empty: 'لا توجد هدايا بانتظار المراجعة.',
    giftRef: 'رقم الهدية',
    sender: 'المرسل',
    recipientHash: 'هاش هاتف المستلم',
    hashNote: 'رقم الهاتف مشفّر ولا يظهر للإدارة كنص صريح.',
    amount: 'المبلغ',
    status: 'الحالة',
    message: 'الرسالة',
    created: 'تاريخ الإنشاء',
    expires: 'ينتهي في',
    timeline: 'سجل تدقيق الهدايا',
    note: 'ملاحظة الإدارة',
    notePlaceholder: 'اكتب سبب القرار قبل أي إجراء حساس...',
    allow: 'السماح بالهدية',
    block: 'حظر الهدية',
    requestReview: 'تركها للمراجعة',
    noteRequired: 'الملاحظة مطلوبة للحظر.',
    actionDone: 'تم تسجيل القرار.',
    error: 'تعذر تنفيذ مراجعة الهدية.',
  },
  en: {
    title: 'Gift Wallet Review',
    ownerOnly: 'Owner / admin only',
    subtitle: 'High-value or locked gifts appear here from the database before they can be claimed.',
    refresh: 'Refresh',
    loading: 'Loading',
    empty: 'No gifts are waiting for review.',
    giftRef: 'Gift reference',
    sender: 'Sender',
    recipientHash: 'Recipient phone hash',
    hashNote: 'Phone is hashed and never shown to admin as plain text.',
    amount: 'Amount',
    status: 'Status',
    message: 'Message',
    created: 'Created',
    expires: 'Expires',
    timeline: 'Gift audit timeline',
    note: 'Admin note',
    notePlaceholder: 'Write the reason before any sensitive action...',
    allow: 'Allow gift',
    block: 'Block gift',
    requestReview: 'Keep in review',
    noteRequired: 'A note is required to block a gift.',
    actionDone: 'Decision recorded.',
    error: 'Gift review action failed.',
  },
  fr: {
    title: 'Vérification des cadeaux du portefeuille',
    ownerOnly: 'Propriétaire / administration uniquement',
    subtitle: 'Les cadeaux de valeur élevée ou verrouillés apparaissent ici depuis la base de données avant de pouvoir être réclamés.',
    refresh: 'Actualiser',
    loading: 'Chargement',
    empty: 'Aucun cadeau en attente de vérification.',
    giftRef: 'Référence du cadeau',
    sender: 'Expéditeur',
    recipientHash: 'Empreinte du téléphone du destinataire',
    hashNote: 'Le numéro de téléphone est haché et n’est jamais affiché en clair à l’administration.',
    amount: 'Montant',
    status: 'Statut',
    message: 'Message',
    created: 'Créé le',
    expires: 'Expire le',
    timeline: 'Journal d’audit des cadeaux',
    note: 'Note de l’administration',
    notePlaceholder: 'Indiquez la raison avant toute action sensible...',
    allow: 'Autoriser le cadeau',
    block: 'Bloquer le cadeau',
    requestReview: 'Laisser en vérification',
    noteRequired: 'Une note est requise pour bloquer un cadeau.',
    actionDone: 'Décision enregistrée.',
    error: 'Échec de l’action de vérification du cadeau.',
  },
}

export function GiftAdminAudit({ lang = 'ar', onAction }: GiftAdminAuditProps) {
  const [queue, setQueue] = useState<PlatformReviewQueue | null>(null)
  const [auditLog, setAuditLog] = useState<PlatformAdminAuditLog[]>([])
  const [selectedGiftId, setSelectedGiftId] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle')
  const [notice, setNotice] = useState('')
  const isAr = lang === 'ar'
  const t = T[lang]
  const gifts = useMemo(() => (queue?.gifts || []) as GiftRecord[], [queue])
  const selectedGift = gifts.find((gift) => gift.id === selectedGiftId) || gifts[0] || null
  const giftAudit = auditLog.filter((item) => item.entityType === 'gifts' || item.entityType === 'gift')

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    setStatus('loading')
    setNotice('')

    try {
      const [nextQueue, nextAuditLog] = await Promise.all([
        fetchPrototypeReviewQueue(),
        fetchPrototypeAdminAuditLog(25),
      ])
      setQueue(nextQueue)
      setAuditLog(nextAuditLog)
      setSelectedGiftId((current) => current || String((nextQueue.gifts[0] as GiftRecord | undefined)?.id || ''))
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setNotice(error instanceof Error ? error.message : t.error)
    }
  }

  async function submit(action: AdminGiftAction) {
    if (action === 'block' && !note.trim()) {
      setStatus('error')
      setNotice(t.noteRequired)
      return
    }

    if (!selectedGift?.id || action === 'request_review') {
      onAction?.({ action, note })
      setStatus('idle')
      setNotice(t.actionDone)
      return
    }

    setStatus('saving')
    setNotice('')

    try {
      await reviewPrototypeQueueEntity('gifts', selectedGift.id, action === 'allow' ? 'APPROVE' : 'REJECT', note)
      onAction?.({ action, note })
      setNote('')
      setNotice(t.actionDone)
      await refresh()
    } catch (error) {
      setStatus('error')
      setNotice(error instanceof Error ? error.message : t.error)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <span style={styles.badge}>{t.ownerOnly}</span>
            <h1 style={styles.title}>{t.title}</h1>
            <p style={styles.copy}>{t.subtitle}</p>
          </div>
          <button disabled={status === 'loading' || status === 'saving'} onClick={() => void refresh()} style={styles.secondaryButton}>
            {status === 'loading' ? t.loading : t.refresh}
          </button>
        </header>

        {notice && <div style={{ ...styles.notice, ...(status === 'error' ? styles.error : {}) }}>{notice}</div>}

        <section className="gift-admin-audit-grid" style={styles.grid}>
          <article style={styles.card}>
            <h2 style={styles.cardTitle}>{t.title}</h2>
            {gifts.length ? (
              <div style={styles.stack}>
                {gifts.map((gift) => (
                  <button
                    key={gift.id}
                    onClick={() => setSelectedGiftId(String(gift.id || ''))}
                    style={{
                      ...styles.giftButton,
                      ...(selectedGift?.id === gift.id ? styles.giftButtonActive : {}),
                    }}
                  >
                    <strong dir="ltr">{shortId(gift.id)}</strong>
                    <span dir={isAr ? 'rtl' : 'ltr'}>{moneyText(gift.amountMinor || 0, gift.currency || 'SYP', lang)}</span>
                    <small>{statusText(gift.status, lang)}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p style={styles.empty}>{status === 'loading' ? t.loading : t.empty}</p>
            )}
          </article>

          <article style={styles.card}>
            {selectedGift ? (
              <>
                <div style={styles.infoGrid}>
                  <Info label={t.giftRef} value={shortId(selectedGift.id)} />
                  <Info label={t.sender} value={shortId(selectedGift.senderUserId)} />
                  <Info label={t.amount} value={moneyText(selectedGift.amountMinor || 0, selectedGift.currency || 'SYP', lang)} dir={isAr ? 'rtl' : 'ltr'} />
                  <Info label={t.status} value={statusText(selectedGift.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
                  <Info label={t.created} value={formatDate(selectedGift.createdAt, lang)} />
                  <Info label={t.expires} value={formatDate(selectedGift.expiresAt, lang)} />
                </div>
                <div style={styles.hashBox}>
                  <span>{t.recipientHash}</span>
                  <strong dir="ltr">{selectedGift.recipientPhoneHash || '-'}</strong>
                  <small>{t.hashNote}</small>
                </div>
                {selectedGift.message && (
                  <div style={styles.hashBox}>
                    <span>{t.message}</span>
                    <strong>{selectedGift.message}</strong>
                  </div>
                )}

                <label style={styles.label}>{t.note}</label>
                <textarea
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t.notePlaceholder}
                  style={styles.textarea}
                  value={note}
                />
                <div style={styles.actions}>
                  <button disabled={status === 'saving'} onClick={() => void submit('allow')} style={styles.allowButton}>
                    {t.allow}
                  </button>
                  <button disabled={status === 'saving'} onClick={() => void submit('block')} style={styles.blockButton}>
                    {t.block}
                  </button>
                  <button disabled={status === 'saving'} onClick={() => void submit('request_review')} style={styles.secondaryButton}>
                    {t.requestReview}
                  </button>
                </div>
              </>
            ) : (
              <p style={styles.empty}>{t.empty}</p>
            )}
          </article>
        </section>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>{t.timeline}</h2>
          {giftAudit.length ? (
            <div style={styles.stack}>
              {giftAudit.map((item) => (
                <div key={item.id} style={styles.auditRow}>
                  <strong>{item.action}</strong>
                  <span dir="ltr">{shortId(item.entityId)}</span>
                  <small>{formatDate(item.createdAt, lang)}</small>
                </div>
              ))}
            </div>
          ) : (
            <p style={styles.empty}>{t.empty}</p>
          )}
        </section>
      </section>
    </main>
  )
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div style={styles.info}>
      <span>{label}</span>
      <strong dir={dir}>{value}</strong>
    </div>
  )
}

function shortId(value?: string | null) {
  if (!value) return '-'
  if (value.length <= 12) return value
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

function formatDate(value?: string | null, lang: Lang = 'ar') {
  if (!value) return '-'
  return new Date(value).toLocaleString(localeForLang(lang))
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#f7f7fb', padding: '24px 16px 90px' },
  shell: { display: 'grid', gap: 14, margin: '0 auto', maxWidth: 1080 },
  header: { alignItems: 'center', display: 'flex', gap: 14, justifyContent: 'space-between' },
  badge: { alignItems: 'center', background: 'rgba(213,169,21,.12)', border: '1px solid rgba(213,169,21,.35)', borderRadius: 8, color: '#d5a915', display: 'inline-flex', fontWeight: 900, minHeight: 34, padding: '0 10px' },
  title: { fontSize: 38, lineHeight: 1.08, margin: '10px 0 8px' },
  copy: { color: '#9aa6ba', lineHeight: 1.6, margin: 0, maxWidth: 680 },
  notice: { background: 'rgba(32,210,155,.1)', border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, color: '#b7ffe8', padding: 14 },
  error: { background: 'rgba(255,96,96,.1)', borderColor: 'rgba(255,96,96,.45)', color: '#ffd1d1' },
  grid: { display: 'grid', gap: 14, gridTemplateColumns: 'minmax(280px, .8fr) minmax(320px, 1.2fr)' },
  card: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 8, display: 'grid', gap: 12, padding: 14 },
  cardTitle: { fontSize: 22, margin: 0 },
  stack: { display: 'grid', gap: 8 },
  giftButton: { background: '#0c1220', border: '1px solid #30384d', borderRadius: 8, color: '#f7f7fb', display: 'grid', gap: 4, minHeight: 76, padding: 12, textAlign: 'start' },
  giftButtonActive: { borderColor: '#d5a915', boxShadow: '0 0 0 1px rgba(213,169,21,.28)' },
  empty: { color: '#9aa6ba', margin: 0 },
  infoGrid: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' },
  info: { background: '#0c1220', border: '1px solid #30384d', borderRadius: 8, display: 'grid', gap: 6, padding: 12 },
  hashBox: { background: '#0c1220', border: '1px solid #30384d', borderRadius: 8, display: 'grid', gap: 7, padding: 12 },
  label: { color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  textarea: { background: '#0c1220', border: '1px solid #30384d', borderRadius: 8, boxSizing: 'border-box', color: '#fff', font: 'inherit', minHeight: 104, padding: 12, width: '100%' },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' },
  allowButton: { background: 'rgba(32,210,155,.15)', border: '1px solid rgba(32,210,155,.55)', borderRadius: 8, color: '#20d29b', fontWeight: 900, minHeight: 50, padding: '0 14px' },
  blockButton: { background: 'rgba(255,95,118,.13)', border: '1px solid rgba(255,95,118,.55)', borderRadius: 8, color: '#ff8da0', fontWeight: 900, minHeight: 50, padding: '0 14px' },
  secondaryButton: { background: '#171b29', border: '1px solid #30384d', borderRadius: 8, color: '#fff', fontWeight: 900, minHeight: 50, padding: '0 14px' },
  auditRow: { alignItems: 'center', background: '#0c1220', border: '1px solid #30384d', borderRadius: 8, display: 'grid', gap: 8, gridTemplateColumns: '1fr auto auto', padding: 12 },
}

export default GiftAdminAudit
