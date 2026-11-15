import { getLastDigit, type TickPoint } from "@/lib/digits";

export type WindowReview = {
  size: number;
  sample: number;
  chiSquare: number;
  maxDeviation: number;
  repeatRate: number;
  entropy: number;
  status: string;
};

export type DigitAIReview = {
  status: string;
  candidate: number | null;
  proposedCandidate: number | null;
  triggerDigit: number | null;
  confidence: number;
  support: number;
  holdoutAccuracy: number;
  baselineAccuracy: number;
  lift: number;
  holdoutSamples: number;
  lowerBound: number;
  explanation: string;
  windows: WindowReview[];
  randomnessNote: string;
};

function wilsonLower(successes: number, total: number): number {
  if (!total) return 0;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return ((centre - margin) / denominator) * 100;
}

function reviewWindow(digits: number[], size: number): WindowReview {
  const sample = digits.slice(-size);
  const n = sample.length;
  const counts = Array<number>(10).fill(0);
  sample.forEach((digit) => counts[digit]++);
  const expected = n / 10;
  const chiSquare = n ? counts.reduce((sum, count) => sum + ((count - expected) ** 2) / expected, 0) : 0;
  const maxDeviation = n ? Math.max(...counts.map((count) => Math.abs((count / n) * 100 - 10))) : 0;
  const entropyBits = n ? -counts.reduce((sum, count) => {
    if (!count) return sum;
    const p = count / n;
    return sum + p * Math.log2(p);
  }, 0) : 0;
  let repeats = 0;
  for (let i = 1; i < n; i++) if (sample[i] === sample[i - 1]) repeats++;
  const repeatRate = n > 1 ? repeats / (n - 1) * 100 : 0;
  const status = n < Math.min(size, 25) ? "BUILDING" : chiSquare > 16.92 ? "DISTRIBUTION DEVIATION" : "NO LARGE DEVIATION";
  return { size, sample: n, chiSquare, maxDeviation, repeatRate, entropy: entropyBits / Math.log2(10) * 100, status };
}

export function scanDigits(points: TickPoint[]): DigitAIReview {
  const digits = points.map((point) => getLastDigit(point.quote, point.pipSize ?? 2));
  const windows = [25, 50, 100, 250, 500, 1000].map((size) => reviewWindow(digits, size));
  const empty: DigitAIReview = {
    status: "COLLECTING EVIDENCE", candidate: null, proposedCandidate: null, triggerDigit: null,
    confidence: 0, support: 0, holdoutAccuracy: 0, baselineAccuracy: 10,
    lift: 0, holdoutSamples: 0, lowerBound: 0, windows,
    randomnessNote: "Observed-output diagnostics only. Deriv's CSPRNG internals and random state are not exposed to this scanner.",
    explanation: "Collect at least 300 ordered ticks. The scanner will evaluate a one-tick model against later, unseen observations.",
  };
  if (digits.length < 300) return empty;

  // Expanding-window walk-forward evaluation: every prediction uses only ticks
  // available before its target tick. No future observations enter training.
  const split = Math.floor((digits.length - 1) * 0.7);
  let correct = 0;
  let evaluated = 0;
  for (let i = split; i < digits.length - 1; i++) {
    const matrix = Array.from({ length: 10 }, () => Array<number>(10).fill(0));
    const rowTotals = Array<number>(10).fill(0);
    for (let j = 0; j < i; j++) {
      matrix[digits[j]][digits[j + 1]]++;
      rowTotals[digits[j]]++;
    }
    const current = digits[i];
    // Score only the opportunities that would have passed the same
    // support/confidence gates used by the live paper decision.
    const supportAtDecision = rowTotals[current];
    if (supportAtDecision < 30) continue;
    const row = matrix[current];
    let best = 0;
    for (let d = 1; d < 10; d++) if (row[d] > row[best]) best = d;
    const confidenceAtDecision = (row[best] + 1) / (supportAtDecision + 10) * 100;
    if (confidenceAtDecision < 13) continue;
    if (best === digits[i + 1]) correct++;
    evaluated++;
  }

  const matrix = Array.from({ length: 10 }, () => Array<number>(10).fill(0));
  const rowTotals = Array<number>(10).fill(0);
  for (let i = 0; i < digits.length - 1; i++) {
    matrix[digits[i]][digits[i + 1]]++;
    rowTotals[digits[i]]++;
  }
  const triggerDigit = digits[digits.length - 1];
  const support = rowTotals[triggerDigit];
  const row = matrix[triggerDigit];
  let candidate = 0;
  for (let d = 1; d < 10; d++) if (row[d] > row[candidate]) candidate = d;
  const confidence = support ? (row[candidate] + 1) / (support + 10) * 100 : 10;
  const holdoutAccuracy = evaluated ? correct / evaluated * 100 : 0;
  const lowerBound = wilsonLower(correct, evaluated);
  const validated = evaluated >= 100 && support >= 30 && lowerBound > 10 && confidence >= 13;

  return {
    status: validated ? "RESEARCH CANDIDATE · PAPER TEST ONLY" : "NO SIGNAL · EDGE NOT VERIFIED",
    candidate: validated ? candidate : null,
    proposedCandidate: candidate,
    triggerDigit, confidence, support, holdoutAccuracy, baselineAccuracy: 10,
    lift: holdoutAccuracy / 10, holdoutSamples: evaluated, lowerBound, windows,
    randomnessNote: "CSPRNG-aware means testing the observable output for distribution and serial-pattern anomalies. It does not reveal Deriv's secret seed, internal state or next random value.",
    explanation: validated
      ? "The one-tick strategy passed its current expanding-window gate on trade-eligible holdout opportunities. Continue paper testing; this is not proof of a persistent or profitable edge."
      : "No candidate has passed the strict out-of-sample gate on trade-eligible opportunities. Only predictions meeting the same support and confidence rules as live paper decisions are counted. The model abstains rather than presenting a weak pattern as a prediction.",
  };
}
