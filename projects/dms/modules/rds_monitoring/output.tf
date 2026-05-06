output "sns_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "rds_identifier" {
  value = var.rds_identifier
}

output "alert_email" {
  value = var.alert_email
}
