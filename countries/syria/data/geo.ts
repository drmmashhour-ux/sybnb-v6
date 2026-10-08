import { OSM_SYRIA_ROAD_CITIES } from './roads'

export type SyriaPlaceLabel = {
  key: string
  ar: string
  en: string
}

export type SyrianArea = SyriaPlaceLabel

export type SyrianCity = SyriaPlaceLabel & {
  areas: SyrianArea[]
}

export type SyrianGovernorate = SyriaPlaceLabel & {
  cities: SyrianCity[]
}

const commonCityAreas = [
  { key: 'city-center', ar: 'مركز المدينة', en: 'City Center' },
  { key: 'old-town', ar: 'المدينة القديمة', en: 'Old Town' },
  { key: 'market', ar: 'السوق', en: 'Market' },
]

const MANUAL_SYRIA_GOVERNORATES: SyrianGovernorate[] = [
  {
    key: 'damascus',
    ar: 'دمشق',
    en: 'Damascus',
    cities: [
      {
        key: 'damascus-city',
        ar: 'دمشق',
        en: 'Damascus City',
        areas: [
          { key: 'old-city', ar: 'المدينة القديمة', en: 'Old City' },
          { key: 'straight-street', ar: 'الشارع المستقيم', en: 'Straight Street / Via Recta' },
          { key: 'midhat-pasha', ar: 'شارع مدحت باشا', en: 'Midhat Pasha Street' },
          { key: 'al-armin', ar: 'شارع العرمين', en: 'Al Armin Street' },
          { key: 'souweqah-street', ar: 'شارع السويقة', en: 'Souweqah Street' },
          { key: 'al-borghol', ar: 'شارع البرغل', en: 'Al-Borghol Street' },
          { key: 'khan-al-magharib', ar: 'شارع خان المغاربة', en: 'Khan al-Magharib Street' },
          { key: 'bab-touma', ar: 'باب توما', en: 'Bab Touma' },
          { key: 'bab-sraijah-street', ar: 'شارع باب سريجة', en: 'Bab Sraijah Street' },
          { key: 'bab-al-jabiya', ar: 'شارع باب الجابية', en: 'Bab Al-Jabiya Street' },
          { key: 'badawi-street', ar: 'شارع البدوي', en: 'Badawi Street' },
          { key: 'souk-al-hamidiyah', ar: 'سوق الحميدية', en: 'Souk al-Hamidiyah' },
          { key: 'souk-el-fakhra', ar: 'سوق الفخرا', en: 'Souk el-Fakhra' },
          { key: 'malki', ar: 'المالكي', en: 'Malki' },
          { key: 'adnan-al-malki', ar: 'شارع عدنان المالكي', en: 'Adnan al-Malki Street' },
          { key: 'abu-rummaneh', ar: 'أبو رمانة', en: 'Abu Rummaneh' },
          { key: 'abu-rummaneh-street', ar: 'شارع أبو رمانة', en: 'Abu Rummaneh Street' },
          { key: 'paris-square', ar: 'ساحة باريس', en: 'Paris Square' },
          { key: 'shaalan', ar: 'الشعلان', en: 'Shaalan' },
          { key: 'hamra-street', ar: 'شارع الحمراء', en: 'Hamra Street' },
          { key: 'shaalan-street', ar: 'شارع الشعلان', en: 'Shaalan Street' },
          { key: 'salhiyeh', ar: 'الصالحية', en: 'Salhiyeh' },
          { key: 'salhiyeh-street', ar: 'شارع الصالحية', en: 'Salhiyeh Street' },
          { key: 'al-naser-street', ar: 'شارع النصر', en: 'An Naser Street' },
          { key: 'mezzeh', ar: 'المزة', en: 'Mezzeh' },
          { key: 'mazzeh-highway', ar: 'أوتوستراد المزة', en: 'Mazzeh Highway' },
          { key: 'mezzeh-86', ar: 'المزة 86', en: 'Mezzeh 86' },
          { key: 'kafr-sousa', ar: 'كفر سوسة', en: 'Kafr Sousa' },
          { key: 'barzeh', ar: 'برزة', en: 'Barzeh' },
          { key: 'dummar', ar: 'دمر', en: 'Dummar' },
          { key: 'muhajirin', ar: 'المهاجرين', en: 'Muhajirin' },
          { key: 'qaymariya', ar: 'القيمرية', en: 'Qaymariya' },
          { key: 'harat-al-qaymariya', ar: 'حارة القيمرية', en: 'Harat al-Qaymariya' },
          { key: 'souweqah', ar: 'السويقة', en: 'Souweqah' },
          { key: 'midan', ar: 'الميدان', en: 'Midan' },
          { key: 'qanawat', ar: 'القنوات', en: 'Qanawat' },
          { key: 'al-qanawat-lane', ar: 'حارة القنوات', en: 'Al Qanawat Lane' },
          { key: 'bab-sreijeh', ar: 'باب سريجة', en: 'Bab Sreijeh' },
          { key: 'barada-street', ar: 'شارع بردى', en: 'Barada Street' },
          { key: 'jamal-abdel-nasser', ar: 'شارع جمال عبد الناصر', en: 'Jamal Abdel Nasser Street' },
          { key: 'saadallah-al-jabri', ar: 'شارع سعد الله الجابري', en: "Sa'adallah al-Jabri Street" },
          { key: 'ataa-al-ayoubi', ar: 'شارع عطاء الأيوبي', en: 'Ataa al-Ayoubi Street' },
          { key: 'atif-street', ar: 'شارع عاطف', en: 'Atif Street' },
          { key: 'hafez-ibrahim', ar: 'شارع حافظ إبراهيم', en: 'Hafez Ibrahim Street' },
          { key: 'majlis-al-niyabi', ar: 'شارع مجلس النواب', en: 'Majlis an-Niyabi Street' },
          { key: 'jawaharlal-nehru', ar: 'شارع جواهر لال نهرو', en: 'Jawaharlal Nehru Street' },
          { key: 'sarouja-road', ar: 'طريق ساروجة', en: 'Sarouja Road' },
          { key: 'souk-sarouja', ar: 'سوق ساروجة', en: 'Souk Sarouja' },
          { key: 'shoukry-al-quowatly', ar: 'شارع شكري القوتلي', en: 'Shoukry al-Quowatly Street' },
          { key: 'khaled-ibn-al-walid', ar: 'شارع خالد بن الوليد', en: 'Khaled Ibn Al Walid Street' },
          { key: 'al-thawra-street', ar: 'شارع الثورة', en: 'Al Thawra Street' },
          { key: 'al-jalaa-street', ar: 'شارع الجلاء', en: 'Al-Jalaa Street' },
          { key: 'aal-al-bait-street', ar: 'شارع آل البيت', en: 'Aal al-Bait Street' },
          { key: 'al-mansur-street', ar: 'شارع المنصور', en: 'Al-Mansur Street' },
          { key: 'harat-al-sharaf', ar: 'حارة الشرف الأعلى', en: "Harat al-Sharaf al-A'la Street" },
        ],
      },
    ],
  },
  {
    key: 'rif-dimashq',
    ar: 'ريف دمشق',
    en: 'Rif Dimashq',
    cities: [
      { key: 'jaramana', ar: 'جرمانا', en: 'Jaramana', areas: commonCityAreas },
      { key: 'qudsaya', ar: 'قدسيا', en: 'Qudsaya', areas: commonCityAreas },
      { key: 'sahnaya', ar: 'صحنايا', en: 'Sahnaya', areas: commonCityAreas },
      { key: 'douma', ar: 'دوما', en: 'Douma', areas: commonCityAreas },
      { key: 'harasta', ar: 'حرستا', en: 'Harasta', areas: commonCityAreas },
      { key: 'darayya', ar: 'داريا', en: 'Darayya', areas: commonCityAreas },
      {
        key: 'sayyidah-zaynab',
        ar: 'السيدة زينب',
        en: 'Sayyidah Zaynab',
        areas: [
          { key: 'al-hawra', ar: 'شارع الحوراء', en: 'Al-Hawra Street' },
          { key: 'basil-al-assad', ar: 'شارع باسل الأسد', en: 'Basil al-Assad Street' },
          { key: 'center', ar: 'المركز', en: 'Center' },
        ],
      },
      { key: 'maaloula', ar: 'معلولا', en: 'Maaloula', areas: commonCityAreas },
    ],
  },
  {
    key: 'aleppo',
    ar: 'حلب',
    en: 'Aleppo',
    cities: [
      {
        key: 'aleppo-city',
        ar: 'حلب',
        en: 'Aleppo City',
        areas: [
          { key: 'city-center', ar: 'مركز المدينة', en: 'City Center' },
          { key: 'shahba', ar: 'الشهباء', en: 'Shahba' },
          { key: 'aziziyeh', ar: 'العزيزية', en: 'Aziziyeh' },
          { key: 'jamiliyeh', ar: 'الجميلية', en: 'Jamiliyeh' },
          { key: 'new-aleppo', ar: 'حلب الجديدة', en: 'New Aleppo' },
          { key: 'king-faisal', ar: 'شارع الملك فيصل', en: 'King Faisal Street' },
          { key: 'bab-al-faraj', ar: 'باب الفرج', en: 'Bab al-Faraj' },
          { key: 'baron-street', ar: 'شارع بارون', en: 'Baron Street' },
          { key: 'baghdad-station', ar: 'محطة بغداد', en: 'Baghdad Station' },
          { key: 'al-sabil', ar: 'السبيل', en: 'Al-Sabil' },
          { key: 'al-furqan', ar: 'الفرقان', en: 'Al-Furqan' },
          { key: 'al-midan', ar: 'الميدان', en: 'Al-Midan' },
          { key: 'university-area', ar: 'منطقة الجامعة', en: 'University Area' },
          { key: 'aleppo-citadel', ar: 'منطقة القلعة', en: 'Citadel Area' },
          { key: 'al-jalloum', ar: 'الجلوم', en: 'Al-Jalloum' },
          { key: 'suleimaniyeh', ar: 'السليمانية', en: 'Suleimaniyeh' },
        ],
      },
      { key: 'manbij', ar: 'منبج', en: 'Manbij', areas: commonCityAreas },
      { key: 'azaz', ar: 'اعزاز', en: 'Azaz', areas: commonCityAreas },
      { key: 'al-bab', ar: 'الباب', en: 'Al-Bab', areas: commonCityAreas },
    ],
  },
  {
    key: 'homs',
    ar: 'حمص',
    en: 'Homs',
    cities: [
      {
        key: 'homs-city',
        ar: 'حمص',
        en: 'Homs City',
        areas: [
          { key: 'city-center', ar: 'مركز المدينة', en: 'City Center' },
          { key: 'waer', ar: 'الوعر', en: 'Al-Waer' },
          { key: 'hamra', ar: 'الحمرا', en: 'Hamra' },
          { key: 'khaldiyeh', ar: 'الخالدية', en: 'Khaldiyeh' },
          { key: 'inshaat', ar: 'الإنشاءات', en: 'Inshaat' },
          { key: 'dablan-street', ar: 'شارع دبلان', en: 'Dablan Street' },
          { key: 'al-ghouta', ar: 'الغوطة', en: 'Al-Ghouta' },
          { key: 'al-mahatta', ar: 'المحطة', en: 'Al-Mahatta' },
          { key: 'al-qusour', ar: 'القصور', en: 'Al-Qusour' },
          { key: 'al-zahra', ar: 'الزهراء', en: 'Al-Zahra' },
          { key: 'al-hadara', ar: 'الحضارة', en: 'Al-Hadara' },
          { key: 'al-arman', ar: 'الأرمن', en: 'Al-Arman' },
          { key: 'fairouzah-road', ar: 'طريق فيروزة', en: 'Fairouzah Road' },
        ],
      },
      { key: 'tadmur', ar: 'تدمر', en: 'Palmyra', areas: commonCityAreas },
      { key: 'talkalakh', ar: 'تلكلخ', en: 'Talkalakh', areas: commonCityAreas },
      { key: 'al-rastan', ar: 'الرستن', en: 'Al-Rastan', areas: commonCityAreas },
    ],
  },
  {
    key: 'hama',
    ar: 'حماة',
    en: 'Hama',
    cities: [
      { key: 'hama-city', ar: 'حماة', en: 'Hama City', areas: [{ key: 'city-center', ar: 'مركز المدينة', en: 'City Center' }, { key: 'hadir', ar: 'الحاضر', en: 'Al-Hadir' }, { key: 'baroudiyeh', ar: 'البارودية', en: 'Baroudiyeh' }, { key: 'assi-square', ar: 'ساحة العاصي', en: 'Assi Square' }, { key: 'bab-qibli', ar: 'باب قبلي', en: 'Bab Qibli' }, { key: 'souk-al-taweel', ar: 'السوق الطويل', en: 'Souk al-Taweel' }, { key: 'al-marabet', ar: 'المرابط', en: 'Al-Marabet' }, { key: 'al-karama', ar: 'الكرامة', en: 'Al-Karama' }] },
      { key: 'salamiyah', ar: 'السلمية', en: 'Salamiyah', areas: commonCityAreas },
      { key: 'mahardah', ar: 'محردة', en: 'Mahardah', areas: commonCityAreas },
      { key: 'masyaf', ar: 'مصياف', en: 'Masyaf', areas: commonCityAreas },
    ],
  },
  {
    key: 'latakia',
    ar: 'اللاذقية',
    en: 'Latakia',
    cities: [
      { key: 'latakia-city', ar: 'اللاذقية', en: 'Latakia City', areas: [{ key: 'city-center', ar: 'مركز المدينة', en: 'City Center' }, { key: 'project-10', ar: 'المشروع العاشر', en: 'Project 10' }, { key: 'project-7', ar: 'المشروع السابع', en: 'Project 7' }, { key: 'corniche', ar: 'الكورنيش', en: 'Corniche' }, { key: 'sheikh-daher', ar: 'الشيخ ضاهر', en: 'Sheikh Daher' }, { key: 'baghdad-street', ar: 'شارع بغداد', en: 'Baghdad Street' }, { key: '8-azar', ar: 'شارع 8 آذار', en: '8 Azar Street' }, { key: 'salibeh', ar: 'الصليبة', en: 'Salibeh' }, { key: 'southern-raml', ar: 'الرمل الجنوبي', en: 'Southern Raml' }, { key: 'university-area', ar: 'منطقة الجامعة', en: 'University Area' }] },
      { key: 'jableh', ar: 'جبلة', en: 'Jableh', areas: commonCityAreas },
      { key: 'qardaha', ar: 'القرداحة', en: 'Qardaha', areas: commonCityAreas },
      { key: 'al-haffa', ar: 'الحفة', en: 'Al-Haffa', areas: commonCityAreas },
    ],
  },
  {
    key: 'tartus',
    ar: 'طرطوس',
    en: 'Tartus',
    cities: [
      { key: 'tartus-city', ar: 'طرطوس', en: 'Tartus City', areas: [{ key: 'city-center', ar: 'مركز المدينة', en: 'City Center' }, { key: 'corniche', ar: 'الكورنيش', en: 'Corniche' }, { key: 'safsafa', ar: 'الصفصافة', en: 'Safsafa' }, { key: 'port-area', ar: 'منطقة المرفأ', en: 'Port Area' }, { key: 'al-thawra-street', ar: 'شارع الثورة', en: 'Al Thawra Street' }, { key: 'al-mina', ar: 'الميناء', en: 'Al-Mina' }, { key: 'old-souk', ar: 'السوق القديم', en: 'Old Souk' }] },
      { key: 'baniyas', ar: 'بانياس', en: 'Baniyas', areas: commonCityAreas },
      { key: 'safita', ar: 'صافيتا', en: 'Safita', areas: commonCityAreas },
      { key: 'dreikish', ar: 'الدريكيش', en: 'Dreikish', areas: commonCityAreas },
    ],
  },
  {
    key: 'idlib',
    ar: 'إدلب',
    en: 'Idlib',
    cities: [
      { key: 'idlib-city', ar: 'إدلب', en: 'Idlib City', areas: [{ key: 'city-center', ar: 'مركز المدينة', en: 'City Center' }, { key: 'university', ar: 'الجامعة', en: 'University Area' }, { key: 'market', ar: 'السوق', en: 'Market' }, { key: 'al-qusour', ar: 'القصور', en: 'Al-Qusour' }, { key: 'al-dabit', ar: 'الضبيط', en: 'Al-Dabit' }, { key: 'industrial-area', ar: 'المنطقة الصناعية', en: 'Industrial Area' }, { key: 'thirty-street', ar: 'شارع الثلاثين', en: 'Thirty Street' }] },
      { key: 'ariha', ar: 'أريحا', en: 'Ariha', areas: commonCityAreas },
      { key: 'jisr-shughur', ar: 'جسر الشغور', en: 'Jisr al-Shughur', areas: commonCityAreas },
      { key: 'maarret-al-numan', ar: 'معرة النعمان', en: 'Maarret al-Numan', areas: commonCityAreas },
    ],
  },
  {
    key: 'daraa',
    ar: 'درعا',
    en: 'Daraa',
    cities: [
      { key: 'daraa-city', ar: 'درعا', en: 'Daraa City', areas: [{ key: 'daraa-balad', ar: 'درعا البلد', en: 'Daraa Balad' }, { key: 'daraa-mahatta', ar: 'درعا المحطة', en: 'Daraa Mahatta' }, { key: 'city-center', ar: 'مركز المدينة', en: 'City Center' }, { key: 'al-sad-road', ar: 'طريق السد', en: 'Al-Sad Road' }, { key: 'al-kashef', ar: 'الكاشف', en: 'Al-Kashef' }, { key: 'matar-road', ar: 'طريق المطار', en: 'Airport Road' }, { key: 'al-qusour', ar: 'القصور', en: 'Al-Qusour' }] },
      { key: 'izraa', ar: 'إزرع', en: 'Izraa', areas: commonCityAreas },
      { key: 'nawa', ar: 'نوى', en: 'Nawa', areas: commonCityAreas },
      { key: 'bosra', ar: 'بصرى', en: 'Bosra', areas: commonCityAreas },
    ],
  },
  {
    key: 'sweida',
    ar: 'السويداء',
    en: 'As-Suwayda',
    cities: [
      { key: 'sweida-city', ar: 'السويداء', en: 'As-Suwayda City', areas: [{ key: 'city-center', ar: 'مركز المدينة', en: 'City Center' }, { key: 'old-city', ar: 'المدينة القديمة', en: 'Old City' }, { key: 'market', ar: 'السوق', en: 'Market' }, { key: 'qanawat-road', ar: 'طريق قنوات', en: 'Qanawat Road' }, { key: 'al-jalaa-street', ar: 'شارع الجلاء', en: 'Al-Jalaa Street' }, { key: 'al-maslakh', ar: 'المسلخ', en: 'Al-Maslakh' }, { key: 'al-thawra-street', ar: 'شارع الثورة', en: 'Al Thawra Street' }] },
      { key: 'shahba', ar: 'شهبا', en: 'Shahba', areas: commonCityAreas },
      { key: 'salkhad', ar: 'صلخد', en: 'Salkhad', areas: commonCityAreas },
    ],
  },
  {
    key: 'deir-ezzor',
    ar: 'دير الزور',
    en: 'Deir ez-Zor',
    cities: [
      {
        key: 'deir-ezzor-city',
        ar: 'دير الزور',
        en: 'Deir ez-Zor City',
        areas: [
          { key: 'city-center', ar: 'مركز المدينة', en: 'City Center' },
          { key: 'al-naher', ar: 'شارع النهر', en: 'Al Naher Street' },
          { key: 'abdul-baki-almashhour', ar: 'شارع عبد الباقي المشهور', en: 'Abdul Baki Almashhour Street' },
          { key: 'hasan-al-taha', ar: 'شارع حسن الطه', en: 'Hasan Al Taha Street' },
          { key: 'seta-ela-roubaa', ar: 'شارع ستة إلا ربع', en: 'Seta Ela Roubaa Street' },
          { key: 'hasan-almashhour', ar: 'شارع حسن المشهور', en: 'Hasan Almashhour Street' },
        ],
      },
      { key: 'al-mayadin', ar: 'الميادين', en: 'Al-Mayadin', areas: commonCityAreas },
      { key: 'al-bukamal', ar: 'البوكمال', en: 'Al-Bukamal', areas: commonCityAreas },
    ],
  },
  {
    key: 'raqqa',
    ar: 'الرقة',
    en: 'Raqqa',
    cities: [
      { key: 'raqqa-city', ar: 'الرقة', en: 'Raqqa City', areas: [{ key: 'city-center', ar: 'مركز المدينة', en: 'City Center' }, { key: 'rashid', ar: 'الرشيد', en: 'Rashid' }, { key: 'mashlab', ar: 'المشلب', en: 'Mashlab' }, { key: 'al-nour-street', ar: 'شارع النور', en: 'Al-Nour Street' }, { key: 'al-qitar-street', ar: 'شارع القطار', en: 'Railway Street' }, { key: 'al-ramila', ar: 'الرميلة', en: 'Al-Ramila' }, { key: 'euphrates-corniche', ar: 'كورنيش الفرات', en: 'Euphrates Corniche' }] },
      { key: 'tabqa', ar: 'الطبقة', en: 'Tabqa', areas: commonCityAreas },
      { key: 'tal-abyad', ar: 'تل أبيض', en: 'Tal Abyad', areas: commonCityAreas },
    ],
  },
  {
    key: 'hasakah',
    ar: 'الحسكة',
    en: 'Al-Hasakah',
    cities: [
      { key: 'hasakah-city', ar: 'الحسكة', en: 'Al-Hasakah City', areas: [{ key: 'city-center', ar: 'مركز المدينة', en: 'City Center' }, { key: 'aziziyeh', ar: 'العزيزية', en: 'Aziziyeh' }, { key: 'ghweiran', ar: 'غويران', en: 'Ghweiran' }, { key: 'al-nashwa', ar: 'النشوة', en: 'Al-Nashwa' }, { key: 'al-mufti', ar: 'المفتي', en: 'Al-Mufti' }, { key: 'al-salihiyah', ar: 'الصالحية', en: 'Al-Salihiyah' }, { key: 'al-kallaseh', ar: 'الكلاسة', en: 'Al-Kallaseh' }] },
      { key: 'qamishli', ar: 'القامشلي', en: 'Qamishli', areas: commonCityAreas },
      { key: 'amuda', ar: 'عامودا', en: 'Amuda', areas: commonCityAreas },
      { key: 'ras-al-ain', ar: 'رأس العين', en: 'Ras al-Ayn', areas: commonCityAreas },
    ],
  },
  {
    key: 'quneitra',
    ar: 'القنيطرة',
    en: 'Quneitra',
    cities: [
      { key: 'quneitra-city', ar: 'القنيطرة', en: 'Quneitra City', areas: commonCityAreas },
      { key: 'khan-arnabah', ar: 'خان أرنبة', en: 'Khan Arnabah', areas: commonCityAreas },
      { key: 'baath-city', ar: 'مدينة البعث', en: 'Baath City', areas: commonCityAreas },
    ],
  },
]

