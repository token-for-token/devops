# Hostinger (production) stacks

Docker Swarm stack files for the t4t hosted-gateway, deployed to a single
Hostinger VPS at `ssh root@195.35.25.26` and reachable at
[t4t-gateway.com](https://t4t-gateway.com).

Layout mirrors [cipherdolls/devops/hostinger/](https://github.com/cipherdolls/devops).

## Stacks

| Stack | File | What it runs |
| --- | --- | --- |
| `system` | `system-stack.yaml` | Traefik (TLS + ingress), Grafana, Loki, Prometheus, node-exporter, cadvisor. Owns the `public` + `internal` overlay networks. |
| `prod`   | `prod-stack.yaml`   | hosted-gateway api + worker + one-shot prisma migrate, plus postgres / redis / bee / postgres-exporter. |
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

# Drop the stack files + configs on the host
mkdir -p /opt/t4t-gateway && cd /opt/t4t-gateway
# rsync this directory up here (or `git clone` the devops repo)
cp .env.example .env && chmod 600 .env
$EDITOR .env  # fill in OPERATOR_PRIVATE_KEY, JWT_SECRET_KEY, ...
```

## Deploy

The system stack creates the shared overlay networks, so deploy it first.

```bash
cd /opt/t4t-gateway

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
lives in `/opt/t4t-gateway/.env` (chmod 600). Future work: migrate to a
proper Docker secret backed by the host's secret manager — never an env var
in the stack file.

## Backups

Postgres volume:

```bash
docker run --rm \
  -v prod_postgres-data:/from_volume \
  -v $(pwd):/workdir \
  alpine \
  sh -c "cd /from_volume && tar cvf /workdir/prod_postgres-data.tar ."

scp root@195.35.25.26:/opt/t4t-gateway/prod_postgres-data.tar ~/Downloads
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
