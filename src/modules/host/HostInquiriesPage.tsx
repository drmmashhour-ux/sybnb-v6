import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchHostInquiries,
  sendListingInquiryMessageAsOwner,
  type HostDashboardMode,
  type PlatformHostInquiryThread,
} from '../../shared/api/platformApi'
import { listingTitleText, moneyText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
  mode?: HostDashboardMode
}

const copy = {
  ar: {
    back: 'العودة للوحة الاستضافة',
    title: 'رسائل العملاء',
    subtitle: 'كل محادثة هنا مرتبطة بإعلان حقيقي وعميل حقيقي، ومحفوظة في قاعدة البيانات.',
    loading: 'جار التحميل...',
    error: 'تعذر تحميل الرسائل.',
    empty: 'لا توجد رسائل بعد.',
    noSelection: 'اختر محادثة لعرضها.',
    replyPlaceholder: 'اكتب ردك هنا...',
    send: 'إرسال',
    sending: 'جارٍ الإرسال...',
    noMessages: 'لا توجد رسائل في هذه المحادثة بعد.',
  },
  en: {
    back: 'Back to host dashboard',
    title: 'Client messages',
    subtitle: 'Every conversation here is tied to a real listing and a real client, and stored in the database.',
    loading: 'Loading...',
    error: 'Could not load messages.',
    empty: 'No messages yet.',
    noSelection: 'Choose a conversation to view it.',
    replyPlaceholder: 'Write your reply...',
    send: 'Send',
    sending: 'Sending...',
    noMessages: 'No messages in this conversation yet.',
  },
  fr: {
    back: 'Retour au tableau de bord hôte',
    title: 'Messages des clients',
    subtitle: 'Chaque conversation ici est liée à une annonce réelle et à un client réel, et enregistrée dans la base de données.',
    loading: 'Chargement...',
    error: 'Impossible de charger les messages.',
    empty: 'Aucun message pour le moment.',
    noSelection: 'Choisissez une conversation pour l’afficher.',
    replyPlaceholder: 'Rédigez votre réponse...',
    send: 'Envoyer',
    sending: 'Envoi...',
    noMessages: 'Aucun message dans cette conversation pour le moment.',
  },
}

export function HostInquiriesPage({ lang, mode = 'host' }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [threads, setThreads] = useState<PlatformHostInquiryThread[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [activeThreadId, setActiveThreadId] = useState('')
  const [replyInput, setReplyInput] = useState('')
  const [sendState, setSendState] = useState<'idle' | 'saving' | 'error'>('idle')

  useEffect(() => {
    void loadThreads()
  }, [])

  async function loadThreads(preserveSelection = false) {
    if (!preserveSelection) setStatus('loading')
    try {
      const result = await fetchHostInquiries(mode)
      setThreads(result)
      if (!preserveSelection && result.length) setActiveThreadId(result[0].id)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  const activeThread = threads.find((thread) => thread.id === activeThreadId)

  async function sendReply() {
    if (!activeThread?.listingId || !activeThread.guestId || !replyInput.trim()) return
    setSendState('saving')
    try {
      await sendListingInquiryMessageAsOwner(activeThread.listingId, activeThread.guestId, replyInput.trim(), mode)
      setReplyInput('')
      setSendState('idle')
      await loadThreads(true)
    } catch (error) {
      setSendState('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/host')}>
        {t.back}
      </button>
      <section style={styles.hero}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
      </section>

      {status === 'loading' && <p style={styles.body}>{t.loading}</p>}
      {status === 'error' && <p style={styles.alert}>{message}</p>}

      {status === 'ready' && (
        <section style={styles.layout}>
          <div style={styles.threadList}>
            {threads.length === 0 && <p style={styles.body}>{t.empty}</p>}
            {threads.map((thread) => {
              const lastMessage = thread.messages[0]
              return (
                <button
                  key={thread.id}
                  style={{ ...styles.threadCard, ...(thread.id === activeThreadId ? styles.threadCardActive : {}) }}
                  onClick={() => setActiveThreadId(thread.id)}
                >
                  <strong>{thread.listing ? listingTitleText(thread.listing, lang) : '-'}</strong>
                  <span>{thread.guest?.displayName || '-'}</span>
                  {thread.listing && <small dir="ltr">{moneyText(thread.listing.priceMinor, thread.listing.currency, lang)}</small>}
                  {lastMessage && <p style={styles.threadPreview}>{lastMessage.body.slice(0, 60)}</p>}
                </button>
              )
            })}
          </div>

          <div style={styles.conversation}>
            {!activeThread ? (
              <p style={styles.body}>{t.noSelection}</p>
            ) : (
              <>
                <div style={styles.conversationHeader}>
                  <strong>{activeThread.listing ? listingTitleText(activeThread.listing, lang) : '-'}</strong>
                  <span>{activeThread.guest?.displayName} · {activeThread.guest?.email}</span>
                </div>
                <div style={styles.messages}>
                  {activeThread.messages.length === 0 && <p style={styles.body}>{t.noMessages}</p>}
                  {[...activeThread.messages].reverse().map((item) => (
                    <div key={item.id} style={item.senderRole === 'GUEST' ? styles.bubbleGuest : styles.bubbleHost}>
                      <small>{item.sender?.displayName || item.senderRole}</small>
                      <span>{item.body}</span>
                    </div>
                  ))}
                </div>
                <div style={styles.replyRow}>
                  <textarea
                    style={styles.replyInput}
                    value={replyInput}
                    onChange={(event) => setReplyInput(event.target.value)}
                    placeholder={t.replyPlaceholder}
                  />
                  <button style={styles.sendButton} disabled={!replyInput.trim() || sendState === 'saving'} onClick={() => void sendReply()}>
                    {sendState === 'saving' ? t.sending : t.send}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 24, maxWidth: 1240, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 10 },
  title: { margin: 0, fontSize: 28 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  layout: { display: 'grid', gap: 16, gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)', alignItems: 'start' },
  threadList: { display: 'grid', gap: 10 },
  threadCard: { display: 'grid', gap: 4, textAlign: 'start', border: '1px solid #242735', borderRadius: 8, background: '#101016', color: '#fff', padding: 14 },
  threadCardActive: { border: '1px solid #526cff', background: 'rgba(82,108,255,.1)' },
  threadPreview: { margin: 0, color: '#9aa6ba', fontSize: 13 },
  conversation: { border: '1px solid #242735', borderRadius: 8, background: '#101016', display: 'grid', gap: 14, padding: 18, minHeight: 320 },
  conversationHeader: { display: 'grid', gap: 4, borderBottom: '1px solid #242735', paddingBottom: 12 },
  messages: { display: 'grid', gap: 10, maxHeight: 360, overflowY: 'auto' },
  bubbleGuest: { display: 'grid', gap: 4, justifySelf: 'start', maxWidth: '80%', background: '#171b29', borderRadius: 8, padding: 12 },
  bubbleHost: { display: 'grid', gap: 4, justifySelf: 'end', maxWidth: '80%', background: 'rgba(32,210,155,.12)', borderRadius: 8, padding: 12 },
  replyRow: { display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1fr) auto' },
  replyInput: { minHeight: 60, border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#fff', padding: 12, fontFamily: 'inherit', resize: 'vertical' },
  sendButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 18px' },
}
