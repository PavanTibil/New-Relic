#Virtual Private Cloud
resource "aws_vpc" "my_vpc" {
  cidr_block = var.vpc_cidr

 tags = {
    Project_Name  = "DMS"
    Resource_Type = "VPC"
    Environment   = var.environment
    Created_By    = "DMS"
    Name          = var.My-vpc
 }
}

resource "aws_subnet" "public_subnet_1" {
  vpc_id            = aws_vpc.my_vpc.id
  cidr_block        = var.public_sub_1_cidr
  availability_zone = var.az_pubsub_1

  tags = {
    Project_Name  = "DMS"
    Resource_Type = "Subnet"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.pubsub_1
  }
}

resource "aws_subnet" "public_subnet_2" {
  vpc_id            = aws_vpc.my_vpc.id
  cidr_block        = var.public_sub_2_cidr
  availability_zone = var.az_pubsub_2

  tags = {
    Project_Name  = "DMS"
    Resource_Type = "Subnet"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.pubsub_2
  }
}

resource "aws_subnet" "private_subnet_1" {
  vpc_id            = aws_vpc.my_vpc.id
  cidr_block        = var.private_sub_1_cidr
  availability_zone = var.az_prisub_1

  tags = {
    Project_Name  = "DMS"
    Resource_Type = "Subnet"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.prisub_1
  }
}

resource "aws_subnet" "private_subnet_2" {
  vpc_id            = aws_vpc.my_vpc.id
  cidr_block        = var.private_sub_2_cidr
  availability_zone = var.az_prisub_2

  tags = {
    Project_Name  = "DMS"
    Resource_Type = "Subnet"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.prisub_2
  }
}

#create internet gateway
resource "aws_internet_gateway" "internet_gateway" {
  vpc_id = aws_vpc.my_vpc.id
  tags = {
    Project_Name  = "DMS"
    Resource_Type = "InternetGateway"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.ig
  }
}

#create route table
resource "aws_route_table" "public_route_table" {
  vpc_id = aws_vpc.my_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.internet_gateway.id
  }

  tags = {
    Project_Name  = "DMS"
    Resource_Type = "RouteTable"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.pub_route_table
  }
}

resource "aws_route_table" "private_route_table_1" {
  vpc_id = aws_vpc.my_vpc.id
 
  tags = {
    Project_Name  = "DMS"
    Resource_Type = "RouteTable"
    Environment   = var.environment
    Created_By    = "DMS"
    Name          = var.pri_route_table-01
 }
}

resource "aws_route_table" "private_route_table_2" {
  vpc_id = aws_vpc.my_vpc.id
 
  tags = {
    Project_Name  = "DMS"
    Resource_Type = "RouteTable"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.pri_route_table-02
 }
}

#Associate public subnet to route table
resource "aws_route_table_association" "public_subnet_1_association" {
  subnet_id      = aws_subnet.public_subnet_1.id
  route_table_id = aws_route_table.public_route_table.id
}

resource "aws_route_table_association" "public_subnet_2_association" {
  subnet_id      = aws_subnet.public_subnet_2.id
  route_table_id = aws_route_table.public_route_table.id
}

#Associate private subnet to route table
resource "aws_route_table_association" "private_subnet_1_association" {
  subnet_id      = aws_subnet.private_subnet_1.id
  route_table_id = aws_route_table.private_route_table_1.id
}

resource "aws_route_table_association" "private_subnet_2_association" {
  subnet_id      = aws_subnet.private_subnet_2.id
  route_table_id = aws_route_table.private_route_table_2.id
}

# Create Elastic_ip and NAT gateway in private subnet
resource "aws_eip" "nat_gateway_eip" {
  domain = "vpc"
  tags = {
    Project_Name  = "DMS"
    Resource_Type = "ElasticIP"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.elastic_ip
 }
}

resource "aws_nat_gateway" "nat_gateway" {
  allocation_id = aws_eip.nat_gateway_eip.id
  subnet_id     = aws_subnet.public_subnet_1.id

  tags = {
    Project_Name  = "DMS"
    Resource_Type = "NAT Gateway"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.NAT_gateway
 }
}

# Create default routes in private route tables to the NAT gateway
resource "aws_route" "private_subnet_1_route" {
  route_table_id         = aws_route_table.private_route_table_1.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat_gateway.id
}

resource "aws_route" "private_subnet_2_route" {
  route_table_id         = aws_route_table.private_route_table_2.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat_gateway.id
}

# Associate both private subnets with the NAT gateway
resource "aws_route_table_association" "private_subnet_1_nat_association" {
  subnet_id      = aws_subnet.private_subnet_1.id
  route_table_id = aws_route_table.private_route_table_1.id
}

resource "aws_route_table_association" "private_subnet_2_nat_association" {
  subnet_id      = aws_subnet.private_subnet_2.id
  route_table_id = aws_route_table.private_route_table_2.id
}



# Create a security group for the RDS instance
resource "aws_security_group" "prod_bastionhost_sg" {
  name        = var.prod_bastionhost_sg
  description = "PROD BASTIONHOST Security Group"
  vpc_id      = aws_vpc.my_vpc.id

  # Allow ALL traffic 
  ingress {
    description = "Allow all internal"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Project_Name = "DMS"
    Resource_Type = "PROD-DMS-BASTIONHOST Security Group"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = "PROD-dms-sg"
  }
}
