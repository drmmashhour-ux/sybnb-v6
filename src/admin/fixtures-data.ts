import type { OrderView, RestaurantFixtureSummary } from './fixtures'
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const order: OrderView = {
  id: 'fx-1001', number: 'FIXTURE-1001', restaurant: 'Demo Pizzeria (fixture)', location: 'Sample district, fixture city', status: 'Out for delivery', placedAt: ago(38),
  amountMinor: 4850, currency: 'CAD',
  restaurantState: { label: 'Order handed over', tone: 'pos', note: 'Packed and collected by the courier.' },
  deliveryState: { label: 'In transit', tone: 'info', note: 'Courier is on the way to the customer.' },
  courier: { name: 'Fixture Courier', vehicle: 'Scooter', phoneMasked: '•••• •• 128' },
  customer: { name: 'Fixture Customer', area: 'Sample district', phoneMasked: '•••• •• 764' },
  items: [
    { qty: 1, name: 'Large Pepperoni', modifiers: ['Extra Cheese', 'Olives'] },
    { qty: 2, name: 'Garlic Bread', modifiers: [] },
    { qty: 1, name: 'Lemonade 500 ml', modifiers: ['No ice'] },
  ],
  timeline: [
    { key: 'placed', label: 'Order placed', at: ago(38) }, { key: 'accepted', label: 'Restaurant accepted', at: ago(36) }, { key: 'preparing', label: 'Preparing', at: ago(34) },
    { key: 'offered', label: 'Courier offered', at: ago(22) }, { key: 'courier_accepted', label: 'Courier accepted', at: ago(21) }, { key: 'arrived', label: 'Courier arrived', at: ago(12) },
    { key: 'ready', label: 'Ready', at: ago(11) }, { key: 'picked_up', label: 'Picked up', at: ago(9) },
  ],
  auditRefs: ['fixture-audit-0001'], supportRefs: [],
}
export const fixtures = {
  order: (id: string) => (id === order.id ? order : null),
  summary: {
    restaurants: { active: 12, paused: 2, onboarding: 3 },
    liveOrders: [{ id: order.id, number: order.number, restaurant: order.restaurant, status: order.status, elapsedFrom: order.placedAt }],
    deliveries: { assigned: 4, unassigned: 1 },
  } as RestaurantFixtureSummary,
}
