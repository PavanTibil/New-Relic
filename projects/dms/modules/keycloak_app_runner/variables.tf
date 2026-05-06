variable "vpc_connector_arn" {
  type = string
}
variable "ecr_access_role_arn" {
  type        = string
  description = "Existing IAM role ARN for ECR access"
  default     = "arn:aws:iam::849008733010:role/service-role/PROD-ECR-Access-Role"
}
variable "keycloak_version" {
  type    = string
  default = "26.1.0"
}

variable "cpu" {
  type    = string
  default = "1024"
}

variable "memory" {
  type    = string
  default = "2048"
}

variable "environment" {
  type    = string
  default = "production"
}

# Runtime environment variables for Keycloak
variable "kc_admin_username" {
  type    = string
  default = "admin"
}

variable "kc_admin_password" {
  type    = string
  default = "Admin@123"
}
variable "kc_db_username" {
  type    = string
  default = "prod_dms"
}
variable "kc_db_password" {
  type    = string
  default = "PRODdmsdb"
}
variable "kc_schema" {
  type    = string
  default = "user-ms"
}
variable "kc_db_url" {
  type    = string
  default = "jdbc:postgresql://prod-dms-private-db.chjeqnus3n84.ap-south-1.rds.amazonaws.com:5437/prodDMSDB"
}
