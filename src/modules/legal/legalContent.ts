// SYBNB legal content — Terms of Service, Privacy Policy, Listing Agreement.
//
// IMPORTANT: This text was drafted to fit how the SYBNB platform actually works (a Syria-focused
// marketplace for short-term rentals, long-term rentals, property sale listings, cars, a general
// marketplace, new-construction listings, and SR rides, with manual/local-wallet + Sham Cash
// payment proofs reviewed by admins, a protected host payout hold, wallet gifts, and email-OTP
// accounts). It is a strong starting point, NOT a substitute for review by a qualified lawyer
// licensed in the Syrian Arab Republic. Versions here must stay in sync with server/lib/legal.mjs.
//
// Each document is a list of sections; each section's title and body carry ar/en/fr text. Bodies
// are arrays of paragraphs. Keep clauses short and plain.

import type { Lang } from '../../engines/language/languageEngine'

export type LegalTri = { ar: string; en: string; fr: string }
export type LegalSection = { id: string; title: LegalTri; body: LegalTri[] }
export type LegalDocKey = 'terms' | 'privacy' | 'listing-agreement'
export type LegalDoc = {
  key: LegalDocKey
  title: LegalTri
  version: string
  effectiveDate: string
  intro: LegalTri[]
  sections: LegalSection[]
}

export const LEGAL_META: Record<LegalDocKey, { title: LegalTri; path: string }> = {
  terms: { title: { ar: 'شروط الخدمة', en: 'Terms of Service', fr: 'Conditions d’utilisation' }, path: '/terms' },
  privacy: { title: { ar: 'سياسة الخصوصية', en: 'Privacy Policy', fr: 'Politique de confidentialité' }, path: '/privacy' },
  'listing-agreement': { title: { ar: 'اتفاقية النشر', en: 'Listing Agreement', fr: 'Accord de publication' }, path: '/listing-agreement' },
}

export const LEGAL_VERSION = '1.0.0'
export const LEGAL_EFFECTIVE_DATE = '2026-10-09'

const S = (id: string, title: LegalTri, body: LegalTri[]): LegalSection => ({ id, title, body })

