# Open-source components and licences

Phase 2 uses established open-source products for media. All of them run on the application server, so no audio, video or text is sent to a third party.

| Component | Used for | Licence | Production note |
| --- | --- | --- | --- |
| [FFmpeg](https://ffmpeg.org) via `ffmpeg-static` (gyan.dev 6.1.1 "essentials" build on Windows) | Rendering MP4s, burning captions, blurring redactions, decoding audio for transcription | **GPL-3.0** for this build (it includes x264) | Use an IT-approved **LGPL** build, or a render-worker container whose licence Legal has cleared, and set `FFMPEG_PATH`. Distributing the GPL build inside a product has obligations. Running it as an internal service is usually simpler. Ask Legal |
| [OpenAI Whisper](https://github.com/openai/whisper) weights (`onnx-community/whisper-base`) | Speech-to-text for recordings | MIT (weights and code) | Larger models (`whisper-small`, `whisper-medium`) are more accurate and slower. Set `LOCAL_STT_MODEL` |
| [Transformers.js](https://github.com/huggingface/transformers.js) (`@huggingface/transformers`) with ONNX Runtime | Runs Whisper and Kokoro in Node | Apache-2.0 (ONNX Runtime: MIT) | Models download once from Hugging Face into `MODELS_DIR`. Pre-load them in an image if the servers have no internet access |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via `kokoro-js` | AI voiceover (English voices) | Apache-2.0 | English only. Other languages use the browser preview voice until a multilingual voice is approved |
| [unpdf](https://github.com/unjs/unpdf), [JSZip](https://stuk.github.io/jszip/) | Text from PDF, DOCX and PPTX uploads | MIT / MIT (or GPL-3.0, dual) | — |

Measured on the development PC (CPU only):
- Kokoro speaks at about 1.6 seconds of compute per second of audio.
- Whisper-base transcribes 5 seconds of speech in about 3 seconds.
- Each model takes about 11 seconds to load, once per server start.
- A 30-second narrated video renders in about 45 seconds.
