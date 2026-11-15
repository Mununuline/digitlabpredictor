export type TickPoint = { quote: number; epoch: number; pipSize?: number };
export type DigitStats = { digit: number; count: number; frequency: number };
export function getLastDigit(quote: number, pipSize: number): number {
  if (!Number.isFinite(quote) || !Number.isInteger(pipSize) || pipSize < 0 || pipSize > 10) throw new Error("Invalid quote or pip size");
  return Number(quote.toFixed(pipSize).replace(".", "").replace("-", "").slice(-1));
}
export function summarizeDigits(ticks: TickPoint[], defaultPipSize: number): DigitStats[] {
  const counts = Array.from({ length: 10 }, () => 0);
  for (const tick of ticks) counts[getLastDigit(tick.quote, tick.pipSize ?? defaultPipSize)]++;
  return counts.map((count, digit) => ({ digit, count, frequency: ticks.length ? count / ticks.length : 0 }));
}
export function sampleDescription(size: number): string {
  if (size <= 0) return "No observations yet";
  return `${size} observed tick${size === 1 ? "" : "s"}`;
}