output "keycloak_service_name" {
  value = aws_apprunner_service.keycloak_service.service_name
}

output "keycloak_service_url" {
  value = aws_apprunner_service.keycloak_service.service_url
}

output "keycloak_service_arn" {
  value = aws_apprunner_service.keycloak_service.arn
}
