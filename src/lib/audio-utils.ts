import { pickMicrophone } from './microphone';

// Simple EventEmitter implementation
export class EventEmitter {
  private events: { [key: string]: Function[] } = {};

  on(event: string, listener: Function) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  emit(event: string, ...args: any[]) {
    if (this.events[event]) {
      this.events[event].forEach(listener => listener(...args));
    }
  }
  
  off(event: string, listener: Function) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter(l => l !== listener);
    }
  }
}

/**
 * AudioRecorder
 * Captures microphone input and converts it to 16kHz PCM 16-bit mono audio.
 */
export class AudioRecorder extends EventEmitter {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private isRecording: boolean = false;
  private isStarting: boolean = false;

  constructor(public sampleRate: number = 16000) {
    super();
  }

  async start() {
    // Idempotent on purpose. A second start() would replace stream/context/
    // processor while the previous set stayed live and connected, so both would
    // keep emitting and every frame would be sent twice.
    //
    // isStarting is checked as well as isRecording because isRecording is only
    // set after the awaits below; two concurrent callers would otherwise both
    // get past the guard before either finished.
    if (this.isRecording || this.isStarting) return;
    this.isStarting = true;

    try {
      // Normally the system default; but not a phone camera's silent mic (see microphone.ts).
      const deviceId = await navigator.mediaDevices
        .enumerateDevices()
        .then(pickMicrophone)
        .catch(() => undefined);
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {})
          // Do not force sampleRate here as it causes "Requested device not found" on some hardware
          // sampleRate: this.sampleRate,
        },
      });
      this.emit('device', this.stream.getAudioTracks()[0]?.label || 'unknown microphone');

      this.audioContext = new AudioContext({ 
        // Try to use the desired sample rate if supported, otherwise browser will use default
        sampleRate: this.sampleRate 
      });
      
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      
      // Buffer size of 4096 provides better stability on main thread
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const contextSampleRate = this.audioContext?.sampleRate || this.sampleRate;
        
        // Calculate volume first for visualization and noise gating
        let sum = 0;
        const step = Math.ceil(inputData.length / 100); 
        for (let i = 0; i < inputData.length; i += step) {
          sum += inputData[i] * inputData[i];
        }
        const volume = Math.sqrt(sum / (inputData.length / step));
        this.emit('volume', volume);

        // Resampling logic
        let processedData = inputData;
        
        if (contextSampleRate !== this.sampleRate) {
            const ratio = contextSampleRate / this.sampleRate;
            const newLength = Math.floor(inputData.length / ratio);
            processedData = new Float32Array(newLength);
            
            // Box filter (averaging) downsampling - better for 48k->16k than simple decimation
            // This acts as a primitive low-pass filter to prevent aliasing
            for (let i = 0; i < newLength; i++) {
                const startOffset = Math.floor(i * ratio);
                const endOffset = Math.floor((i + 1) * ratio);
                const count = endOffset - startOffset;
                
                if (count > 0) {
                    let sampleSum = 0;
                    for (let j = startOffset; j < endOffset; j++) {
                        sampleSum += inputData[j];
                    }
                    processedData[i] = sampleSum / count;
                } else {
                    // Fallback for upsampling or 1:1 (unlikely here)
                    processedData[i] = inputData[startOffset];
                }
            }
        }

        const pcm16 = this.floatTo16BitPCM(processedData);
        this.emit('data', this.arrayBufferToBase64(pcm16));
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      this.isRecording = true;
    } catch (error) {
      console.error('Error starting audio recording:', error);
      throw error;
    } finally {
      this.isStarting = false;
    }
  }

  stop() {
    this.isRecording = false;
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  private floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  }

  private arrayBufferToBase64(buffer: Int16Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer.buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}

/**
 * AudioStreamer
 * Plays back 24kHz PCM 16-bit mono audio from Gemini.
 */
export class AudioStreamer {
  public audioContext: AudioContext | null = null;
  private nextStartTime: number = 0;
  private gainNode: GainNode | null = null;
  // Scheduled buffers are tracked so barge-in can cut them off without
  // destroying the AudioContext (see stop()).
  private sources: Set<AudioBufferSourceNode> = new Set();

  constructor(public sampleRate: number = 24000) {}

  initialize() {
    // A closed context can never be reused; only then build a new one.
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      this.gainNode = null;
      this.nextStartTime = 0;
    }
    if (!this.gainNode) {
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
      this.nextStartTime = this.audioContext.currentTime;
    }
  }

  async resume() {
    this.initialize();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  play(base64Data: string) {
    this.initialize();

    // A context that is not running schedules silence. Chrome/Electron create
    // every new AudioContext suspended, so recover it here rather than losing
    // the turn's audio.
    if (this.audioContext!.state === 'suspended') {
      void this.audioContext!.resume();
    }

    // Decode base64 to ArrayBuffer
    const binaryString = window.atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Convert Int16 PCM to Float32
    const int16Data = new Int16Array(bytes.buffer);
    const float32Data = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
      float32Data[i] = int16Data[i] / 32768.0;
    }

    // Create AudioBuffer
    const buffer = this.audioContext!.createBuffer(1, float32Data.length, this.sampleRate);
    buffer.getChannelData(0).set(float32Data);

    // Schedule playback
    const source = this.audioContext!.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode!);

    // Ensure gapless playback
    const currentTime = this.audioContext!.currentTime;
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime;
    }
    
    source.onended = () => this.sources.delete(source);
    this.sources.add(source);

    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  /**
   * Cut playback that is already scheduled (barge-in / turn interrupted).
   *
   * The AudioContext is deliberately kept alive: closing it here used to leave
   * play() to build a fresh context, which browsers start in "suspended" state,
   * so every later turn was scheduled into a context that never ran and the
   * assistant went permanently silent after the first interruption.
   */
  stop() {
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // already finished
      }
    }
    this.sources.clear();
    this.nextStartTime = this.audioContext?.currentTime ?? 0;
  }

  /** Full teardown. Only for unmount — after this the streamer is unusable. */
  dispose() {
    this.stop();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
    }
    this.audioContext = null;
    this.gainNode = null;
    this.nextStartTime = 0;
  }
}
