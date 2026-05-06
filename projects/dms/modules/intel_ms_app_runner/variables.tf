variable "environment" {
  description = "Environment tag for resources (dev/uat/prod)"
  type        = string
  default     = "prod"
}

variable "vpc_connector_arn" {
  description = "ARN of the App Runner VPC Connector"
  type        = string
}

variable "cpu" {
  description = "CPU configuration for App Runner instance"
  type        = string
  default     = "1024"
}
variable "memory" {
  type    = string
  default = "2048"
}
variable "ecr_access_role_arn" {
  type        = string
  description = "Existing IAM role ARN for ECR access"
  default     = "arn:aws:iam::849008733010:role/service-role/PROD-ECR-Access-Role"
}
variable "instance_arn" {
  description = "Secret manager role for App Runner instance"
  type        = string
  default     = "arn:aws:iam::849008733010:role/Prod-App-Runner-Secret-Manager-Access-Role"
}
variable "intel_ms_secret" {
  description = "Secret for App Runner instance"
  type        = string
  default     = "arn:aws:secretsmanager:ap-south-1:849008733010:secret:prod-apprunner-intelms-9jOCce"
}
variable "common_secret" {
  description = "Secret configuration for App Runner instance"
  type        = string
  default     = "arn:aws:secretsmanager:ap-south-1:849008733010:secret:prod-apprunner-common-secret-ZLUWhF"
}