// ---------------------------------------------------------------------------------------------
// TERMS OF SERVICE
// ---------------------------------------------------------------------------------------------
const TERMS: LegalDoc = {
  key: 'terms',
  title: LEGAL_META.terms.title,
  version: LEGAL_VERSION,
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  intro: [
    {
      ar: 'تحكم شروط الخدمة هذه استخدامك لمنصة SYBNB ("المنصة", "نحن")، بما في ذلك الموقع والتطبيقات والخدمات المرتبطة بها. باستخدامك للمنصة أو إنشاء حساب فيها، فإنك توافق على هذه الشروط. إن لم توافق عليها، فلا تستخدم المنصة.',
      en: 'These Terms of Service govern your use of the SYBNB platform ("the Platform", "we", "us"), including our website, applications, and related services. By using the Platform or creating an account, you agree to these Terms. If you do not agree, do not use the Platform.',
      fr: 'Les présentes Conditions d’utilisation régissent votre utilisation de la plateforme SYBNB (« la Plateforme », « nous »), y compris le site, les applications et les services associés. En utilisant la Plateforme ou en créant un compte, vous acceptez ces Conditions. Si vous ne les acceptez pas, n’utilisez pas la Plateforme.',
    },
  ],
  sections: [
    S('definitions', { ar: '1. تعريفات', en: '1. Definitions', fr: '1. Définitions' }, [
      {
        ar: '"المستخدم" أي شخص ينشئ حساباً أو يستخدم المنصة. "المضيف/الناشر" مستخدم ينشر إعلاناً (إيجار، بيع، سيارة، سوق، بناء جديد). "الضيف/العميل" مستخدم يرسل طلب حجز أو شراء. "الإعلان" العرض المنشور على المنصة. "الحجز" طلب على إعلان إيجار يومي أو خدمة. "رحلة SR" خدمة التنقّل. "المحفظة" الرصيد الداخلي للمستخدم.',
        en: '"User" means anyone who creates an account or uses the Platform. "Host/Lister" means a User who publishes a listing (rental, sale, car, marketplace, new construction). "Guest/Customer" means a User who sends a booking or purchase request. "Listing" means an offer published on the Platform. "Booking" means a request on a short-term rental or service. "SR ride" means the mobility service. "Wallet" means a User’s internal balance.',
        fr: '« Utilisateur » : toute personne qui crée un compte ou utilise la Plateforme. « Hôte/Annonceur » : un Utilisateur qui publie une annonce (location, vente, voiture, marché, construction neuve). « Invité/Client » : un Utilisateur qui envoie une demande de réservation ou d’achat. « Annonce » : une offre publiée sur la Plateforme. « Réservation » : une demande sur une location de courte durée ou un service. « Course SR » : le service de mobilité. « Portefeuille » : le solde interne d’un Utilisateur.',
      },
    ]),
    S('role', { ar: '2. دور المنصة', en: '2. The role of the Platform', fr: '2. Le rôle de la Plateforme' }, [
      {
        ar: 'المنصة وسيط تقني يتيح للمضيفين والعملاء التواصل وإتمام المعاملات. ما لم يُنص صراحةً على خلاف ذلك، فإن المنصة ليست طرفاً في العقد بين المضيف والعميل، ولا تملك العقارات أو السيارات أو السلع المعروضة ولا تؤجّرها بنفسها. المضيف هو المسؤول عن إعلانه والتزاماته تجاه العميل.',
        en: 'The Platform is a technology intermediary that lets Hosts and Customers connect and transact. Unless expressly stated otherwise, the Platform is not a party to the contract between a Host and a Customer, and does not own, let, or sell the properties, cars, or goods listed. The Host is responsible for its listing and its obligations to the Customer.',
        fr: 'La Plateforme est un intermédiaire technique qui permet aux Hôtes et aux Clients d’entrer en relation et de réaliser des transactions. Sauf mention expresse contraire, la Plateforme n’est pas partie au contrat entre un Hôte et un Client, et ne possède, ne loue ni ne vend les biens, véhicules ou articles annoncés. L’Hôte est responsable de son annonce et de ses obligations envers le Client.',
      },
    ]),
    S('accounts', { ar: '3. الحسابات والأهلية', en: '3. Accounts and eligibility', fr: '3. Comptes et admissibilité' }, [
      {
        ar: 'يجب أن يكون عمرك 18 عاماً على الأقل لإنشاء حساب. يتم التحقق من الحساب عبر رمز لمرة واحدة (OTP) يُرسل إلى بريدك الإلكتروني. أنت مسؤول عن صحة معلوماتك وعن الحفاظ على سرية وسائل الدخول إلى حسابك وعن كل نشاط يجري من خلاله. أبلغنا فوراً بأي استخدام غير مصرّح به.',
        en: 'You must be at least 18 years old to create an account. Accounts are verified by a one-time code (OTP) sent to your email. You are responsible for the accuracy of your information, for keeping your account credentials confidential, and for all activity under your account. Notify us immediately of any unauthorized use.',
        fr: 'Vous devez avoir au moins 18 ans pour créer un compte. Les comptes sont vérifiés par un code à usage unique (OTP) envoyé à votre e-mail. Vous êtes responsable de l’exactitude de vos informations, de la confidentialité de vos identifiants et de toute activité sur votre compte. Signalez-nous immédiatement toute utilisation non autorisée.',
      },
    ]),
    S('listings', { ar: '4. الإعلانات والتزامات المضيف', en: '4. Listings and Host obligations', fr: '4. Annonces et obligations de l’Hôte' }, [
      {
        ar: 'يتعهد المضيف بأن لديه الحق القانوني في نشر الإعلان وتقديم ما يعرضه، وبأن المعلومات والصور والأسعار دقيقة وغير مضلّلة. تخضع الإعلانات لمراجعة الإدارة والتحقق من الهوية قبل النشر، وقد تُرفض أو تُزال الإعلانات المخالفة. يلتزم المضيف بالقوانين المعمول بها بما فيها تراخيص الإيجار والسلامة والضرائب.',
        en: 'The Host represents that it has the legal right to publish the listing and provide what it offers, and that its information, photos, and prices are accurate and not misleading. Listings are subject to admin review and identity verification before publication, and non-compliant listings may be rejected or removed. The Host must comply with applicable laws, including rental, safety, and tax requirements.',
        fr: 'L’Hôte déclare qu’il a le droit légal de publier l’annonce et de fournir ce qu’il propose, et que ses informations, photos et prix sont exacts et non trompeurs. Les annonces sont soumises à une vérification administrative et d’identité avant publication, et les annonces non conformes peuvent être rejetées ou retirées. L’Hôte doit respecter les lois applicables, y compris les exigences de location, de sécurité et fiscales.',
      },
    ]),
    S('bookings-payments', { ar: '5. الحجوزات والمدفوعات', en: '5. Bookings and payments', fr: '5. Réservations et paiements' }, [
      {
        ar: 'عند الحجز على إيجار يومي، يُطلب من العميل تقديم إثبات دفع (محفظة محلية / شام كاش / وسيلة متاحة). تخضع المدفوعات لمراجعة الإدارة للتحقق من استلام المبلغ فعلياً قبل تأكيد الحجز. المبلغ المعروض على العميل يشمل الأجرة والرسوم والضرائب المبيّنة قبل الإرسال. لا يُعتمد أي تأكيد دفع من طرف العميل وحده؛ يُحتسب المبلغ وتُؤكَّد حالته من جانب الخادم والإدارة.',
        en: 'When booking a short-term rental, the Customer is asked to submit a payment proof (local wallet / Sham Cash / an available method). Payments are subject to admin review to confirm the funds were actually received before the booking is confirmed. The amount shown to the Customer includes the rent, fees, and taxes disclosed before submission. No payment is treated as confirmed on the Customer’s word alone; the amount is computed and its status confirmed server-side and by admin review.',
        fr: 'Lors de la réservation d’une location de courte durée, le Client doit soumettre une preuve de paiement (portefeuille local / Sham Cash / un moyen disponible). Les paiements sont soumis à une vérification administrative confirmant la réception effective des fonds avant la confirmation de la réservation. Le montant affiché au Client comprend le loyer, les frais et les taxes indiqués avant l’envoi. Aucun paiement n’est considéré comme confirmé sur la seule parole du Client ; le montant est calculé et son statut confirmé côté serveur et par l’administration.',
      },
    ]),
    S('fees', { ar: '6. الرسوم والعمولة', en: '6. Fees and commission', fr: '6. Frais et commission' }, [
      {
        ar: 'تتقاضى المنصة عمولة على معاملات الإيجار اليومي وقد تطبّق رسوماً أو ضرائب إضافية مبيّنة قبل الدفع. تُحتسب أنصبة المنصة والمضيف من إجمالي ما دفعه العميل بعد تأكيد الدفع. قد تتغير الرسوم مستقبلاً مع إشعار مسبق.',
        en: 'The Platform charges a commission on short-term-rental transactions and may apply additional fees or taxes that are disclosed before payment. The Platform’s and the Host’s shares are computed from the Customer’s total after the payment is confirmed. Fees may change in the future with prior notice.',
        fr: 'La Plateforme prélève une commission sur les transactions de location de courte durée et peut appliquer des frais ou taxes supplémentaires indiqués avant le paiement. Les parts de la Plateforme et de l’Hôte sont calculées à partir du total payé par le Client après confirmation du paiement. Les frais peuvent évoluer à l’avenir moyennant un préavis.',
      },
    ]),
    S('payouts', { ar: '7. مستحقات المضيف والحجز الوقائي', en: '7. Host payouts and protective hold', fr: '7. Versements à l’Hôte et retenue de protection' }, [
      {
        ar: 'تُحجز مستحقات المضيف بعد تأكيد الدفع وتبقى محمية حتى اكتمال الإقامة ومرور مدة الحجز الوقائي (14 يوماً من تاريخ المغادرة) ودون نزاع مفتوح، ثم تُفرَج للمضيف. الهدف حماية العميل وضمان جودة الخدمة. يتم الصرف الفعلي خارج المنصة ويُسجَّل في المحفظة.',
        en: 'Host earnings are held after the payment is confirmed and remain protected until the stay is completed, the protective hold period has passed (14 days after check-out), and there is no open dispute, after which they are released to the Host. This protects the Customer and ensures service quality. Actual disbursement happens off-platform and is recorded in the Wallet.',
        fr: 'Les gains de l’Hôte sont retenus après confirmation du paiement et restent protégés jusqu’à la fin du séjour, l’expiration de la période de retenue (14 jours après le départ) et en l’absence de litige ouvert, puis sont versés à l’Hôte. Cela protège le Client et garantit la qualité du service. Le versement effectif a lieu hors plateforme et est enregistré dans le Portefeuille.',
      },
    ]),
    S('cancellations', { ar: '8. الإلغاء والاسترداد', en: '8. Cancellations and refunds', fr: '8. Annulations et remboursements' }, [
      {
        ar: 'تُعرض سياسة الإلغاء المطبّقة على كل حجز داخل صفحة الإعلان قبل الإرسال. قد يترتب على الإلغاء رسوم بحسب توقيته والسياسة المعلنة. تُعالَج عمليات الاسترداد المستحقة عبر المنصة وتُسجَّل في المحفظة والسجل المالي.',
        en: 'The cancellation policy that applies to each booking is shown on the listing page before submission. A cancellation may incur fees depending on its timing and the stated policy. Eligible refunds are processed through the Platform and recorded in the Wallet and financial ledger.',
        fr: 'La politique d’annulation applicable à chaque réservation est indiquée sur la page de l’annonce avant l’envoi. Une annulation peut entraîner des frais selon son moment et la politique annoncée. Les remboursements éligibles sont traités via la Plateforme et enregistrés dans le Portefeuille et le registre financier.',
      },
    ]),
    S('wallet-gifts', { ar: '9. المحفظة والهدايا', en: '9. Wallet and gifts', fr: '9. Portefeuille et cadeaux' }, [
      {
        ar: 'قد تتيح المنصة رصيد محفظة داخلي وإرسال هدايا رصيد بين المستخدمين. رصيد المحفظة والهدايا ليست عملة قانونية ولا تُصرف نقداً إلا وفق ما تسمح به المنصة، وقد تخضع لمدد صلاحية ومراجعة لمكافحة الاحتيال. تخضع الهدايا غير المُطالَب بها خلال مدة الصلاحية للإلغاء.',
        en: 'The Platform may provide an internal Wallet balance and the ability to send balance gifts between Users. Wallet balance and gifts are not legal tender and are not cashable except as the Platform permits, and may be subject to expiry periods and anti-fraud review. Gifts not claimed within their validity period are subject to cancellation.',
        fr: 'La Plateforme peut fournir un solde de Portefeuille interne et la possibilité d’envoyer des cadeaux de solde entre Utilisateurs. Le solde et les cadeaux ne constituent pas une monnaie légale et ne sont pas convertibles en espèces sauf autorisation de la Plateforme, et peuvent être soumis à des délais d’expiration et à un contrôle anti-fraude. Les cadeaux non réclamés dans leur délai de validité peuvent être annulés.',
      },
    ]),
    S('conduct', { ar: '10. السلوك المحظور', en: '10. Prohibited conduct', fr: '10. Conduite interdite' }, [
      {
        ar: 'يُحظر: نشر معلومات كاذبة أو مضلّلة، الاحتيال أو التحايل على المدفوعات، انتهاك حقوق الغير، نشر محتوى غير قانوني أو مسيء، محاولة اختراق أو إساءة استخدام المنصة، أو استخدامها لغير الغرض المشروع. نحتفظ بحق تعليق أو إنهاء الحسابات المخالفة.',
        en: 'The following are prohibited: posting false or misleading information, fraud or circumventing payments, infringing the rights of others, posting unlawful or abusive content, attempting to hack or misuse the Platform, or using it for any unlawful purpose. We reserve the right to suspend or terminate violating accounts.',
        fr: 'Sont interdits : la publication d’informations fausses ou trompeuses, la fraude ou le contournement des paiements, la violation des droits d’autrui, la publication de contenu illégal ou abusif, les tentatives de piratage ou d’utilisation abusive de la Plateforme, ou son usage à des fins illégales. Nous nous réservons le droit de suspendre ou de résilier les comptes en infraction.',
      },
    ]),
    S('ip', { ar: '11. المحتوى والملكية الفكرية', en: '11. Content and intellectual property', fr: '11. Contenu et propriété intellectuelle' }, [
      {
        ar: 'تبقى حقوق المحتوى الذي ترفعه ملكاً لك، وتمنح المنصة ترخيصاً غير حصري لعرضه واستضافته وترويجه ضمن تشغيل الخدمة. أما علامات SYBNB وتصاميمها وبرمجياتها فهي ملك للمنصة ولا يجوز استخدامها دون إذن.',
        en: 'You retain ownership of the content you upload, and grant the Platform a non-exclusive license to display, host, and promote it as part of operating the service. The SYBNB marks, designs, and software are owned by the Platform and may not be used without permission.',
        fr: 'Vous conservez la propriété du contenu que vous téléversez et accordez à la Plateforme une licence non exclusive pour l’afficher, l’héberger et le promouvoir dans le cadre de l’exploitation du service. Les marques, designs et logiciels SYBNB appartiennent à la Plateforme et ne peuvent être utilisés sans autorisation.',
      },
    ]),
    S('disputes', { ar: '12. النزاعات وقرارات الإدارة', en: '12. Disputes and admin decisions', fr: '12. Litiges et décisions administratives' }, [
      {
        ar: 'عند نشوء نزاع بين مضيف وعميل، قد تتدخّل الإدارة لمراجعة الأدلة المتاحة (إثبات الدفع، حالة الحجز، السجل) واتخاذ قرار تشغيلي بشأن الإفراج عن المستحقات أو الاسترداد. قرارات الإدارة التشغيلية نهائية ضمن المنصة، ولا تمنع الأطراف من اللجوء إلى الجهات المختصة.',
        en: 'When a dispute arises between a Host and a Customer, admins may step in to review the available evidence (payment proof, booking status, records) and make an operational decision about releasing earnings or issuing a refund. Operational admin decisions are final within the Platform and do not prevent the parties from seeking recourse before the competent authorities.',
        fr: 'En cas de litige entre un Hôte et un Client, les administrateurs peuvent intervenir pour examiner les preuves disponibles (preuve de paiement, statut de la réservation, registres) et prendre une décision opérationnelle concernant la libération des gains ou un remboursement. Les décisions administratives opérationnelles sont définitives au sein de la Plateforme et n’empêchent pas les parties de saisir les autorités compétentes.',
      },
    ]),
    S('disclaimer', { ar: '13. إخلاء المسؤولية وحدودها', en: '13. Disclaimers and limitation of liability', fr: '13. Clauses de non-responsabilité et limitation' }, [
      {
        ar: 'تُقدَّم المنصة "كما هي" دون ضمانات صريحة أو ضمنية بخصوص توفّرها الدائم أو خلوّها من الأخطاء. لا تضمن المنصة جودة أو سلامة أو قانونية ما يعرضه المضيفون. إلى الحد الذي يسمح به القانون، لا تتحمل المنصة المسؤولية عن الأضرار غير المباشرة أو التبعية، ويقتصر إجمالي مسؤوليتها عن أي معاملة على قيمة عمولتها من تلك المعاملة.',
        en: 'The Platform is provided "as is" without express or implied warranties regarding continuous availability or being error-free. The Platform does not guarantee the quality, safety, or legality of what Hosts offer. To the extent permitted by law, the Platform is not liable for indirect or consequential damages, and its total liability for any transaction is limited to the commission it earned on that transaction.',
        fr: 'La Plateforme est fournie « telle quelle », sans garantie expresse ou implicite de disponibilité continue ou d’absence d’erreurs. La Plateforme ne garantit pas la qualité, la sécurité ou la légalité de ce que proposent les Hôtes. Dans la mesure permise par la loi, la Plateforme n’est pas responsable des dommages indirects ou consécutifs, et sa responsabilité totale pour toute transaction est limitée à la commission qu’elle a perçue sur celle-ci.',
      },
    ]),
    S('indemnity', { ar: '14. التعويض', en: '14. Indemnification', fr: '14. Indemnisation' }, [
      {
        ar: 'توافق على تعويض المنصة والدفاع عنها عن أي مطالبات أو أضرار ناشئة عن مخالفتك لهذه الشروط أو للقانون أو لحقوق الغير أثناء استخدامك للمنصة.',
        en: 'You agree to indemnify and defend the Platform against any claims or damages arising from your breach of these Terms, of the law, or of the rights of others in connection with your use of the Platform.',
        fr: 'Vous acceptez d’indemniser et de défendre la Plateforme contre toute réclamation ou tout dommage résultant de votre violation des présentes Conditions, de la loi ou des droits d’autrui dans le cadre de votre utilisation de la Plateforme.',
      },
    ]),
    S('law', { ar: '15. القانون الحاكم وتسوية النزاعات', en: '15. Governing law and dispute resolution', fr: '15. Droit applicable et règlement des litiges' }, [
      {
        ar: 'تخضع هذه الشروط لقوانين الجمهورية العربية السورية وتُفسَّر وفقاً لها، وتختص محاكم دمشق بالنظر في أي نزاع ما لم يقضِ قانون آمر بخلاف ذلك. يُشجَّع حل النزاعات ودياً وعبر الدعم أولاً.',
        en: 'These Terms are governed by and construed under the laws of the Syrian Arab Republic, and the courts of Damascus have jurisdiction over any dispute unless a mandatory law provides otherwise. Resolving disputes amicably and through support first is encouraged.',
        fr: 'Les présentes Conditions sont régies et interprétées selon les lois de la République arabe syrienne, et les tribunaux de Damas sont compétents pour tout litige, sauf disposition légale impérative contraire. La résolution amiable des litiges et via le support est encouragée en premier lieu.',
      },
    ]),
    S('changes', { ar: '16. تعديل الشروط', en: '16. Changes to these Terms', fr: '16. Modification des Conditions' }, [
      {
        ar: 'قد نحدّث هذه الشروط من وقت لآخر. عند إجراء تغييرات جوهرية، سنحدّث رقم الإصدار والتاريخ وقد نطلب موافقتك من جديد. استمرارك في استخدام المنصة بعد سريان التعديل يُعدّ قبولاً له.',
        en: 'We may update these Terms from time to time. For material changes, we will update the version number and date and may ask you to accept again. Your continued use of the Platform after a change takes effect constitutes acceptance.',
        fr: 'Nous pouvons mettre à jour ces Conditions de temps à autre. Pour les changements importants, nous mettrons à jour le numéro de version et la date et pourrons vous demander de les accepter à nouveau. Votre utilisation continue de la Plateforme après l’entrée en vigueur d’un changement vaut acceptation.',
      },
    ]),
  ],
}

