import type { SearchDivision } from '../../modules/search/UnifiedSearchBar'
import type { VisualFilterArt, VisualFilterGroup } from './filterTypes'

const VISUAL_FILTER_CONFIG_KEY = 'sybnb_visual_filter_groups_v1'
export const VISUAL_FILTER_CONFIG_EVENT = 'sybnb_visual_filter_groups_changed'

// Sort options ("Newest" / "Lowest price" / "Highest price") intentionally have no photoSrc here:
// a stock property photo can't represent an abstract sort order, so these fall back to the
// drawn SortPicture icon (lines + direction arrow) instead of a misleading real photo.
const visualFilterPhotoSrc: Partial<Record<VisualFilterArt, string>> = {
  'price-any': '/assets/filter-photos/price/any-price.webp',
  'price-low': '/assets/filter-photos/price/economy.webp',
  'price-mid': '/assets/filter-photos/price/medium.webp',
  'price-high': '/assets/filter-photos/price/luxury.webp',
  'general-properties': '/assets/filter-photos/general/all-properties.webp',
  'general-rooms': '/assets/filter-photos/general/all-rooms.webp',
  'general-beds': '/assets/filter-photos/general/all-beds.webp',
  'popular-parking': '/assets/filter-photos/popular/parking.webp',
  'popular-entire': '/assets/filter-photos/popular/entire-apartment.webp',
  'popular-old-city': '/assets/filter-photos/popular/old-city.webp',
  'popular-near-me': '/assets/filter-photos/popular/near-me.webp',
  'room-any': '/assets/filter-photos/rooms/any-room.webp',
  'room-single': '/assets/filter-photos/rooms/single-room.webp',
  'room-double': '/assets/filter-photos/rooms/double-room.webp',
  'room-suite': '/assets/filter-photos/rooms/suite.webp',
  'room-studio': '/assets/filter-photos/rooms/studio.webp',
  'room-family': '/assets/filter-photos/rooms/family-room.webp',
  'bed-single': '/assets/filter-photos/beds/single-bed.webp',
  'bed-double': '/assets/filter-photos/beds/double-bed.webp',
  'bed-queen': '/assets/filter-photos/beds/queen-bed.webp',
  'bed-king': '/assets/filter-photos/beds/king-bed.webp',
  'bed-sofa': '/assets/filter-photos/beds/sofa-bed.webp',
  'property-apartment': '/assets/filter-photos/properties/apartment.webp',
  'property-villa': '/assets/filter-photos/properties/villa.webp',
  'property-room': '/assets/filter-photos/properties/private-room.webp',
  'property-heritage': '/assets/filter-photos/properties/heritage-home.webp',
  'property-farm': '/assets/filter-photos/properties/farm.webp',
  'property-chalet': '/assets/filter-photos/properties/chalet.webp',
  'property-land': '/assets/filter-photos/properties/land.webp',
  'property-office': '/assets/filter-photos/properties/office.webp',
  'property-shop': '/assets/filter-photos/properties/shop.webp',
  'property-project': '/assets/filter-photos/properties/new-project.webp',
  'amenity-wifi': '/assets/filter-photos/amenities/wifi.webp',
  'amenity-fast-internet': '/assets/filter-photos/amenities/high-speed-internet.webp',
  'amenity-parking': '/assets/filter-photos/amenities/parking.webp',
  'amenity-bathroom': '/assets/filter-photos/amenities/bathroom.png',
  'amenity-breakfast': '/assets/filter-photos/meals/breakfast-included.png',
  'meal-lunch': '/assets/filter-photos/meals/meal-plan.png',
  'meal-dinner': '/assets/filter-photos/meals/restaurant.png',
  'meal-buffet': '/assets/filter-photos/meals/restaurant.png',
  'meal-all-inclusive': '/assets/filter-photos/meals/meal-plan.png',
  'meal-restaurant': '/assets/filter-photos/meals/restaurant.png',
  'meal-no-kitchen': '/assets/filter-photos/meals/no-kitchen.png',
  'meal-halal': '/assets/filter-photos/meals/halal.png',
  'meal-plan': '/assets/filter-photos/meals/meal-plan.png',
  'meal-vegetarian': '/assets/filter-photos/meals/vegetarian.png',
  'meal-room-service': '/assets/filter-photos/meals/room-service.png',
  'amenity-generator': '/assets/filter-photos/amenities/generator.webp',
  'amenity-kitchen': '/assets/filter-photos/amenities/kitchen.webp',
  'amenity-ac': '/assets/filter-photos/amenities/ac.webp',
  'amenity-balcony': '/assets/filter-photos/amenities/balcony.webp',
  'amenity-pool': '/assets/filter-photos/amenities/pool.webp',
  'amenity-heating': '/assets/filter-photos/amenities/heating.webp',
  'amenity-tv': '/assets/filter-photos/amenities/smart-tv.webp',
  'amenity-garden': '/assets/filter-photos/amenities/garden.webp',
  'amenity-elevator': '/assets/filter-photos/amenities/elevator.webp',
  'view-sea': '/assets/filter-photos/views/sea-view.webp',
  'view-mountain': '/assets/filter-photos/views/mountain-view.webp',
  'outdoor-bbq': '/assets/filter-photos/views/bbq.webp',
  'access-crib': '/assets/filter-photos/access/baby-crib.webp',
  'access-pet': '/assets/filter-photos/access/pet-friendly.webp',
  'access-wheelchair': '/assets/filter-photos/access/wheelchair-accessible.webp',
  'access-ramp': '/assets/filter-photos/access/ramp.png',
  'access-parking': '/assets/filter-photos/access/accessible-parking.png',
  'access-bathroom': '/assets/filter-photos/access/accessible-bathroom.png',
  'access-wide-doorway': '/assets/filter-photos/access/wide-doorway.png',
  'access-hearing-loop': '/assets/filter-photos/access/hearing-loop.png',
  'access-visual-aid': '/assets/filter-photos/access/visual-aid.png',
  'access-service-animal': '/assets/filter-photos/access/service-animal.png',
  'trust-verified': '/assets/filter-photos/trust/verified-host.webp',
  'trust-rating': '/assets/filter-photos/trust/high-rating.webp',
  'trust-fast': '/assets/filter-photos/trust/fast-response.webp',
  'trust-family': '/assets/filter-photos/trust/family-friendly.webp',
  'trust-instant': '/assets/filter-photos/trust/instant-booking.webp',
  'trust-featured': '/assets/filter-photos/trust/featured-host.webp',
  'payment-shamcash': '/assets/filter-photos/payments/sham-cash.webp',
  'payment-card': '/assets/filter-photos/payments/card-stripe.webp',
  'payment-local-wallet': '/assets/filter-photos/payments/local-wallet.webp',
  'car-sedan': '/assets/filter-photos/cars/sedan.webp',
  'car-suv': '/assets/filter-photos/cars/suv.webp',
  'car-pickup': '/assets/filter-photos/cars/pickup.webp',
  'car-van': '/assets/filter-photos/cars/van.webp',
  'car-luxury': '/assets/filter-photos/cars/luxury.webp',
  'car-economy': '/assets/filter-photos/cars/economy.webp',
  'car-toyota': '/assets/filter-photos/cars/toyota.webp',
  'car-hyundai': '/assets/filter-photos/cars/hyundai.webp',
  'car-kia': '/assets/filter-photos/cars/kia.webp',
  'car-mercedes': '/assets/filter-photos/cars/mercedes.webp',
  'car-bmw': '/assets/filter-photos/cars/bmw.webp',
  'car-electric': '/assets/filter-photos/cars/electric.webp',
  'car-gas': '/assets/filter-photos/cars/gas.webp',
  'car-diesel': '/assets/filter-photos/cars/diesel.webp',
  'car-hybrid': '/assets/filter-photos/cars/hybrid.webp',
  'car-manual': '/assets/filter-photos/cars/manual.webp',
  'car-automatic': '/assets/filter-photos/cars/automatic.webp',
  'condition-new': '/assets/filter-photos/condition/new.webp',
  'condition-used': '/assets/filter-photos/condition/used.webp',
  'market-furniture': '/assets/filter-photos/market/furniture.webp',
  'market-electronics': '/assets/filter-photos/market/electronics.webp',
  'market-appliances': '/assets/filter-photos/market/appliances.webp',
  'market-services': '/assets/filter-photos/market/services.webp',
  'sr-ride-economy': '/assets/filter-photos/sr-ride/economy.webp',
  'sr-ride-comfort': '/assets/filter-photos/sr-ride/comfort.webp',
  'sr-ride-premium': '/assets/filter-photos/sr-ride/premium.webp',
  'sr-ride-family-van': '/assets/filter-photos/sr-ride/family-van.webp',
  'sr-ride-city': '/assets/filter-photos/sr-ride/city-ride.webp',
  'sr-ride-airport': '/assets/filter-photos/sr-ride/airport.webp',
  'sr-ride-intercity': '/assets/filter-photos/sr-ride/intercity.webp',
  'sr-ride-hourly': '/assets/filter-photos/sr-ride/hourly.webp',
  'sr-ride-instant': '/assets/filter-photos/sr-ride/instant-confirm.webp',
  'sr-ride-ac': '/assets/filter-photos/sr-ride/ac.webp',
  'sr-ride-wifi': '/assets/filter-photos/sr-ride/wifi.webp',
  'sr-ride-luggage': '/assets/filter-photos/sr-ride/luggage.webp',
  'sr-ride-child-seat': '/assets/filter-photos/sr-ride/child-seat.webp',
  'sr-ride-family-friendly': '/assets/filter-photos/sr-ride/family-friendly.webp',
}

