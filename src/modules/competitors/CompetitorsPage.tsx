import { pick, type Lang } from '../../engines/language/languageEngine'

type Props = {
  lang: Lang
}

const rows = [
  {
    area: { ar: 'المستخدم الأساسي', en: 'Main user', fr: 'Utilisateur principal' },
    airbnb: { ar: 'ضيف + مضيف', en: 'Guest + host', fr: 'Voyageur + hôte' },
    booking: { ar: 'ضيف + فندق/عقار', en: 'Guest + hotel/property', fr: 'Voyageur + hôtel/établissement' },
    guesty: { ar: 'مدير عقارات + مضيف', en: 'Property manager + host', fr: 'Gestionnaire immobilier + hôte' },
    sybnb: { ar: 'ضيف + مضيف + إدارة + سائق + بائع', en: 'Guest + host + admin + driver + seller', fr: 'Voyageur + hôte + administration + chauffeur + vendeur' },
  },
  {
    area: { ar: 'هدف المنصة', en: 'Platform purpose', fr: 'Vocation de la plateforme' },
    airbnb: { ar: 'حجز الإقامات والتجارب', en: 'Book stays and experiences', fr: 'Réserver des séjours et des expériences' },
    booking: { ar: 'مقارنة وحجز الإقامات', en: 'Compare and reserve stays', fr: 'Comparer et réserver des séjours' },
    guesty: { ar: 'تشغيل وإدارة أعمال الإيجار', en: 'Operate rental businesses', fr: 'Exploiter des entreprises de location' },
    sybnb: { ar: 'سوق + تشغيل + مدفوعات + تواصل', en: 'Marketplace + operations + payments + contact', fr: 'Place de marché + opérations + paiements + communication' },
  },
  {
    area: { ar: 'بحث العميل', en: 'Guest search', fr: 'Recherche du voyageur' },
    airbnb: { ar: 'المكان / التاريخ / الضيوف', en: 'Where / when / who', fr: 'Où / quand / qui' },
    booking: { ar: 'الوجهة / التاريخ / الضيوف والغرف', en: 'Destination / dates / guests and rooms', fr: 'Destination / dates / voyageurs et chambres' },
    guesty: { ar: 'ليس موجهاً للبحث العام', en: 'Not public-search first', fr: 'Pas axé sur la recherche publique' },
    sybnb: { ar: 'المكان / التقويم / الضيوف ثم فلاتر مصورة', en: 'Place / calendar / guests, then photo filters', fr: 'Lieu / calendrier / voyageurs, puis filtres visuels' },
  },
  {
    area: { ar: 'التقويم', en: 'Calendar', fr: 'Calendrier' },
    airbnb: { ar: 'تقويم حجز بسيط', en: 'Simple booking calendar', fr: 'Calendrier de réservation simple' },
    booking: { ar: 'تقويم توفر وسعر', en: 'Availability and price calendar', fr: 'Calendrier des disponibilités et des prix' },
    guesty: { ar: 'تقويم موحد متعدد القنوات', en: 'Multi-channel calendar', fr: 'Calendrier multicanal' },
    sybnb: { ar: 'تقويم يومي للعميل + نحتاج تقويم عمليات', en: 'Daily guest calendar + operations calendar needed', fr: 'Calendrier quotidien du voyageur + calendrier des opérations requis' },
  },
  {
    area: { ar: 'خيارات البحث', en: 'Filters', fr: 'Filtres' },
    airbnb: { ar: 'بسيطة ومرئية', en: 'Simple and visual', fr: 'Simples et visuels' },
    booking: { ar: 'عملية وكثيفة', en: 'Practical and dense', fr: 'Pratiques et denses' },
    guesty: { ar: 'إدارية وتشغيلية', en: 'Operational/admin filters', fr: 'Filtres opérationnels/administratifs' },
    sybnb: { ar: 'صور لمس حسب القسم', en: 'Touch photo filters by division', fr: 'Filtres photo tactiles par division' },
  },
  {
    area: { ar: 'بطاقات النتائج', en: 'Result cards', fr: 'Fiches de résultats' },
    airbnb: { ar: 'صورة أولاً وتجربة ناعمة', en: 'Photo-first and calm', fr: 'Photo d’abord, présentation épurée' },
    booking: { ar: 'كثيفة مع سعر وتقييم', en: 'Dense with price and rating', fr: 'Denses, avec prix et note' },
    guesty: { ar: 'ليست محور المنتج', en: 'Not the core surface', fr: 'Pas au cœur du produit' },
    sybnb: { ar: 'صورة + سعر + حالة + حجز/تفاصيل', en: 'Photo + price + status + book/details', fr: 'Photo + prix + statut + réserver/détails' },
  },
  {
    area: { ar: 'الخريطة والموقع', en: 'Map and location', fr: 'Carte et emplacement' },
    airbnb: { ar: 'خريطة قوية مع أحياء ونطاق سعر', en: 'Strong map with neighborhoods and price ranges', fr: 'Carte riche avec quartiers et fourchettes de prix' },
    booking: { ar: 'خريطة عملية بجانب النتائج', en: 'Practical map beside results', fr: 'Carte pratique à côté des résultats' },
    guesty: { ar: 'حسب موقع الحجز المباشر', en: 'Depends on the direct booking site', fr: 'Selon le site de réservation directe' },
    sybnb: { ar: 'نحتاج خريطة بحث وخرائط تشغيل للزيارات والرحلات', en: 'Need search map plus operations maps for visits and rides', fr: 'Carte de recherche requise, ainsi que des cartes opérationnelles pour les visites et les courses' },
  },
  {
    area: { ar: 'التقييمات والمراجعات', en: 'Reviews and ratings', fr: 'Avis et évaluations' },
    airbnb: { ar: 'تقييم ضيف ومضيف بعد الإقامة', en: 'Guest and host reviews after stays', fr: 'Avis des voyageurs et des hôtes après le séjour' },
    booking: { ar: 'تقييمات ضيوف موثقة بعد الحجز', en: 'Verified guest reviews after booking', fr: 'Avis vérifiés des voyageurs après la réservation' },
    guesty: { ar: 'إدارة مراجعات عبر القنوات', en: 'Review management across channels', fr: 'Gestion des avis sur tous les canaux' },
    sybnb: { ar: 'نحتاج تقييم ضيف/مضيف/سائق مع مراجعة الإدارة', en: 'Need guest, host, and driver ratings with admin moderation', fr: 'Évaluations des voyageurs, hôtes et chauffeurs requises, avec modération administrative' },
  },
  {
    area: { ar: 'التحقق والثقة', en: 'Verification and trust', fr: 'Vérification et confiance' },
    airbnb: { ar: 'هوية، مضيفين موثقين، حماية منصة', en: 'Identity, trusted hosts, platform protection', fr: 'Identité, hôtes de confiance, protection de la plateforme' },
    booking: { ar: 'تأكيد حجز رسمي ومكان إقامة موثّق', en: 'Official confirmation and verified property flow', fr: 'Confirmation officielle et parcours d’établissement vérifié' },
    guesty: { ar: 'تحقق ضيوف وحماية أضرار حسب التكامل', en: 'Guest verification and damage protection by integration', fr: 'Vérification des voyageurs et protection contre les dommages par intégration' },
    sybnb: { ar: 'نحتاج KYC، شارات ثقة، QR، وتحذير لا تدفع خارج المنصة', en: 'Need KYC, trust badges, QR, and do-not-pay-outside warning', fr: 'KYC, badges de confiance, QR et avertissement de ne pas payer hors plateforme requis' },
  },
  {
    area: { ar: 'الإلغاء والاسترداد', en: 'Cancellation and refunds', fr: 'Annulation et remboursements' },
    airbnb: { ar: 'سياسات إلغاء واضحة حسب المضيف', en: 'Clear cancellation policies by host', fr: 'Politiques d’annulation claires selon l’hôte' },
    booking: { ar: 'سياسات مجانية/غير مستردة حسب العرض', en: 'Free/non-refundable policies by rate', fr: 'Politiques gratuites/non remboursables selon le tarif' },
    guesty: { ar: 'قواعد آلية للحجز المباشر والقنوات', en: 'Automated rules for direct and channel bookings', fr: 'Règles automatisées pour les réservations directes et par canal' },
    sybnb: { ar: 'نحتاج محرك استرداد ونزاع مرتبط بالإدارة والمحفظة', en: 'Need refund and dispute engine tied to admin and wallet', fr: 'Moteur de remboursement et de litige requis, lié à l’administration et au portefeuille' },
  },
  {
    area: { ar: 'المدفوعات والتحويلات', en: 'Payments and payouts', fr: 'Paiements et versements' },
    airbnb: { ar: 'تحصيل من الضيف وتحويل للمضيف', en: 'Guest collection and host payouts', fr: 'Encaissement auprès du voyageur et versement à l’hôte' },
    booking: { ar: 'دفع عبر المنصة أو في العقار حسب السياسة', en: 'Platform or property payment depending on policy', fr: 'Paiement sur la plateforme ou à l’établissement selon la politique' },
    guesty: { ar: 'بوابات دفع ومحاسبة للمشغلين', en: 'Payment gateways and accounting for operators', fr: 'Passerelles de paiement et comptabilité pour les exploitants' },
    sybnb: { ar: 'محفظة محلية وإثبات دفع؛ نحتاج جدول تحويلات للمالكين', en: 'Local wallet and proof upload; need owner payout schedule', fr: 'Portefeuille local et téléversement de preuve; calendrier de versement aux propriétaires requis' },
  },
  {
    area: { ar: 'التسعير والعمولة', en: 'Pricing and commission', fr: 'Tarification et commission' },
    airbnb: { ar: 'رسوم خدمة وتسعير ذكي للمضيف', en: 'Service fees and smart pricing for hosts', fr: 'Frais de service et tarification intelligente pour les hôtes' },
    booking: { ar: 'عمولة شريك وعروض وتسعير ديناميكي', en: 'Partner commission, deals, and dynamic pricing', fr: 'Commission partenaire, offres et tarification dynamique' },
    guesty: { ar: 'تسعير وإيرادات عبر أدوات وتكاملات', en: 'Pricing and revenue tools through integrations', fr: 'Outils de tarification et de revenus par intégrations' },
    sybnb: { ar: 'نحتاج لوحة عمولة وسعر مقترح حسب المنطقة والطلب', en: 'Need commission board and suggested price by area and demand', fr: 'Tableau des commissions et prix suggéré selon le secteur et la demande requis' },
  },
  {
    area: { ar: 'التواصل', en: 'Communication', fr: 'Communication' },
    airbnb: { ar: 'رسائل داخل المنصة', en: 'In-platform messages', fr: 'Messagerie intégrée à la plateforme' },
    booking: { ar: 'رسائل الحجز', en: 'Booking messages', fr: 'Messages liés à la réservation' },
    guesty: { ar: 'صندوق موحد لكل القنوات', en: 'Unified inbox across channels', fr: 'Boîte de réception unifiée pour tous les canaux' },
    sybnb: { ar: 'IMMOContact موجود ونحتاج توسيعه', en: 'IMMOContact exists and should expand', fr: 'IMMOContact existe et doit être étendu' },
  },
  {
    area: { ar: 'لوحات الإدارة', en: 'Admin dashboards', fr: 'Tableaux de bord administratifs' },
    airbnb: { ar: 'لوحة مضيف أساسية', en: 'Basic host dashboard', fr: 'Tableau de bord hôte de base' },
    booking: { ar: 'Partner extranet', en: 'Partner extranet', fr: 'Partner extranet' },
    guesty: { ar: 'PMS قوي مع تقارير', en: 'Strong PMS with reports', fr: 'PMS robuste avec rapports' },
    sybnb: { ar: 'لوحة إدارة + مضيف + بائع', en: 'Admin + host + seller dashboards', fr: 'Tableaux de bord administration + hôte + vendeur' },
  },
  {
    area: { ar: 'العمليات', en: 'Operations', fr: 'Opérations' },
    airbnb: { ar: 'محدودة', en: 'Limited', fr: 'Limitées' },
    booking: { ar: 'تشغيل شركاء', en: 'Partner operations', fr: 'Opérations des partenaires' },
    guesty: { ar: 'مهام، تنظيف، صيانة، أتمتة', en: 'Tasks, cleaning, maintenance, automation', fr: 'Tâches, ménage, entretien, automatisation' },
    sybnb: { ar: 'نحتاج مهام وصيانة وتقويم عمليات', en: 'Need tasks, maintenance, operations calendar', fr: 'Tâches, entretien et calendrier des opérations requis' },
  },
  {
    area: { ar: 'التقارير والتحليلات', en: 'Reports and analytics', fr: 'Rapports et analyses' },
    airbnb: { ar: 'إحصاءات أداء للمضيف', en: 'Host performance insights', fr: 'Indicateurs de performance pour les hôtes' },
    booking: { ar: 'تقارير شريك ومؤشرات طلب', en: 'Partner reports and demand insights', fr: 'Rapports partenaires et indicateurs de demande' },
    guesty: { ar: 'تقارير تشغيل وإيرادات قوية', en: 'Strong operations and revenue reports', fr: 'Rapports d’exploitation et de revenus complets' },
    sybnb: { ar: 'نحتاج تقارير مبيعات، حجوزات، دفع، وسائقين للإدارة', en: 'Need sales, booking, payment, and driver reports for admin', fr: 'Rapports de ventes, réservations, paiements et chauffeurs requis pour l’administration' },
  },
  {
    area: { ar: 'تجربة الموبايل والتابلت', en: 'Mobile and tablet experience', fr: 'Expérience mobile et tablette' },
    airbnb: { ar: 'تجربة موبايل ممتازة للضيف', en: 'Excellent mobile guest experience', fr: 'Excellente expérience mobile pour les voyageurs' },
    booking: { ar: 'موبايل سريع وكثيف للبحث والحجز', en: 'Fast dense mobile search and booking', fr: 'Recherche et réservation mobiles rapides et denses' },
    guesty: { ar: 'لوحات تشغيل للمديرين والفرق', en: 'Operations dashboards for managers and teams', fr: 'Tableaux de bord opérationnels pour gestionnaires et équipes' },
    sybnb: { ar: 'نحو تابلت/لمس للعملاء المهمين والإدارة والتسويق', en: 'Moving toward tablet/touch for VIP clients, admin, and marketing', fr: 'Évolution vers tablette/tactile pour les clients VIP, l’administration et le marketing' },
  },
  {
    area: { ar: 'التعدد اللغوي والمحلي', en: 'Language and local market', fr: 'Langue et marché local' },
    airbnb: { ar: 'عالمي متعدد اللغات', en: 'Global multi-language product', fr: 'Produit mondial multilingue' },
    booking: { ar: 'عالمي مع لغات وأسواق كثيرة', en: 'Global with many languages and markets', fr: 'Mondial, avec de nombreuses langues et de nombreux marchés' },
    guesty: { ar: 'موجه للمشغلين عالمياً', en: 'Global operator-focused product', fr: 'Produit mondial axé sur les exploitants' },
    sybnb: { ar: 'عربي/إنجليزي + دفع محلي + سوق سوريا', en: 'Arabic/English + local payment + Syria market focus', fr: 'Arabe/anglais + paiement local + priorité au marché syrien' },
  },
  {
    area: { ar: 'الذكاء الاصطناعي', en: 'AI', fr: 'IA' },
    airbnb: { ar: 'توصيات مخفية', en: 'Mostly hidden recommendations', fr: 'Recommandations surtout invisibles' },
    booking: { ar: 'مساعد تخطيط/بحث', en: 'Trip/search assistant', fr: 'Assistant de voyage/recherche' },
    guesty: { ar: 'وكلاء AI للتشغيل والتسعير والرسائل', en: 'AI agents for ops, pricing, messages', fr: 'Agents IA pour les opérations, la tarification et les messages' },
    sybnb: { ar: 'SYBNB Brain للفلاتر، الإدارة، والمراجعة', en: 'SYBNB Brain for filters, admin, review', fr: 'SYBNB Brain pour les filtres, l’administration et la révision' },
  },
]

