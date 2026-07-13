import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchPrototypeAdminAuditLog,
  fetchPrototypeAdminMetrics,
  fetchPrototypeReviewQueue,
  type PlatformAdminAuditLog,
  type PlatformAdminMetrics,
  type PlatformReviewQueue,
} from '../../shared/api/platformApi'

type Props = {
  lang: Lang
}

type OperationEvent = {
  id: string
  day: number
  type: 'booking' | 'payment' | 'review' | 'ride' | 'maintenance' | 'message'
  title: string
  meta: string
  status: 'urgent' | 'pending' | 'ready' | 'planned'
  stage: 'new' | 'assigned' | 'progress' | 'waiting' | 'done'
  assignee: string
  priority: 'high' | 'medium' | 'low'
  href?: string
}

const copy = {
  ar: {
    eyebrow: 'Guesty gap #1',
    title: 'تقويم عمليات SYBNB',
    body: 'عين واحدة على العمل اليومي: الحجوزات، المدفوعات، المراجعات، الرحلات، الصيانة، والرسائل.',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    calendar: 'التقويم',
    tasks: 'قائمة المهام',
    board: 'لوحة المهام',
    detail: 'تفاصيل المهمة',
    assignee: 'المسؤول',
    priority: 'الأولوية',
    related: 'مرتبط بـ',
    due: 'موعد التنفيذ',
    signals: 'إشارات التشغيل',
    automation: 'أتمتة التشغيل',
    automationRows: ['تذكير الدفع قبل انتهاء المهلة', 'إنشاء مهمة تنظيف بعد الخروج', 'تنبيه المالية عند وجود نزاع', 'تعيين السائق عند تأكيد الرحلة'],
    conflicts: 'التعارضات',
    nextAction: 'أفضل إجراء الآن',
    nextActionText: 'راجع المدفوعات العاجلة ثم اربط المحادثات المفتوحة بمهمة تشغيلية.',
    openFinance: 'فتح المالية',
    openInbox: 'فتح IMMOContact',
    pendingReviews: 'مراجعات معلقة',
    payments: 'مدفوعات',
    bookings: 'حجوزات',
    rides: 'رحلات',
    maintenance: 'صيانة',
    messages: 'رسائل',
    ai: 'قريباً',
    aiText: 'لاحقاً يراقب هذا التقويم التعارضات، التأخير، الطلب العالي، وسعر المنطقة.',
    empty: 'لا توجد مهام لهذا اليوم.',
    open: 'فتح',
    taskColumns: {
      new: 'جديد',
      assigned: 'مُعيّن',
      progress: 'قيد التنفيذ',
      waiting: 'بانتظار',
      done: 'منجز',
    },
    priorityLabels: {
      high: 'عالية',
      medium: 'متوسطة',
      low: 'منخفضة',
    },
  },
  en: {
    eyebrow: 'Guesty gap #1',
    title: 'SYBNB Operations Calendar',
    body: 'One eye on daily operations: bookings, payments, reviews, rides, maintenance, and messages.',
    refresh: 'Refresh',
    loading: 'Loading',
    calendar: 'Calendar',
    tasks: 'Task board',
    board: 'Task board',
    detail: 'Task detail',
    assignee: 'Assignee',
    priority: 'Priority',
    related: 'Related to',
    due: 'Due date',
    signals: 'Operations signals',
    automation: 'Operations automation',
    automationRows: ['Payment reminder before SLA expires', 'Create cleaning task after checkout', 'Alert finance when dispute exists', 'Assign driver when ride is confirmed'],
    conflicts: 'Conflicts',
    nextAction: 'Best next action',
    nextActionText: 'Review urgent payments first, then connect open conversations to an operations task.',
    openFinance: 'Open finance',
    openInbox: 'Open IMMOContact',
    pendingReviews: 'Pending reviews',
    payments: 'Payments',
    bookings: 'Bookings',
    rides: 'Rides',
    maintenance: 'Maintenance',
    messages: 'Messages',
    ai: 'Coming soon',
    aiText: 'Later this calendar watches conflicts, delays, demand spikes, and area pricing.',
    empty: 'No tasks for this day.',
    open: 'Open',
    taskColumns: {
      new: 'New',
      assigned: 'Assigned',
      progress: 'In Progress',
      waiting: 'Waiting',
      done: 'Done',
    },
    priorityLabels: {
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
  },
}

const taskStages: OperationEvent['stage'][] = ['new', 'assigned', 'progress', 'waiting', 'done']

const statusLabel = {
  ar: { urgent: 'عاجل', pending: 'بانتظار', ready: 'جاهز', planned: 'مخطط' },
  en: { urgent: 'Urgent', pending: 'Pending', ready: 'Ready', planned: 'Planned' },
}

export function OperationsCalendarPage({ lang }: Props) {
  const t = copy[lang]
  const [queue, setQueue] = useState<PlatformReviewQueue | null>(null)
  const [metrics, setMetrics] = useState<PlatformAdminMetrics | null>(null)
  const [auditLog, setAuditLog] = useState<PlatformAdminAuditLog[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedDay, setSelectedDay] = useState(new Date().getDate())
  const [selectedTaskId, setSelectedTaskId] = useState('')

  useEffect(() => {
    void loadOperations()
  }, [])

  async function loadOperations() {
    setStatus('loading')
    try {
      const [nextQueue, nextMetrics, nextAudit] = await Promise.all([
        fetchPrototypeReviewQueue(),
        fetchPrototypeAdminMetrics(),
        fetchPrototypeAdminAuditLog(8),
      ])
      setQueue(nextQueue)
      setMetrics(nextMetrics)
      setAuditLog(nextAudit)
      setStatus('ready')
    } catch {
      setStatus('error')
      setQueue(null)
      setMetrics(null)
      setAuditLog([])
    }
  }

  const events = useMemo(() => buildOperationEvents(queue, metrics, auditLog, lang), [auditLog, lang, metrics, queue])
  const days = useMemo(() => buildMonthDays(events), [events])
  const selectedEvents = events.filter((event) => event.day === selectedDay)
  const selectedTask = events.find((event) => event.id === selectedTaskId) || selectedEvents[0] || events[0]
  const totals = [
    { label: t.pendingReviews, value: String((queue?.listings.length || 0) + (queue?.bookings.length || 0) + (queue?.gifts.length || 0)), tone: 'blue' },
    { label: t.payments, value: String(queue?.payments.length || 0), tone: 'gold' },
    { label: t.bookings, value: String(totalRecord(metrics?.bookingsByStatus)), tone: 'green' },
    { label: t.rides, value: String(totalRecord(metrics?.ridesByStatus)), tone: 'cyan' },
  ]

  return (
    <main className="operations-page" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <section className="operations-hero">
        <div>
          <p>{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <span>{t.body}</span>
        </div>
        <button onClick={() => void loadOperations()}>{status === 'loading' ? t.loading : t.refresh}</button>
      </section>

      <section className="operations-metrics">
        {totals.map((item) => (
          <article className={item.tone} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      <section className="operations-layout">
        <div className="operations-calendar-card">
          <div className="operations-card-head">
            <h2>{t.calendar}</h2>
            <span>July 2026</span>
          </div>
          <div className="operations-calendar-grid">
            {days.map((day) => (
              <button
                className={day.date === selectedDay ? 'active' : ''}
                key={day.date}
                onClick={() => setSelectedDay(day.date)}
              >
                <strong>{day.date}</strong>
                <span>{day.events.length}</span>
                <i>{day.events.map((event) => event.type).slice(0, 3).join(' · ')}</i>
              </button>
            ))}
          </div>
        </div>

        <div className="operations-task-card">
          <div className="operations-card-head">
            <h2>{t.tasks}</h2>
            <span>{selectedDay}</span>
          </div>
          <div className="operations-task-list">
            {selectedEvents.length ? selectedEvents.map((event) => (
              <article className={event.status} key={event.id}>
                <div>
                  <strong>{event.title}</strong>
                  <span>{event.meta}</span>
                </div>
                <small>{statusLabel[lang][event.status]}</small>
                {event.href ? <button onClick={() => openEvent(event.href as string)}>{t.open}</button> : null}
              </article>
            )) : <p>{t.empty}</p>}
          </div>
        </div>
      </section>

      <section className="operations-board-shell">
        <div className="operations-card-head">
          <h2>{t.board}</h2>
          <span>Guesty-style</span>
        </div>
        <div className="operations-board-layout">
          <div className="operations-kanban">
            {taskStages.map((stage) => {
              const stageEvents = events.filter((event) => event.stage === stage).slice(0, 4)
              return (
                <section key={stage}>
                  <header>
                    <strong>{t.taskColumns[stage]}</strong>
                    <span>{stageEvents.length}</span>
                  </header>
                  <div>
                    {stageEvents.length ? stageEvents.map((event) => (
                      <button
                        className={`${event.status} ${selectedTask?.id === event.id ? 'active' : ''}`}
                        key={event.id}
                        onClick={() => setSelectedTaskId(event.id)}
                      >
                        <small>{event.type}</small>
                        <strong>{event.title}</strong>
                        <span>{event.meta}</span>
                        <i>{event.assignee}</i>
                      </button>
                    )) : <p>{t.empty}</p>}
                  </div>
                </section>
              )
            })}
          </div>

          <aside className="operations-task-detail">
            <div className="operations-card-head">
              <h2>{t.detail}</h2>
              <span>{selectedTask ? statusLabel[lang][selectedTask.status] : '-'}</span>
            </div>
            {selectedTask ? (
              <>
                <strong>{selectedTask.title}</strong>
                <p>{selectedTask.meta}</p>
                <TaskFact label={t.assignee} value={selectedTask.assignee} />
                <TaskFact label={t.priority} value={t.priorityLabels[selectedTask.priority]} />
                <TaskFact label={t.related} value={selectedTask.type} />
                <TaskFact label={t.due} value={`July ${selectedTask.day}, 2026`} />
                {selectedTask.href ? <button onClick={() => openEvent(selectedTask.href as string)}>{t.open}</button> : null}
              </>
            ) : <p>{t.empty}</p>}
          </aside>
        </div>
      </section>

      <section className="operations-signals">
        <div>
          <p>{t.ai}</p>
          <h2>{t.signals}</h2>
          <span>{t.aiText}</span>
        </div>
        <div>
          <Signal label={t.maintenance} value={lang === 'ar' ? 'تنظيف بعد كل خروج' : 'Clean after checkout'} />
          <Signal label={t.messages} value={lang === 'ar' ? 'توحيد IMMOContact' : 'Unify IMMOContact'} />
          <Signal label={t.payments} value={lang === 'ar' ? 'تذكير إثبات الدفع' : 'Payment proof reminder'} />
        </div>
      </section>

      <section className="operations-automation">
        <article>
          <p>{t.automation}</p>
          <h2>{t.nextAction}</h2>
          <span>{t.nextActionText}</span>
          <div>
            <button onClick={() => openEvent('/finance')}>{t.openFinance}</button>
            <button onClick={() => openEvent('/immocontact')}>{t.openInbox}</button>
          </div>
        </article>
        <div>
          {t.automationRows.map((row, index) => (
            <section key={row}>
              <strong>{index + 1}</strong>
              <span>{row}</span>
              <b>{index === 0 ? (lang === 'ar' ? 'نشط' : 'Active') : (lang === 'ar' ? 'جاهز' : 'Ready')}</b>
            </section>
          ))}
        </div>
      </section>
    </main>
  )
}

function openEvent(href: string) {
  window.location.hash = href
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <strong>{label}</strong>
      <span>{value}</span>
    </article>
  )
}

function TaskFact({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function buildMonthDays(events: OperationEvent[]) {
  return Array.from({ length: 31 }, (_, index) => {
    const date = index + 1
    return { date, events: events.filter((event) => event.day === date) }
  })
}

function buildOperationEvents(
  queue: PlatformReviewQueue | null,
  metrics: PlatformAdminMetrics | null,
  auditLog: PlatformAdminAuditLog[],
  lang: Lang,
): OperationEvent[] {
  const today = new Date().getDate()
  const events: OperationEvent[] = []
  queue?.payments.forEach((payment, index) => {
    events.push({
      id: `payment-${payment.id}`,
      day: clampDay(today + index),
      type: 'payment',
      title: lang === 'ar' ? 'مراجعة إثبات دفع' : 'Review payment proof',
      meta: `${payment.amountMinor.toLocaleString()} ${payment.currency}`,
      status: 'urgent',
      stage: 'new',
      assignee: lang === 'ar' ? 'فريق الدفع' : 'Payment team',
      priority: 'high',
      href: `/payment/receipt/${payment.id}`,
    })
  })
  queue?.bookings.forEach((booking, index) => {
    events.push({
      id: `booking-${booking.id}`,
      day: dayFromISO(booking.checkIn) || clampDay(today + index + 1),
      type: 'booking',
      title: booking.listing ? (lang === 'ar' ? booking.listing.titleAr : booking.listing.titleEn || booking.listing.titleAr) : (lang === 'ar' ? 'حجز جديد' : 'New booking'),
      meta: `${booking.amountMinor.toLocaleString()} ${booking.currency}`,
      status: 'pending',
      stage: 'assigned',
      assignee: lang === 'ar' ? 'مشرف الحجوزات' : 'Booking lead',
      priority: 'high',
      href: `/booking/${booking.id}`,
    })
  })
  queue?.listings.forEach((listing, index) => {
    events.push({
      id: `listing-${listing.id}`,
      day: clampDay(today + index + 2),
      type: 'review',
      title: lang === 'ar' ? 'مراجعة إعلان' : 'Review listing',
      meta: lang === 'ar' ? listing.titleAr : listing.titleEn || listing.titleAr,
      status: 'pending',
      stage: 'waiting',
      assignee: lang === 'ar' ? 'مراجعة الإعلانات' : 'Listing review',
      priority: 'medium',
      href: `/listing/${listing.id}`,
    })
  })
  queue?.gifts.forEach((gift, index) => {
    events.push({
      id: `gift-${gift.id}`,
      day: clampDay(today + index + 3),
      type: 'payment',
      title: lang === 'ar' ? 'مراجعة هدية محفظة' : 'Review wallet gift',
      meta: `${gift.amountMinor.toLocaleString()} ${gift.currency}`,
      status: 'pending',
      stage: 'waiting',
      assignee: lang === 'ar' ? 'فريق المحفظة' : 'Wallet team',
      priority: 'medium',
      href: `/wallet/gift/claim/${gift.id}`,
    })
  })
  auditLog.slice(0, 4).forEach((entry, index) => {
    events.push({
      id: `audit-${entry.id}`,
      day: clampDay(today - index),
      type: 'message',
      title: lang === 'ar' ? 'تدقيق قرار إداري' : 'Audit admin decision',
      meta: entry.action.replace(/_/g, ' '),
      status: 'ready',
      stage: 'done',
      assignee: entry.actor?.displayName || (lang === 'ar' ? 'الإدارة' : 'Admin'),
      priority: 'low',
    })
  })
  events.push(
    {
      id: 'maintenance-cleaning',
      day: clampDay(today + 1),
      type: 'maintenance',
      title: lang === 'ar' ? 'تنظيف بعد خروج ضيف' : 'Post-checkout cleaning',
      meta: lang === 'ar' ? 'مهمة تشغيلية من نوع Guesty' : 'Guesty-style operations task',
      status: 'planned',
      stage: 'progress',
      assignee: lang === 'ar' ? 'فريق التنظيف' : 'Cleaning team',
      priority: 'medium',
    },
    {
      id: 'ride-dispatch',
      day: clampDay(today),
      type: 'ride',
      title: lang === 'ar' ? 'متابعة تعيين سائق' : 'Follow driver assignment',
      meta: `${totalRecord(metrics?.ridesByStatus)} ${lang === 'ar' ? 'رحلات' : 'rides'}`,
      status: 'ready',
      stage: 'assigned',
      assignee: lang === 'ar' ? 'مشرف السائقين' : 'Driver dispatcher',
      priority: 'medium',
      href: '/driver',
    },
  )
  return events
}

function dayFromISO(value: string | null) {
  if (!value) return 0
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.getDate() : 0
}

function clampDay(value: number) {
  if (value < 1) return 1
  if (value > 31) return ((value - 1) % 31) + 1
  return value
}

function totalRecord(record?: Record<string, number>) {
  return Object.values(record || {}).reduce((sum, value) => sum + value, 0)
}
