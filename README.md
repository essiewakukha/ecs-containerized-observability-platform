# Observability Platform on AWS ECS Fargate

A production-style demo showing how to containerize a Node.js service, provision AWS infrastructure with Terraform, and wire up automated monitoring, alerting, and CI/CD — end to end, deployed and verified on real AWS infrastructure.

**Stack:** Node.js · Docker · Terraform · AWS ECS Fargate · Prometheus · Grafana · Alertmanager · AWS Cloud Map · GitHub Actions (OIDC)

---

## What this project demonstrates

- **Infrastructure as Code** — the entire AWS footprint (VPC, subnets, ALB, ECS cluster, ECR, IAM roles, Cloud Map service discovery) is defined in Terraform, no click-ops.
- **Containerized microservices** — multi-stage Dockerfiles, health checks, and a docker-compose setup for local development before anything touches the cloud.
- **Observability** — the app exposes Prometheus metrics out of the box (`prom-client`), Prometheus scrapes it via AWS Cloud Map service discovery, and Grafana visualizes it on a pre-provisioned dashboard.
- **Automated alerting** — Prometheus alert rules watch for container crashes, CPU spikes above 80%, and elevated HTTP 5xx rates.
- **CI/CD with OIDC** — a GitHub Actions pipeline authenticates to AWS via OpenID Connect (no long-lived AWS keys stored in GitHub), builds and pushes all three images to ECR, then runs `terraform apply`.

See [`docs/architecture.md`](docs/architecture.md) for the full diagram and design rationale.

## Project structure

```
.
├── app/                          # Node.js service (Express + prom-client)
├── terraform/                    # AWS infra: VPC, ECS/Fargate, ALB, ECR, IAM, Cloud Map
├── monitoring/
│   ├── prometheus.yml              # local (docker-compose) scrape config
│   ├── prometheus/                 # ECS-specific: Dockerfile + config baked in
│   ├── alertmanager/                # alert rules + webhook routing (local only)
│   └── grafana/
│       ├── Dockerfile                # bakes provisioning-ecs/ into the image for AWS
│       ├── provisioning/             # local (docker-compose) datasource + dashboard config
│       └── provisioning-ecs/         # AWS-specific: uses Cloud Map DNS names
├── .github/workflows/            # CI/CD pipeline (OIDC auth to AWS)
├── docs/architecture.md          # architecture diagram + design notes
└── docker-compose.yml            # local dev environment
```

**Why there are two versions of the Prometheus/Grafana config** (local vs. `-ecs`/`provisioning-ecs`): docker-compose gives containers DNS names via its embedded network (`app`, `prometheus`). ECS Fargate has no equivalent — each task gets its own IP with no built-in DNS between services. AWS Cloud Map fills that gap in production, so the AWS-side configs reference `app.observability.internal` and `prometheus.observability.internal` instead. See the troubleshooting log below for how this was diagnosed.

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

## Deploy to AWS

```bash
cd terraform
terraform init
terraform apply
```

This provisions a VPC, an ECS Fargate cluster (app + Prometheus + Grafana), an Application Load Balancer, three ECR repositories, and a Cloud Map private DNS namespace so the services can find each other.

Then build and push all three images (each service has its own Dockerfile and ECR repo — `app/`, `monitoring/prometheus/`, `monitoring/grafana/`):

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

