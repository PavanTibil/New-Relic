# Create the App Runner service
resource "aws_apprunner_service" "prod_intel_ms" {
  service_name = "Prod_Intel_ms"

  source_configuration {
    image_repository {
      image_identifier      = "849008733010.dkr.ecr.ap-south-1.amazonaws.com/prod-dms-ecr:intelms-apprunner-8"
      image_repository_type = "ECR"

      image_configuration {
        port = 3008

        runtime_environment_secrets = {
          "prod-apprunner-intelms"        = var.intel_ms_secret
          "prod-apprunner-common-secret" = var.common_secret
        }
      }
    }

    # âœ… Use existing manually created IAM Role
    authentication_configuration {
      access_role_arn = var.ecr_access_role_arn
    }
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = var.vpc_connector_arn
    }
  }

  instance_configuration {
    cpu               = var.cpu
    memory            = var.memory
    instance_role_arn = var.instance_arn
  }

  tags = {
    Project_Name = "DMS"
    Environment  = var.environment
    App          = "ms"
  }
}
