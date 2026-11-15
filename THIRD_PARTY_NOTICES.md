# Open-source components

KHALA's conversation UI uses **assistant-ui** (`@assistant-ui/react`, `@assistant-ui/react-markdown`), licensed under MIT. Project and original license: https://github.com/assistant-ui/assistant-ui/blob/main/LICENSE . The dependency packages retain their upstream license notices in `node_modules`.

Actual model execution uses the locally installed **OpenAI Codex CLI**, an open-source agent CLI licensed under Apache-2.0: https://github.com/openai/codex . The CLI is not vendored by this repository; the user installs and authenticates it separately. Model access and subscription usage are separate from the source-code license.

Other dependencies retain their respective upstream licenses; see each package's license file and `package-lock.json` for exact installed versions.

Local semantic retrieval uses **multilingual-e5-small** (MIT) by intfloat, with ONNX quantized artifacts distributed by Xenova. Sources: https://huggingface.co/intfloat/multilingual-e5-small and https://huggingface.co/Xenova/multilingual-e5-small . Installed revision, file hashes, and the distributor model card are retained in `.khala-models/multilingual-e5-small/`. NumPy, ONNX Runtime and Hugging Face Tokenizers retain their respective installed package license notices. KHALA does not execute custom remote model code.
