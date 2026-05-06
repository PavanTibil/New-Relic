output "rds_identifier_name" {
  value = aws_db_instance.postgres_rds.identifier
}

output "rds_endpoint" {
  value = aws_db_instance.postgres_rds.address
}

output "rds_port" {
  value = aws_db_instance.postgres_rds.port
}

# -----------------------------
# Networking Outputs
# -----------------------------

output "rds_security_group_id" {
  description = "Security Group ID attached to RDS"
  value       = aws_security_group.rds_sg.id
}

output "rds_subnet_group" {
  description = "Subnet group name for the RDS instance"
  value       = aws_db_subnet_group.postgres_subnet_group.name
}

# -----------------------------
# CloudWatch Metric Inputs
# -----------------------------

output "cloudwatch_rds_identifier" {
  description = "RDS identifier to be used for CloudWatch monitoring"
  value       = aws_db_instance.postgres_rds.id
}

output "cloudwatch_rds_endpoint" {
  description = "RDS endpoint used by dashboards or scripts"
  value       = aws_db_instance.postgres_rds.endpoint
}
