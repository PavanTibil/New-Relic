##############################################
# DATA SOURCES FOR MANAGED POLICIES (NO HARDCODED IDs)
##############################################

data "aws_cloudfront_cache_policy" "CachingDisabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "AllViewerExceptHostHeader" {
  name = "Managed-AllViewerExceptHostHeader"
}

##############################################
# LOCALS
##############################################

locals {
  full_allowed = [
    "GET",
    "HEAD",
    "OPTIONS",
    "PUT",
    "POST",
    "PATCH",
    "DELETE"
  ]
}

##############################################
# CLOUDFRONT DISTRIBUTION
##############################################

resource "aws_cloudfront_distribution" "this" {
  enabled     = true
  price_class = "PriceClass_All"

  ##############################################
  # ORIGINS (10 App Runner Services)
  ##############################################

  dynamic "origin" {
    for_each = var.origins
    content {
      domain_name = origin.value
      origin_id   = origin.key

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  ##############################################
  # DEFAULT CACHE BEHAVIOR
  ##############################################

  default_cache_behavior {
    target_origin_id       = var.default_origin
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = local.full_allowed
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ##############################################
  # ORDERED CACHE BEHAVIORS (12)
  ##############################################

  ordered_cache_behavior {
    path_pattern           = "/requests/*"
    target_origin_id       = "workflow-events-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = local.full_allowed
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ordered_cache_behavior {
    path_pattern           = "/intel/*"
    target_origin_id       = "intel-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = local.full_allowed
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ordered_cache_behavior {
    path_pattern           = "/drouter/*"
    target_origin_id       = "drouter-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = local.full_allowed
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ordered_cache_behavior {
    path_pattern           = "/dlistener/*"
    target_origin_id       = "dlistener-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = local.full_allowed
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ordered_cache_behavior {
    path_pattern           = "/user"
    target_origin_id       = "user-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ordered_cache_behavior {
    path_pattern           = "/requests/wfevents"
    target_origin_id       = "workflow-events-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ordered_cache_behavior {
    path_pattern           = "/requests/wfagent"
    target_origin_id       = "workflow-agent-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ordered_cache_behavior {
    path_pattern           = "/requests/wfhandler"
    target_origin_id       = "workflow-handler-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ordered_cache_behavior {
    path_pattern           = "/user/*"
    target_origin_id       = "user-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = local.full_allowed
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ordered_cache_behavior {
    path_pattern           = "/transformer/*"
    target_origin_id       = "dtransformer-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = local.full_allowed
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ordered_cache_behavior {
    path_pattern           = "/registry/*"
    target_origin_id       = "registry-ms"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods        = local.full_allowed
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.CachingDisabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.AllViewerExceptHostHeader.id
  }

  ##############################################
  # SSL SETTINGS
  ##############################################

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  http_version = "http2"

  tags = {
    Project_Name = "DMS"
    Resource_Type = "CloudFront"
  }
}
