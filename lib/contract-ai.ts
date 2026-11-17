import { getLastDigit, type TickPoint } from "@/lib/digits";

export type DigitContractType = "MATCHES" | "DIFFERS" | "EVEN" | "ODD" | "OVER" | "UNDER";
export type ContractScan = {
  contract: DigitContractType;
  status: "COLLECTING" | "NO_EDGE" | "RESEARCH_CANDIDATE";
  decision: "WAIT" | "NO TRADE" | "REVIEW CANDIDATE";
  barrier: number | null;
  predictedWinProbability: number;
  baselineProbability: number;
  holdoutAccuracy: number;
  holdoutSamples: number;
  lowerBound: number;
  edgeLowerBound: number;
  recentAccuracy: number;
  recentSamples: number;
  wins: number;
  reason: string;
  methodology: string;
};

type Choice = { barrier: number | null; probability: number; baseline: number };

const MIN_TRAIN = 100;
const MIN_HOLDOUT = 100;
const Z = 1.96;

function lowerBound(successes: number, total: number): number {
  if (!total) return 0;
  const p = successes / total;
  const z2 = Z * Z;
  const den = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin = Z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return (centre - margin) / den * 100;
}

function choose(digits: number[], contract: DigitContractType): Choice {
  const counts = Array<number>(10).fill(0);
  digits.forEach((digit) => counts[digit]++);
  const n = digits.length;
  const smoothed = (successes: number, baseline: number) =>
    (successes + 10 * baseline) / (n + 10);

  if (contract === "MATCHES" || contract === "DIFFERS") {
    let digit = 0;
    for (let d = 1; d <= 9; d++) {
      if (contract === "MATCHES" ? counts[d] > counts[digit] : counts[d] < counts[digit]) digit = d;
    }
    const matchProbability = smoothed(counts[digit], 0.1);
    return {
      barrier: digit,
      probability: contract === "MATCHES" ? matchProbability : 1 - matchProbability,
      baseline: contract === "MATCHES" ? 0.1 : 0.9,
    };
  }

  if (contract === "EVEN" || contract === "ODD") {
    const even = counts[0] + counts[2] + counts[4] + counts[6] + counts[8];
    const odd = n - even;
    const isEven = contract === "EVEN";
    const selected = isEven ? even : odd;
    return { barrier: null, probability: smoothed(selected, 0.5), baseline: 0.5 };
  }

  let best: Choice | null = null;
  const isOver = contract === "OVER";
  const barriers = isOver ? [0,1,2,3,4,5,6,7,8] : [1,2,3,4,5,6,7,8,9];
  for (const barrier of barriers) {
    const qualifying = digits.reduce((sum, digit) =>
      sum + (isOver ? Number(digit > barrier) : Number(digit < barrier)), 0);
    const baseline = isOver ? (9 - barrier) / 10 : barrier / 10;
    const probability = smoothed(qualifying, baseline);
    const candidate = { barrier, probability, baseline };
    if (!best || probability - baseline > best.probability - best.baseline) best = candidate;
  }
  return best || { barrier: isOver ? 4 : 5, probability: 0.5, baseline: 0.5 };
}

function wins(contract: DigitContractType, digit: number, barrier: number | null): boolean {
  if (barrier === null) return contract === "EVEN" ? digit % 2 === 0 : digit % 2 === 1;
  if (contract === "MATCHES") return digit === barrier;
  if (contract === "DIFFERS") return digit !== barrier;
  if (contract === "OVER") return digit > barrier;
  if (contract === "UNDER") return digit < barrier;
  return false;
}

function scanMatches(points: TickPoint[], digits: number[]): ContractScan {
  const empty: ContractScan = {
    contract: "MATCHES", status: "COLLECTING", decision: "WAIT", barrier: null,
    predictedWinProbability: 0, baselineProbability: 10, holdoutAccuracy: 0,
    holdoutSamples: 0, lowerBound: 0, edgeLowerBound: 0, recentAccuracy: 0,
    recentSamples: 0, wins: 0,
    reason: "Collect at least 450 ordered ticks. MATCHES needs enough historical examples of the latest digit to evaluate the next-digit prediction.",
    methodology: "MATCHES-specific conditional next-digit model; expanding walk-forward holdout; Laplace smoothing; Wilson lower bound against the 10% exact-digit baseline.",
  };
  if (digits.length < 450) return empty;

  const split = Math.floor((digits.length - 1) * 0.7);
  const outcomes: boolean[] = [];
  for (let i = split; i < digits.length - 1; i++) {
    const counts = Array<number>(10).fill(0);
    let support = 0;
    for (let j = 0; j < i; j++) {
      if (digits[j] === digits[i]) { counts[digits[j + 1]]++; support++; }
    }
    if (support < 30) continue;
    let pick = 0;
    for (let d = 1; d < 10; d++) if (counts[d] > counts[pick]) pick = d;
    const probability = (counts[pick] + 1) / (support + 10);
    if (probability < 0.13) continue;
    outcomes.push(pick === digits[i + 1]);
  }
  const total = outcomes.length;
  if (!total) return empty;
  const successes = outcomes.filter(Boolean).length;
  const hitRate = successes / total * 100;
  const lower = lowerBound(successes, total);
  const recent = outcomes.slice(-Math.min(100, total));
  const recentRate = recent.filter(Boolean).length / recent.length * 100;

  const trigger = digits[digits.length - 1];
  const counts = Array<number>(10).fill(0);
  let support = 0;
  for (let j = 0; j < digits.length - 1; j++) {
    if (digits[j] === trigger) { counts[digits[j + 1]]++; support++; }
  }
  let candidate = 0;
  for (let d = 1; d < 10; d++) if (counts[d] > counts[candidate]) candidate = d;
  const probability = support ? (counts[candidate] + 1) / (support + 10) * 100 : 0;
  const edge = lower - 10;
  const qualified = total >= MIN_HOLDOUT && support >= 30 && probability >= 13
    && edge >= 5 && recent.length >= 50 && recentRate >= 10;
  const pct = (n: number) => n.toFixed(1) + "%";
  return {
    contract: "MATCHES", status: qualified ? "RESEARCH_CANDIDATE" : "NO_EDGE",
    decision: qualified ? "REVIEW CANDIDATE" : "NO TRADE", barrier: candidate,
    predictedWinProbability: probability, baselineProbability: 10,
    holdoutAccuracy: hitRate, holdoutSamples: total, lowerBound: lower,
    edgeLowerBound: edge, recentAccuracy: recentRate, recentSamples: recent.length,
    wins: successes,
    reason: qualified
      ? `MATCHES predicts the next last digit is ${candidate}, conditioned on the latest observed digit ${trigger}. Walk-forward holdout: ${pct(hitRate)} from ${total} eligible tests; Wilson lower bound ${pct(lower)} versus the 10% exact-digit baseline. Candidate only; the live proposal must still pass payout and risk gates.`
      : `MATCHES currently predicts digit ${candidate} after latest digit ${trigger}, but the evidence gate is not met. Holdout ${pct(hitRate)} from ${total} eligible tests; lower bound ${pct(lower)}; candidate estimate ${pct(probability)}; recent ${pct(recentRate)}. Bot must WAIT.`,
    methodology: "MATCHES-only next-last-digit forecast: for each historical decision, train a transition row on earlier occurrences of the current trigger digit, select the most frequent next digit, and score only predictions with at least 30 prior examples and 13% smoothed probability. Expanding walk-forward holdout; Wilson lower bound must exceed the 10% exact-digit baseline by at least 5 percentage points. This does not establish future profitability.",
  };
}

