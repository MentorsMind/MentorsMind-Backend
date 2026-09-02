# Scaling

Two layers, doing different jobs.

| Layer | File | Reacts to | Role |
| --- | --- | --- | --- |
| Kubernetes HPA | `hpa.yaml` | Observed CPU and memory | Safety net. Always on, never predictive. |
| Scaling optimizer | `src/workers/scaling-optimizer.worker.ts` | Predicted request rate | Adds capacity *before* the load arrives. |

The HPA is the floor, not the plan. It only moves once utilisation has already
risen, which is one replica-startup too late for a traffic pattern as sharp as
session bookings at the top of the hour. The optimizer predicts the next window
from the weekly seasonal profile and moves first; the HPA still catches anything
the prediction missed.

## Constraints the optimizer enforces

The policy lives in `src/services/auto-scaler.service.ts` (`DEFAULT_POLICY`).

- **SLO breaches outrank the forecast.** p95 over budget scales up on the
  observation, whatever the prediction says.
- **Cooldowns are asymmetric.** 60s up, 300s down. Scaling down is the direction
  that causes incidents.
- **Low confidence holds.** A prediction below `MIN_ACTIONABLE_CONFIDENCE` (0.4)
  changes nothing.
- **Scale-down is capped per step** at `maxScaleDownStep`, so a mispredicted dip
  cannot strip the fleet in one tick.

Set `minReplicas` on the HPA at or above the optimizer's `minReplicas`, or the
two will fight over the floor.

## Multi-cloud

`ScalingExecutor` is the only cloud-specific surface — `currentReplicas()` and
`scaleTo(n)`. Kubernetes, an AWS ASG, or a dry run each implement those two
methods; the policy above is shared and does not change per provider.

## Running it

```ts
const worker = new ScalingOptimizerWorker({ metrics: prometheusMetricsSource });
worker.start();
```

`worker.costReport()` returns the scale-up/scale-down/hold counts and the net
replica delta over the retained history, which is what the scaling dashboard
plots against spend.
