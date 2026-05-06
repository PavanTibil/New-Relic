variable "vpc_id" {
  type = string
}
variable "private_subnet_1_id" {
  type = string
}
variable "private_subnet_2_id" {
  type = string
}
variable "RDS_sg" {
        default = "PROD-dms-sg"
}

variable "rds_identifier" {
        default = "prod-dms-private-db"
}

variable "rds_db_subnet_group" {
        default = "prod-db-subnet-group"
}

#variable "allocated_storage" {
        #default = "50"
#}

#variable "engine_version" {
        #default = "17.4"
#}

variable "environment" {
        default = "PROD"
}
variable "allowed_office_ip" {
        default = "49.249.50.178/32"
}
