FROM grafana/grafana:11.1.0

# Bake in the datasource + dashboard provisioning so Grafana comes up
# pre-configured on ECS, where there's no volume mount like docker-compose has.
# NOTE: this uses provisioning-ecs/ (Cloud Map DNS names), not provisioning/
# (docker-compose service names) — see monitoring/grafana/provisioning-ecs/
COPY provisioning-ecs /etc/grafana/provisioning
COPY dashboards /var/lib/grafana/dashboards