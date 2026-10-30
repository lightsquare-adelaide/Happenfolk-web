/**
 * Event price label shown on public event cards.
 *
 * Prices are stored as integer Australian cents (events.price_cents).
 * Zero, null or a negative value reads as "Free"; anything else is an
 * A$ amount. Whole-dollar prices drop the cents ("A$25"), others keep
 * two decimals ("A$12.50"). Checkout is simulated, so the card shows
 * the price only — the payment notice lives on the participate page.
 */
export function formatEventPrice(priceCents: number | null | undefined): string {
  if (priceCents == null || !Number.isFinite(priceCents) || priceCents <= 0) return "Free";
  const cents = Math.round(priceCents);
  const dollars = cents / 100;
  return cents % 100 === 0 ? `A$${dollars.toFixed(0)}` : `A$${dollars.toFixed(2)}`;
}
