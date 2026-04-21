provider "aws" {
  region = "ap-south-1"
}

resource "aws_instance" "example" {
  ami           = "ami-0f5ee92e2d63afc18" # Amazon Linux 2 AMI for ap-south-1 (verify latest)
  instance_type = "t2.micro"

  tags = {
    Name = "NR Test"
  }
}
