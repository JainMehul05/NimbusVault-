"""One-time CloudFront setup for approved Session B (requires the user's explicit approval).

Creates: a pay-as-you-go CloudFront distribution (no flat-rate plan) using the existing VPC origin
for the approved instance, plus one SG rule admitting only CloudFront's VPC-origin service group on
TCP 8080. Writes the public URL into approved-instance.json; secrets stay in a private file.
Idempotent: refuses to create a second distribution.
"""
import json
import secrets
import time
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.runtime/aws-deployment'
PUBLIC = ROOT / '.runtime/public-deployment'
target = json.loads((PRIVATE / 'approved-instance.json').read_text())
ledger_path = PRIVATE / 'resource-ledger.json'
ledger = json.loads(ledger_path.read_text())
session = boto3.Session(profile_name='default', region_name='ap-southeast-2')
cf = session.client('cloudfront', region_name='us-east-1')
ec2 = session.client('ec2')
if target.get('cloudfront_distribution_id'):
    raise SystemExit('A distribution is already recorded; refusing to create another')
vpc_origin_id = next(r['id'] for r in ledger['session_b']['created'] if r['type'] == 'cloudfront-vpc-origin')
origin = cf.get_vpc_origin(Id=vpc_origin_id)['VpcOrigin']
if origin['Status'] != 'Deployed':
    raise SystemExit(f"VPC origin is {origin['Status']}; wait until Deployed")
instance = ec2.describe_instances(InstanceIds=[target['instance_id']])['Reservations'][0]['Instances'][0]
private_dns = instance['PrivateDnsName']

secrets_file = PUBLIC / 'public-secrets.json'
if secrets_file.exists():
    held = json.loads(secrets_file.read_text())
else:
    held = {'origin_secret': secrets.token_urlsafe(48), 'invite_code': 'nimbus-' + secrets.token_hex(4)}
    secrets_file.write_text(json.dumps(held, indent=2))

service_sg = ec2.describe_security_groups(Filters=[
    {'Name': 'group-name', 'Values': ['CloudFront-VPCOrigins-Service-SG']},
    {'Name': 'vpc-id', 'Values': [instance['VpcId']]}])['SecurityGroups'][0]['GroupId']
app_sg = instance['SecurityGroups'][0]['GroupId']
try:
    ec2.authorize_security_group_ingress(GroupId=app_sg, IpPermissions=[{
        'IpProtocol': 'tcp', 'FromPort': 8080, 'ToPort': 8080,
        'UserIdGroupPairs': [{'GroupId': service_sg, 'Description': 'CloudFront VPC origin only'}]}])
    ledger['session_b']['modified'].append({'resource': app_sg, 'change': f'ingress tcp 8080 from {service_sg} (CloudFront VPC origin)'})
except ec2.exceptions.ClientError as error:
    if 'InvalidPermission.Duplicate' not in str(error):
        raise

CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'
CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6'
ALL_VIEWER_EXCEPT_HOST = 'b689b0a8-53d0-40ab-baf2-68738e2966ac'
SECURITY_HEADERS = '67f7725c-6f97-4210-82d7-5512b31e9d03'
all_methods = {'Quantity': 7, 'Items': ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
               'CachedMethods': {'Quantity': 2, 'Items': ['GET', 'HEAD']}}
config = {
    'CallerReference': 'nimbusvault-session-b-' + secrets.token_hex(4),
    'Comment': 'NimbusVault public demo (EC2 via VPC origin)',
    'Enabled': True,
    'HttpVersion': 'http2and3',
    'IsIPV6Enabled': True,
    'PriceClass': 'PriceClass_All',
    'Origins': {'Quantity': 1, 'Items': [{
        'Id': 'nimbusvault-ec2', 'DomainName': private_dns,
        'CustomHeaders': {'Quantity': 1, 'Items': [{'HeaderName': 'x-nimbus-origin-verify', 'HeaderValue': held['origin_secret']}]},
        'VpcOriginConfig': {'VpcOriginId': vpc_origin_id, 'OriginReadTimeout': 60, 'OriginKeepaliveTimeout': 5},
        'ConnectionAttempts': 3, 'ConnectionTimeout': 10}]},
    'DefaultCacheBehavior': {
        'TargetOriginId': 'nimbusvault-ec2', 'ViewerProtocolPolicy': 'redirect-to-https', 'Compress': True,
        'AllowedMethods': all_methods, 'CachePolicyId': CACHING_DISABLED,
        'OriginRequestPolicyId': ALL_VIEWER_EXCEPT_HOST, 'ResponseHeadersPolicyId': SECURITY_HEADERS},
    'CacheBehaviors': {'Quantity': 1, 'Items': [{
        # Vite assets are content-hashed public JS/CSS; nothing personal is ever cached.
        'PathPattern': '/assets/*', 'TargetOriginId': 'nimbusvault-ec2', 'ViewerProtocolPolicy': 'redirect-to-https',
        'Compress': True, 'AllowedMethods': {'Quantity': 2, 'Items': ['GET', 'HEAD'],
                                              'CachedMethods': {'Quantity': 2, 'Items': ['GET', 'HEAD']}},
        'CachePolicyId': CACHING_OPTIMIZED, 'OriginRequestPolicyId': ALL_VIEWER_EXCEPT_HOST,
        'ResponseHeadersPolicyId': SECURITY_HEADERS}]},
    'ViewerCertificate': {'CloudFrontDefaultCertificate': True},
    'Restrictions': {'GeoRestriction': {'RestrictionType': 'none', 'Quantity': 0}},
}
created = cf.create_distribution_with_tags(DistributionConfigWithTags={
    'DistributionConfig': config,
    'Tags': {'Items': [{'Key': 'NimbusVaultDeployment', 'Value': target['deployment_id']}]}})['Distribution']
url = 'https://' + created['DomainName']
ledger['session_b']['created'].append({'type': 'cloudfront-distribution', 'id': created['Id'], 'domain': created['DomainName']})
ledger_path.write_text(json.dumps(ledger, indent=2))
target.update(cloudfront_distribution_id=created['Id'], public_url=url, vpc_origin_id=vpc_origin_id)
(PRIVATE / 'approved-instance.json').write_text(json.dumps(target, indent=2))
print(json.dumps({'distribution': created['Id'], 'url': url, 'status': created['Status']}))
