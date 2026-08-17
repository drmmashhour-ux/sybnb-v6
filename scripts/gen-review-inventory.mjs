// SYBNB — generate the AUTHORITY-REVIEW SYNTHETIC inventory dataset (deterministic; no randomness).
// NOT real customer listings. Every record is tagged inventory_source=authority_review_synthetic and
// owned by a synthetic .invalid owner so the whole set can be removed cleanly later.
//   node scripts/gen-review-inventory.mjs > docs/launch/authority-review-inventory.json
import { writeFileSync } from 'node:fs'

const GOV = { damascus: 'دمشق', aleppo: 'حلب', latakia: 'اللاذقية', homs: 'حمص', tartus: 'طرطوس' }
const CITY_EN = { damascus: 'Damascus', aleppo: 'Aleppo', latakia: 'Latakia', homs: 'Homs', tartus: 'Tartus' }
const DISTRICTS = {
  damascus: [['المالكي','Malki'],['المزة','Mazzeh'],['أبو رمانة','Abu Rummaneh'],['كفرسوسة','Kafr Sousa'],['البرامكة','Baramkeh']],
  aleppo: [['الفرقان','Al-Furqan'],['المحافظة','Al-Muhafaza'],['العزيزية','Al-Aziziyah'],['حلب الجديدة','New Aleppo'],['السبيل','Al-Sabil']],
  latakia: [['الزراعة','Al-Ziraa'],['الشيخ ضاهر','Sheikh Daher'],['الرمل الشمالي','Al-Raml']],
  homs: [['الإنشاءات','Al-Inshaat'],['الوعر','Al-Waer'],['كرم الزيتون','Karm al-Zeitoun']],
  tartus: [['الثورة','Al-Thawra'],['الرميلة','Al-Rmeileh'],['وسط المدينة','City Center']],
}
const cities = Object.keys(GOV)
const listings = []
let n = 0
const pick = (arr, i) => arr[i % arr.length]
const add = (division, city, distIdx, titleAr, titleEn, price, descAr, descEn, meta = {}) => {
  const [area, areaEn] = DISTRICTS[city][distIdx % DISTRICTS[city].length]
  listings.push({
    division, city, governorate: GOV[city], area, areaEn,
    title_ar: titleAr, title_en: titleEn,
    price_minor: price, currency: 'SYP',
    description_ar: descAr, description_en: descEn,
    ownerName: `${CITY_EN[city]} ${{STAYS:'Stays',RENTALS:'Homes',BUY:'Realty',CARS:'Motors',MARKETPLACE:'Market',NEW_CONSTRUCTION:'Developments'}[division]} (Review)`,
    ownerEmail: `review-${division.toLowerCase()}-${city}@authority-review.invalid`,
    metadata: { inventory_source: 'authority_review_synthetic', ...meta },
  })
}

// STAYS (8) — daily furnished
const staySpecs = [
  ['شقة مفروشة بإطلالة','Furnished apartment with view',350000,2,'شقة أنيقة مفروشة بالكامل للإيجار اليومي، قريبة من الخدمات.','Elegant fully-furnished apartment for daily rental, close to amenities.'],
  ['استوديو حديث وسط المدينة','Modern downtown studio',220000,1,'استوديو عصري مناسب للأفراد ورجال الأعمال.','Modern studio ideal for individuals and business travelers.'],
  ['شقة عائلية واسعة','Spacious family apartment',480000,3,'ثلاث غرف نوم، مطبخ مجهز، إنترنت عالي السرعة.','Three bedrooms, equipped kitchen, high-speed internet.'],
  ['شقة بغرفتي نوم قرب البحر','Two-bedroom near the sea',400000,2,'إطلالة جميلة ومناسبة للعائلات في اللاذقية.','Pleasant sea-side setting, family-friendly.'],
]
for (let i = 0; i < 8; i++) { const c = cities[i % cities.length]; const s = staySpecs[i % staySpecs.length]
  add('STAYS', c, i, `${s[0]} - ${DISTRICTS[c][i%DISTRICTS[c].length][0]}`, `${s[1]} - ${DISTRICTS[c][i%DISTRICTS[c].length][1]}`, s[2] + (i*10000), s[4], s[5], { propertyType: s[3] >= 3 ? 'apartment' : 'studio', nightly: true }) }

// RENTALS (8) — monthly
const rentSpecs = [
  ['شقة للإيجار الشهري','Apartment for monthly rent',2500000,'شقة مريحة بعقد شهري، قريبة من المدارس والأسواق.','Comfortable monthly-lease apartment near schools and markets.'],
  ['فيلا للإيجار مع حديقة','Villa for rent with garden',6500000,'فيلا مستقلة بحديقة خاصة ومواقف سيارات.','Detached villa with private garden and parking.'],
  ['شقة مفروشة طويلة الأمد','Long-term furnished flat',3200000,'مناسبة للعائلات، مفروشة بالكامل.','Family-suitable, fully furnished.'],
]
for (let i = 0; i < 8; i++) { const c = cities[i % cities.length]; const s = rentSpecs[i % rentSpecs.length]
  add('RENTALS', c, i+1, `${s[0]} - ${CITY_EN[c]==='Damascus'?'دمشق':GOV[c]}`, `${s[1]} - ${CITY_EN[c]}`, s[2] + (i*150000), s[3], s[4], { propertyType: 'apartment', term: 'monthly' }) }