export const sortFilterGroup: VisualFilterGroup = {
  id: 'sort',
  title: { ar: 'ترتيب النتائج', en: 'Sort results' },
  mode: 'single',
  options: [
    { id: 'newest', label: { ar: 'الأحدث', en: 'Newest' }, art: 'sort-newest' },
    { id: 'priceLow', label: { ar: 'الأقل سعراً', en: 'Lowest price' }, art: 'sort-low' },
    { id: 'priceHigh', label: { ar: 'الأعلى سعراً', en: 'Highest price' }, art: 'sort-high' },
  ],
}

export const priceFilterGroup: VisualFilterGroup = {
  id: 'priceBand',
  title: { ar: 'السعر', en: 'Price' },
  mode: 'single',
  options: [
    { id: 'any', label: { ar: 'أي سعر', en: 'Any price' }, art: 'price-any' },
    { id: 'low', label: { ar: 'اقتصادي', en: 'Budget' }, art: 'price-low' },
    { id: 'mid', label: { ar: 'متوسط', en: 'Mid range' }, art: 'price-mid' },
    { id: 'high', label: { ar: 'فاخر', en: 'Premium' }, art: 'price-high' },
  ],
}

export const popularFilterGroup: VisualFilterGroup = {
  id: 'popular',
  title: { ar: 'الأكثر طلباً', en: 'Popular' },
  mode: 'multi',
  options: [
    { id: 'parking', label: { ar: 'موقف سيارات', en: 'Parking' }, art: 'popular-parking' },
    { id: 'entireApartment', label: { ar: 'شقة كاملة', en: 'Entire apartment' }, art: 'popular-entire' },
    { id: 'breakfast', label: { ar: 'فطور', en: 'Breakfast' }, art: 'amenity-breakfast' },
    { id: 'oldCity', label: { ar: 'المدينة القديمة', en: 'Old City' }, art: 'popular-old-city' },
    { id: 'nearMe', label: { ar: 'بالقرب مني', en: 'Near me' }, art: 'popular-near-me' },
    { id: 'rating8', label: { ar: 'جيد جداً 8+', en: 'Very Good 8+' }, art: 'trust-rating' },
    { id: 'generator', label: { ar: 'مولد كهرباء', en: 'Generator' }, art: 'amenity-generator' },
    { id: 'verifiedHost', label: { ar: 'مضيف موثق', en: 'Verified host' }, art: 'trust-verified' },
  ],
}

