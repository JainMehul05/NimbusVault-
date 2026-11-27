"""Read-only AWS deployment discovery. Never provisions or changes cloud resources."""
import concurrent.futures
import json
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / '.runtime/aws-deployment'
DESTINATION.mkdir(parents=True, exist_ok=True)
sdk = Config(connect_timeout=4, read_timeout=12, retries={'max_attempts': 1})
session = boto3.Session(profile_name='default', region_name='ap-southeast-2')
report = {'observed_at': datetime.now(timezone.utc).isoformat(), 'mutations': [], 'checks': {}}


def client(service, region='ap-southeast-2'):
    return session.client(service, region_name=region, config=sdk)


def check(name, fn):
    try:
        result = {'status': 'verified_read_only', 'result': fn()}
    except Exception as error:
        result = {'status': 'blocked', 'error_type': type(error).__name__}
        if hasattr(error, 'response'):
            result['aws_error_code'] = error.response.get('Error', {}).get('Code')
    return name, result


def price(service, filters):
    response = client('pricing', 'us-east-1').get_products(
        ServiceCode=service,
        Filters=[{'Type': 'TERM_MATCH', 'Field': k, 'Value': v} for k, v in filters.items()],
        MaxResults=100,
    )
    return {'products': [json.loads(p) for p in response['PriceList']],
            'has_more': 'NextToken' in response}


try:
    identity = client('sts').get_caller_identity()
    expected = json.loads((ROOT / '.runtime/cloud-resources.json').read_text(encoding='utf-8-sig'))[
        'serverless_outputs']['WorkflowArn'].split(':')[4]
    if identity['Account'] != expected:
        raise RuntimeError('Wrong AWS account; discovery stopped')
    plan = client('freetier', 'us-east-1').get_account_plan_state()
    report['identity'] = identity
    report['plan'] = plan
    expiry = plan.get('accountPlanExpirationDate')
    if (plan.get('accountPlanType') != 'FREE' or plan.get('accountPlanStatus') != 'ACTIVE'
            or not expiry or expiry <= datetime.now(timezone.utc)
            or float(plan.get('accountPlanRemainingCredits', {}).get('amount', 0)) <= 10):
        raise RuntimeError('Active Free plan, expiry and USD10 reserve not established')
    ec2 = client('ec2')
    tasks = {
        'instance_type': lambda: ec2.describe_instance_types(InstanceTypes=['m7i-flex.large']),
        'instance_offerings': lambda: ec2.describe_instance_type_offerings(
            LocationType='availability-zone',
            Filters=[{'Name': 'instance-type', 'Values': ['m7i-flex.large']}]),
        'ubuntu_24_04': lambda: sorted(ec2.describe_images(Owners=['099720109477'], Filters=[
            {'Name': 'name', 'Values': ['ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*']},
            {'Name': 'state', 'Values': ['available']},
            {'Name': 'architecture', 'Values': ['x86_64']}])['Images'],
            key=lambda i: i['CreationDate'], reverse=True)[:3],
        'vpcs': lambda: ec2.describe_vpcs(),
        'subnets': lambda: ec2.describe_subnets(),
        'routes': lambda: ec2.describe_route_tables(),
        'internet_gateways': lambda: ec2.describe_internet_gateways(),
        'existing_instances': lambda: ec2.describe_instances(),
        'ebs_encryption_default': lambda: ec2.get_ebs_encryption_by_default(),
        'ssm_instances': lambda: client('ssm').describe_instance_information(),
        'ec2_price': lambda: price('AmazonEC2', {
            'regionCode': 'ap-southeast-2', 'instanceType': 'm7i-flex.large',
            'operatingSystem': 'Linux', 'tenancy': 'Shared', 'preInstalledSw': 'NA',
            'capacitystatus': 'Used'}),
        'gp3_price': lambda: price('AmazonEC2', {
            'regionCode': 'ap-southeast-2', 'volumeApiName': 'gp3',
            'productFamily': 'Storage'}),
        'ipv4_price': lambda: price('AmazonVPC', {
            'regionCode': 'ap-southeast-2', 'usagetype': 'APS2-PublicIPv4:InUseAddress'}),
        'freetier_usage': lambda: client('freetier', 'us-east-1').get_free_tier_usage(maxResults=100),
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for name, result in pool.map(lambda item: check(*item), tasks.items()):
            report['checks'][name] = result
except Exception as error:
    report['blocked'] = {'type': type(error).__name__}
finally:
    (DESTINATION / 'discovery.json').write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')
    print(json.dumps({'checks': {k: v['status'] for k, v in report['checks'].items()},
                      'blocked': report.get('blocked'), 'mutations': []}))
