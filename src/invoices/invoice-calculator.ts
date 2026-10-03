import { Prisma } from '../generated/prisma/client';

type Numeric = number | string | Prisma.Decimal;

export interface ItemInput {
  description: string;
  quantity: number;
  unitPrice: Numeric;
}

export function calculateInvoice(
  items: ItemInput[],
  discount: Numeric = 0,
  tax: Numeric = 0,
) {
  const lines = items.map((item) => {
    const unitPrice = new Prisma.Decimal(item.unitPrice);
    return {
      description: item.description,
      quantity: item.quantity,
      unitPrice,
      amount: unitPrice.mul(item.quantity),
    };
  });

  const subtotal = lines.reduce(
    (sum, line) => sum.add(line.amount),
    new Prisma.Decimal(0),
  );
  const discountValue = new Prisma.Decimal(discount);
  const taxValue = new Prisma.Decimal(tax);
  const total = subtotal.sub(discountValue).add(taxValue);

  return { lines, subtotal, discount: discountValue, tax: taxValue, total };
}
