resource "aws_apprunner_service" "keycloak_service" {
  service_name = "keycloak-service"

  source_configuration {
    image_repository {
      image_identifier      = "849008733010.dkr.ecr.ap-south-1.amazonaws.com/prod-dms-ecr:keycloak-26.1.0"
      image_repository_type = "ECR"

      image_configuration {
        port = 8080
        start_command = "start-dev"
        runtime_environment_variables = {
          KC_ADMIN_PASSWORD = var.kc_admin_password
          KC_ADMIN_USERNAME = var.kc_admin_username
          KC_DB             = "postgres"
          KC_DB_URL         = var.kc_db_url
          KC_DB_USERNAME    = var.kc_db_username
          KC_DB_PASSWORD    = var.kc_db_password
          KC_HTTP_ENABLED   = "true"
          KC_HTTP_PORT      = "8080"
          KC_PROXY = "edge"
          KC_DB_SCHEMA      = var.kc_schema
        }
        # Optional: Add runtime environment secrets if needed
        # runtime_environment_secrets = {
        #   DB_PASSWORD = "arn:aws:secretsmanager:region:account:secret:secretId"
        # }
      }
    }

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
    cpu    = var.cpu
    memory = var.memory
  }

  tags = {
    Environment = var.environment
    App         = "keycloak"
  }
