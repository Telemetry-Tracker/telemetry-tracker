export function computeTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.qty;
  }
  if (total > 100) {
    throw new Error("Checkout total exceeded: " + total);
  }
  return total;
}
