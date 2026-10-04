import { calculateInvoice } from './invoice-calculator';

describe('calculateInvoice', () => {
  it('menghitung subtotal, diskon, pajak, dan total', () => {
    const result = calculateInvoice(
      [
        { description: 'Desain logo', quantity: 1, unitPrice: 500000 },
        { description: 'Revisi', quantity: 2, unitPrice: 100000 },
      ],
      50000,
      77000,
    );

    expect(result.subtotal.toString()).toBe('700000');
    expect(result.discount.toString()).toBe('50000');
    expect(result.tax.toString()).toBe('77000');
    expect(result.total.toString()).toBe('727000');
  });

  it('mengisi amount per baris = quantity x unitPrice', () => {
    const result = calculateInvoice([
      { description: 'Revisi', quantity: 3, unitPrice: 100000 },
    ]);

    expect(result.lines[0].amount.toString()).toBe('300000');
  });

  it('akurat untuk desimal (tanpa selisih floating point)', () => {
    const result = calculateInvoice([
      { description: 'A', quantity: 3, unitPrice: 0.1 },
    ]);

    // Dengan number biasa: 0.1 * 3 = 0.30000000000000004
    expect(result.subtotal.toString()).toBe('0.3');
  });

  it('diskon dan pajak default 0', () => {
    const result = calculateInvoice([
      { description: 'A', quantity: 1, unitPrice: 1000 },
    ]);

    expect(result.total.toString()).toBe('1000');
  });
});
