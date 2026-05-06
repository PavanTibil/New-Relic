output "intel_ms_service_name" {
  value = aws_apprunner_service.prod_intel_ms.service_name
}

output "intel_ms_service_url" {
  value = aws_apprunner_service.prod_intel_ms.service_url
}

output "intel_ms_service_arn" {
  value = aws_apprunner_service.prod_intel_ms.arn
}
