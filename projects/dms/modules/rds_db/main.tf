# Create a security group for the RDS instance
resource "aws_security_group" "rds_sg" {
  name        = var.RDS_sg
  description = "RDS Private Security Group"
  vpc_id      = var.vpc_id

  # Allow inbound port 5437 from your office IP
  ingress {
    description = "Postgres access"
    from_port   = 5437
    to_port     = 5437
    protocol    = "tcp"
    cidr_blocks = [var.allowed_office_ip] # example: "49.249.50.178/32"
  }

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
    Resource_Type = "RDS Security Group"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = "PROD-dms-sg"
  }
}

# Create the RDS subnet group (private subnets)
resource "aws_db_subnet_group" "postgres_subnet_group" {
  name       = var.rds_db_subnet_group
  subnet_ids = [
    var.private_subnet_1_id,
    var.private_subnet_2_id,
  ]

  tags = {
    Name = var.rds_db_subnet_group
  }
}

# Create the RDS PostgreSQL instance
resource "aws_db_instance" "postgres_rds" {
  identifier                = var.rds_identifier
  engine                    = "postgres"
  engine_version            = "17.4"
  db_name                   = "prodDMSdb"
  instance_class            = "db.t3.small"
  allocated_storage         = 50
  storage_type              = "gp3"

  username                  = "prod_dms"
  password                  = "PRODdmsdb"

  port                      = 5437

  db_subnet_group_name      = aws_db_subnet_group.postgres_subnet_group.id
  vpc_security_group_ids    = [aws_security_group.rds_sg.id]

  multi_az                  = true
  publicly_accessible       = false
  deletion_protection       = false

  backup_retention_period   = 7
  backup_window             = "18:23-18:53"  # matches screenshot

  maintenance_window        = "Mon:09:35-Mon:10:05" # use your window

  auto_minor_version_upgrade = true

  storage_encrypted         = true

  copy_tags_to_snapshot     = true

  skip_final_snapshot       = true

  tags = {
    Project_Name  = "DMS"
    Resource_Type = "RDS PostgreSQL"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.rds_identifier
  }
}
