import { computeTotal } from "./checkout";
function onPressPay() {
  return computeTotal([{ price: 80, qty: 2 }]);
}
try {
  onPressPay();
} catch (e) {
  print(e.stack);
}
