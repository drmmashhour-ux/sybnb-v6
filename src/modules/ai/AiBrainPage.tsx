import type { Lang } from '../../engines/language/languageEngine'

type Props = {
  lang: Lang
}

// This page has no live backend — there is no competitor-scraping, demand-signal, or
// pricing-intelligence service in SYBNB today. Everything below is a labeled example of what
// the AI Brain roadmap concept would show once that service exists. Do not swap these for
// real listing/user names; keep them generic so nobody mistakes this for live output.
const signals = [
  { platform: 'Example platform A', ar: 'مثال: تغيّر تسعير في منطقة مجاورة', en: 'Example: pricing shift in a nearby area', statusAr: 'يتطلب إجراء', statusEn: 'Needs action', tone: 'danger' },
  { platform: 'Example platform B', ar: 'مثال: تحديث عمولة', en: 'Example: commission update', statusAr: 'مراقب', statusEn: 'Watching', tone: 'gold' },
  { platform: 'Example platform C', ar: 'مثال: تحديث واجهة', en: 'Example: interface update', statusAr: 'معتمد', statusEn: 'Approved', tone: 'green' },
  { platform: 'Example platform D', ar: 'مثال: حملة خصومات', en: 'Example: discount campaign', statusAr: 'جديد', statusEn: 'New', tone: 'red' },
]

const priceSignals = [
  { ar: 'مثال: منطقة أ', en: 'Example area A', demandAr: 'مرتفع الطلب', demandEn: 'High demand', nightly: '—', monthly: '—', currency: 'SYP' },
  { ar: 'مثال: منطقة ب', en: 'Example area B', demandAr: 'متوسط الطلب', demandEn: 'Medium demand', nightly: '—', monthly: '—', currency: 'SYP' },
  { ar: 'مثال: منطقة ج', en: 'Example area C', demandAr: 'مرتفع الطلب', demandEn: 'High demand', nightly: '—', monthly: '—', currency: 'SYP' },
]

const improvements = [
  { ar: 'مثال: قائمة أ', en: 'Example listing A', actionAr: 'أضف صور احترافية', actionEn: 'Add professional photos', lift: '—', priorityAr: 'عالية', priorityEn: 'High', tone: 'red' },
  { ar: 'مثال: قائمة ب', en: 'Example listing B', actionAr: 'شارة الثقة', actionEn: 'Trust badge', lift: '—', priorityAr: 'متوسطة', priorityEn: 'Medium', tone: 'gold' },
  { ar: 'مثال: قائمة ج', en: 'Example listing C', actionAr: 'تعديل السعر', actionEn: 'Adjust price', lift: '—', priorityAr: 'عالية', priorityEn: 'High', tone: 'red' },
  { ar: 'مثال: قائمة د', en: 'Example listing D', actionAr: 'تحسين الوصف', actionEn: 'Improve description', lift: '—', priorityAr: 'متوسطة', priorityEn: 'Medium', tone: 'gold' },
]

const roadmap = [
  { score: '—', ar: 'نظام دفع متكامل', en: 'Integrated payment system', tagAr: 'ابن التالي', tagEn: 'Build next', state: 'PENDING', tone: 'gold' },
  { score: '—', ar: 'تحسين محرك الحجز', en: 'Improve booking engine', tagAr: 'حسّن التالي', tagEn: 'Improve next', state: 'IN PROGRESS', tone: 'green' },
  { score: '—', ar: 'تنبيه مخاطر السيولة', en: 'Liquidity risk alert', tagAr: 'تنبيه مخاطر', tagEn: 'Risk alert', state: 'PENDING', tone: 'gold' },
  { score: '—', ar: 'توسيع سوق جدة', en: 'Expand Jeddah market', tagAr: 'فرصة السوق', tagEn: 'Market opportunity', state: 'IN PROGRESS', tone: 'green' },
]

