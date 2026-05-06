# -------------------
# SNS
# -------------------

resource "aws_sns_topic" "alerts" {
  name = "${var.app_name}-apprunner-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# -------------------
# APP RUNNER ALARMS
# -------------------

resource "aws_cloudwatch_metric_alarm" "apprunner_4xx" {
  alarm_name          = "${var.app_name}-AppRunner-4XX-Errors"
  namespace           = "AWS/AppRunner"
  metric_name         = "4XXError"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"

  dimensions = {
    ServiceName = var.apprunner_service_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "apprunner_5xx" {
  alarm_name          = "${var.app_name}-AppRunner-5XX-Errors"
  namespace           = "AWS/AppRunner"
  metric_name         = "5XXError"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"

  dimensions = {
    ServiceName = var.apprunner_service_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "apprunner_high_cpu" {
  alarm_name          = "${var.app_name}-AppRunner-High-CPU"
  namespace           = "AWS/AppRunner"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    ServiceName = var.apprunner_service_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "apprunner_high_memory" {
  alarm_name          = "${var.app_name}-AppRunner-High-Memory"
  namespace           = "AWS/AppRunner"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    ServiceName = var.apprunner_service_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}
