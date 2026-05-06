output "vpc_connector_name" {
  value = aws_apprunner_vpc_connector.dms_connector.vpc_connector_name
}
output "vpc_connector_arn" {
  value = aws_apprunner_vpc_connector.dms_connector.arn
}