export const roomFilterGroup: VisualFilterGroup = {
  id: 'roomType',
  title: { ar: 'نوع الغرفة', en: 'Room type' },
  mode: 'single',
  options: [
    { id: 'any', label: { ar: 'أي غرفة', en: 'Any room' }, art: 'general-rooms' },
    { id: 'singleRoom', label: { ar: 'غرفة مفردة', en: 'Single room' }, art: 'room-single' },
    { id: 'doubleRoom', label: { ar: 'غرفة مزدوجة', en: 'Double room' }, art: 'room-double' },
    { id: 'suite', label: { ar: 'جناح', en: 'Suite' }, art: 'room-suite' },
    { id: 'studio', label: { ar: 'استوديو', en: 'Studio' }, art: 'room-studio' },
    { id: 'familyRoom', label: { ar: 'غرفة عائلية', en: 'Family room' }, art: 'room-family' },
  ],
}

export const bedFilterGroup: VisualFilterGroup = {
  id: 'bedType',
  title: { ar: 'نوع السرير', en: 'Bed type' },
  mode: 'single',
  options: [
    { id: 'any', label: { ar: 'الكل', en: 'Any' }, art: 'general-beds' },
    { id: 'singleBed', label: { ar: 'سرير مفرد', en: 'Single bed' }, art: 'bed-single' },
    { id: 'doubleBed', label: { ar: 'سرير مزدوج', en: 'Double bed' }, art: 'bed-double' },
    { id: 'queenBed', label: { ar: 'كوين', en: 'Queen bed' }, art: 'bed-queen' },
    { id: 'kingBed', label: { ar: 'كينغ', en: 'King bed' }, art: 'bed-king' },
    { id: 'sofaBed', label: { ar: 'سرير صوفا', en: 'Sofa bed' }, art: 'bed-sofa' },
  ],
}

export const propertyFilterGroup: VisualFilterGroup = {
  id: 'propertyType',
  title: { ar: 'نوع العقار', en: 'Property type' },
  mode: 'single',
  options: [
    { id: 'any', label: { ar: 'الكل', en: 'Any' }, art: 'general-properties' },
    { id: 'apartment', label: { ar: 'شقة', en: 'Apartment' }, art: 'property-apartment' },
    { id: 'villa', label: { ar: 'فيلا', en: 'Villa' }, art: 'property-villa' },
    { id: 'room', label: { ar: 'غرفة', en: 'Room' }, art: 'property-room' },
    { id: 'heritage', label: { ar: 'بيت تراثي', en: 'Heritage' }, art: 'property-heritage' },
    { id: 'farm', label: { ar: 'مزرعة', en: 'Farm' }, art: 'property-farm' },
    { id: 'chalet', label: { ar: 'شاليه', en: 'Chalet' }, art: 'property-chalet' },
    { id: 'land', label: { ar: 'أرض', en: 'Land' }, art: 'property-land' },
    { id: 'office', label: { ar: 'مكتب', en: 'Office' }, art: 'property-office' },
    { id: 'shop', label: { ar: 'محل تجاري', en: 'Shop' }, art: 'property-shop' },
    { id: 'project', label: { ar: 'مشروع جديد', en: 'New project' }, art: 'property-project' },
  ],
}

