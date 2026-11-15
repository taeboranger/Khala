"""Download model artifacts only; no custom model code is executed."""
import json, pathlib, urllib.request, hashlib

root = pathlib.Path(__file__).resolve().parents[1] / '.khala-models' / 'multilingual-e5-small'
root.mkdir(parents=True, exist_ok=True)
repo = 'Xenova/multilingual-e5-small'
manifest_path = root / 'manifest.json'
if manifest_path.exists():
    revision = json.loads(manifest_path.read_text(encoding='utf-8'))['revision']
else:
    with urllib.request.urlopen('https://huggingface.co/api/models/' + repo, timeout=60) as response:
        revision = json.load(response)['sha']
files = ['tokenizer.json', 'onnx/model_quantized.onnx', 'README.md']
manifest = {'repo': repo, 'revision': revision, 'files': {}}
for name in files:
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temporary = target.with_suffix(target.suffix + '.download')
        urllib.request.urlretrieve(f'https://huggingface.co/{repo}/resolve/{revision}/{name}', temporary)
        temporary.replace(target)
    manifest['files'][name] = hashlib.sha256(target.read_bytes()).hexdigest()
    print('Ready:', name, target.stat().st_size, flush=True)
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
