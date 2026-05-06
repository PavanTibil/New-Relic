variable "dashboard_name" {
  description = "CloudWatch dashboard name"
  type        = string
  default     = "DMS_Prod_Custom_Dashboard"
}
variable "app_runner_service_names" {
  description = "List of App Runner service names"
  type        = list(string)
}

variable "rds_identifier" {
  description = "RDS DB instance identifier"
  type        = string
}
variable "region" {
  description = "AWS region for CloudWatch widgets"
  type        = string
}