const gaps = [
  { ar: 'تقويم عمليات موحد للحجوزات، المدفوعات، الصيانة، والرحلات.', en: 'Unified operations calendar for bookings, payments, maintenance, and rides.', fr: 'Calendrier des opérations unifié pour les réservations, paiements, entretien et courses.' },
  { ar: 'صندوق رسائل موحد لكل العميل/المضيف/البائع/السائق/الإدارة.', en: 'Unified inbox for guest, host, seller, driver, and admin.', fr: 'Boîte de réception unifiée pour voyageur, hôte, vendeur, chauffeur et administration.' },
  { ar: 'نظام مهام للتنظيف، الصيانة، مراجعة الوثائق، ومراجعة الدفع.', en: 'Task system for cleaning, maintenance, document review, and payment review.', fr: 'Système de tâches pour le ménage, l’entretien, la révision des documents et des paiements.' },
  { ar: 'بوابة مالك تعرض الإيراد، الحجوزات، الحالة، والمدفوعات.', en: 'Owner portal for revenue, bookings, status, and payouts.', fr: 'Portail propriétaire pour les revenus, réservations, statuts et versements.' },
  { ar: 'محرك تسعير واقتراحات حسب المنطقة والموسم والطلب.', en: 'Pricing suggestion engine by area, season, and demand.', fr: 'Moteur de suggestion de prix selon le secteur, la saison et la demande.' },
]