export function AiBrainPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const firstSignal = signals[0]
  const go = (route: string) => {
    window.location.hash = route
  }

  return (
    <main className="ai-brain-page" dir={isAr ? 'rtl' : 'ltr'}>
      <header className="ai-brain-top">
        <div>
          <span>◉</span>
          <strong>SYBNB AI BRAIN</strong>
          <small>MARKET INTELLIGENCE</small>
        </div>
        <p>{isAr ? 'معاينة توضيحية — غير متصلة ببيانات حية' : 'Illustrative preview — not connected to live data'}</p>
        <button onClick={() => (window.location.hash = '/admin/review')}>{isAr ? 'الإدارة' : 'Admin'}</button>
      </header>

      <section className="ai-brain-notice">
        <strong>{isAr ? 'مفهوم استشاري فقط' : 'Advisory concept only'}</strong>
        <span>
          {isAr
            ? 'لا توجد خدمة رصد منافسين أو تسعير ذكي حقيقية بعد. كل ما يظهر هنا أمثلة توضيحية لما سيبدو عليه AI Brain عند بناء تلك الخدمة، وليس تحليلاً حياً أو قوائم أو مستخدمين حقيقيين.'
            : 'No real competitor-monitoring or pricing-intelligence service exists yet. Everything shown here is an illustrative example of what AI Brain would look like once that service is built — not live analysis, and not real listings or users.'}
        </span>
      </section>

      <section className="ai-brain-grid">
        <aside className="ai-detail-panel">
          <SectionTitle icon="⌘" title={isAr ? 'تفاصيل الإشارة' : 'Signal Detail'} subtitle="SIGNAL DETAIL" />
          <article className="ai-signal-detail-card">
            <div>
              <span className="ai-source">{isAr ? 'مثال توضيحي' : 'Illustrative example'}</span>
              <strong>{isAr ? firstSignal.ar : firstSignal.en}</strong>
              <p>{isAr ? 'مثال: عند بناء خدمة رصد المنافسين، ستظهر هنا التغيّرات المرصودة في أسعار السوق مع تقييم أثرها المحتمل على SYBNB.' : 'Example: once a competitor-monitoring service exists, observed market pricing shifts and their likely impact on SYBNB would appear here.'}</p>
            </div>
            <div className="ai-impact">
              <b>{isAr ? 'مثال' : 'EXAMPLE'}</b>
              <i />
              <span>{isAr ? 'تأثير SYBNB المتوقع' : 'Expected SYBNB impact'}</span>
            </div>
            <div className="ai-detail-facts">
              <span>{isAr ? 'الحالة' : 'Status'} <b>{isAr ? firstSignal.statusAr : firstSignal.statusEn}</b></span>
              <span>{isAr ? 'الأولوية' : 'Priority'} <b>{isAr ? 'عالية' : 'High'}</b></span>
              <span>{isAr ? 'الفريق المسؤول' : 'Owner team'} <b>{isAr ? 'فريق العمليات' : 'Operations team'}</b></span>
            </div>
            <p className="ai-action-note">{isAr ? 'مثال إجراء مقترح: تفعيل التسعير الديناميكي لتقليل الفجوة السعرية مع المنافسين.' : 'Example suggested action: activate dynamic pricing to reduce the competitor pricing gap.'}</p>
            <div className="ai-detail-actions">
              <button onClick={() => go('/finance')}>{isAr ? 'الموافقة على الإجراء' : 'Approve action'}</button>
              <button onClick={() => go('/operations')}>{isAr ? 'إنشاء مهمة' : 'Create task'}</button>
              <button onClick={() => go('/competitors')}>{isAr ? 'تجاهل' : 'Ignore'}</button>
            </div>
          </article>
        </aside>

        <section className="ai-roadmap-column">
          <SectionTitle icon="⚑" title={isAr ? 'خارطة التطوير' : 'Platform Roadmap'} subtitle="PLATFORM ROADMAP" />
          {roadmap.map((item) => (
            <article className={`ai-roadmap-card ${item.tone}`} key={item.en}>
              <span>{item.score}</span>
              <div>
                <strong>{isAr ? item.ar : item.en}</strong>
                <small>{item.state}</small>
              </div>
              <b>{isAr ? item.tagAr : item.tagEn}</b>
            </article>
          ))}
        </section>

        <section className="ai-improvements-column">
          <SectionTitle icon="✣" title={isAr ? 'تحسين الإعلانات' : 'Listing Improvements'} subtitle="LISTING IMPROVEMENTS" />
          {improvements.map((item) => (
            <article className="ai-improvement-card" key={item.en}>
              <span className={item.tone}>{isAr ? item.priorityAr : item.priorityEn}</span>
              <div>
                <strong>{isAr ? item.ar : item.en}</strong>
                <small>{isAr ? item.actionAr : item.actionEn}</small>
                <b>{item.lift} {isAr ? 'مشاهدات' : 'views'}</b>
              </div>
              <button onClick={() => go('/host')}>{isAr ? 'تطبيق' : 'Apply'}</button>
            </article>
          ))}
        </section>

        <section className="ai-price-column">
          <SectionTitle icon="♕" title={isAr ? 'ذكاء الأسعار' : 'Price Intelligence'} subtitle="PRICE INTELLIGENCE" />
          {priceSignals.map((item) => (
            <article className="ai-price-card" key={item.en}>
              <div className="ai-confidence"><b>{isAr ? 'مثال' : 'EXAMPLE'}</b></div>
              <div>
                <h3>{isAr ? item.ar : item.en}</h3>
                <small>{isAr ? item.demandAr : item.demandEn}</small>
                <p>{isAr ? 'السعر الليلي' : 'Nightly price'} <strong>{item.nightly} {item.currency}</strong></p>
                <p>{isAr ? 'الإيجار الشهري' : 'Monthly rent'} <strong>{item.monthly} {item.currency}</strong></p>
              </div>
              <svg viewBox="0 0 160 44" aria-hidden="true">
                <polyline points="0,34 28,24 58,30 92,16 125,9 160,12" />
              </svg>
            </article>
          ))}
        </section>

        <section className="ai-competitor-column">
          <SectionTitle icon="◉" title={isAr ? 'رصد المنافسين' : 'Competitor Watch'} subtitle="COMPETITOR WATCH" />
          {signals.map((signal) => (
            <article className="ai-competitor-card" key={`${signal.platform}-${signal.en}`}>
              <button aria-label="close" onClick={() => go('/competitors')}>×</button>
              <div>
                <strong>{signal.platform}</strong>
                <span>{isAr ? signal.ar : signal.en}</span>
                <small>{isAr ? 'مثال توضيحي' : 'Illustrative example'}</small>
              </div>
              <b className={signal.tone}>{isAr ? signal.statusAr : signal.statusEn}</b>
              <i>⌁ ◉</i>
            </article>
          ))}
        </section>
      </section>

      <section className="ai-summary">
        <div>☼</div>
        <h2>{isAr ? 'ملخص اليوم (مثال)' : 'Today Summary (example)'}</h2>
        <p>{isAr ? 'مثال: عند تشغيل خدمة ذكاء السوق، سيظهر هنا ملخص يومي حقيقي لإشارات الطلب والأسعار المقترحة بناءً على بيانات فعلية.' : 'Example: once a market-intelligence service is running, a real daily summary of demand signals and suggested prices would appear here, based on actual data.'}</p>
      </section>

      <section className="ai-panel-previews">
        <PreviewPanel title={isAr ? 'اقتراح السعر الذكي' : 'Smart price suggestion'} value={isAr ? 'مثال' : 'EXAMPLE'} />
        <PreviewPanel title={isAr ? 'تحسين القائمة الذكي' : 'Smart listing improvement'} value={isAr ? 'مثال' : 'EXAMPLE'} />
        <PreviewPanel title={isAr ? 'لوحة اقتراحات الخارطة' : 'Roadmap suggestions'} value={isAr ? 'مثال' : 'EXAMPLE'} />
      </section>
    </main>
  )
}

function SectionTitle({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <header className="ai-section-title">
      <span>{icon}</span>
      <div>
        <h2>{title}</h2>
        <small>{subtitle}</small>
      </div>
    </header>
  )
}

function PreviewPanel({ title, value }: { title: string; value: string }) {
  return (
    <article>
      <button onClick={() => (window.location.hash = '/ai-brain')}>×</button>
      <h2>{title}</h2>
      <strong>{value}</strong>
      <p>AI Brain</p>
    </article>
  )
}
