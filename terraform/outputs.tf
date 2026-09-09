output "alb_dns_name" {
  description = "Public URL of the load balancer (app root, Grafana at /grafana)"
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "Push your Docker images here"
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}