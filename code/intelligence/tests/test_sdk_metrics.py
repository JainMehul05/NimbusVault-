"""Instrumentation test with a real SDK serializer and a simulated HTTP transport."""
from types import SimpleNamespace

import boto3
from app import aws_metrics


def test_vector_counter_observes_sdk_api_calls_without_a_live_aws_request(monkeypatch):
    session = boto3.Session(aws_access_key_id='synthetic', aws_secret_access_key='synthetic',
                            region_name='ap-southeast-2')
    session.events.register('before-call.s3vectors.QueryVectors', aws_metrics.record_vector_query)
    client = session.client('s3vectors')
    monkeypatch.setattr(client._endpoint, 'make_request', lambda *args, **kwargs: (
        SimpleNamespace(status_code=200, headers={}), {'vectors': [], 'distanceMetric': 'cosine'}))
    before = aws_metrics.snapshot()
    client.query_vectors(vectorBucketName='synthetic', indexName='synthetic',
                         queryVector={'float32': [0.0] * 384}, topK=1)
    after = aws_metrics.snapshot()
    assert after['process_id'] == before['process_id']
    assert after['vector_query_sdk_calls'] == before['vector_query_sdk_calls'] + 1
