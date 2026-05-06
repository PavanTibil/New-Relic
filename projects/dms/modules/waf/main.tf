provider "aws" {
  region = "us-east-1"   # Required for CloudFront WAF
}

##############################################################
# IP SET: ProdSarvatraApiIP
##############################################################
resource "aws_wafv2_ip_set" "prod_sarvatra_api_ip" {
  name        = "ProdSarvatraApiIP"
  description = "SarvatraAllowedApiIP"
  scope       = "CLOUDFRONT"

  ip_address_version = "IPV4"

  addresses = [
    "1.7.23.65/32",
    "129.154.47.227/32",
    "202.154.164.237/32",
    "152.67.189.101/32",
    "1.7.23.34/32",
    "13.232.117.29/32"
  ]
}

##############################################################
# WEB ACL
##############################################################
resource "aws_wafv2_web_acl" "waf_cloudfront" {
  name        = var.waf_name
  scope       = "CLOUDFRONT"
  description = "CloudFront Global WAF"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "waf-cloudfront"
    sampled_requests_enabled   = true
  }

  #####################################################################
  # RULE 1: BlockNonIndiaRequests
  #####################################################################
  rule {
    name     = "BlockNonIndiaRequests"
    priority = 1

    action {
      block {}
    }

    statement {
      not_statement {
        statement {
          geo_match_statement {
            country_codes = ["IN"]
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "block-non-india"
      sampled_requests_enabled   = true
    }
  }

  #####################################################################
  # RULE 2: AWS Managed SQL Injection Rule
  #####################################################################
  rule {
    name     = "AWS-AWSManagedRulesSQLiRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "managed-sqli"
      sampled_requests_enabled   = true
    }
  }

  #####################################################################
  # RULE 3: AllowRequestsFromSarvatraIP
  #####################################################################
  rule {
    name     = "AllowRequestsFromSarvatraIP"
    priority = 3

    action {
      allow {}
    }

    statement {
      and_statement {

        # ---- URI PATH MATCH (/drouter/pnotif) ----
        statement {
          byte_match_statement {
            field_to_match {
              uri_path {}
            }

            positional_constraint = "EXACTLY"
            search_string         = "/drouter/pnotif"

            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }

        # ---- IP Set Check ----
        statement {
          ip_set_reference_statement {
            arn = aws_wafv2_ip_set.prod_sarvatra_api_ip.arn
          }
        }

      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "allow-sarvatra-ip"
      sampled_requests_enabled   = true
    }
  }

  #####################################################################
  # RULE 4: BlockRequestsForOthers
  #####################################################################
  rule {
    name     = "BlockRequestsForOthers"
    priority = 4

    action {
      block {}
    }

    statement {
      byte_match_statement {
        field_to_match {
          uri_path {}
        }

        positional_constraint = "EXACTLY"
        search_string         = "/drouter/pnotif"

        text_transformation {
          priority = 0
          type     = "LOWERCASE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "block-requests-for-others"
      sampled_requests_enabled   = true
    }
  }

}