export const amenityFilterGroup: VisualFilterGroup = {
  id: 'amenities',
  title: { ar: 'المزايا', en: 'Amenities' },
  mode: 'multi',
  options: [
    { id: 'wifi', label: { ar: 'Wi-Fi', en: 'Wi-Fi' }, art: 'amenity-wifi' },
    { id: 'fastInternet', label: { ar: 'إنترنت سريع', en: 'Fast internet' }, art: 'amenity-fast-internet' },
    { id: 'parking', label: { ar: 'موقف', en: 'Parking' }, art: 'amenity-parking' },
    { id: 'bathroom', label: { ar: 'حمام', en: 'Bathroom' }, art: 'amenity-bathroom' },
    { id: 'generator', label: { ar: 'مولد', en: 'Generator' }, art: 'amenity-generator' },
    { id: 'kitchen', label: { ar: 'مطبخ', en: 'Kitchen' }, art: 'amenity-kitchen' },
    { id: 'ac', label: { ar: 'تكييف', en: 'A/C' }, art: 'amenity-ac' },
    { id: 'balcony', label: { ar: 'شرفة', en: 'Balcony' }, art: 'amenity-balcony' },
    { id: 'pool', label: { ar: 'مسبح', en: 'Pool' }, art: 'amenity-pool' },
    { id: 'heating', label: { ar: 'تدفئة', en: 'Heating' }, art: 'amenity-heating' },
    { id: 'tv', label: { ar: 'تلفزيون ذكي', en: 'Smart TV' }, art: 'amenity-tv' },
    { id: 'garden', label: { ar: 'حديقة', en: 'Garden' }, art: 'amenity-garden' },
    { id: 'elevator', label: { ar: 'مصعد', en: 'Elevator' }, art: 'amenity-elevator' },
  ],
}

export const mealFilterGroup: VisualFilterGroup = {
  id: 'meals',
  title: { ar: 'الوجبات', en: 'Meals' },
  mode: 'multi',
  options: [
    { id: 'breakfast', label: { ar: 'إفطار', en: 'Breakfast' }, art: 'amenity-breakfast' },
    { id: 'lunch', label: { ar: 'غداء', en: 'Lunch' }, art: 'meal-lunch' },
    { id: 'dinner', label: { ar: 'عشاء', en: 'Dinner' }, art: 'meal-dinner' },
    { id: 'openBuffet', label: { ar: 'بوفيه مفتوح', en: 'Open buffet' }, art: 'meal-buffet' },
    { id: 'allInclusive', label: { ar: 'شامل الكل', en: 'All inclusive' }, art: 'meal-all-inclusive' },
    { id: 'restaurant', label: { ar: 'مطعم', en: 'Restaurant' }, art: 'meal-restaurant' },
    { id: 'noKitchen', label: { ar: 'بدون مطبخ', en: 'No kitchen' }, art: 'meal-no-kitchen' },
    { id: 'halal', label: { ar: 'حلال', en: 'Halal' }, art: 'meal-halal' },
    { id: 'mealPlan', label: { ar: 'خطة وجبات', en: 'Meal plan' }, art: 'meal-plan' },
    { id: 'vegetarian', label: { ar: 'نباتي', en: 'Vegetarian' }, art: 'meal-vegetarian' },
    { id: 'roomService', label: { ar: 'خدمة الغرف', en: 'Room service' }, art: 'meal-room-service' },
  ],
}

export const hotelStarFilterGroup: VisualFilterGroup = {
  id: 'hotelStars',
  title: { ar: 'تصنيف الفندق', en: 'Hotel rating' },
  mode: 'single',
  options: [
    { id: 'fiveStars', label: { ar: '5 نجوم', en: '5 stars' }, art: 'hotel-star-5' },
    { id: 'fourStars', label: { ar: '4 نجوم', en: '4 stars' }, art: 'hotel-star-4' },
    { id: 'threeStars', label: { ar: '3 نجوم', en: '3 stars' }, art: 'hotel-star-3' },
    { id: 'twoStars', label: { ar: '2 نجوم', en: '2 stars' }, art: 'hotel-star-2' },
    { id: 'oneStar', label: { ar: 'نجمة واحدة', en: '1 star' }, art: 'hotel-star-1' },
  ],
}

export const viewFilterGroup: VisualFilterGroup = {
  id: 'views',
  title: { ar: 'الإطلالة والخارج', en: 'Views & outdoors' },
  mode: 'multi',
  options: [
    { id: 'seaView', label: { ar: 'إطلالة بحرية', en: 'Sea view' }, art: 'view-sea' },
    { id: 'mountainView', label: { ar: 'إطلالة جبلية', en: 'Mountain view' }, art: 'view-mountain' },
    { id: 'garden', label: { ar: 'حديقة', en: 'Garden' }, art: 'amenity-garden' },
    { id: 'pool', label: { ar: 'مسبح', en: 'Pool' }, art: 'amenity-pool' },
    { id: 'balcony', label: { ar: 'شرفة', en: 'Balcony' }, art: 'amenity-balcony' },
    { id: 'bbq', label: { ar: 'شواية', en: 'BBQ' }, art: 'outdoor-bbq' },
  ],
}

