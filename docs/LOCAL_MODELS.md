# Using Local Vision Models with Obsidian Image Renamer

This guide explains how to use local vision models instead of cloud-based APIs like OpenAI.

## Why Use Local Models?

- **Privacy**: Images never leave your computer
- **Cost**: No API fees
- **Offline**: Works without internet connection
- **Control**: Full control over the model and processing

## Supported Local Model Servers

### Ollama (Recommended for Beginners)

1. **Install Ollama**:
   ```bash
   # macOS
   brew install ollama

   # Linux
   curl -fsSL https://ollama.com/install.sh | sh

   # Windows
   # Download from https://ollama.com/download
   ```

2. **Download a vision model**:
   ```bash
   # Recommended: LLaVA (7B parameters, ~4GB download)
   ollama pull llava

   # Alternative: Llama 3.2 Vision (newer, better quality)
   ollama pull llama3.2-vision:11b
   ```

3. **Start the server** (runs automatically after pull):
   ```bash
   ollama serve  # Usually auto-starts
   ```

4. **Configure the plugin**:
   - API Endpoint: `http://localhost:11434/api/chat`
   - API Key: `ollama` (or any non-empty string)
   - Model: `llava` (or `llama3.2-vision:11b`)

### LM Studio (User-Friendly GUI)

1. **Download LM Studio** from [lmstudio.ai](https://lmstudio.ai/)

2. **Download a vision model**:
   - Open LM Studio
   - Search for "llava" or "bakllava"
   - Download a GGUF quantized version (Q4_K_M recommended)

3. **Start the server**:
   - Load the model
   - Go to "Local Server" tab
   - Click "Start Server"

4. **Configure the plugin**:
   - API Endpoint: `http://localhost:1234/v1/chat/completions`
   - API Key: `lm-studio` (or any non-empty string)
   - Model: Use the model name shown in LM Studio

### LocalAI (Advanced Users)

1. **Run with Docker**:
   ```bash
   docker run -p 8080:8080 --name local-ai -ti \
     localai/localai:latest-aio-cpu
   ```

2. **Configure the plugin**:
   - API Endpoint: `http://localhost:8080/v1/chat/completions`
   - API Key: `local` (or any non-empty string)
   - Model: `llava-1.5-7b-hf`

## Available Vision Models

### Small Models (4-8GB RAM)
- **MobileVLM**: Fast, lightweight, good for basic captions
- **LLaVA-7B**: Good balance of quality and speed
- **TinyLLaVA**: Ultra-light, runs on most hardware

### Medium Models (8-16GB RAM)
- **LLaVA-13B**: Better caption quality
- **BakLLaVA**: Improved version of LLaVA
- **Llama 3.2 Vision 11B**: Latest from Meta, excellent quality

### Large Models (16GB+ RAM)
- **LLaVA-34B**: Best quality but slow
- **Llama 3.2 Vision 90B**: State-of-the-art, requires high-end hardware

## Local Model Quality Considerations

**Note**: Local vision models typically produce significantly lower quality results compared to cloud-based models. The smaller models that can run on consumer hardware such as my 16GB MacBook often exhibit:
- Generic or vague descriptions (e.g., "a picture of something" instead of specific details)
- Missing important elements from images
- Poor understanding of complex scenes or text in images
- Hallucinations or incorrect identifications

For best results with image renaming, consider using cloud-based vision APIs (OpenAI, Anthropic, Gemini) despite the privacy and cost trade-offs. The quality gap between local and cloud models is particularly noticeable for tasks requiring detailed image understanding.

## Performance Tips

1. **Use quantized models**: Look for Q4_K_M or Q5_K_M versions
2. **GPU acceleration**: Use models with "GGUF" format for GPU support
3. **Adjust image size**: Smaller images process faster (plugin already resizes to 512px)
4. **Choose appropriate model size**: 7B models are usually sufficient for file naming

## Troubleshooting

### "Connection refused" error
- Ensure the local server is running
- Check the port number in the endpoint URL
- Try `127.0.0.1` instead of `localhost`

### "Model not found" error
- Verify the model name matches exactly
- For Ollama: run `ollama list` to see available models
- For LM Studio: check the model name in the interface

### Slow performance
- Use a smaller/quantized model
- Ensure you have enough free RAM
- Close other applications
- Consider using GPU acceleration if available

### Poor caption quality
- Try a larger model (13B instead of 7B)
- Adjust the prompt in the plugin code if needed
- Ensure the image is clear and well-lit

## Example Configurations

### Privacy-First Setup (Ollama + LLaVA)
```
API Endpoint: http://localhost:11434/api/chat
API Key: ollama
Model: llava
```
- Completely offline
- No data leaves your machine
- ~4GB model size

### Quality-First Setup (LM Studio + Llama 3.2 Vision)
```
API Endpoint: http://localhost:1234/v1/chat/completions
API Key: lm-studio
Model: llama-3.2-11b-vision-instruct
```
- Better caption quality
- Still local and private
- ~6-8GB model size

### Speed-First Setup (Ollama + TinyLLaVA)
```
API Endpoint: http://localhost:11434/api/chat
API Key: ollama
Model: tinyllava
```
- Fastest processing
- Minimal resource usage
- ~2GB model size

## Comparison with Cloud APIs

| Aspect | Local Models | Cloud APIs (OpenAI) |
|--------|-------------|-------------------|
| Privacy | ✅ Complete | ❌ Images sent to cloud |
| Cost | ✅ Free after setup | ❌ Per-request fees |
| Speed | ⚡ Varies (1-10s) | ⚡⚡ Fast (1-3s) |
| Quality | 🎯 Good | 🎯🎯 Excellent |
| Setup | 📦 Some effort | ✅ Just API key |
| Internet | ✅ Not required | ❌ Required |
| Hardware | 💻 8GB+ RAM | ✅ Any |

## Additional Resources

- [Ollama Documentation](https://github.com/ollama/ollama)
- [LM Studio Guide](https://lmstudio.ai/docs)
- [LocalAI Documentation](https://localai.io/)
- [LLaVA Model Information](https://github.com/haotian-liu/LLaVA)
- [Llama 3.2 Vision](https://llama.meta.com/)