const marketSignals = [
  { ar: 'منافس جديد في السوق', en: 'New competitor in the market', fr: 'Nouveau concurrent sur le marché' },
  { ar: 'ميزة جديدة عند Airbnb أو Booking أو Guesty', en: 'New feature from Airbnb, Booking, or Guesty', fr: 'Nouvelle fonctionnalité chez Airbnb, Booking ou Guesty' },
  { ar: 'تغيير في التسعير أو العمولة', en: 'Pricing or commission changes', fr: 'Changements de tarification ou de commission' },
  { ar: 'اتجاه جديد في الحجز أو الإدارة أو الذكاء الاصطناعي', en: 'New trend in booking, operations, or AI', fr: 'Nouvelle tendance en réservation, opérations ou IA' },
]

const bookingClickRows = [
  {
    step: { ar: 'بعد ضغط الحجز', en: 'After clicking book', fr: 'Après le clic sur Réserver' },
    airbnb: { ar: 'يفتح تأكيد الحجز مع التواريخ والضيوف والسعر.', en: 'Opens reservation confirmation with dates, guests, and price.', fr: 'Ouvre la confirmation de réservation avec dates, voyageurs et prix.' },
    booking: { ar: 'ينتقل إلى اختيار الغرفة/الخيار ثم إدخال بيانات الضيف.', en: 'Moves to room/rate choice, then guest details.', fr: 'Passe au choix de la chambre/du tarif, puis aux coordonnées du voyageur.' },
    guesty: { ar: 'غالباً حجز مباشر من موقع المالك مع قواعده الخاصة.', en: 'Usually direct booking from the owner brand site with its rules.', fr: 'Généralement une réservation directe sur le site du propriétaire, selon ses règles.' },
    sybnb: { ar: 'ينشئ طلب حجز ثم يفتح الدفع/الإيصال/مراجعة الإدارة.', en: 'Creates booking request, then opens payment/receipt/admin review.', fr: 'Crée une demande de réservation, puis ouvre le paiement/le reçu/la révision administrative.' },
  },
  {
    step: { ar: 'السعر والرسوم', en: 'Price and fees', fr: 'Prix et frais' },
    airbnb: { ar: 'يعرض السعر، الرسوم، الضرائب، وسياسة الإلغاء.', en: 'Shows price, fees, taxes, and cancellation policy.', fr: 'Affiche le prix, les frais, les taxes et la politique d’annulation.' },
    booking: { ar: 'يعرض السعر النهائي، الضرائب، شروط الدفع والإلغاء.', en: 'Shows final price, taxes, payment and cancellation terms.', fr: 'Affiche le prix final, les taxes et les conditions de paiement et d’annulation.' },
    guesty: { ar: 'حسب محرك الحجز المباشر: سعر، وديعة، رسوم تنظيف.', en: 'Depends on direct engine: rate, deposit, cleaning fees.', fr: 'Selon le moteur direct : tarif, dépôt, frais de ménage.' },
    sybnb: { ar: 'نحتاج تفصيل أوضح: سعر، رسوم منصة، دفع محلي، حالة الموافقة.', en: 'Need clearer breakdown: price, platform fee, local payment, approval state.', fr: 'Ventilation plus claire requise : prix, frais de plateforme, paiement local, état d’approbation.' },
  },
  {
    step: { ar: 'الدفع', en: 'Payment', fr: 'Paiement' },
    airbnb: { ar: 'دفع فوري أو خطط دفع/ادفع لاحقاً في بعض الحالات.', en: 'Immediate payment or pay-later/payment plans in some cases.', fr: 'Paiement immédiat ou paiement différé/échelonné dans certains cas.' },
    booking: { ar: 'الدفع عبر المنصة أو لدى مكان الإقامة حسب السياسة.', en: 'Payment through platform or at property depending on policy.', fr: 'Paiement sur la plateforme ou à l’établissement selon la politique.' },
    guesty: { ar: 'يدعم بوابات دفع وحلول مالية لصاحب العقار.', en: 'Supports payment gateways and financial tools for operators.', fr: 'Prend en charge des passerelles de paiement et des outils financiers pour les exploitants.' },
    sybnb: { ar: 'محفظة/إثبات دفع محلي ثم موافقة الإدارة قبل التأكيد.', en: 'Local wallet/proof upload, then admin approval before confirmation.', fr: 'Portefeuille local/téléversement de preuve, puis approbation administrative avant confirmation.' },
  },
  {
    step: { ar: 'الثقة والأمان', en: 'Trust and safety', fr: 'Confiance et sécurité' },
    airbnb: { ar: 'سياسة إلغاء، مضيف موثق، تقييمات، حماية المنصة.', en: 'Cancellation policy, host trust, reviews, platform protection.', fr: 'Politique d’annulation, hôte de confiance, avis, protection de la plateforme.' },
    booking: { ar: 'تأكيد رسمي، رسائل داخلية، وتحذير من روابط خارجية.', en: 'Official confirmation, in-platform messages, avoid outside links.', fr: 'Confirmation officielle, messagerie intégrée, éviter les liens externes.' },
    guesty: { ar: 'تحقق ضيف، حماية ضرر، أتمتة رسائل ومراجعات.', en: 'Guest verification, damage protection, messaging/review automation.', fr: 'Vérification des voyageurs, protection contre les dommages, automatisation des messages/avis.' },
    sybnb: { ar: 'نحتاج شاشة ثقة عند الدفع: لا تدفع خارج SYBNB، رقم مراجعة، QR.', en: 'Need trust screen at payment: do not pay outside SYBNB, review ID, QR.', fr: 'Écran de confiance requis au paiement : ne payez pas hors de SYBNB, numéro de révision, QR.' },
  },
  {
    step: { ar: 'بعد التأكيد', en: 'After confirmation', fr: 'Après la confirmation' },
    airbnb: { ar: 'رحلة في الحساب، رسائل المضيف، تعليمات الوصول.', en: 'Trip in account, host messages, arrival instructions.', fr: 'Voyage dans le compte, messages de l’hôte, instructions d’arrivée.' },
    booking: { ar: 'تأكيد/PIN، رسائل مكان الإقامة، إدارة الحجز.', en: 'Confirmation/PIN, property messages, manage booking.', fr: 'Confirmation/NIP, messages de l’établissement, gestion de la réservation.' },
    guesty: { ar: 'تطبيق/بوابة ضيف، رسائل تلقائية، مهام تشغيلية.', en: 'Guest app/portal, automated messages, operational tasks.', fr: 'Application/portail voyageur, messages automatisés, tâches opérationnelles.' },
    sybnb: { ar: 'لوحة الحجز، إيصال الدفع، IMMOContact، وتقويم العمليات.', en: 'Booking dashboard, payment receipt, IMMOContact, operations calendar.', fr: 'Tableau de bord de réservation, reçu de paiement, IMMOContact, calendrier des opérations.' },
  },
]

