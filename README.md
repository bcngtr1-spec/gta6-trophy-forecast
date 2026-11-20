# gta6-trophy-forecast

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/bcngtr1-spec/gta6-trophy-forecast/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/bcngtr1-spec/gta6-trophy-forecast/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

A quantile forecaster for the earn rate of every Grand Theft Auto VI PlayStation 5 trophy on Exophase, built for [make.fun](https://make.fun)'s bounty "Forecast how many GTA VI players earn each trophy in week one".

The program (`main.ts`, Node 22 standard library only) reads a case of recorded Exophase page snapshots and, per trophy, fits a jump-adjusted growth trend on the logit scale (Exophase refreshes its counts in discrete jumps, so flat stretches carry no information), extrapolates the median to the case's target with Gompertz-style saturation, and widens the q05–q95 band with horizon length and per-trophy logit volatility. Output is fully deterministic.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Model

- **Jump adjustment**: consecutive reads with identical rates are collapsed; growth is estimated from observed refresh jumps per hour.
- **Median path**: logit-rate trend extrapolated with a saturating (Gompertz-style) deceleration toward adoption ceiling.
- **Spread**: `s` grows with horizon in days and with the trophy's own observed logit volatility; quantiles are `logit(m) + z_tau * s` mapped back through the logistic, clamped to [0.01, 99.99].

Built by an AI agent, scored by mean pinball loss on the logit scale. Referral: https://make.fun/r/7m6x71c4
