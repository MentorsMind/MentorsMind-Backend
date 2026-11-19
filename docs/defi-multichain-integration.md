# DeFi Wallet Multi-Chain Integration — Implementation Plan

Closes #966

## Problem
`defi-wallet.service.ts` supports Ethereum, Polygon, and Stellar in constants but the
`DEFI_WALLET_USE_MOCKS` flag indicates real subgraph integration was planned but never
fully shipped. The Aave/Compound GraphQL queries and routing logic exist but need
live endpoint wiring, position-refresh jobs, and caching.

## Current State
- `AAVE_POSITIONS_QUERY` and `COMPOUND_POSITIONS_QUERY` are defined
- `getAavePositions()` and `getCompoundPositions()` call `queryGraph()` — real code path
- `DEFI_WALLET_USE_MOCKS=true` short-circuits to `MockAdapter`
- Stellar positions use `stellarService.getAccount()` — already live

## Required Changes

### `src/services/defi-wallet.service.ts`
- Real subgraph queries are already wired — set `DEFI_WALLET_USE_MOCKS=false` and
  populate env vars to activate them
- Add `linkWalletAddress(userId, chain, address)` method to persist ethereum/polygon
  addresses to the `wallets` table
- Add `getUniswapPositions(userId, chain, walletAddress)` using The Graph Uniswap V3
  subgraph (`DEFI_ETHEREUM_UNISWAP_SUBGRAPH_URL`)
- Improve APY normalisation for Aave v3 ray-scaled rates

### `src/routes/v1/index.ts` + new route file
- `POST /wallets/defi/link` — link an Ethereum/Polygon address to user wallet
- `GET  /wallets/defi/positions` — already exists (defi-wallet.service routes)
- `POST /wallets/defi/sync` — force-refresh cache

### `src/jobs/defiPositionRefresh.job.ts` (new)
- Cron job that calls `defiWalletService.syncPositions(userId)` for active users
- Runs every 15 minutes, respects `DEFI_WALLET_USE_MOCKS` flag

### `src/config/env.ts`
- Document new env vars:
  - `DEFI_ETHEREUM_UNISWAP_SUBGRAPH_URL`
  - `DEFI_POLYGON_UNISWAP_SUBGRAPH_URL`

## Environment Variables Required
```
DEFI_WALLET_USE_MOCKS=false
DEFI_ETHEREUM_AAVE_SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/aave/protocol-v3
DEFI_ETHEREUM_COMPOUND_SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/graphprotocol/compound-v2
DEFI_POLYGON_AAVE_SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/aave/protocol-v3-polygon
DEFI_POLYGON_COMPOUND_SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/graphprotocol/compound-v2-polygon
DEFI_ETHEREUM_UNISWAP_SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3
```
