# DevOps

This repo manages the two environments for the Token4Token hosted gateway:

- **`local/`** — docker-compose files for running development and testing
  environments locally. Tests run inside Docker, no host-side Bun needed.
- **`hostinger/`** — Docker Swarm stack files for the remote production
  cluster on Hostinger.

The layout mirrors [cipherdolls/devops](https://github.com/cipherdolls/devops).

## Local development

```bash
cd local
make up          # bring the dev stack up (postgres, redis, bee, anvil, api, worker)
make logs        # tail
make down        # clean shutdown
```

The dev compose mounts `../../hosted-gateway/src` so file changes hot-reload
inside the container (`bun run --watch`).

## Local testing

Every E2E spec runs inside Docker against a fresh stack (anvil fork of Gnosis,
deployed contracts, a t4t-provider container against a stub Ollama).

```bash
cd local
make test SPEC=accounts          # run one spec
make test-all                    # run every spec sequentially
```

`make test` brings up postgres + redis + anvil + bee + t4t-provider + hosted
api + worker, then runs the `bun` test container against them. After the run
it tears everything down (`-v --remove-orphans`).

## Hostinger / production

Stack files in `hostinger/` are applied via `docker stack deploy` from the CI
pipeline. Not relevant for local development.
