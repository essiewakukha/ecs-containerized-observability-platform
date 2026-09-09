# Observability Platform on AWS ECS Fargate

A production-style demo showing how to containerize a Node.js service, provision AWS infrastructure with Terraform, and wire up automated monitoring and alerting — end to end.

**Stack:** Node.js · Docker · Terraform · AWS ECS Fargate · Prometheus · Grafana · Alertmanager · GitHub Actions

---

## What this project demonstrates

- **Infrastructure as Code** — the entire AWS footprint (VPC, subnets, ALB, ECS cluster, ECR, IAM roles) is defined in Terraform, no click-ops.
- **Containerized microservices** — multi-stage Dockerfile, health checks, and a docker-compose setup for local development before anything touches the cloud.
- **Observability** — the app exposes Prometheus metrics out of the box (`prom-client`), with pre-provisioned Grafana dashboards so metrics are visualized on first boot, not configured by hand.
- **Automated alerting** — Prometheus Alertmanager watches for container crashes, CPU spikes above 80%, and elevated HTTP 5xx rates, and routes them to a webhook (Slack/Discord/Lambda-compatible).
- **CI/CD** — a GitHub Actions pipeline builds the Docker image, pushes it to ECR, and applies the Terraform changes on every push to `main`.

See [`docs/architecture.md`](docs/architecture.md) for the full diagram and design rationale.

## Project structure

```
.
├── app/                    # Node.js service (Express + prom-client)
├── terraform/               # AWS infra: VPC, ECS/Fargate, ALB, ECR, IAM
├── monitoring/
│   ├── prometheus.yml         # scrape config
│   ├── alertmanager/          # alert rules + webhook routing
│   └── grafana/                # provisioned datasource + dashboard
├── .github/workflows/        # CI/CD pipeline
├── docs/architecture.md      # architecture diagram + design notes
└── docker-compose.yml        # local dev environment
```

## Run it locally

Requires Docker and Docker Compose.

```bash
git clone <your-repo-url>
cd observability-platform
docker compose up --build
```

| Service | URL | Notes |
|---|---|---|
| App | http://localhost:3000 | `/health`, `/metrics`, `/simulate/error`, `/simulate/slow` |
| Prometheus | http://localhost:9090 | Targets and alert rules |
| Grafana | http://localhost:3001 | Login `admin` / `admin`, dashboard pre-loaded |
| Alertmanager | http://localhost:9093 | Active alerts |
| cAdvisor | http://localhost:8080 | Raw container metrics |

Hit `curl http://localhost:3000/simulate/error` a few times to trigger the 5xx alert rule, or watch `/simulate/slow` push up the latency panel in Grafana.

## Deploy to AWS

```bash
cd terraform
terraform init
terraform apply
```

This provisions a VPC, an ECS Fargate cluster running the app + Prometheus + Grafana, an Application Load Balancer, and an ECR repository. Push your image to the ECR repo (URL is in `terraform output`) and set `app_image_tag` accordingly, or let the GitHub Actions pipeline handle both steps automatically on push to `main`.

**Required GitHub secret:** `AWS_DEPLOY_ROLE_ARN` — an IAM role ARN configured for GitHub OIDC with ECR push and Terraform apply permissions.

## Alerting

Alert rules live in [`monitoring/alertmanager/alert.rules.yml`](monitoring/alertmanager/alert.rules.yml):

- `ServiceDown` — app unreachable for 30s+
- `ContainerCpuHigh` — any container above 80% CPU for 1 min+
- `HighHttp5xxRate` — more than 5% of requests returning 5xx over 5 min
- `HighRequestLatency` — p95 latency above 1s for 2 min+

Point `monitoring/alertmanager/alertmanager.yml` at your own Slack/Discord webhook or Lambda function URL to receive notifications.

## Challenges & Troubleshooting

Building and deploying this surfaced a few real issues worth documenting — partly for anyone else hitting the same thing, partly because working through them is as much a part of the engineering as the initial design.

**1. Duplicate resource declarations in Terraform**
`terraform init`/`validate` failed with `Duplicate resource "aws_security_group" configuration`. Root cause: the `aws_security_group` blocks meant only for `security_groups.tf` had also been copy-pasted into `alb.tf`. Terraform resource names must be unique per type across an entire module (not just per file), so having the same `resource "aws_security_group" "alb"` block in two files fails at parse time.
*Fix:* keep each resource type in exactly one file — `alb.tf` should only ever contain `aws_lb`, target group, and listener resources; security groups live solely in `security_groups.tf`.

**2. ALB target group name exceeding AWS's 32-character limit**
`terraform apply` failed with `"name" cannot be longer than 32 characters` on the Grafana target group, because `${var.project_name}-grafana-tg` (with `project_name = "observability-platform"`) came out to 34 characters.
*Fix:* switched both target groups from `name` to `name_prefix` (max 6 chars, e.g. `"app-"` / `"graf-"`), letting AWS generate a short unique suffix instead. This also required `lifecycle { create_before_destroy = true }`, since a target group attached to a live listener can't be destroyed and recreated in place.

**3. Grafana dashboard missing after deploying to ECS (local worked, AWS didn't)**
Locally, `docker-compose.yml` mounts `monitoring/grafana/provisioning/` and `monitoring/grafana/dashboards/` as bind-mount volumes into the Grafana container, so it boots pre-configured with a datasource and dashboard. ECS Fargate has no equivalent to a docker-compose bind mount — the stock `grafana/grafana:11.1.0` image on ECS starts completely unconfigured, landing on the generic "Welcome to Grafana" screen instead.
*Fix:* built a small custom image (`monitoring/grafana/Dockerfile`) that extends the official Grafana image and `COPY`s the provisioning and dashboard files directly into it at build time. That image gets its own ECR repository (`aws_ecr_repository.grafana` in `terraform/ecr.tf`) and the ECS task definition was updated to pull from there instead of Docker Hub. This is the general pattern for adapting any "just mount a config file" local setup to a platform like Fargate that has no persistent/shared filesystem by default — bake config into the image, or use something like EFS if the config needs to be mutable at runtime.

**4. Provisioned dashboards don't appear on the Grafana homepage automatically**
Even once provisioning is correctly picked up, provisioned dashboards show up under **Dashboards** in the sidebar — they don't replace the default "Welcome to Grafana" homepage unless a home dashboard preference is explicitly set. Worth checking there before assuming provisioning failed.

## Notes on cost & scope

This is sized as a portfolio/demo deployment, not a production one — a single NAT gateway and modest Fargate task sizes keep AWS costs low. `docs/architecture.md` calls out these tradeoffs explicitly so you can speak to them if asked in an interview.

## License

MIT