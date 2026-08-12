export interface FbsAllocationWarehouse {
  warehouseId: number;
  targetQuantity: number;
  orders30d: number;
}

export interface FbsAllocationResult {
  warehouses: FbsAllocationWarehouse[];
  transfers: Array<{ from: number; to: number; quantity: number }>;
}

/**
 * Rank warehouses by non-cancelled orders for the last 30 days.
 *
 * When stock is scarce, only the best-selling warehouses remain active. When
 * there is enough stock for every warehouse, each one receives one unit and
 * the surplus is distributed proportionally to demand. Existing placement is
 * used as a tie-breaker so equal-demand warehouses do not churn needlessly.
 */
export function allocateFbsStock(
  input: FbsAllocationWarehouse[],
  physicalQuantity: number,
): FbsAllocationResult {
  if (!Number.isSafeInteger(physicalQuantity) || physicalQuantity < 0) {
    throw new Error("Physical quantity must be a non-negative integer");
  }
  if (input.length === 0) throw new Error("At least one warehouse is required");
  const warehouses = input.map((row) => ({
    warehouseId: row.warehouseId,
    targetQuantity: Math.max(0, Math.trunc(row.targetQuantity || 0)),
    orders30d: Math.max(0, Math.trunc(row.orders30d || 0)),
  }));
  const previous = new Map(warehouses.map((row) => [row.warehouseId, row.targetQuantity]));
  const ranked = [...warehouses].sort((a, b) =>
    b.orders30d - a.orders30d
    || Number(b.targetQuantity > 0) - Number(a.targetQuantity > 0)
    || b.targetQuantity - a.targetQuantity
    || a.warehouseId - b.warehouseId
  );

  for (const warehouse of warehouses) warehouse.targetQuantity = 0;

  if (physicalQuantity < warehouses.length) {
    for (let index = 0; index < physicalQuantity; index += 1) {
      ranked[index].targetQuantity = 1;
    }
  } else {
    for (const warehouse of warehouses) warehouse.targetQuantity = 1;
    const surplus = physicalQuantity - warehouses.length;
    const totalOrders = warehouses.reduce((sum, row) => sum + row.orders30d, 0);

    if (surplus > 0 && totalOrders > 0) {
      let allocated = 0;
      const shares = warehouses.map((warehouse) => {
        const exact = surplus * warehouse.orders30d / totalOrders;
        const quantity = Math.floor(exact);
        warehouse.targetQuantity += quantity;
        allocated += quantity;
        return { warehouse, remainder: exact - quantity };
      });
      shares.sort((a, b) =>
        b.remainder - a.remainder
        || b.warehouse.orders30d - a.warehouse.orders30d
        || (previous.get(b.warehouse.warehouseId) || 0) - (previous.get(a.warehouse.warehouseId) || 0)
        || a.warehouse.warehouseId - b.warehouse.warehouseId
      );
      for (let index = 0; index < surplus - allocated; index += 1) {
        shares[index].warehouse.targetQuantity += 1;
      }
    } else if (surplus > 0) {
      // No demand signal: retain the previous distribution as closely as
      // possible instead of moving stock between equal warehouses.
      let allocated = 0;
      for (const warehouse of ranked) {
        const retained = Math.min(Math.max((previous.get(warehouse.warehouseId) || 0) - 1, 0), surplus - allocated);
        warehouse.targetQuantity += retained;
        allocated += retained;
        if (allocated === surplus) break;
      }
      for (let index = 0; allocated < surplus; index = (index + 1) % ranked.length) {
        ranked[index].targetQuantity += 1;
        allocated += 1;
      }
    }
  }

  const donors = warehouses
    .map((row) => ({ warehouseId: row.warehouseId, quantity: (previous.get(row.warehouseId) || 0) - row.targetQuantity }))
    .filter((row) => row.quantity > 0)
    .sort((a, b) => a.warehouseId - b.warehouseId);
  const receivers = warehouses
    .map((row) => ({ warehouseId: row.warehouseId, quantity: row.targetQuantity - (previous.get(row.warehouseId) || 0) }))
    .filter((row) => row.quantity > 0)
    .sort((a, b) => a.warehouseId - b.warehouseId);
  const transfers: Array<{ from: number; to: number; quantity: number }> = [];
  let donorIndex = 0;
  let receiverIndex = 0;
  while (donorIndex < donors.length && receiverIndex < receivers.length) {
    const donor = donors[donorIndex];
    const receiver = receivers[receiverIndex];
    const quantity = Math.min(donor.quantity, receiver.quantity);
    transfers.push({ from: donor.warehouseId, to: receiver.warehouseId, quantity });
    donor.quantity -= quantity;
    receiver.quantity -= quantity;
    if (donor.quantity === 0) donorIndex += 1;
    if (receiver.quantity === 0) receiverIndex += 1;
  }
  return { warehouses, transfers };
}
