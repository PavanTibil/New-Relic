resource "aws_apprunner_vpc_connector" "dms_connector" {
  vpc_connector_name = var.name

  subnets         = var.subnet_ids
  security_groups = var.security_group_ids

  tags = {
    Project_Name  = var.project_name
    Resource_Type = "AppRunner-VPC-Connector"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.name
  }
}
