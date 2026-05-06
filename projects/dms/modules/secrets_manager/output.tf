# Returns map of all created secret names
output "secret_names" {
  value = keys(aws_secretsmanager_secret.this)
}

# Returns map of all ARNs
output "secret_arns" {
  value = {
    for key, secret in aws_secretsmanager_secret.this :
    key => secret.arn
  }
}

# Returns SSM parameter paths used
output "ssm_paths" {
  value = var.secrets
}
