output "registry_ms_service_name" {
  value = aws_apprunner_service.prod_registry_ms.service_name
}

output "registry_ms_service_url" {
  value = aws_apprunner_service.prod_registry_ms.service_url
}

output "registry_ms_service_arn" {
  value = aws_apprunner_service.prod_registry_ms.arn
}
