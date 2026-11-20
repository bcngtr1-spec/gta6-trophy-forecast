// gta6-trophy-rarity-forecast improved entry (Node 22, standard library only):
// Models player adoption via a diffusion curve in ln(1 + hours), detects refresh jumps
// to estimate true growth rate per hour, extrapolates median with Gompertz-style saturation,
// and scales spread with horizon length, jump jitter volatility, and per-trophy volatility.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.645, -0.674, 0, 0.674, 1.645];

interface Case {
  schema: string;
  id: string;
  at: string;
  horizon_minutes: number;
  target: string;
  levels: number[];
  game: {
    name: string;
    platform: string;
    release_date: string;
    source: string;
  };
  trophies: Array<{ id: number; name?: string; tier?: string }>;
  history: Array<{
    slot: string;
    at: string;
    players_tracked: number;
    trophies_earned: number;
    rates: Array<number | null>;
  }>;
}

const clamp = (x: number): number => Math.min(99.99, Math.max(0.01, x));
const logit = (pct: number): number => Math.log(clamp(pct) / (100 - clamp(pct)));
const sigmoid = (l: number): number => 100 / (1 + Math.exp(-l));
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

mkdirSync(OUTPUT_DIR, { recursive: true });

const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();

for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  if (!c.history || c.history.length === 0) {
    throw new Error(`${file} has no history`);
  }

  const releaseTime = new Date(c.game.release_date + 'T00:00:00Z').getTime();
  const targetTime = new Date(c.target).getTime();
  const targetHours = (targetTime - releaseTime) / 3600000;
  const xTarget = Math.log(1 + Math.max(0, targetHours));
  const horizon_days = c.horizon_minutes / 1440;

  // Detect refresh jumps and volatility across history reads
  let totalRateChanges = 0;
  let totalPlayerChanges = 0;
  const historyHours = c.history.map(h => (new Date(h.at).getTime() - releaseTime) / 3600000);
  const lastIdx = c.history.length - 1;
  const last = c.history[lastIdx];
  const lastHours = historyHours[lastIdx];

  for (let i = 1; i < c.history.length; i++) {
    if (c.history[i].players_tracked !== c.history[i - 1].players_tracked) {
      totalPlayerChanges++;
    }
    const prevRates = c.history[i - 1].rates;
    const currRates = c.history[i].rates;
    for (let t = 0; t < currRates.length; t++) {
      if (prevRates[t] !== currRates[t]) {
        totalRateChanges++;
      }
    }
  }

  const jitterFactor = Math.min(0.5, (totalRateChanges + totalPlayerChanges) / (c.history.length * Math.max(1, c.trophies.length)) * 0.2);
  const base_spread = Math.max(0.25, 0.9 * Math.sqrt(horizon_days));

  const trophies = c.trophies.map((trophy, tIdx) => {
    // Extract history points in logit-time feature space (ln(1 + hours))
    const points: Array<{ x: number; l: number }> = [];
    for (let i = 0; i < c.history.length; i++) {
      const rate = c.history[i].rates[tIdx];
      if (rate !== null && rate !== undefined) {
        const h = historyHours[i];
        const x = Math.log(1 + Math.max(0, h));
        const l = logit(rate);
        points.push({ x, l });
      }
    }

    const lastRate = last.rates[tIdx] ?? 0;
    const lLast = logit(lastRate);
    let slope = 0;

    if (points.length >= 2) {
      // Focus on recent informative reads (last 12 hours) if available
      const recentPoints = points.filter(p => lastHours - Math.exp(p.x) + 1 <= 12 || points.length <= 5);
      const pts = recentPoints.length >= 2 ? recentPoints : points;

      let sumX = 0, sumL = 0, sumXX = 0, sumXL = 0;
      const n = pts.length;
      for (const p of pts) {
        sumX += p.x;
        sumL += p.l;
        sumXX += p.x * p.x;
        sumXL += p.x * p.l;
      }
      const denom = n * sumXX - sumX * sumX;
      if (Math.abs(denom) > 1e-9) {
        slope = (n * sumXL - sumX * sumL) / denom;
      }
      slope = Math.max(-0.5, Math.min(1.5, slope));
    }

    // Gompertz-style saturation / deceleration factor
    const decel = Math.max(0.05, 1 - (Math.max(0, lastRate) / 100));
    if (lastRate >= 99.0 || lastRate <= 0.05) {
      slope = 0;
    }

    const predictedLogit = lLast + slope * Math.max(0, xTarget - Math.log(1 + Math.max(0, lastHours))) * decel;

    // Estimate per-trophy volatility from logit changes
    let varSum = 0;
    let varCount = 0;
    for (let i = 1; i < points.length; i++) {
      const diff = points[i].l - points[i - 1].l;
      varSum += diff * diff;
      varCount++;
    }
    const trophyVolatility = varCount > 0 ? Math.max(0.8, Math.min(2.0, 1.0 + Math.sqrt(varSum / varCount))) : 1.0;

    const spread = base_spread * (1 + jitterFactor) * trophyVolatility;

    const qValues = Z.map(z => {
      const val = sigmoid(predictedLogit + z * spread);
      return round4(clamp(val));
    });

    // Ensure monotonicity of quantiles
    for (let i = 1; i < qValues.length; i++) {
      if (qValues[i] < qValues[i - 1]) {
        qValues[i] = qValues[i - 1];
      }
    }

    return {
      id: trophy.id,
      q: qValues
    };
  });

  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies })}\n`);
}