export const accessFilterGroup: VisualFilterGroup = {
  id: 'access',
  title: { ar: 'ذوي الاحتياجات الخاصة والعائلة', en: 'Special needs & family' },
  mode: 'multi',
  options: [
    { id: 'familyFriendly', label: { ar: 'مناسب للعائلات', en: 'Family friendly' }, art: 'trust-family' },
    { id: 'babyCrib', label: { ar: 'سرير أطفال', en: 'Baby crib' }, art: 'access-crib' },
    { id: 'petFriendly', label: { ar: 'يسمح بالحيوانات', en: 'Pet friendly' }, art: 'access-pet' },
    { id: 'wheelchair', label: { ar: 'مناسب للكراسي المتحركة', en: 'Wheelchair access' }, art: 'access-wheelchair' },
    { id: 'handicapRamp', label: { ar: 'منحدر لذوي الاحتياجات', en: 'Accessible ramp' }, art: 'access-ramp' },
    { id: 'handicapParking', label: { ar: 'مواقف مخصصة', en: 'Accessible parking' }, art: 'access-parking' },
    { id: 'accessibleBathroom', label: { ar: 'حمام مناسب للكراسي المتحركة', en: 'Accessible bathroom' }, art: 'access-bathroom' },
    { id: 'wideDoorway', label: { ar: 'أبواب واسعة', en: 'Wide doorway' }, art: 'access-wide-doorway' },
    { id: 'hearingLoop', label: { ar: 'دعم ضعاف السمع', en: 'Hearing support' }, art: 'access-hearing-loop' },
    { id: 'visualAid', label: { ar: 'دعم بصري', en: 'Visual aid' }, art: 'access-visual-aid' },
    { id: 'serviceAnimal', label: { ar: 'حيوان خدمة', en: 'Service animal' }, art: 'access-service-animal' },
    { id: 'elevator', label: { ar: 'مصعد', en: 'Elevator' }, art: 'amenity-elevator' },
  ],
}

export const trustFilterGroup: VisualFilterGroup = {
  id: 'trust',
  title: { ar: 'المضيف والثقة', en: 'Host & trust' },
  mode: 'multi',
  options: [
    { id: 'verifiedHost', label: { ar: 'مضيف موثق', en: 'Verified host' }, art: 'trust-verified' },
    { id: 'rating8', label: { ar: 'تقييم 8+', en: 'Rating 8+' }, art: 'trust-rating' },
    { id: 'fastResponse', label: { ar: 'رد سريع', en: 'Fast response' }, art: 'trust-fast' },
    { id: 'familyFriendly', label: { ar: 'مناسب للعائلة', en: 'Family friendly' }, art: 'trust-family' },
    { id: 'instantBooking', label: { ar: 'حجز فوري', en: 'Instant booking' }, art: 'trust-instant' },
    { id: 'featuredHost', label: { ar: 'مضيف مميز', en: 'Featured host' }, art: 'trust-featured' },
  ],
}

export const carFilterGroup: VisualFilterGroup = {
  id: 'carBody',
  title: { ar: 'شكل السيارة', en: 'Car body' },
  mode: 'single',
  options: [
    { id: 'any', label: { ar: 'الكل', en: 'Any' }, art: 'any' },
    { id: 'sedan', label: { ar: 'سيدان', en: 'Sedan' }, art: 'car-sedan' },
    { id: 'suv', label: { ar: 'SUV', en: 'SUV' }, art: 'car-suv' },
    { id: 'pickup', label: { ar: 'بيك أب', en: 'Pickup' }, art: 'car-pickup' },
    { id: 'van', label: { ar: 'فان', en: 'Van' }, art: 'car-van' },
    { id: 'luxury', label: { ar: 'فاخر', en: 'Luxury' }, art: 'car-luxury' },
    { id: 'economy', label: { ar: 'اقتصادي', en: 'Economy' }, art: 'car-economy' },
  ],
}

export const carBrandFilterGroup: VisualFilterGroup = {
  id: 'carBrand',
  title: { ar: 'الماركة', en: 'Brand' },
  mode: 'single',
  options: [
    { id: 'any', label: { ar: 'الكل', en: 'Any' }, art: 'any' },
    { id: 'toyota', label: { ar: 'تويوتا', en: 'Toyota' }, art: 'car-toyota' },
    { id: 'hyundai', label: { ar: 'هيونداي', en: 'Hyundai' }, art: 'car-hyundai' },
    { id: 'kia', label: { ar: 'كيا', en: 'Kia' }, art: 'car-kia' },
    { id: 'mercedes', label: { ar: 'مرسيدس', en: 'Mercedes' }, art: 'car-mercedes' },
    { id: 'bmw', label: { ar: 'BMW', en: 'BMW' }, art: 'car-bmw' },
  ],
}

export const carFuelFilterGroup: VisualFilterGroup = {
  id: 'carFuel',
  title: { ar: 'الوقود', en: 'Fuel' },
  mode: 'single',
  options: [
    { id: 'any', label: { ar: 'الكل', en: 'Any' }, art: 'any' },
    { id: 'gas', label: { ar: 'بنزين', en: 'Gas' }, art: 'car-gas' },
    { id: 'diesel', label: { ar: 'ديزل', en: 'Diesel' }, art: 'car-diesel' },
    { id: 'hybrid', label: { ar: 'هايبرد', en: 'Hybrid' }, art: 'car-hybrid' },
    { id: 'electric', label: { ar: 'كهرباء', en: 'Electric' }, art: 'car-electric' },
  ],
}

export const carTransmissionFilterGroup: VisualFilterGroup = {
  id: 'carTransmission',
  title: { ar: 'ناقل الحركة', en: 'Transmission' },
  mode: 'single',
  options: [
    { id: 'any', label: { ar: 'الكل', en: 'Any' }, art: 'any' },
    { id: 'automatic', label: { ar: 'أوتوماتيك', en: 'Automatic' }, art: 'car-automatic' },
    { id: 'manual', label: { ar: 'عادي', en: 'Manual' }, art: 'car-manual' },
  ],
}

