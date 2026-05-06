output "sns_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "apprunner_service_name" {
  value = var.apprunner_service_name
}

output "alert_email" {
  value = var.alert_email
}
