resource "aws_s3_bucket" "my_bucket" {
  bucket        = var.bucket_name
  force_destroy = true

  tags = {
    Name = "MyAppBucket"
  }
}

