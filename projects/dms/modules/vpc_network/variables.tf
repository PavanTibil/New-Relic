variable "My-vpc"{
        default = "DMS-PROD-VPC"
}

variable "vpc_cidr" {
        default = "10.1.0.0/16"
}

variable "public_sub_1_cidr"{
        default = "10.1.0.0/24"
}

variable "pubsub_1"{
        default = "DMS-PUBLIC-SUBNET-01"
}

variable "public_sub_2_cidr"{
        default = "10.1.2.0/24"
}

variable "pubsub_2"{
        default = "DMS-PUBLIC-SUBNET-02"
}

variable "private_sub_1_cidr"{
        default = "10.1.3.0/24"
}

variable "prisub_1"{
        default = "DMS-PRIVATE-SUBNET-01"
}

variable "private_sub_2_cidr"{
        default = "10.1.4.0/24"
}

variable "prisub_2"{
        default = "DMS-PRIVATE-SUBNET-02"
}

variable "az_pubsub_1" {
        default = "ap-south-1a"
}

variable "az_pubsub_2" {
        default = "ap-south-1b"
}

variable "az_prisub_1" {
        default = "ap-south-1a"
}

variable "az_prisub_2" {
        default = "ap-south-1b"
}

variable "ig" {
        default = "DMS-PROD-IG"
}

variable "pub_route_table" {
        default = "DMS-PROD-PUBRT-01"
}

variable "pri_route_table-01" {
        default = "DMS-PROD-PRIRT-01"
}

variable "pri_route_table-02" {
        default = "DMS-PROD-PRIRT-02"
}

variable "NAT_gateway" {
        default = "DMS-PROD-NAT"
}

variable "elastic_ip" {
        default = "DMS-PROD-ELASTICIP-NATGTWY"
}
variable "environment" {
        default = "PROD"
}
variable "prod_bastionhost_sg" {
        default = "DMS-PROD-BASTIONHOST-SG"
}