// BUY (8) — for sale
const buySpecs = [
  ['شقة للبيع','Apartment for sale',180000000,'شقة بموقع مميز، تشطيب جيد، جاهزة للسكن.','Prime location, good finishing, move-in ready.'],
  ['فيلا فاخرة للبيع','Luxury villa for sale',950000000,'فيلا واسعة بتصميم عصري وحديقة.','Spacious modern villa with garden.'],
  ['بيت عربي تراثي','Heritage Arabic house',320000000,'بيت دمشقي بطابع تراثي أصيل.','Authentic heritage Damascene house.'],
]
for (let i = 0; i < 8; i++) { const c = cities[i % cities.length]; const s = buySpecs[i % buySpecs.length]
  add('BUY', c, i+2, `${s[0]} - ${GOV[c]}`, `${s[1]} - ${CITY_EN[c]}`, s[2] + (i*5000000), s[3], s[4], { propertyType: i%2?'villa':'apartment' }) }

// CARS (8) — realistic
const carSpecs = [
  ['تويوتا كورولا 2019','Toyota Corolla 2019',22000000,'toyota','سيارة اقتصادية بحالة جيدة، صيانة منتظمة.','Economical sedan in good condition, regular maintenance.'],
  ['هيونداي إلنترا 2020','Hyundai Elantra 2020',26000000,'hyundai','سيارة عائلية موفرة للوقود.','Fuel-efficient family sedan.'],
  ['كيا سبورتاج 2018','Kia Sportage 2018',34000000,'kia','دفع رباعي مناسب للطرقات المختلفة.','SUV suitable for varied roads.'],
  ['مرسيدس E200 2016','Mercedes E200 2016',58000000,'mercedes','سيارة فخمة بحالة ممتازة.','Premium sedan in excellent condition.'],
]
for (let i = 0; i < 8; i++) { const c = cities[i % cities.length]; const s = carSpecs[i % carSpecs.length]
  add('CARS', c, i, `${s[0]}`, `${s[1]}`, s[2] + (i*500000), s[4], s[5], { visualFilters: { carBrand: s[3] } }) }

// MARKETPLACE (8)
const mktSpecs = [
  ['طقم كنب مودرن','Modern sofa set',4500000,'طقم كنب بحالة ممتازة، تصميم عصري.','Modern sofa set in excellent condition.'],
  ['ثلاجة كبيرة','Large refrigerator',3800000,'ثلاجة موفرة للطاقة بحالة جيدة.','Energy-efficient fridge, good condition.'],
  ['تلفزيون ذكي 55 بوصة','55-inch smart TV',2900000,'شاشة ذكية عالية الدقة.','High-definition smart display.'],
  ['غرفة نوم كاملة','Complete bedroom set',6200000,'غرفة نوم خشبية فاخرة.','Premium wooden bedroom set.'],
]
for (let i = 0; i < 8; i++) { const c = cities[i % cities.length]; const s = mktSpecs[i % mktSpecs.length]
  add('MARKETPLACE', c, i+1, `${s[0]} - ${CITY_EN[c]}`, `${s[1]} - ${CITY_EN[c]}`, s[2] + (i*100000), s[3], s[4], {}) }

// NEW_CONSTRUCTION (5)
const ncSpecs = [
  ['مشروع سكني جديد - المرحلة الأولى','New residential project - Phase 1',450000000,'مجمع سكني حديث بمرافق متكاملة.','Modern residential complex with integrated amenities.'],
  ['أبراج سكنية قيد الإنشاء','Residential towers under construction',680000000,'شقق بمواصفات عالية وتسليم مجدول.','High-spec apartments with scheduled delivery.'],
]
for (let i = 0; i < 5; i++) { const c = cities[i % cities.length]; const s = ncSpecs[i % ncSpecs.length]
  add('NEW_CONSTRUCTION', c, i, `${s[0]} - ${GOV[c]}`, `${s[1]} - ${CITY_EN[c]}`, s[2] + (i*20000000), s[3], s[4], { projectPhase: (i%3)+1 }) }

const out = {
  _note: 'AUTHORITY-REVIEW SYNTHETIC dataset — NOT real customer listings. Every record tagged metadata.inventory_source=authority_review_synthetic; owners use @authority-review.invalid. Prices are demonstration values, not verified market prices. Remove cleanly before loading genuine inventory.',
  generatedFor: 'private Syrian-authority review + technical demonstration',
  listings,
}
writeFileSync('docs/launch/authority-review-inventory.json', JSON.stringify(out, null, 2))
console.log(`generated ${listings.length} listings ->`, listings.reduce((a, l) => { a[l.division] = (a[l.division]||0)+1; return a }, {}))
