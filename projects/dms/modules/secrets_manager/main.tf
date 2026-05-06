# Read all SSM parameters (SecureString)
data "aws_ssm_parameter" "json_param" {
  for_each        = var.secrets
  name            = each.value
  with_decryption = true
}

# Create Secrets Manager for each secret
resource "aws_secretsmanager_secret" "this" {
  for_each = var.secrets

  name        = each.key
  description = "Secret synced from SSM SecureString"

  tags = {
    Project_Name  = "DMS"
    Resource_Type = "SecretsManager"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = each.key
  }
}

# Store version values (secret payload)
resource "aws_secretsmanager_secret_version" "version" {
  for_each      = var.secrets
  secret_id     = aws_secretsmanager_secret.this[each.key].id
  secret_string = data.aws_ssm_parameter.json_param[each.key].value
}