export function CompetitorsPage({ lang }: Props) {
  const isAr = lang === 'ar'

  return (
    <main className="competitors-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="competitors-hero">
        <p>{pick(lang, 'تقييم السوق', 'Market evaluation', 'Évaluation du marché')}</p>
        <h1>{pick(lang, 'المنافسين وموقع SYBNB', 'Competitors and SYBNB Position', 'Concurrents et positionnement de SYBNB')}</h1>
        <span>
          {pick(
            lang,
            'نقارن ما يراه العميل وما يستخدمه المضيف والإدارة حتى نعرف أين نقف وما الذي نبنيه لاحقاً.',
            'We compare what guests see and what hosts/admins operate so we know where we stand and what to build next.',
            'Nous comparons ce que voient les voyageurs et ce qu’utilisent les hôtes et l’administration afin de savoir où nous en sommes et quoi bâtir ensuite.',
          )}
        </span>
      </section>

      <section className="competitors-table-card">
        <div className="competitors-table">
          <div className="competitors-row competitors-head">
            <strong>{pick(lang, 'المجال', 'Area', 'Domaine')}</strong>
            <strong>Airbnb</strong>
            <strong>Booking</strong>
            <strong>Guesty</strong>
            <strong>SYBNB V6</strong>
          </div>
          {rows.map((row) => (
            <div className="competitors-row" key={row.area.en}>
              <strong>{row.area[lang]}</strong>
              <span>{row.airbnb[lang]}</span>
              <span>{row.booking[lang]}</span>
              <span>{row.guesty[lang]}</span>
              <span className="sybnb-cell">{row.sybnb[lang]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="competitors-gaps">
        <h2>{pick(lang, 'قائمة ما ينقصنا حالياً', 'Current Missing Pieces', 'Éléments manquants actuels')}</h2>
        <div>
          {gaps.map((gap, index) => (
            <article key={gap.en}>
              <strong>{String(index + 1).padStart(2, '0')}</strong>
              <p>{gap[lang]}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="competitors-booking-flow">
        <div className="competitors-card-title">
          <p>{pick(lang, 'تجربة العميل بعد الحجز', 'Client Experience After Booking Click', 'Expérience client après le clic sur Réserver')}</p>
          <h2>{pick(lang, 'ماذا يرى العميل عند الضغط على حجز؟', 'What does the client see after clicking book?', 'Que voit le client après avoir cliqué sur Réserver?')}</h2>
        </div>
        <div className="competitors-table-card compact">
          <div className="competitors-table booking-flow-table">
            <div className="competitors-row competitors-head">
              <strong>{pick(lang, 'المرحلة', 'Step', 'Étape')}</strong>
              <strong>Airbnb</strong>
              <strong>Booking</strong>
              <strong>Guesty</strong>
              <strong>SYBNB V6</strong>
            </div>
            {bookingClickRows.map((row) => (
              <div className="competitors-row" key={row.step.en}>
                <strong>{row.step[lang]}</strong>
                <span>{row.airbnb[lang]}</span>
                <span>{row.booking[lang]}</span>
                <span>{row.guesty[lang]}</span>
                <span className="sybnb-cell">{row.sybnb[lang]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="competitors-brain">
        <div>
          <p>{'SYBNB Brain'}</p>
          <h2>{pick(lang, 'مراقبة السوق والمنافسين', 'Market and Competitor Watch', 'Veille du marché et de la concurrence')}</h2>
          <span>
            {pick(
              lang,
              'نربط هذا القسم لاحقاً مع AI Brain حتى يحدّثنا عندما تظهر منصة جديدة، ميزة جديدة، أو فجوة يجب أن نبنيها.',
              'Later, this section can connect to AI Brain so it updates us when a new platform, feature, or gap appears.',
              'Cette section pourra ensuite être reliée à AI Brain afin de nous signaler toute nouvelle plateforme, fonctionnalité ou lacune.',
            )}
          </span>
        </div>
        <div className="brain-signal-grid">
          {marketSignals.map((signal) => (
            <article key={signal.en}>
              <strong>AI</strong>
              <span>{signal[lang]}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
