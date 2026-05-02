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
  <a href="https://solana.com/"><img src="https://img.shields.io/static/v1?label=Solana&message=mainnet&color=9945FF&logo=solana&logoColor=white&style=flat-square" alt="Solana mainnet" /></a>
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

Full guides at **[docs.trepa.io/developers](https://docs.trepa.io/developers/introduction)**:

- [Quickstart](https://docs.trepa.io/developers/quickstart)
- [Writing bots](https://docs.trepa.io/developers/writing-bots)
- [SDK reference](https://docs.trepa.io/developers/sdk-reference)

## Examples

Deployable sample bots (`Dockerfile`, `docker-compose.yml`, `@trepa/sdk@latest`
from npm). **Both require Docker** to run ([install Docker](https://docs.docker.com/get-docker/)).

- [`examples/spot-bot`](./examples/spot-bot): one credential, live BTC spot at
  min stake. Start here.
- [`examples/liquidity-bot`](./examples/liquidity-bot): swarm + Gaussian ladder
  around spot, optional `withManager` master-wallet funder.

## License

[MIT](./LICENSE)
