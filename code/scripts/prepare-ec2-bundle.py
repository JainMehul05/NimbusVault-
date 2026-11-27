"""Create a local public-code/model bundle. Never upload or include private runtime state."""
import gzip
import hashlib
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / '.runtime/aws-deployment/bundle'
target.mkdir(exist_ok=True)
if shutil.disk_usage(target).free < 5 * 1024**3:
    raise SystemExit('At least 5 GiB free local disk required; no cleanup is automatic')
paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                                cwd=root).decode().split('\0')
prefixes = ('backend/src/', 'backend/tests/', 'backend/prisma/', 'backend/scripts/',
            'frontend/src/', 'frontend/public/', 'intelligence/app/', 'intelligence/tests/',
            'deployment/', 'scripts/', 'benchmarks/', 'infra/test/')
top = {'package.json', 'package-lock.json', '.dockerignore', 'samples/cloud-stage-canary.txt'}
manifest = {}
archive_directories = set()


def add(archive, path, relative):
    if not path.resolve().is_relative_to(root):
        raise RuntimeError('Deployment file escapes the project: ' + relative)
    if path.is_symlink() or path.is_junction():
        raise RuntimeError('Links are forbidden in deployment bundles: ' + relative)
    if path.suffix.lower() in {'.exe', '.dll', '.db', '.pem', '.key'} or path.name == '.env':
        raise RuntimeError('Forbidden deployment file: ' + relative)
    with path.open('rb') as stream:
        manifest[relative] = {'sha256': hashlib.file_digest(stream, 'sha256').hexdigest(),
                              'bytes': path.stat().st_size}
    for parent in reversed(Path(relative).parents):
        directory = parent.as_posix()
        key = (id(archive), directory)
        if directory != '.' and key not in archive_directories:
            entry = tarfile.TarInfo(directory)
            entry.type = tarfile.DIRTYPE
            entry.mode = 0o755
            entry.uid = entry.gid = 0
            entry.uname = entry.gname = 'root'
            archive.addfile(entry)
            archive_directories.add(key)
    entry = archive.gettarinfo(str(path), arcname=relative)
    entry.mode = 0o644
    entry.uid = entry.gid = 0
    entry.uname = entry.gname = 'root'
    with path.open('rb') as stream:
        archive.addfile(entry, stream)


with tarfile.open(target / 'source.tar.gz', 'w:gz', compresslevel=1) as archive:
    for relative in sorted(set(paths)):
        if not relative or not (root / relative).is_file():
            continue
        workspace_config = relative.count('/') == 1 and relative.split('/')[0] in {
            'backend', 'frontend', 'infra', 'e2e', 'intelligence'} and (
                relative.endswith(('.json', '.ts', '.cjs', '.toml')) or
                relative.endswith(('requirements.lock', 'requirements.txt')))
        if relative in top or relative.startswith(prefixes) or workspace_config:
            if '.env' in Path(relative).name or '__pycache__' in Path(relative).parts:
                continue
            add(archive, root / relative, relative)
    for name in ['cloud-config.json', 'cloud-resources.json', 'vector-demo.json']:
        add(archive, root / '.runtime/aws-deployment/local/configuration' / name,
            'deployment/configuration/' + name)
assets = root / '.runtime/standalone-ai'
with tarfile.open(target / 'models.tar', 'w') as archive:
    for directory in ['embedding-cache', 'models']:
        for path in sorted((assets / directory).rglob('*')):
            if not path.is_file() or '.locks' in path.parts:
                continue
            add(archive, path, 'model-assets/' + path.relative_to(assets).as_posix())
(target / 'FILES.json').write_text(json.dumps(manifest, indent=2))
images = ['nimbusvault-ec2-api:prepared', 'nimbusvault-ec2-intelligence:prepared',
          'nimbusvault-ec2-ollama-cpu:prepared',
          'nimbusvault-ec2-postgres:prepared']
with (target / 'images.tar.gz').open('wb') as raw:
    with gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=1) as compressed:
        process = subprocess.Popen(['docker', 'save', *images], stdout=subprocess.PIPE)
        shutil.copyfileobj(process.stdout, compressed, length=1024**2)
        process.stdout.close()
        if process.wait() != 0:
            raise RuntimeError('Image export failed; partial archive is not deployable')
archives = {}
for path in target.iterdir():
    if path.name == 'BUNDLE.json':
        continue
    with path.open('rb') as stream:
        archives[path.name] = {'bytes': path.stat().st_size,
                              'sha256': hashlib.file_digest(stream, 'sha256').hexdigest()}
report = {'status': 'LOCAL_ONLY_NOT_UPLOADED', 'private_data_included': False,
          'windows_binaries_included': False, 'files': len(manifest), 'archives': archives,
          'total_bytes': sum(v['bytes'] for v in archives.values()),
          'images': json.loads(subprocess.check_output(['docker', 'image', 'inspect', *images]))}
(target / 'BUNDLE.json').write_text(json.dumps(report, indent=2))
print(json.dumps({k: v for k, v in report.items() if k != 'images'}, indent=2))
