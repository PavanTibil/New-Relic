variable "repository_name" {
  type        = string
  description = "Name of the ECR repository"
  default     = "prod-dms-ecr"
}

variable "project_name" {
  type        = string
  default     = "DMS"
  description = "Project name tag"
}

variable "environment" {
  type        = string
  description = "Environment tag"
  default     = "PROD"
}
