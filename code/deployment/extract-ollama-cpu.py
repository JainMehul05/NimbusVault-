"""Extract only native Linux CPU runtime files from the hash-verified official release."""
import hashlib
import json
import os
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

archive = Path('/archive.zst')
expected = 'b82649006cb5b54ed1237fa2d1a26a7f939a4fd03150033759acbff7ff315adf'
with archive.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == expected
destination = Path('/native-cpu')
destination.mkdir()
gpu = ('cuda', 'cublas', 'cudart', 'cudnn', 'nvrtc', 'nvidia', 'rocm', 'vulkan', 'mlx', 'metal')
files = {}
links = []
with subprocess.Popen(['zstd', '-d', '-c', str(archive)], stdout=subprocess.PIPE) as process:
    with tarfile.open(fileobj=process.stdout, mode='r|') as tar:
        for member in tar:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe official archive path')
            name = path.as_posix().removeprefix('./')
            if name != 'bin/ollama' and not name.startswith('lib/ollama/'):
                continue
            if any(part in name.lower() for part in gpu):
                continue
            output = destination / name
            if member.issym():
                link = PurePosixPath(member.linkname)
                if link.is_absolute() or '..' in link.parts:
                    raise ValueError('Unsafe runtime symlink')
                links.append((output, member.linkname))
            elif member.isfile():
                output.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, output.open('wb') as target:
                    while chunk := source.read(1024 * 1024):
                        target.write(chunk)
                output.chmod(0o755 if member.mode & 0o111 else 0o644)
                with output.open('rb') as stream:
                    files[name] = hashlib.file_digest(stream, 'sha256').hexdigest()
    assert process.wait() == 0
for output, target in links:
    output.parent.mkdir(parents=True, exist_ok=True)
    os.symlink(target, output)
assert 'bin/ollama' in files and any('cpu' in name for name in files)
(destination / 'CPU_RUNTIME_MANIFEST.json').write_text(json.dumps({
    'official_archive_sha256': expected, 'extracted_files': files,
    'bytes': sum((destination / name).stat().st_size for name in files),
}, indent=2))
print('Verified official archive; CPU files:', len(files))