/** Contract-specific expanding walk-forward evaluation. Every choice at t uses only digits before t. */
export function scanDigitContract(points: TickPoint[], contract: DigitContractType): ContractScan {
  const digits = points.map((point) => getLastDigit(point.quote, point.pipSize ?? 2));
  if (contract === "MATCHES") return scanMatches(points, digits);
  const empty: ContractScan = {
    contract, status: "COLLECTING", decision: "WAIT", barrier: null,
    predictedWinProbability: 0, baselineProbability: 0, holdoutAccuracy: 0,
    holdoutSamples: 0, lowerBound: 0, edgeLowerBound: 0, recentAccuracy: 0,
    recentSamples: 0, wins: 0,
    reason: "Collect at least 450 ordered ticks. The contract-specific model needs a training history and a separate unseen evaluation period.",
    methodology: "Expanding-window walk-forward; Laplace-smoothed event probabilities; contract-specific benchmark; Wilson lower confidence bound.",
  };
  if (digits.length < 450) return empty;

  const split = Math.floor((digits.length - 1) * 0.7);
  let successes = 0;
  let baselineTotal = 0;
  const outcomes: boolean[] = [];
  for (let i = split; i < digits.length - 1; i++) {
    const choice = choose(digits.slice(0, i), contract);
    const hit = wins(contract, digits[i + 1], choice.barrier);
    outcomes.push(hit);
    if (hit) successes++;
    baselineTotal += choice.baseline;
  }
  const total = outcomes.length;
  if (!total) return empty;
  const baselineProbability = baselineTotal / total * 100;
  const holdoutAccuracy = successes / total * 100;
  const lower = lowerBound(successes, total);
  const edgeLower = lower - baselineProbability;
  const recent = outcomes.slice(-Math.min(100, total));
  const recentWins = recent.filter(Boolean).length;
  const recentAccuracy = recent.length ? recentWins / recent.length * 100 : 0;
  const current = choose(digits.slice(0, -1), contract);
  const enough = total >= MIN_HOLDOUT;
  const stable = recent.length >= 50 && recentAccuracy >= baselineProbability - 3;
  const qualified = enough && edgeLower > 0 && stable;

  const pct = (value: number) => value.toFixed(1) + "%";
  const candidateLabel = current.barrier === null
    ? (contract === "EVEN" ? "EVEN" : "ODD")
    : String(current.barrier);
  const reason = qualified
    ? `Unseen walk-forward results beat the contract's benchmark: ${pct(holdoutAccuracy)} hit rate versus ${pct(baselineProbability)} baseline. The Wilson lower bound is ${pct(lower)}; recent 100-or-fewer tests are ${pct(recentAccuracy)}. This is a research candidate only; check the live proposal's break-even probability before considering a demo trade.`
    : `No validated edge. Unseen results: ${pct(holdoutAccuracy)} versus ${pct(baselineProbability)} benchmark; lower confidence bound ${pct(lower)}; recent sample ${pct(recentAccuracy)}. The scanner abstains unless the lower confidence bound beats the contract-specific benchmark and recent results remain stable.`;

  return {
    contract, status: qualified ? "RESEARCH_CANDIDATE" : "NO_EDGE",
    decision: qualified ? "REVIEW CANDIDATE" : "NO TRADE",
    barrier: current.barrier, predictedWinProbability: current.probability * 100,
    baselineProbability, holdoutAccuracy, holdoutSamples: total,
    lowerBound: lower, edgeLowerBound: edgeLower,
    recentAccuracy, recentSamples: recent.length, wins: successes,
    reason: `Current candidate: ${candidateLabel}. ${reason}`,
    methodology: "Expanding-window walk-forward (first 70% training, final 30% unseen); decisions rebuilt only from earlier ticks; Laplace smoothing toward the contract's uniform-digit baseline; lower Wilson bound compared with the average benchmark; recent stability check. This is not a payout-adjusted profitability test.",
  };
}
