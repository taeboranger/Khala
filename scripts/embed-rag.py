"""Local multilingual-E5 inference. JSON stdin/stdout; never accesses the network."""
import sys, json, pathlib
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

root = pathlib.Path(__file__).resolve().parents[1] / '.khala-models' / 'multilingual-e5-small'
tokenizer = Tokenizer.from_file(str(root / 'tokenizer.json'))
tokenizer.enable_truncation(max_length=512)
tokenizer.enable_padding(pad_id=1, pad_token='<pad>')
options = ort.SessionOptions()
options.intra_op_num_threads = 2
session = ort.InferenceSession(str(root / 'onnx/model_quantized.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
request = json.loads(sys.stdin.buffer.read().decode('utf-8'))
vectors = []
for start in range(0, len(request['texts']), 8):
    encoded = tokenizer.encode_batch(request['texts'][start:start + 8])
    ids = np.asarray([e.ids for e in encoded], dtype=np.int64)
    mask = np.asarray([e.attention_mask for e in encoded], dtype=np.int64)
    inputs = {'input_ids': ids, 'attention_mask': mask, 'token_type_ids': np.zeros_like(ids)}
    hidden = session.run(None, {i.name: inputs[i.name] for i in session.get_inputs()})[0]
    pooled = (hidden * mask[:, :, None]).sum(axis=1) / mask.sum(axis=1)[:, None]
    pooled /= np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12)
    vectors.extend(pooled.tolist())
print(json.dumps(vectors, separators=(',', ':')))
