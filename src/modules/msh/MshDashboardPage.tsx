import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { MSH_CONTRACT, MshReadError, readMsh, type MshSnapshot, type MshWallet } from './mshReadOnly'
import { MshRewardsPreview } from './MshRewardsPreview'
import './msh-dashboard.css'

const french: Record<string, string> = {
  "Back to SYBNB wallet": "Retour au portefeuille SYBNB",
  "SEPOLIA TESTNET": "RÉSEAU DE TEST SEPOLIA",
  "MSH testnet dashboard": "Tableau de bord MSH de test",
  "Test tokens have no real financial value. This dashboard reads balances only. MSH is separate from SYBNB booking balances and payments.": "Les jetons de test n’ont aucune valeur financière réelle. Ce tableau de bord affiche uniquement les soldes. MSH est séparé des soldes de réservation et des paiements SYBNB.",
  "Open this page in a browser with MetaMask installed.": "Ouvrez cette page dans un navigateur avec MetaMask installé.",
  "I am using a dedicated test wallet.": "J’utilise un portefeuille dédié aux tests.",
  "Refresh balance": "Actualiser le solde",
  "Disconnect": "Déconnecter",
  "Reading…": "Lecture…",
  "Connect test wallet": "Connecter le portefeuille de test",
  "Test token balance": "Solde des jetons de test",
  "Wallet address": "Adresse du portefeuille",
  "Network": "Réseau",
  "Read at block": "Lecture au bloc",
  "Test token contract": "Contrat du jeton de test",
  "View verified source on Sepolia": "Voir le code source vérifié sur Sepolia",
  "Wallet changed. Reconnect to update your balance.": "Le portefeuille a changé. Reconnectez-vous pour actualiser le solde.",
  "Select Ethereum Sepolia in MetaMask, then reconnect.": "Sélectionnez Ethereum Sepolia dans MetaMask, puis reconnectez-vous.",
  "No account connected. Connect your test wallet.": "Aucun compte connecté. Connectez votre portefeuille de test.",
  "The configured MSH test token could not be verified.": "Le jeton de test MSH configuré n’a pas pu être vérifié.",
  "Wallet changed during refresh. Reconnect.": "Le portefeuille a changé pendant la lecture. Reconnectez-vous.",
  "Wallet access or balance reading failed. Try again.": "La connexion ou la lecture du solde a échoué. Réessayez.",
  "App connection cleared. MetaMask permissions remain unchanged.": "Connexion de l’application effacée. Les autorisations MetaMask restent inchangées."
}

export function MshDashboardPage({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const wallet = (window as unknown as { ethereum?: MshWallet }).ethereum
  const [snapshot, setSnapshot] = useState<MshSnapshot | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const version = useRef(0)
  const active = useRef(true)
  const t = (en: string, arabic: string) => ar ? arabic : lang === 'fr' ? french[en] || en : en
  function clear() { version.current++; setSnapshot(null); setBusy(false) }
  useEffect(() => {
    active.current = true
    const change = () => { clear(); setMessage(t('Wallet changed. Reconnect to update your balance.', 'تغيّرت المحفظة. أعد الاتصال لتحديث الرصيد.')) }
    for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) wallet?.on?.(event, change)
    return () => { active.current = false; version.current++; for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) wallet?.removeListener?.(event, change) }
  }, [wallet, lang])
  async function load(connect: boolean) {
    if (!wallet || busy || (connect && !consent)) return
    const operation = ++version.current
    setBusy(true); setMessage(''); setSnapshot(null)
    try {
      const next = await readMsh(wallet, connect)
      if (active.current && operation === version.current) setSnapshot(next)
    } catch (error) {
      const reason = error instanceof MshReadError ? error.reason : 'other'
      const notices: Record<string, string> = {
        network: t('Select Ethereum Sepolia in MetaMask, then reconnect.', 'اختر شبكة إيثيريوم سيبوليا في ميتاماسك ثم أعد الاتصال.'),
        account: t('No account connected. Connect your test wallet.', 'لا يوجد حساب متصل. اتصل بمحفظتك التجريبية.'),
        contract: t('The configured MSH test token could not be verified.', 'تعذر التحقق من رمز MSH التجريبي.'),
        changed: t('Wallet changed during refresh. Reconnect.', 'تغيّرت المحفظة أثناء التحديث. أعد الاتصال.'),
        other: t('Wallet access or balance reading failed. Try again.', 'تعذر الاتصال أو قراءة الرصيد. حاول مجدداً.'),
      }
      if (active.current && operation === version.current) setMessage(notices[reason] || notices.other)
    } finally { if (active.current && operation === version.current) setBusy(false) }
  }
  return <main className="msh-dashboard" dir={ar ? 'rtl' : 'ltr'}>
    <a href="#/wallet">{t('Back to SYBNB wallet', 'العودة إلى محفظة SYBNB')}</a>
    <p className="msh-dashboard-eyebrow">{t('SEPOLIA TESTNET', 'شبكة سيبوليا التجريبية')}</p>
    <h1>{t('MSH testnet dashboard', 'لوحة MSH التجريبية')}</h1>
    <p className="msh-dashboard-notice">{t('Test tokens have no real financial value. This dashboard reads balances only. MSH is separate from SYBNB booking balances and payments.', 'الرموز التجريبية بلا قيمة مالية حقيقية. تعرض هذه اللوحة الأرصدة فقط. MSH منفصل عن أرصدة الحجوزات والمدفوعات في SYBNB.')}</p>
    <MshRewardsPreview lang={lang} />
    {!wallet && <p>{t('Open this page in a browser with MetaMask installed.', 'افتح هذه الصفحة في متصفح يحتوي على ميتاماسك.')}</p>}
    {!snapshot && <label className="msh-dashboard-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{t('I am using a dedicated test wallet.', 'أستخدم محفظة مخصصة للاختبار.')}</label>}
    <div className="msh-dashboard-actions">
      {snapshot ? <><button disabled={busy} onClick={() => void load(false)}>{t('Refresh balance', 'تحديث الرصيد')}</button><button onClick={() => { clear(); setConsent(false); setMessage(t('App connection cleared. MetaMask permissions remain unchanged.', 'تم مسح اتصال التطبيق. تبقى أذونات ميتاماسك دون تغيير.')) }}>{t('Disconnect', 'قطع الاتصال')}</button></>
      : <button disabled={!wallet || !consent || busy} onClick={() => void load(true)}>{busy ? t('Reading…', 'جارٍ القراءة…') : t('Connect test wallet', 'الاتصال بالمحفظة التجريبية')}</button>}
    </div>
    <div role="status" aria-live="polite">{message}</div>
    {snapshot && <section className="msh-dashboard-balance"><span>{t('Test token balance', 'رصيد الرمز التجريبي')}</span><strong dir="ltr">{snapshot.balance} MSH</strong>
      <dl><dt>{t('Wallet address', 'عنوان المحفظة')}</dt><dd dir="ltr">{snapshot.account}</dd><dt>{t('Network', 'الشبكة')}</dt><dd>Ethereum Sepolia (11155111)</dd><dt>{t('Read at block', 'القراءة عند الكتلة')}</dt><dd>{snapshot.block}</dd></dl>
    </section>}
    <section className="msh-dashboard-contract"><h2>{t('Test token contract', 'عقد الرمز التجريبي')}</h2><p dir="ltr">{MSH_CONTRACT}</p><a href={`https://sepolia.etherscan.io/address/${MSH_CONTRACT}#code`} target="_blank" rel="noopener noreferrer">{t('View verified source on Sepolia', 'عرض المصدر المتحقق منه على سيبوليا')}</a></section>
  </main>
}
