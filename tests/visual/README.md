# Visual Regression Tests

BackstopJS captures email, dashboard, and API documentation fixtures at desktop
and mobile viewports. Reference images are stored in `tests/visual/baselines/`;
generated comparisons and reports are ignored by Git.

```bash
# Capture or refresh references intentionally
pnpm run visual:reference

# Compare the current render against the references
pnpm run visual:test

# Approve the current comparison after review
pnpm run visual:approve
```

Run `visual:reference` only when a reviewed UI change is intended. CI should run
`visual:test` and publish the Backstop HTML/CI reports when comparisons fail.