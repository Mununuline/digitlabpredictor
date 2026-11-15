export type TickPoint = {
  quote: number;
  epoch: number;
};

export type DigitStats = {
  digit: number;
  count: number;
  frequency: number;
};

export function getLastDigit(quote: number, pipSize: number): number {
  if (!Number.isFinite(quote) || !Number.isInteger(pipSize) || pipSize < 0 || pipSize > 10) {
    throw new Error("Invalid quote or pip size");
  }

  const fixed = quote.toFixed(pipSize);
  const digits = fixed.replace(".", "").replace("-", "");
  return Number(digits.at(-1) ?? 0);
}

export function summarizeDigits(ticks: TickPoint[], pipSize: number): DigitStats[] {
  const counts = Array.from({ length: 10 }, () => 0);

  for (const tick of ticks) {
    counts[getLastDigit(tick.quote, pipSize)] += 1;
  }

  const total = ticks.length;
  return counts.map((count, digit) => ({
    digit,
    count,
    frequency: total === 0 ? 0 : count / total
  }));
}

export function sampleDescription(size: number): string {
  if (size <= 0) return "No observations yet";
  return `${size} observed tick${size === 1 ? "" : "s"}`;
}