// ---------------------------------------------------------------------------------------------
// PRIVACY POLICY
// ---------------------------------------------------------------------------------------------
const PRIVACY: LegalDoc = {
  key: 'privacy',
  title: LEGAL_META.privacy.title,
  version: LEGAL_VERSION,
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  intro: [
    {
      ar: 'توضّح سياسة الخصوصية هذه كيف تجمع منصة SYBNB بياناتك وتستخدمها وتحميها عند استخدامك للمنصة. نحن نلتزم بجمع الحد الأدنى اللازم من البيانات لتشغيل الخدمة.',
      en: 'This Privacy Policy explains how the SYBNB platform collects, uses, and protects your data when you use the Platform. We are committed to collecting the minimum data necessary to operate the service.',
      fr: 'La présente Politique de confidentialité explique comment la plateforme SYBNB collecte, utilise et protège vos données lorsque vous utilisez la Plateforme. Nous nous engageons à collecter le minimum de données nécessaire au fonctionnement du service.',
    },
  ],
  sections: [
    S('collect', { ar: '1. البيانات التي نجمعها', en: '1. Data we collect', fr: '1. Données que nous collectons' }, [
      {
        ar: 'بيانات الحساب (الاسم، البريد الإلكتروني، واللغة)، وبيانات التحقق (رمز OTP، ووثيقة الهوية عند طلب التحقق للمضيفين)، ورقم الهاتف الذي يُخزَّن بشكل مُجزَّأ (hash) لا يكشف الرقم، وإثباتات الدفع التي ترفعها، وتفاصيل الإعلانات والحجوزات والمحفظة، وبيانات الاستخدام التقنية (سجلات، جهاز)، وبيانات الموقع عند استخدام خدمة SR للرحلات.',
        en: 'Account data (name, email, language), verification data (OTP code, and an identity document when host verification is required), your phone number stored as a non-reversible hash that does not reveal the number, payment proofs you upload, listing/booking/Wallet details, technical usage data (logs, device), and location data when you use the SR ride service.',
        fr: 'Données de compte (nom, e-mail, langue), données de vérification (code OTP et un document d’identité lorsque la vérification de l’hôte est requise), votre numéro de téléphone stocké sous forme de hachage non réversible qui ne révèle pas le numéro, les preuves de paiement que vous téléversez, les détails des annonces/réservations/Portefeuille, les données techniques d’utilisation (journaux, appareil) et les données de localisation lorsque vous utilisez le service de course SR.',
      },
    ]),
    S('use', { ar: '2. كيف نستخدم بياناتك', en: '2. How we use your data', fr: '2. Comment nous utilisons vos données' }, [
      {
        ar: 'لإنشاء حسابك والتحقق منه، وتشغيل الإعلانات والحجوزات والمدفوعات، ومراجعة الالتزام ومكافحة الاحتيال، وتقديم الدعم، وإرسال إشعارات الخدمة ورموز التحقق، وتحسين المنصة. لا نبيع بياناتك الشخصية.',
        en: 'To create and verify your account, operate listings/bookings/payments, perform compliance review and fraud prevention, provide support, send service notifications and verification codes, and improve the Platform. We do not sell your personal data.',
        fr: 'Pour créer et vérifier votre compte, exploiter les annonces/réservations/paiements, effectuer des contrôles de conformité et prévenir la fraude, fournir une assistance, envoyer des notifications de service et des codes de vérification, et améliorer la Plateforme. Nous ne vendons pas vos données personnelles.',
      },
    ]),
    S('sharing', { ar: '3. مشاركة البيانات', en: '3. Data sharing', fr: '3. Partage des données' }, [
      {
        ar: 'نشارك الحد اللازم من البيانات بين المضيف والعميل لإتمام المعاملة، ومع مزوّدي خدمات موثوقين (مثل مزوّد البريد الإلكتروني لإرسال الرموز، ومزوّدي الاستضافة والدفع) ضمن حدود الخدمة، وعند الطلب القانوني من جهة مختصة. نلزم مزوّدينا بحماية بياناتك.',
        en: 'We share the necessary minimum between a Host and a Customer to complete a transaction, with trusted service providers (such as our email provider to send codes, and our hosting and payment providers) within the scope of the service, and when legally required by a competent authority. We require our providers to protect your data.',
        fr: 'Nous partageons le minimum nécessaire entre un Hôte et un Client pour réaliser une transaction, avec des prestataires de confiance (comme notre fournisseur d’e-mail pour envoyer les codes, et nos prestataires d’hébergement et de paiement) dans le cadre du service, et lorsque la loi l’exige à la demande d’une autorité compétente. Nous exigeons de nos prestataires qu’ils protègent vos données.',
      },
    ]),
    S('security', { ar: '4. الأمان', en: '4. Security', fr: '4. Sécurité' }, [
      {
        ar: 'نطبّق إجراءات أمنية تقنية وتنظيمية، منها تجزئة رقم الهاتف وكلمات المرور، والتحقق عبر رموز لمرة واحدة، وتقييد الوصول، وتشفير الاتصال. لا يمكن ضمان أمان مطلق، لكننا نعمل على حماية بياناتك باستمرار.',
        en: 'We apply technical and organizational security measures, including hashing of phone numbers and passwords, one-time-code verification, access restrictions, and encryption in transit. Absolute security cannot be guaranteed, but we continuously work to protect your data.',
        fr: 'Nous appliquons des mesures de sécurité techniques et organisationnelles, dont le hachage des numéros de téléphone et des mots de passe, la vérification par code à usage unique, des restrictions d’accès et le chiffrement en transit. Une sécurité absolue ne peut être garantie, mais nous travaillons en continu à protéger vos données.',
      },
    ]),
    S('retention', { ar: '5. مدة الاحتفاظ', en: '5. Data retention', fr: '5. Conservation des données' }, [
      {
        ar: 'نحتفظ ببياناتك طالما كان حسابك فعّالاً وبالقدر اللازم لتقديم الخدمة والامتثال للالتزامات القانونية والمحاسبية وحل النزاعات. عند عدم الحاجة، نحذف البيانات أو نجعلها مجهولة المصدر.',
        en: 'We retain your data for as long as your account is active and as needed to provide the service and comply with legal, accounting, and dispute-resolution obligations. When no longer needed, we delete or anonymize the data.',
        fr: 'Nous conservons vos données tant que votre compte est actif et dans la mesure nécessaire pour fournir le service et respecter les obligations légales, comptables et de règlement des litiges. Lorsqu’elles ne sont plus nécessaires, nous les supprimons ou les anonymisons.',
      },
    ]),
    S('rights', { ar: '6. حقوقك', en: '6. Your rights', fr: '6. Vos droits' }, [
      {
        ar: 'يحق لك الاطلاع على بياناتك وتصحيحها وطلب حذف حسابك ضمن ما يسمح به القانون والالتزامات القائمة. لممارسة حقوقك تواصل معنا عبر بيانات التواصل أدناه. قد نحتاج للتحقق من هويتك قبل تنفيذ الطلب.',
        en: 'You have the right to access and correct your data and to request deletion of your account within what the law and existing obligations permit. To exercise your rights, contact us using the details below. We may need to verify your identity before acting on a request.',
        fr: 'Vous avez le droit d’accéder à vos données, de les corriger et de demander la suppression de votre compte dans la mesure permise par la loi et les obligations existantes. Pour exercer vos droits, contactez-nous via les coordonnées ci-dessous. Nous pourrons devoir vérifier votre identité avant de donner suite.',
      },
    ]),
    S('cookies', { ar: '7. ملفات التعريف والتخزين المحلي', en: '7. Cookies and local storage', fr: '7. Cookies et stockage local' }, [
      {
        ar: 'نستخدم تخزيناً محلياً وملفات ضرورية لتشغيل الجلسة وتذكّر تفضيلاتك (مثل اللغة). لا نستخدمها لأغراض إعلانية تتبّعية من أطراف ثالثة.',
        en: 'We use local storage and essential files to run your session and remember your preferences (such as language). We do not use them for third-party advertising tracking.',
        fr: 'Nous utilisons le stockage local et des fichiers essentiels pour exécuter votre session et mémoriser vos préférences (comme la langue). Nous ne les utilisons pas à des fins de suivi publicitaire tiers.',
      },
    ]),
    S('children', { ar: '8. الأطفال', en: '8. Children', fr: '8. Mineurs' }, [
      {
        ar: 'المنصة غير موجّهة لمن هم دون 18 عاماً، ولا نجمع بياناتهم عن قصد. إذا علمنا بجمع بيانات قاصر دون سند، نحذفها.',
        en: 'The Platform is not directed to anyone under 18, and we do not knowingly collect their data. If we learn that a minor’s data was collected without a lawful basis, we delete it.',
        fr: 'La Plateforme ne s’adresse pas aux personnes de moins de 18 ans, et nous ne collectons pas sciemment leurs données. Si nous apprenons que les données d’un mineur ont été collectées sans base légale, nous les supprimons.',
      },
    ]),
    S('changes', { ar: '9. تعديل السياسة', en: '9. Changes to this Policy', fr: '9. Modification de la Politique' }, [
      {
        ar: 'قد نحدّث هذه السياسة مع تطوّر الخدمة أو المتطلبات القانونية. سنحدّث رقم الإصدار والتاريخ عند أي تغيير جوهري.',
        en: 'We may update this Policy as the service or legal requirements evolve. We will update the version number and date for any material change.',
        fr: 'Nous pouvons mettre à jour cette Politique à mesure que le service ou les exigences légales évoluent. Nous mettrons à jour le numéro de version et la date pour tout changement important.',
      },
    ]),
  ],
}

