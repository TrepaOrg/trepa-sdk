<p align="center">
  <img src="assets/logo.png" alt="Trepa" width="140" />
</p>

<h1 align="center">@trepa/sdk</h1>

<p align="center">
  <strong>TypeScript SDK for the Trepa precision-prediction protocol</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@trepa/sdk"><img src="https://img.shields.io/npm/v/@trepa/sdk?style=flat-square&logo=npm&logoColor=white&color=CB3837" alt="npm" /></a>
  <a href="https://bundlephobia.com/package/@trepa/sdk"><img src="https://img.shields.io/bundlephobia/minzip/@trepa/sdk?style=flat-square&label=bundle&logo=webpack&logoColor=white&color=4c1" alt="bundle size (minified + gzipped)" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" /></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-%3E%3D10.33.1-f69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm" /></a>
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Solana-signed%20transactions-9945FF?style=flat-square&logo=solana&logoColor=white" alt="Solana signed transactions" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
</p>

<p align="center">
  <a href="https://docs.trepa.io/developers/introduction"><strong>📚 Read the docs →</strong></a>
</p>

---

> [!WARNING]
> **Experimental.** The SDK is under active development and has not yet hit a stable release.

## Install

```bash
npm install @trepa/sdk
```

## Quickstart

Put your credentials in a `.env` file (and add it to `.gitignore`):

```sh
TREPA_API_KEY=trp_your_api_key
TREPA_PRIVATE_KEY=your_base58_wallet_private_key
```

Write the bot:

```ts
import { credentialsFromEnv, Trepa } from '@trepa/sdk';

const trepa = new Trepa({
  credentials: credentialsFromEnv(),
});

await trepa.bots.run({
  predict: (pool) => ({ value: 65_000, stake: pool.min_stake }),
});
```

Run it with Node's built-in env loader:

```bash
node --env-file=.env bot.ts
```

`bots.run` calls your `predict` once per open Bitcoin pool, signs and submits the prediction with your wallet, then sleeps until the next pool. For a swarm, set `TREPA_API_KEY_1` / `TREPA_PRIVATE_KEY_1`, `_2`, `_3`, ... and `credentialsFromEnv()` returns them all.

Full guides at **[docs.trepa.io/developers](https://docs.trepa.io/developers/introduction)**:

- [Quickstart](https://docs.trepa.io/developers/quickstart): a real BTC-spot bot in five minutes.
- [Writing bots](https://docs.trepa.io/developers/writing-bots): the `predict` contract, lifecycle hooks, and swarms.
- [SDK reference](https://docs.trepa.io/developers/sdk-reference): every resource on the `Trepa` client.

## Examples

- [`examples/spot-bot`](./examples/spot-bot): one credential, predicts live BTC spot at min stake. Start here.
- [`examples/liquidity-bot`](./examples/liquidity-bot): a swarm quoting a volatility-sized price ladder around BTC spot.

## License

[MIT](./LICENSE)
