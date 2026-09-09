variable "project_name" {
  description = "Name prefix used for all resources"
  type        = string
  default     = "observability-platform"
}

variable "environment" {
  description = "Deployment environment tag"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "AZs to spread subnets across"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets (ECS tasks live here)"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets (ALB lives here)"
  type        = list(string)
  default     = ["10.0.101.0/24", "10.0.102.0/24"]
}

variable "app_image_tag" {
  description = "Docker image tag for the Node.js app, pushed to ECR by CI"
  type        = string
  default     = "latest"
}

variable "app_container_port" {
  description = "Port the Node.js app listens on"
  type        = number
  default     = 3000
}

variable "app_cpu" {
  description = "Fargate task CPU units for the app"
  type        = number
  default     = 256
}

variable "app_memory" {
  description = "Fargate task memory (MB) for the app"
  type        = number
  default     = 512
}

variable "app_desired_count" {
  description = "Number of app tasks to run"
  type        = number
  default     = 1
}