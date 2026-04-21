// AudioWorklet that down-mixes + resamples the incoming mic stream to mono
// 16 kHz linear16 PCM and posts each buffered chunk back to the main thread
// where it is forwarded to the Deepgram WebSocket.
class PCMWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const target = (options && options.processorOptions && options.processorOptions.targetSampleRate) || 16000;
    this._targetRate = target;
    this._sourceRate = sampleRate;
    this._ratio = this._sourceRate / this._targetRate;
    this._accumulator = 0;
    // Chunk about every 100 ms of 16 kHz PCM → 1600 samples.
    this._chunkSize = 1600;
    this._buffer = new Int16Array(this._chunkSize);
    this._bufferIndex = 0;
  }

  _pushSample(float) {
    const clamped = Math.max(-1, Math.min(1, float));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    this._buffer[this._bufferIndex++] = int16 | 0;
    if (this._bufferIndex >= this._chunkSize) {
      this.port.postMessage(this._buffer.buffer.slice(0));
      this._bufferIndex = 0;
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    // Naive linear downsampling — good enough for speech ASR and cheaper
    // than a full polyphase filter on the audio thread.
    while (this._accumulator < channel.length) {
      const idx = this._accumulator | 0;
      this._pushSample(channel[idx]);
      this._accumulator += this._ratio;
    }
    this._accumulator -= channel.length;
    return true;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