export const conditionFilterGroup: VisualFilterGroup = {
  id: 'condition',
  title: { ar: 'الحالة', en: 'Condition' },
  mode: 'single',
  options: [
    { id: 'any', label: { ar: 'الكل', en: 'Any' }, art: 'any' },
    { id: 'new', label: { ar: 'جديد', en: 'New' }, art: 'condition-new' },
    { id: 'used', label: { ar: 'مستعمل', en: 'Used' }, art: 'condition-used' },
  ],
}

export const marketFilterGroup: VisualFilterGroup = {
  id: 'marketCategory',
  title: { ar: 'تصنيف السوق', en: 'Marketplace category' },
  mode: 'single',
  options: [
    { id: 'any', label: { ar: 'الكل', en: 'Any' }, art: 'any' },
    { id: 'furniture', label: { ar: 'أثاث', en: 'Furniture' }, art: 'market-furniture' },
    { id: 'electronics', label: { ar: 'إلكترونيات', en: 'Electronics' }, art: 'market-electronics' },
    { id: 'appliances', label: { ar: 'أجهزة', en: 'Appliances' }, art: 'market-appliances' },
    { id: 'services', label: { ar: 'خدمات', en: 'Services' }, art: 'market-services' },
  ],
}

export const paymentFilterGroup: VisualFilterGroup = {
  id: 'payments',
  title: { ar: 'طرق الدفع', en: 'Payment methods' },
  mode: 'multi',
  options: [
    { id: 'shamCash', label: { ar: 'Sham Cash', en: 'Sham Cash' }, art: 'payment-shamcash' },
    { id: 'cardStripe', label: { ar: 'بطاقة ائتمان', en: 'Credit card' }, art: 'payment-card' },
    { id: 'localWallet', label: { ar: 'محفظة محلية', en: 'Local wallet' }, art: 'payment-local-wallet' },
  ],
}

export const srRideCategoryFilterGroup: VisualFilterGroup = {
  id: 'srRideCategory',
  title: { ar: 'نوع الرحلة', en: 'Ride type' },
  mode: 'single',
  options: [
    { id: 'economy', label: { ar: 'اقتصادي', en: 'Economy' }, art: 'sr-ride-economy' },
    { id: 'comfort', label: { ar: 'مريح', en: 'Comfort' }, art: 'sr-ride-comfort' },
    { id: 'premium', label: { ar: 'فاخر', en: 'Premium' }, art: 'sr-ride-premium' },
    { id: 'familyVan', label: { ar: 'فان عائلي', en: 'Family van' }, art: 'sr-ride-family-van' },
  ],
}

export const srRideRouteFilterGroup: VisualFilterGroup = {
  id: 'srRideRoute',
  title: { ar: 'مسار الرحلة', en: 'Route' },
  mode: 'single',
  options: [
    { id: 'cityRide', label: { ar: 'داخل المدينة', en: 'City ride' }, art: 'sr-ride-city' },
    { id: 'airport', label: { ar: 'المطار', en: 'Airport' }, art: 'sr-ride-airport' },
    { id: 'intercity', label: { ar: 'بين المدن', en: 'Intercity' }, art: 'sr-ride-intercity' },
    { id: 'hourly', label: { ar: 'بالساعة', en: 'Hourly' }, art: 'sr-ride-hourly' },
  ],
}

export const srRideFeatureFilterGroup: VisualFilterGroup = {
  id: 'srRideFeatures',
  title: { ar: 'مزايا الرحلة', en: 'Ride features' },
  mode: 'multi',
  options: [
    // A pre-checked "Verified driver" option used to live here, but no verification concept exists
    // anywhere in the driver data model and it was never sent to the backend -- removed rather than
    // implying vetting that never happened. See CAPSULE_RULES.noFakeTrustSignal in shared/capsules.
    { id: 'instantConfirm', label: { ar: 'تأكيد فوري', en: 'Instant confirm' }, art: 'sr-ride-instant' },
    { id: 'ac', label: { ar: 'تكييف', en: 'A/C' }, art: 'sr-ride-ac' },
    { id: 'wifi', label: { ar: 'Wi-Fi', en: 'Wi-Fi' }, art: 'sr-ride-wifi' },
    { id: 'luggage', label: { ar: 'حقائب', en: 'Luggage' }, art: 'sr-ride-luggage' },
    { id: 'childSeat', label: { ar: 'مقعد طفل', en: 'Child seat' }, art: 'sr-ride-child-seat' },
    { id: 'familyFriendly', label: { ar: 'مناسب للعائلة', en: 'Family friendly' }, art: 'sr-ride-family-friendly' },
  ],
}

export function visualFilterGroupsForDivision(division: SearchDivision): VisualFilterGroup[] {
  if (division === 'cars') return carVisualFilterGroups()
  if (division === 'newConstruction') return newConstructionVisualFilterGroups()
  if (division === 'marketplace') return marketplaceVisualFilterGroups()
  return visualFilterGroupsById(['popular', 'sort', 'priceBand', 'propertyType', 'roomType', 'bedType', 'hotelStars', 'meals', 'amenities', 'views', 'access', 'trust', 'payments'])
}

