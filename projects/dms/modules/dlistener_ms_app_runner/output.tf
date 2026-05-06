output "dlistener_ms_service_name" {
  value = aws_apprunner_service.prod_dlistener_ms.service_name
}

output "dlistener_ms_service_url" {
  value = aws_apprunner_service.prod_dlistener_ms.service_url
}

output "dlistener_ms_service_arn" {
  value = aws_apprunner_service.prod_dlistener_ms.arn
}
