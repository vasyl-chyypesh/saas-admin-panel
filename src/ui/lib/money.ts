/**
 * Money in the UI. Amounts travel as integers in the currency's minor unit (cents for USD); people
 * type and read major units ("49.99"). Conversion goes through strings, never `* 100`, so 19.99
 * stays exactly 1999.
 */

/**
 * Digits in the currency's minor unit: 2 for USD (cents), 0 for JPY. Prices are stored in minor
 * units, so this is the scale between the stored integer and what people type and read.
 */
export const minorUnitDigits = (currency: string): number => {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    // Not a well-formed currency code (e.g. half-typed in the form).
    return 2;
  }
};

/** `4900, 'USD'` → `$49.00`; `null` → `Custom` (the price is quoted by sales). */
export const formatPrice = (amount: number | null, currency: string): string => {
  if (amount === null) return 'Custom';
  const major = amount / 10 ** minorUnitDigits(currency);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
  } catch {
    return `${major.toFixed(minorUnitDigits(currency))} ${currency}`;
  }
};

/** `4990, 'USD'` → `"49.90"`, for prefilling an input; `null` → `""`. */
export const toAmountInput = (amount: number | null, currency: string): string => {
  if (amount === null) return '';
  const digits = minorUnitDigits(currency);
  return (amount / 10 ** digits).toFixed(digits);
};

/**
 * "49.9" → 4990 for USD. Parsed as strings rather than with `Number(x) * 100`, which would turn
 * 19.99 into 1998.9999…. Returns `undefined` for anything that isn't a plain non-negative amount.
 */
export const parseAmount = (raw: string, currency: string): number | undefined => {
  const digits = minorUnitDigits(currency);
  const value = raw.trim();
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`);
  if (!pattern.test(value)) return undefined;
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
};
