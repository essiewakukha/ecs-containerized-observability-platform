FROM grafana/grafana:11.1.0

# Bake in the datasource + dashboard provisioning so Grafana comes up
# pre-configured on ECS, where there's no volume mount like docker-compose has.
COPY provisioning /etc/grafana/provisioning
COPY dashboards /var/lib/grafana/dashboards