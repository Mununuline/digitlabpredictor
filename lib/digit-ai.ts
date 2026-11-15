import { getLastDigit, type TickPoint } from "@/lib/digits";

export type DigitAIReview = {
  status: string;
  candidate: number | null;
  triggerDigit: number | null;
  confidence: number;
  support: number;
  holdoutAccuracy: number;
  baselineAccuracy: number;
  lift: number;
  holdoutSamples: number;
  explanation: string;
};

export function scanDigits(points: TickPoint[]): DigitAIReview {
  const digits = points.map((p) => getLastDigit(p.quote, p.pipSize ?? 2));
  const empty: DigitAIReview = {
    status: "COLLECTING EVIDENCE", candidate: null, triggerDigit: null,
    confidence: 0, support: 0, holdoutAccuracy: 0, baselineAccuracy: 10,
    lift: 0, holdoutSamples: 0,
    explanation: "Collect at least 150 ordered ticks before the adaptive scanner evaluates a candidate.",
  };
  if (digits.length < 150) return empty;

  const split = Math.floor((digits.length - 1) * 0.7);
  const matrix = Array.from({ length: 10 }, () => Array<number>(10).fill(0));
  const rowTotals = Array<number>(10).fill(0);
  for (let i = 0; i < split; i++) {
    matrix[digits[i]][digits[i + 1]]++;
    rowTotals[digits[i]]++;
  }

  // Chronological holdout: predictions are made only from the earlier training segment.
  let correct = 0;
  let evaluated = 0;
  for (let i = split; i < digits.length - 1; i++) {
    const row = matrix[digits[i]];
    const total = rowTotals[digits[i]];
    if (total < 10) continue;
    let best = 0;
    for (let d = 1; d < 10; d++) if (row[d] > row[best]) best = d;
    if (best === digits[i + 1]) correct++;
    evaluated++;
  }
  const holdoutAccuracy = evaluated ? correct / evaluated * 100 : 0;

  const triggerDigit = digits[digits.length - 1];
  const support = rowTotals[triggerDigit];
  const row = matrix[triggerDigit];
  let candidate = 0;
  for (let d = 1; d < 10; d++) if (row[d] > row[candidate]) candidate = d;
  const confidence = support ? (row[candidate] + 1) / (support + 10) * 100 : 10;
  const lift = holdoutAccuracy / 10;
  const validated = evaluated >= 30 && support >= 25 && holdoutAccuracy > 10.5 && confidence >= 13;
  return {
    status: validated ? "RESEARCH CANDIDATE" : "NO SIGNAL · EDGE NOT VERIFIED",
    candidate: validated ? candidate : null,
    triggerDigit, confidence, support, holdoutAccuracy, baselineAccuracy: 10,
    lift, holdoutSamples: evaluated,
    explanation: validated
      ? "A transition candidate passed the app's preliminary chronological holdout gate. This is not proof of a profitable or persistent edge; keep it in paper research."
      : "The model has not beaten the 10% reference strongly enough on untouched chronological observations, or its trigger sample is too small. No digit is recommended.",
  };
}