cd app && docker build -t <ecr_repository_url>:latest . && docker push <ecr_repository_url>:latest && cd ..
cd monitoring/prometheus && docker build -t <prometheus_ecr_repository_url>:latest . && docker push <prometheus_ecr_repository_url>:latest && cd ../..
cd monitoring/grafana && docker build -t <grafana_ecr_repository_url>:latest . && docker push <grafana_ecr_repository_url>:latest && cd ../..
```

(All four `*_ecr_repository_url` values come from `terraform output`.)

Then force each ECS service to pick up the fresh image:
```bash
aws ecs update-service --cluster observability-platform-cluster --service observability-platform-app --force-new-deployment --region us-east-1
aws ecs update-service --cluster observability-platform-cluster --service observability-platform-prometheus --force-new-deployment --region us-east-1
aws ecs update-service --cluster observability-platform-cluster --service observability-platform-grafana --force-new-deployment --region us-east-1
```

The GitHub Actions pipeline automates all of the above — see below to set it up.

## CI/CD setup (GitHub Actions + AWS OIDC)

The pipeline authenticates to AWS using OpenID Connect rather than storing AWS access keys as GitHub secrets — more secure, and it's the AWS-recommended pattern. This requires a one-time setup in the AWS Console:

1. **IAM → Identity providers → Add provider.** Type: OpenID Connect. Provider URL: `https://token.actions.githubusercontent.com`. Audience: `sts.amazonaws.com`.
2. From the provider's confirmation banner, click **Assign role → Create a new role**. This pre-fills the trust relationship for you.
3. Under GitHub organization/repository, enter your GitHub username and this repo's name to scope the trust policy to exactly this repository (avoid leaving it open to any repo on your account).
4. Attach permissions: `AmazonEC2ContainerRegistryFullAccess`, `AmazonECS_FullAccess`, `AmazonVPCFullAccess`, `IAMFullAccess`, `ElasticLoadBalancingFullAccess`, `AWSCloudMapFullAccess`, `CloudWatchLogsFullAccess`. (Broader than least-privilege — fine for a portfolio project; a production setup would scope this down per-service.)
5. Name the role (e.g. `github-actions-observability-platform`), create it, and copy its ARN.
6. In GitHub: **Settings → Secrets and variables → Actions**, add/update `AWS_DEPLOY_ROLE_ARN` with that ARN.
7. Push to `main` (or manually trigger the workflow from the Actions tab) — the pipeline builds and pushes all three images, then runs `terraform apply`.

## Alerting

Alert rules live in [`monitoring/alertmanager/alert.rules.yml`](monitoring/alertmanager/alert.rules.yml) (and a copy baked into the AWS Prometheus image at `monitoring/prometheus/alert.rules.yml`):

- `ServiceDown` — app unreachable for 30s+
- `ContainerCpuHigh` — any container above 80% CPU for 1 min+ (cAdvisor-based, local only — see limitations below)
- `HighHttp5xxRate` — more than 5% of requests returning 5xx over 5 min
- `HighRequestLatency` — p95 latency above 1s for 2 min+

View evaluated rules and their current state under Grafana's **Alerting → Alert rules**, or Prometheus's own `/alerts` page.

## Known limitations on AWS

- **Container CPU/Memory panels show "No data" on AWS.** They depend on cAdvisor, which requires host-level access (`/sys`, `/var/lib/docker`) that Fargate — a serverless container platform — does not expose. Fully functional locally via docker-compose; on AWS, the equivalent would be ECS Container Insights / CloudWatch metrics (not wired up in this version).
- **Alertmanager doesn't run on ECS in this version** — only locally via docker-compose. Alert rules still evaluate on the AWS Prometheus instance and are visible under Alerts, they just have nowhere to route notifications to yet on AWS.

## Troubleshooting log

Real issues hit building and deploying this, in the order they came up — kept here because debugging process is as much a part of the engineering as the initial design.

**1. Duplicate resource declarations in Terraform.**
`terraform validate` failed with `Duplicate resource "aws_security_group"`. Cause: the security group blocks meant only for `security_groups.tf` were accidentally duplicated into `alb.tf` during a copy-paste. Terraform resource names must be unique per type across the whole module, not just per file. Fix: each resource type kept in exactly one file.

**2. ALB target group name exceeding AWS's 32-character limit.**
`${var.project_name}-grafana-tg` came out to 34 characters. Fix: switched to `name_prefix` (6-char max, AWS generates a unique suffix) with `lifecycle { create_before_destroy = true }`, since a target group attached to a live listener can't be destroyed and recreated in place.

**3. Grafana dashboard missing after deploying to ECS — worked locally, not on AWS.**
Locally, docker-compose bind-mounts Grafana's provisioning config as volumes. ECS Fargate has no equivalent — the stock image starts completely unconfigured. Fix: built a custom Grafana image (`monitoring/grafana/Dockerfile`) that bakes provisioning in at build time, with its own ECR repo.

**4. Provisioned dashboards don't appear on Grafana's homepage automatically.**
They show up under **Dashboards** in the sidebar, not as the default landing page, unless a home dashboard preference is explicitly set.

