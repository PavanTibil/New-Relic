resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.dashboard_name

  dashboard_body = jsonencode({
    widgets = concat(
      local.app_runner_widgets,
      local.rds_widgets
    )
  })
}

locals {

  # ----------------------------
  # App Runner Widgets
  # ----------------------------
  app_runner_widgets = flatten([
    for index, service in var.app_runner_service_names : [

      # CPU + Memory
      {
        type   = "metric"
        x      = 0
        y      = index * 6
        width  = 12
        height = 6

        properties = {
          title  = "App Runner | ${service} | CPU & Memory"
          region = var.region
          stat   = "Average"
          period = 60

          metrics = [
            ["AWS/AppRunner", "CPUUtilization", "ServiceName", service],
            [".", "MemoryUtilization", ".", "."]
          ]
        }
      },

      # Requests + Errors
      {
        type   = "metric"
        x      = 12
        y      = index * 6
        width  = 12
        height = 6

        properties = {
          title  = "App Runner | ${service} | Traffic & Errors"
          region = var.region
          period = 60

          metrics = [
            ["AWS/AppRunner", "RequestCount", "ServiceName", service, { "stat": "Sum" }],
            [".", "5XXErrors", ".", ".", { "stat": "Sum" }],
            [".", "4XXErrors", ".", ".", { "stat": "Sum" }]
          ]
        }
      }
    ]
  ])

  # ----------------------------
  # RDS Widgets
  # ----------------------------
  rds_widgets = [

    # CPU + Connections
    {
      type   = "metric"
      x      = 0
      y      = length(var.app_runner_service_names) * 6
      width  = 12
      height = 6

      properties = {
        title  = "RDS | CPU & Connections"
        region = var.region
        stat   = "Average"
        period = 60

        metrics = [
          ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_identifier],
          [".", "DatabaseConnections", ".", "."]
        ]
      }
    },

    # Storage + Memory
    {
      type   = "metric"
      x      = 12
      y      = length(var.app_runner_service_names) * 6
      width  = 12
      height = 6

      properties = {
        title  = "RDS | Storage & Memory"
        region = var.region
        stat   = "Average"
        period = 300

        metrics = [
          ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", var.rds_identifier],
          [".", "FreeableMemory", ".", "."]
        ]
      }
    }
  ]
}