// ---------------------------------------------------------------------------------------------
// LISTING AGREEMENT
// ---------------------------------------------------------------------------------------------
const LISTING: LegalDoc = {
  key: 'listing-agreement',
  title: LEGAL_META['listing-agreement'].title,
  version: LEGAL_VERSION,
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  intro: [
    {
      ar: 'يجب على كل مضيف/ناشر قبول اتفاقية النشر هذه واجتياز التحقق من الهوية قبل نشر أي إعلان على المنصة، في جميع الأقسام. تكمّل هذه الاتفاقية شروط الخدمة ولا تحلّ محلها.',
      en: 'Every Host/Lister must accept this Listing Agreement and pass identity verification before publishing any listing on the Platform, in any division. This Agreement supplements, and does not replace, the Terms of Service.',
      fr: 'Chaque Hôte/Annonceur doit accepter le présent Accord de publication et réussir la vérification d’identité avant de publier une annonce sur la Plateforme, dans toutes les sections. Cet Accord complète, sans les remplacer, les Conditions d’utilisation.',
    },
  ],
  sections: [
    S('eligibility', { ar: '1. الأهلية والتحقق', en: '1. Eligibility and verification', fr: '1. Admissibilité et vérification' }, [
      {
        ar: 'تقرّ بأنك بالغ (18 عاماً فأكثر) وتملك الأهلية القانونية، وتوافق على التحقق من هويتك عبر رفع وثيقة رسمية عند الطلب. لا يُنشر الإعلان قبل اكتمال المتطلبات المطلوبة.',
        en: 'You confirm that you are an adult (18+) with legal capacity, and you agree to identity verification by uploading an official document when requested. A listing is not published until the required steps are complete.',
        fr: 'Vous confirmez être majeur (18 ans ou plus) et avoir la capacité juridique, et vous acceptez la vérification d’identité par le téléversement d’un document officiel sur demande. Une annonce n’est pas publiée avant l’achèvement des étapes requises.',
      },
    ]),
    S('rightto-list', { ar: '2. الحق في النشر ودقة الإعلان', en: '2. Right to list and listing accuracy', fr: '2. Droit de publier et exactitude de l’annonce' }, [
      {
        ar: 'تتعهد بأن لديك الحق القانوني الكامل في عرض العقار أو السيارة أو السلعة أو الخدمة، وبأن كل المعلومات والصور والأسعار والتوافر دقيقة وحديثة وغير مضلّلة. تتحمل وحدك مسؤولية صحة إعلانك.',
        en: 'You represent that you have the full legal right to offer the property, car, good, or service, and that all information, photos, prices, and availability are accurate, current, and not misleading. You are solely responsible for the accuracy of your listing.',
        fr: 'Vous déclarez avoir le plein droit légal d’offrir le bien, le véhicule, l’article ou le service, et que toutes les informations, photos, prix et disponibilités sont exacts, à jour et non trompeurs. Vous êtes seul responsable de l’exactitude de votre annonce.',
      },
    ]),
    S('compliance', { ar: '3. الالتزام القانوني والسلامة', en: '3. Legal compliance and safety', fr: '3. Conformité légale et sécurité' }, [
      {
        ar: 'تلتزم بكل القوانين والتراخيص المطبّقة على نشاطك (الإيجار، البيع، النقل)، وبمعايير السلامة الأساسية، وبعدم عرض ما هو محظور قانوناً. أي ضرائب أو رسوم حكومية مترتبة على نشاطك تقع على عاتقك.',
        en: 'You comply with all laws and licenses applicable to your activity (renting, selling, transport), with basic safety standards, and you do not offer anything legally prohibited. Any taxes or governmental fees arising from your activity are your responsibility.',
        fr: 'Vous respectez toutes les lois et licences applicables à votre activité (location, vente, transport), les normes de sécurité de base, et vous n’offrez rien d’illégal. Toute taxe ou redevance publique découlant de votre activité est à votre charge.',
      },
    ]),
    S('pricing-payouts', { ar: '4. التسعير والعمولة والمستحقات', en: '4. Pricing, commission, and payouts', fr: '4. Tarification, commission et versements' }, [
      {
        ar: 'تحدّد أسعارك بوضوح. تخصم المنصة عمولتها ورسومها المعلنة من إجمالي ما يدفعه العميل. تُحجز مستحقاتك وتبقى محمية حتى اكتمال الإقامة ومرور مدة الحجز الوقائي (14 يوماً) ودون نزاع، ثم تُفرَج. تتم المطابقة المالية والصرف عبر المنصة ويُسجَّل في المحفظة.',
        en: 'You set your prices clearly. The Platform deducts its disclosed commission and fees from the Customer’s total. Your earnings are held and remain protected until the stay is completed, the protective hold period (14 days) has passed, and there is no dispute, after which they are released. Financial reconciliation and disbursement occur through the Platform and are recorded in the Wallet.',
        fr: 'Vous fixez vos prix clairement. La Plateforme déduit sa commission et ses frais annoncés du total payé par le Client. Vos gains sont retenus et protégés jusqu’à la fin du séjour, l’expiration de la période de retenue (14 jours) et en l’absence de litige, puis libérés. Le rapprochement financier et le versement se font via la Plateforme et sont enregistrés dans le Portefeuille.',
      },
    ]),
    S('bookings', { ar: '5. التعامل مع الحجوزات والعملاء', en: '5. Handling bookings and customers', fr: '5. Gestion des réservations et des clients' }, [
      {
        ar: 'تلتزم بالرد على الطلبات واحترام الحجوزات المؤكدة وتقديم الخدمة كما وصفتها، والتعامل باحترام مع العملاء. الإلغاء المتكرر أو عدم الوفاء قد يؤدي إلى تقييد حسابك.',
        en: 'You agree to respond to requests, honor confirmed bookings, provide the service as described, and treat customers respectfully. Repeated cancellations or non-fulfilment may result in restrictions on your account.',
        fr: 'Vous acceptez de répondre aux demandes, d’honorer les réservations confirmées, de fournir le service tel que décrit et de traiter les clients avec respect. Des annulations répétées ou un non-respect des engagements peuvent entraîner des restrictions sur votre compte.',
      },
    ]),
    S('prohibited', { ar: '6. الإعلانات المحظورة', en: '6. Prohibited listings', fr: '6. Annonces interdites' }, [
      {
        ar: 'يُحظر نشر ما هو غير قانوني أو مزوّر أو خطير أو ينتهك حقوق الغير أو يخالف سياسات المنصة. تحتفظ المنصة بحق رفض أو إزالة أي إعلان دون إشعار مسبق عند المخالفة.',
        en: 'Publishing anything unlawful, counterfeit, dangerous, infringing the rights of others, or violating Platform policies is prohibited. The Platform reserves the right to reject or remove any listing without prior notice in case of violation.',
        fr: 'Il est interdit de publier tout contenu illégal, contrefait, dangereux, portant atteinte aux droits d’autrui ou contraire aux politiques de la Plateforme. La Plateforme se réserve le droit de rejeter ou de retirer toute annonce sans préavis en cas de violation.',
      },
    ]),
    S('license', { ar: '7. ترخيص المحتوى', en: '7. Content license', fr: '7. Licence de contenu' }, [
      {
        ar: 'تمنح المنصة ترخيصاً غير حصري لاستخدام صور ونصوص إعلانك لعرضه والترويج له ضمن تشغيل الخدمة. تؤكد أنك تملك حقوق المحتوى الذي ترفعه أو حصلت على إذن باستخدامه.',
        en: 'You grant the Platform a non-exclusive license to use your listing’s photos and text to display and promote it as part of operating the service. You confirm that you own the content you upload or have permission to use it.',
        fr: 'Vous accordez à la Plateforme une licence non exclusive d’utiliser les photos et textes de votre annonce pour l’afficher et la promouvoir dans le cadre de l’exploitation du service. Vous confirmez posséder le contenu téléversé ou avoir l’autorisation de l’utiliser.',
      },
    ]),
    S('review', { ar: '8. مراجعة الإدارة والإزالة', en: '8. Admin review and removal', fr: '8. Examen administratif et retrait' }, [
      {
        ar: 'تخضع الإعلانات لمراجعة الإدارة قبل النشر وبعده. يجوز للإدارة طلب تعديلات أو تعليق أو إزالة إعلان لا يستوفي المعايير أو يخالف الشروط، مع إشعارك بالسبب حيثما أمكن.',
        en: 'Listings are subject to admin review before and after publication. Admins may request changes, suspend, or remove a listing that does not meet standards or breaches the Terms, notifying you of the reason where possible.',
        fr: 'Les annonces sont soumises à un examen administratif avant et après publication. Les administrateurs peuvent demander des modifications, suspendre ou retirer une annonce non conforme aux normes ou contraire aux Conditions, en vous indiquant le motif lorsque c’est possible.',
      },
    ]),
    S('liability', { ar: '9. المسؤولية والتعويض', en: '9. Liability and indemnification', fr: '9. Responsabilité et indemnisation' }, [
      {
        ar: 'تتحمل المسؤولية الكاملة عن إعلانك وعمّا تقدّمه للعميل، وتوافق على تعويض المنصة عن أي مطالبة ناشئة عن مخالفتك لهذه الاتفاقية أو للقانون أو لحقوق الغير.',
        en: 'You bear full responsibility for your listing and what you provide to the Customer, and you agree to indemnify the Platform against any claim arising from your breach of this Agreement, the law, or the rights of others.',
        fr: 'Vous assumez l’entière responsabilité de votre annonce et de ce que vous fournissez au Client, et vous acceptez d’indemniser la Plateforme contre toute réclamation résultant de votre violation du présent Accord, de la loi ou des droits d’autrui.',
      },
    ]),
    S('termination', { ar: '10. المدة والإنهاء', en: '10. Term and termination', fr: '10. Durée et résiliation' }, [
      {
        ar: 'تسري هذه الاتفاقية طوال نشرك لإعلانات على المنصة. يجوز لأي طرف إنهاؤها، وتظل الأحكام المتعلقة بالالتزامات القائمة والمسؤولية والتعويض سارية بعد الإنهاء.',
        en: 'This Agreement applies for as long as you publish listings on the Platform. Either party may terminate it, and the provisions on existing obligations, liability, and indemnification survive termination.',
        fr: 'Le présent Accord s’applique tant que vous publiez des annonces sur la Plateforme. Chaque partie peut y mettre fin, et les dispositions relatives aux obligations existantes, à la responsabilité et à l’indemnisation survivent à la résiliation.',
      },
    ]),
    S('acceptance', { ar: '11. القبول', en: '11. Acceptance', fr: '11. Acceptation' }, [
      {
        ar: 'بقبولك هذه الاتفاقية ونشرك إعلاناً، تقرّ بأنك قرأتها وفهمتها ووافقت عليها وعلى شروط الخدمة وسياسة الخصوصية.',
        en: 'By accepting this Agreement and publishing a listing, you acknowledge that you have read, understood, and agreed to it, together with the Terms of Service and the Privacy Policy.',
        fr: 'En acceptant le présent Accord et en publiant une annonce, vous reconnaissez l’avoir lu, compris et accepté, ainsi que les Conditions d’utilisation et la Politique de confidentialité.',
      },
    ]),
  ],
}

export const LEGAL_DOCS: Record<LegalDocKey, LegalDoc> = {
  terms: TERMS,
  privacy: PRIVACY,
  'listing-agreement': LISTING,
}

export function legalText(tri: LegalTri, lang: Lang): string {
  return tri[lang] ?? tri.en
}
