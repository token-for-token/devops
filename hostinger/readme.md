# Hostinger (production) stacks

Docker Swarm stack files for the t4t hosted-gateway, deployed to a single
Hostinger VPS at `ssh root@195.35.25.26` and reachable at
[t4t-gateway.com](https://t4t-gateway.com).

Layout mirrors [cipherdolls/devops/hostinger/](https://github.com/cipherdolls/devops).

## Stacks

| Stack | File | What it runs |
| --- | --- | --- |
| `system` | `system-stack.yaml` | Traefik (TLS + ingress), Grafana, Loki, Prometheus, node-exporter, cadvisor. Owns the `public` + `internal` overlay networks. |
| `prod`   | `prod-stack.yaml`   | hosted-gateway api + worker + one-shot prisma migrate, plus postgres / redis / bee / postgres-exporter / stamp-monitor. |
| `dev`    | `dev-stack.yaml`    | Staging on `dev.t4t-gateway.com` — the `:develop` image tag against its own postgres / redis / bee volumes. |

Supporting configs:

- `loki.yaml` — Loki single-binary filesystem config
- `prometheus.yml` — scrape targets (traefik, grafana, loki, node-exporter,
  postgres-exporter, cadvisor, hosted-gateway api)
- `.env.example` — copy to `.env` on the host, fill in
  `OPERATOR_PRIVATE_KEY` / `JWT_SECRET_KEY` / etc.

## DNS records (Hostinger DNS panel)

Point all of these at `195.35.25.26`:

```
A  t4t-gateway.com               195.35.25.26
A  www.t4t-gateway.com           195.35.25.26
A  api.t4t-gateway.com           195.35.25.26
A  dev.t4t-gateway.com           195.35.25.26
A  traefik.t4t-gateway.com       195.35.25.26
A  grafana.t4t-gateway.com       195.35.25.26
A  loki.t4t-gateway.com          195.35.25.26
A  prometheus.t4t-gateway.com    195.35.25.26
```

## One-time host setup

```bash
ssh root@195.35.25.26

# Docker + swarm
curl -fsSL https://get.docker.com | sh
docker swarm init --advertise-addr 195.35.25.26

# Loki driver (so container logs ship to Loki via the `loki` logging driver)
docker plugin install grafana/loki-docker-driver:2.9.7 \
    --alias loki --grant-all-permissions

# Stack files come from this repo, cloned on the host. Deploys run from the
# clone, so `git pull` is the deploy step — do not hand-edit files here.
git clone git@github.com:token-for-token/devops.git /root/devops
cd /root/devops/hostinger
cp .env.example .env && chmod 600 .env
$EDITOR .env  # fill in OPERATOR_PRIVATE_KEY, JWT_SECRET_KEY, ...
```

## Deploy

The system stack creates the shared overlay networks, so deploy it first.

```bash
cd /root/devops/hostinger

# 1. Networks + ingress + monitoring
docker stack deploy -c system-stack.yaml system

# 2. App + datastores
docker stack deploy -c prod-stack.yaml prod

# (optional) staging on dev.t4t-gateway.com
docker stack deploy -c dev-stack.yaml dev
```

Re-deploying after a new image tag:

```bash
docker service update --image ghcr.io/token-for-token/hosted-gateway:main \
    --force prod_api
docker service update --image ghcr.io/token-for-token/hosted-gateway:main \
    --force prod_worker
```

## Secrets

`OPERATOR_PRIVATE_KEY` is the on-chain identity for every tenant. For now it
lives in `/root/devops/hostinger/.env` (chmod 600). Future work: migrate to a
proper Docker secret backed by the host's secret manager — never an env var
in the stack file.

## Postage batches (stamp-monitor)

The gateway's uploads are paid for by a postage batch that expires. When it
lapsed, the gateway returned 500 on every route — see the comment above the
`stamp-monitor` service for the full chain. `stamp-monitor` now owns renewal:
it polls `prod_bee` every 5 min, tops a batch up when it drops under 14 days,
and refuses any single action over 8 xBZZ.

It runs beside Bee rather than reading the chain because **bucket fullness is
not on-chain** — postage stamps are off-chain signatures, so only a node that
saw them knows how full a batch is. A batch can be fully funded and still
refuse writes.

No Traefik route and no published port: it is on `internal` only, and its UI
can spend xBZZ. Note `internal` is **not attachable**, so `docker run --network
internal ...` is refused — query through a container that is already on it:

```bash
docker service logs --tail 50 prod_stamp-monitor

M=$(docker ps --filter name=prod_stamp-monitor -q | head -1)
docker exec $M bun -e 'console.log(await (await fetch("http://bee:1633/stamps")).text())'
```

For the dashboard, publish it only for as long as you are looking at it, and
tunnel rather than exposing the port — swarm ingress binds `0.0.0.0`, so a
published port is on the public internet:

```bash
docker service update --publish-add published=8088,target=3000 prod_stamp-monitor
ssh -L 8088:127.0.0.1:8088 root@<host>   # then http://127.0.0.1:8088
docker service update --publish-rm published=8088,target=3000 prod_stamp-monitor
```

The API authenticates with an **`x-admin-token`** header, not `Authorization:
Bearer`. A wrong header is a 401; a missing `ADMIN_TOKEN` in the service is a
503 (`admin API disabled`) — it fails closed, because these routes buy postage.

**Deploy caveat:** `docker stack deploy` substitutes `${STAMP_MONITOR_ADMIN_TOKEN}`
from the *shell*, not from `.env`. Source it first or the monitor deploys with an
empty token and the dashboard 503s:

```bash
cd /root/devops/hostinger && set -a && . ./.env && set +a
docker stack deploy -c prod-stack.yaml --resolve-image=never prod
```

`WEBHOOK_URL` is unset, so alerts (`wallet_low`, `batch_full`, `topup_blocked`)
only reach the logs. Set it to make them reach a person.

## Backups

Postgres volume:

```bash
docker run --rm \
  -v prod_postgres-data:/from_volume \
  -v $(pwd):/workdir \
  alpine \
  sh -c "cd /from_volume && tar cvf /workdir/prod_postgres-data.tar ."

scp root@195.35.25.26:/root/devops/hostinger/prod_postgres-data.tar ~/Downloads
```

Bee data volume (postage batch / swarm keys — DO NOT lose this):

```bash
docker run --rm \
  -v prod_bee-data:/from_volume \
  -v $(pwd):/workdir \
  alpine \
  sh -c "cd /from_volume && tar cvf /workdir/prod_bee-data.tar ."
```

## Troubleshooting

```bash
docker stack services system           # health of ingress + monitoring
docker stack services prod             # health of gateway + data
docker service logs -f prod_api
docker service logs -f prod_worker

# Replay a failed Prisma migration:
docker exec -it $(docker ps -q -f name=prod_prisma) sh
bunx prisma migrate resolve --rolled-back <migration_name>
```
