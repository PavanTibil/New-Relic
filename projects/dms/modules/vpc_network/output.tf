output "vpc_id" {
  value       = aws_vpc.my_vpc.id
}
output "public_subnet_1_id" {
  value = aws_subnet.public_subnet_1.id
}

output "public_subnet_2_id" {
  value = aws_subnet.public_subnet_2.id
}

output "private_subnet_1_id" {
  value = aws_subnet.private_subnet_1.id
}

output "private_subnet_2_id" {
  value = aws_subnet.private_subnet_2.id
}

output "prod_bastionhost_sg" {
  value = aws_security_group.prod_bastionhost_sg.id
}
########################################
# INTERNET GATEWAY
########################################
output "internet_gateway_id" {
  value = aws_internet_gateway.internet_gateway.id
}

########################################
# NAT GATEWAY
########################################
output "nat_gateway_id" {
  value = aws_nat_gateway.nat_gateway.id
}

########################################
# ROUTE TABLES
########################################
output "public_route_table_id" {
  value = aws_route_table.public_route_table.id
}

output "private_route_table_1_id" {
  value = aws_route_table.private_route_table_1.id
}

output "private_route_table_2_id" {
  value = aws_route_table.private_route_table_2.id
}
