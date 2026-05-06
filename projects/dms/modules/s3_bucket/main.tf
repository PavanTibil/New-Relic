# S3 bucket for certificate storage
resource "aws_s3_bucket" "cert_bucket" {
  bucket = var.cert_bucket

  tags = {
    Project_Name  = "DMS"
    Resource_Type = "S3"
    Environment   = var.environment
    Created_By    = "SRE"
    Name          = var.cert_bucket
  }
}

# Block Public Access (ALL 🔒)
resource "aws_s3_bucket_public_access_block" "access_cert_bucket" {
  bucket                  = aws_s3_bucket.cert_bucket.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}
