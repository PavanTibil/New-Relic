output "user_ms_service_name" {
  value = aws_apprunner_service.prod_user_ms.service_name
}

output "user_ms_service_url" {
  value = aws_apprunner_service.prod_user_ms.service_url
}

output "user_ms_service_arn" {
  value = aws_apprunner_service.prod_user_ms.arn
}