function carVisualFilterGroups() {
  return visualFilterGroupsById(['sort', 'priceBand', 'carBody', 'carBrand', 'carFuel', 'carTransmission', 'condition', 'trust']).map((group) => {
    if (group.id === 'priceBand') {
      return {
        ...group,
        options: group.options.map((option) => ({
          ...option,
          photoSrc:
            option.id === 'low'
              ? visualFilterPhotoSrc['car-economy']
              : option.id === 'mid'
                ? visualFilterPhotoSrc['car-suv']
                : option.id === 'high'
                  ? visualFilterPhotoSrc['car-luxury']
                  : visualFilterPhotoSrc['car-sedan'],
        })),
      }
    }

    return group
  })
}

function newConstructionVisualFilterGroups() {
  return visualFilterGroupsById(['sort', 'priceBand', 'propertyType', 'amenities', 'views', 'access', 'trust', 'payments']).map((group) => {
    if (group.id === 'priceBand') {
      return {
        ...group,
        options: group.options.map((option) => ({
          ...option,
          photoSrc:
            option.id === 'low'
              ? visualFilterPhotoSrc['property-apartment']
              : option.id === 'mid'
                ? visualFilterPhotoSrc['property-office']
                : option.id === 'high'
                  ? visualFilterPhotoSrc['property-villa']
                  : visualFilterPhotoSrc['property-project'],
        })),
      }
    }

    if (group.id === 'propertyType') {
      return {
        ...group,
        options: group.options.map((option) => ({
          ...option,
          photoSrc:
            option.id === 'land'
              ? visualFilterPhotoSrc['property-land']
              : option.id === 'office'
                ? visualFilterPhotoSrc['property-office']
                : option.id === 'shop'
                  ? visualFilterPhotoSrc['property-shop']
                  : option.id === 'villa'
                    ? visualFilterPhotoSrc['property-villa']
                    : visualFilterPhotoSrc['property-project'],
        })),
      }
    }

    return group
  })
}

function marketplaceVisualFilterGroups() {
  return visualFilterGroupsById(['sort', 'priceBand', 'marketCategory', 'condition', 'payments']).map((group) => {
    if (group.id === 'priceBand') {
      return {
        ...group,
        options: group.options.map((option) => ({
          ...option,
          photoSrc:
            option.id === 'low'
              ? visualFilterPhotoSrc['market-services']
              : option.id === 'mid'
                ? visualFilterPhotoSrc['market-appliances']
                : option.id === 'high'
                  ? visualFilterPhotoSrc['market-electronics']
                  : visualFilterPhotoSrc['market-furniture'],
        })),
      }
    }

    return group
  })
}

export function sellerPropertyFilterGroupsFromConfig() {
  return visualFilterGroupsById(['popular', 'propertyType', 'roomType', 'bedType', 'hotelStars', 'meals', 'amenities', 'views', 'access', 'payments'])
}

export function sellerCarFilterGroupsFromConfig() {
  return visualFilterGroupsById(['carBody', 'carBrand', 'carFuel', 'carTransmission', 'condition'])
}

export function renterPropertyFilterGroupsFromConfig() {
  // No 'payments' group: RENTALS/BUY are commission/contact-based with no in-app payment
  // collection at all (no booking, no checkout, no quote) -- same reasoning as SR Ride below.
  // CAPSULE_RULES.noFakeTrustSignal.
  return visualFilterGroupsById(['popular', 'sort', 'priceBand', 'propertyType', 'roomType', 'bedType', 'hotelStars', 'meals', 'amenities', 'views', 'access', 'trust'])
}

export function hostInventoryFilterGroupsFromConfig() {
  return visualFilterGroupsById(['popular', 'propertyType', 'roomType', 'bedType', 'hotelStars', 'meals', 'amenities', 'views', 'access', 'trust', 'payments'])
}

export function srRideFilterGroupsFromConfig() {
  // No 'payments' group here: SR Ride has no in-app payment-collection mechanism at all (no
  // PaymentProof relation on RideRequest, fares are informational only) -- offering a payment-method
  // choice would imply a capability that doesn't exist. CAPSULE_RULES.noFakeTrustSignal.
  return visualFilterGroupsById(['srRideCategory', 'srRideRoute', 'srRideFeatures'])
}

export const sellerPropertyFilterGroups = sellerPropertyFilterGroupsFromConfig()
export const sellerCarFilterGroups = sellerCarFilterGroupsFromConfig()
export const renterPropertyFilterGroups = renterPropertyFilterGroupsFromConfig()
export const hostInventoryFilterGroups = hostInventoryFilterGroupsFromConfig()