**5. Same problem as #3, but for Prometheus — and worse, since it's the root data source.**
Even after fixing Grafana, the dashboard showed "No data." Root cause: Prometheus on ECS was running with an empty config for the same reason (no volume mount on Fargate) — plus its scrape targets (`app:3000`, `cadvisor:8080`) were docker-compose hostnames that don't resolve on Fargate at all, and cAdvisor itself can't run on Fargate (no host access). Fix: a custom Prometheus image with config baked in, **plus** an AWS Cloud Map private DNS namespace (`terraform/service_discovery.tf`) so `app.observability.internal` and `prometheus.observability.internal` actually resolve between ECS tasks. Dropped the cAdvisor scrape job from the AWS-specific config entirely (documented as a known limitation above) rather than pretending it would work.

**6. Files landing in the wrong place / wrong extensions during manual edits.**
Several rounds of manually recreating files led to extension mismatches (`.yaml` vs `.yml`) that broke docker-compose's exact-path volume mounts, and a `provisioning-ecs/` directory that was referenced by the Dockerfile but never actually created — which meant a previous "successful" Grafana image push didn't actually contain the fix it was supposed to. Fix: systematically diffed the actual file tree (`find monitoring -type f`) against the intended structure before each rebuild, and used `docker build --no-cache` to rule out stale cached layers masking the real state.

**7. `terraform destroy` failing on non-empty ECR repositories.**
AWS won't delete an ECR repo that still has images in it. Fix: added `force_delete = true` to both `aws_ecr_repository` resources so future `destroy` runs don't need a manual `aws ecr batch-delete-image` step first.

**8. GitHub Actions pipeline failing OIDC authentication.**
`Error: Could not assume role with OIDC: The web identity token provided could not be validated.` This wasn't a workflow-file bug — the AWS side was never set up. GitHub Actions authenticates to AWS via an OIDC identity provider plus an IAM role with a trust policy scoped to the specific repo; neither existed yet. Fix: created the OIDC provider (`token.actions.githubusercontent.com`) and a dedicated IAM role via the AWS Console (IAM → Identity providers → Add provider → Assign role), then pointed the `AWS_DEPLOY_ROLE_ARN` GitHub secret at the new role's ARN. See "CI/CD setup" above for the exact steps.

**9. Container CPU / Memory panels permanently show "No data" on AWS — why, and how that was confirmed.**
Even after Prometheus and Grafana were both fully fixed and everything else on the dashboard populated (HTTP Requests, P95 Latency, Service Up), these two panels stayed empty. This one isn't a bug to fix — it's a hard platform constraint, confirmed by tracing the metric back to its source:
- Both panels query `container_cpu_usage_seconds_total` and `container_memory_usage_bytes` — metrics produced by **cAdvisor**, not by the app or by Prometheus itself.
- cAdvisor works by reading directly from the host machine it runs on: `/sys/fs/cgroup`, `/var/lib/docker`, `/proc`, the container runtime's own state. That's how it knows what every container on that host is doing.
- **AWS Fargate has no accessible host.** It's a serverless container platform by design — you get a container, not a VM you can inspect. There is no `/var/lib/docker` to mount, because there's no Docker daemon exposed to you at all.
- So cAdvisor isn't misconfigured on AWS — it's fundamentally unrunnable there. This is why the AWS-specific `monitoring/prometheus/prometheus.yml` scrape config has no `cadvisor` job at all (deliberately removed, see issue #5), while the local `monitoring/prometheus.yml` still has one and cAdvisor still runs fine in docker-compose (where it mounts the real host's `/sys`, `/var/run`, `/var/lib/docker`).
- The AWS-native equivalent is **ECS Container Insights** (CloudWatch), which this project's Terraform already partially anticipated — `aws_ecs_cluster.main` has `containerInsights = "enabled"` in `terraform/ecs.tf`, and the Prometheus task's IAM role (`terraform/iam.tf`) already has `cloudwatch:GetMetricData` permissions attached, both left over from the original design intent of pulling CloudWatch metrics into Prometheus via a CloudWatch exporter. That integration was never built out — it's a natural next step, not a currently-working path.

Net effect: those two panels are expected to read "No data" on the AWS deployment, permanently, given the current architecture. Anyone reviewing the AWS screenshots will see this — it's called out here rather than hidden, since correctly identifying *why* a metric is unavailable is itself a demonstration of understanding the platform, not a gap to be embarrassed about.

## Notes on cost & scope

This is sized as a portfolio/demo deployment, not a production one — a single NAT gateway and modest Fargate task sizes keep AWS costs low. Remember to `terraform destroy` when not actively demoing it, since the ALB, NAT gateway, and Fargate tasks all bill continuously while running.

## License

MIT