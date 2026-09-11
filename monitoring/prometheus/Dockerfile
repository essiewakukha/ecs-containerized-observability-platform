FROM prom/prometheus:v2.53.0

# Bake in the scrape config + alert rules so Prometheus comes up
# pre-configured on ECS, where there's no volume mount like docker-compose has.
# This config uses Cloud Map service-discovery DNS names (app.observability.internal)
# instead of the docker-compose service names used in the local prometheus.yml.
COPY prometheus.yml /etc/prometheus/prometheus.yml
COPY alert.rules.yml /etc/prometheus/alert.rules.yml