export const visualFilterArtOptions: VisualFilterArt[] = [
  'any',
  'sort-newest',
  'sort-low',
  'sort-high',
  'price-any',
  'price-low',
  'price-mid',
  'price-high',
  'general-properties',
  'general-rooms',
  'general-beds',
  'popular-parking',
  'popular-entire',
  'popular-old-city',
  'popular-near-me',
  'room-any',
  'room-single',
  'room-double',
  'room-suite',
  'room-studio',
  'room-family',
  'bed-single',
  'bed-double',
  'bed-queen',
  'bed-king',
  'bed-sofa',
  'property-apartment',
  'property-villa',
  'property-room',
  'property-heritage',
  'property-farm',
  'property-chalet',
  'property-land',
  'property-office',
  'property-shop',
  'property-project',
  'amenity-wifi',
  'amenity-fast-internet',
  'amenity-parking',
  'amenity-bathroom',
  'amenity-breakfast',
  'meal-lunch',
  'meal-dinner',
  'meal-buffet',
  'meal-all-inclusive',
  'meal-restaurant',
  'meal-no-kitchen',
  'meal-halal',
  'meal-plan',
  'meal-vegetarian',
  'meal-room-service',
  'hotel-star-5',
  'hotel-star-4',
  'hotel-star-3',
  'hotel-star-2',
  'hotel-star-1',
  'amenity-generator',
  'amenity-kitchen',
  'amenity-ac',
  'amenity-balcony',
  'amenity-pool',
  'amenity-heating',
  'amenity-tv',
  'amenity-garden',
  'amenity-elevator',
  'view-sea',
  'view-mountain',
  'outdoor-bbq',
  'access-crib',
  'access-pet',
  'access-wheelchair',
  'access-ramp',
  'access-parking',
  'access-bathroom',
  'access-wide-doorway',
  'access-hearing-loop',
  'access-visual-aid',
  'access-service-animal',
  'trust-verified',
  'trust-rating',
  'trust-fast',
  'trust-family',
  'trust-instant',
  'trust-featured',
  'payment-shamcash',
  'payment-card',
  'payment-local-wallet',
  'car-sedan',
  'car-suv',
  'car-pickup',
  'car-van',
  'car-luxury',
  'car-economy',
  'car-toyota',
  'car-hyundai',
  'car-kia',
  'car-mercedes',
  'car-bmw',
  'car-electric',
  'car-gas',
  'car-diesel',
  'car-hybrid',
  'car-manual',
  'car-automatic',
  'condition-new',
  'condition-used',
  'market-furniture',
  'market-electronics',
  'market-appliances',
  'market-services',
  'sr-ride-economy',
  'sr-ride-comfort',
  'sr-ride-premium',
  'sr-ride-family-van',
  'sr-ride-city',
  'sr-ride-airport',
  'sr-ride-intercity',
  'sr-ride-hourly',
  'sr-ride-instant',
  'sr-ride-ac',
  'sr-ride-wifi',
  'sr-ride-luggage',
  'sr-ride-child-seat',
  'sr-ride-family-friendly',
]

export function loadEditableVisualFilterGroups(): VisualFilterGroup[] {
  if (typeof window === 'undefined') return defaultVisualFilterGroups()

  try {
    const stored = window.localStorage.getItem(VISUAL_FILTER_CONFIG_KEY)
    if (!stored) return defaultVisualFilterGroups()
    const groups = JSON.parse(stored) as VisualFilterGroup[]
    return Array.isArray(groups) && groups.length ? mergeDefaultFilterGroups(groups).map(hydrateFilterGroup) : defaultVisualFilterGroups()
  } catch {
    return defaultVisualFilterGroups()
  }
}

export function saveEditableVisualFilterGroups(groups: VisualFilterGroup[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(VISUAL_FILTER_CONFIG_KEY, JSON.stringify(groups))
  window.dispatchEvent(new Event(VISUAL_FILTER_CONFIG_EVENT))
}

export function resetEditableVisualFilterGroups() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(VISUAL_FILTER_CONFIG_KEY)
  window.dispatchEvent(new Event(VISUAL_FILTER_CONFIG_EVENT))
}

function visualFilterGroupsById(ids: string[]) {
  const editableGroups = loadEditableVisualFilterGroups()
  return ids.flatMap((id) => editableGroups.find((group) => group.id === id) || [])
}

function defaultVisualFilterGroups(): VisualFilterGroup[] {
  return [
    sortFilterGroup,
    priceFilterGroup,
    popularFilterGroup,
    propertyFilterGroup,
    roomFilterGroup,
    bedFilterGroup,
    hotelStarFilterGroup,
    mealFilterGroup,
    amenityFilterGroup,
    viewFilterGroup,
    accessFilterGroup,
    trustFilterGroup,
    paymentFilterGroup,
    carFilterGroup,
    carBrandFilterGroup,
    carFuelFilterGroup,
    carTransmissionFilterGroup,
    conditionFilterGroup,
    marketFilterGroup,
    srRideCategoryFilterGroup,
    srRideRouteFilterGroup,
    srRideFeatureFilterGroup,
  ].map((group) => hydrateFilterGroup({
    ...group,
    title: { ...group.title },
    options: group.options.map((option) => ({ ...option, label: { ...option.label } })),
  }))
}

function mergeDefaultFilterGroups(groups: VisualFilterGroup[]) {
  const defaults = defaultVisualFilterGroups()
  return defaults.map((defaultGroup) => {
    const storedGroup = groups.find((group) => group.id === defaultGroup.id)
    if (!storedGroup) return defaultGroup

    const defaultOptionIds = new Set(defaultGroup.options.map((option) => option.id))
    const storedOptions = storedGroup.options.filter((option) => defaultOptionIds.has(option.id))
    const storedOptionIds = new Set(storedOptions.map((option) => option.id))
    const missingDefaultOptions = defaultGroup.options.filter((option) => !storedOptionIds.has(option.id))
    return {
      ...storedGroup,
      title: defaultGroup.title,
      options: [...storedOptions, ...missingDefaultOptions],
    }
  })
}

function hydrateFilterGroup(group: VisualFilterGroup): VisualFilterGroup {
  return {
    ...group,
    title: { ...group.title },
    options: group.options.map((option) => ({
      ...option,
      label: { ...option.label },
      photoSrc: option.photoSrc || visualFilterPhotoSrc[option.art],
      photoAlt: option.photoAlt || option.label,
    })),
  }
}
