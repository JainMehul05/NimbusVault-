"""Approved Session B fallback: AWS-generated public HTTPS URL through API Gateway (HTTP API).

Visitor → https://{api}.execute-api.ap-southeast-2.amazonaws.com (AWS certificate)
        → VPC link (ENIs in our subnet, own SG) → Cloud Map → EC2 private IP:8080 (API origin listener)
API Gateway overwrites X-Forwarded-For with the real source IP and adds the origin secret header.
No public inbound port is opened on EC2. Idempotent: refuses to create a second API.
"""
import json
import time
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.runtime/aws-deployment'
PUBLIC = ROOT / '.runtime/public-deployment'
target = json.loads((PRIVATE / 'approved-instance.json').read_text())
ledger_path = PRIVATE / 'resource-ledger.json'
ledger = json.loads(ledger_path.read_text())
held = json.loads((PUBLIC / 'public-secrets.json').read_text())
TAG = target['deployment_id']
s = boto3.Session(profile_name='default', region_name='ap-southeast-2')
ec2, sd, apigw = s.client('ec2'), s.client('servicediscovery'), s.client('apigatewayv2')
if target.get('apigw_api_id'):
    raise SystemExit('An API is already recorded; refusing to create another')


def record(entry):
    ledger['session_b']['created'].append(entry)
    ledger_path.write_text(json.dumps(ledger, indent=2))


inst = ec2.describe_instances(InstanceIds=[target['instance_id']])['Reservations'][0]['Instances'][0]
vpc, subnet, private_ip = inst['VpcId'], inst['SubnetId'], inst['PrivateIpAddress']
app_sg = inst['SecurityGroups'][0]['GroupId']

# 1. VPC link security group: no inbound; outbound only to the application SG on 8080.
link_sg = ec2.create_security_group(GroupName='nimbusvault-apigw-vpclink', VpcId=vpc,
    Description='NimbusVault API Gateway VPC link: egress to app 8080 only',
    TagSpecifications=[{'ResourceType': 'security-group', 'Tags': [{'Key': 'NimbusVaultDeployment', 'Value': TAG}]}])['GroupId']
record({'type': 'security-group', 'id': link_sg, 'name': 'nimbusvault-apigw-vpclink'})
ec2.revoke_security_group_egress(GroupId=link_sg, IpPermissions=[{'IpProtocol': '-1', 'IpRanges': [{'CidrIp': '0.0.0.0/0'}]}])
ec2.authorize_security_group_egress(GroupId=link_sg, IpPermissions=[{'IpProtocol': 'tcp', 'FromPort': 8080, 'ToPort': 8080,
    'UserIdGroupPairs': [{'GroupId': app_sg, 'Description': 'NimbusVault origin listener'}]}])
ec2.authorize_security_group_ingress(GroupId=app_sg, IpPermissions=[{'IpProtocol': 'tcp', 'FromPort': 8080, 'ToPort': 8080,
    'UserIdGroupPairs': [{'GroupId': link_sg, 'Description': 'API Gateway VPC link only'}]}])
ledger['session_b']['modified'].append({'resource': app_sg, 'change': f'ingress tcp 8080 from {link_sg} (API Gateway VPC link)'})

# 2. Cloud Map HTTP namespace + service + the instance's private IP/port.
op = sd.create_http_namespace(Name='nimbusvault', Description='NimbusVault private origin discovery',
                              Tags=[{'Key': 'NimbusVaultDeployment', 'Value': TAG}])['OperationId']
for _ in range(60):
    o = sd.get_operation(OperationId=op)['Operation']
    if o['Status'] in ('SUCCESS', 'FAIL'):
        break
    time.sleep(3)
if o['Status'] != 'SUCCESS':
    raise SystemExit(f"Cloud Map namespace failed: {o.get('ErrorMessage')}")
namespace = o['Targets']['NAMESPACE']
record({'type': 'cloudmap-namespace', 'id': namespace, 'name': 'nimbusvault'})
service = sd.create_service(Name='web', NamespaceId=namespace, Type='HTTP',
                            Tags=[{'Key': 'NimbusVaultDeployment', 'Value': TAG}])['Service']
record({'type': 'cloudmap-service', 'id': service['Id'], 'arn': service['Arn']})
sd.register_instance(ServiceId=service['Id'], InstanceId=target['instance_id'],
                     Attributes={'AWS_INSTANCE_IPV4': private_ip, 'AWS_INSTANCE_PORT': '8080'})
record({'type': 'cloudmap-instance', 'service': service['Id'], 'instance': target['instance_id'], 'ip': private_ip})

# 3. VPC link V2 (no charge for HTTP API VPC links).
link = apigw.create_vpc_link(Name='nimbusvault-vpclink', SubnetIds=[subnet], SecurityGroupIds=[link_sg], Tags={'NimbusVaultDeployment': TAG})
record({'type': 'apigw-vpc-link', 'id': link['VpcLinkId']})
for _ in range(100):
    status = apigw.get_vpc_link(VpcLinkId=link['VpcLinkId'])['VpcLinkStatus']
    if status in ('AVAILABLE', 'FAILED'):
        break
    time.sleep(6)
if status != 'AVAILABLE':
    raise SystemExit(f'VPC link {status}')

# 4. HTTP API, private integration, $default route and throttled auto-deployed stage.
api = apigw.create_api(Name='nimbusvault-public', ProtocolType='HTTP', Description='NimbusVault public demo',
                       Tags={'NimbusVaultDeployment': TAG})
record({'type': 'apigw-http-api', 'id': api['ApiId'], 'endpoint': api['ApiEndpoint']})
integration = apigw.create_integration(
    ApiId=api['ApiId'], IntegrationType='HTTP_PROXY', IntegrationMethod='ANY', ConnectionType='VPC_LINK',
    ConnectionId=link['VpcLinkId'], IntegrationUri=service['Arn'], PayloadFormatVersion='1.0', TimeoutInMillis=30000,
    RequestParameters={
        'overwrite:header.x-nimbus-origin-verify': held['origin_secret'],
        # X-Forwarded-For is reserved by API Gateway; the true client address travels in this header and
        # the backend trusts it only on requests that also carry the origin secret.
        'overwrite:header.x-nimbus-client-ip': '$context.identity.sourceIp',
    })
apigw.create_route(ApiId=api['ApiId'], RouteKey='$default', Target='integrations/' + integration['IntegrationId'])
apigw.create_stage(ApiId=api['ApiId'], StageName='$default', AutoDeploy=True,
                   DefaultRouteSettings={'ThrottlingBurstLimit': 40, 'ThrottlingRateLimit': 20},
                   Tags={'NimbusVaultDeployment': TAG})
url = api['ApiEndpoint']
target.update(public_url=url, apigw_api_id=api['ApiId'], vpc_link_id=link['VpcLinkId'], cloudmap_service_id=service['Id'],
              vpc_origin_id=next(r['id'] for r in ledger['session_b']['created'] if r['type'] == 'cloudfront-vpc-origin'))
(PRIVATE / 'approved-instance.json').write_text(json.dumps(target, indent=2))
print(json.dumps({'url': url, 'api': api['ApiId'], 'vpc_link': link['VpcLinkId'], 'private_ip': private_ip}))
