provider "aws" {
  region = "ap-south-1"
}

resource "aws_apprunner_service" "example" {
  service_name = "nrdms-app"

  source_configuration {
    auto_deployments_enabled = false

    authentication_configuration {
      access_role_arn = "arn:aws:iam::849008733010:role/PROD-ECR-Access-Role"
    }

    image_repository {
      image_repository_type = "ECR"

      image_configuration {
        port = "8080"

        runtime_environment_variables = {
          KEYCLOAK_ADMIN          = "admin"
          KEYCLOAK_ADMIN_PASSWORD = "admin123"
        }
      }

      image_identifier = "849008733010.dkr.ecr.ap-south-1.amazonaws.com/prod-dms-ecr:keycloak-26.1.0"
    }
  }

  instance_configuration {
    cpu    = "1024"
    memory = "2048"
  }

  tags = {
    Name = "NRDMS"
    Project = "DMS"
  }
}
