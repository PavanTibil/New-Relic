##########################################
# WAF Outputs
##########################################

output "waf_acl_name" {
  value = aws_wafv2_web_acl.waf_cloudfront.name
}

output "waf_acl_arn" {
  value = aws_wafv2_web_acl.waf_cloudfront.arn
}

output "waf_ip_set_name" {
  value = aws_wafv2_ip_set.prod_sarvatra_api_ip.name
}

output "waf_ip_set_arn" {
  value = aws_wafv2_ip_set.prod_sarvatra_api_ip.arn
}
