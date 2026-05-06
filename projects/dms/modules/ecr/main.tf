resource "aws_ecr_repository" "this" {
  name                 = var.repository_name
  image_tag_mutability = "IMMUTABLE"

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Project_Name  = var.project_name
    Resource_Type = "ECR"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.repository_name
  }
}