function mergeAreas(primary: SyrianArea[], secondary: SyrianArea[]) {
  const seen = new Set<string>()
  const merged: SyrianArea[] = []

  for (const area of [...primary, ...secondary]) {
    const key = `${area.ar}::${area.en}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(area)
  }

  return merged
}

function mergeGovernorateData(primary: SyrianGovernorate[], secondary: SyrianGovernorate[]) {
  const governorates = new Map<string, SyrianGovernorate>()

  for (const governorate of primary) {
    governorates.set(governorate.key, {
      ...governorate,
      cities: governorate.cities.map((city) => ({ ...city, areas: [...city.areas] })),
    })
  }

  for (const governorate of secondary) {
    const existingGovernorate = governorates.get(governorate.key)
    if (!existingGovernorate) {
      governorates.set(governorate.key, governorate)
      continue
    }

    const cities = new Map(existingGovernorate.cities.map((city) => [city.key, city]))

    for (const city of governorate.cities) {
      const existingCity = cities.get(city.key)
      if (!existingCity) {
        cities.set(city.key, city)
        continue
      }

      cities.set(city.key, {
        ...existingCity,
        areas: mergeAreas(existingCity.areas, city.areas),
      })
    }

    governorates.set(governorate.key, {
      ...existingGovernorate,
      cities: Array.from(cities.values()),
    })
  }

  return Array.from(governorates.values())
}

export const SYRIA_GOVERNORATES: SyrianGovernorate[] = mergeGovernorateData(
  MANUAL_SYRIA_GOVERNORATES,
  OSM_SYRIA_ROAD_CITIES,
)

export function getGovernorate(key: string) {
  return SYRIA_GOVERNORATES.find((governorate) => governorate.key === key)
}

export function getCity(governorateKey: string, cityKey: string) {
  return getGovernorate(governorateKey)?.cities.find((city) => city.key === cityKey)
}

// French (and any other LTR UI language) uses the English place names.
export function labelFor(lang: 'ar' | 'en' | 'fr', item?: { ar: string; en: string }) {
  if (!item) return ''
  return lang === 'ar' ? item.ar : item.en
}
