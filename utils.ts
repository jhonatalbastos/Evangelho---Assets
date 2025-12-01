// Helper functions for base64 encoding/decoding as per Google GenAI guidelines
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  let bytes = new Uint8Array(len); // Changed from const to let to resolve SyntaxError
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

import { GeneratedAsset } from './types';
import { logger } from './services/logger';

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Helper to get duration of base64 raw PCM audio
export async function getAudioDuration(base64: string): Promise<number> {
  return new Promise((resolve) => {
    // Create a new AudioContext for each decode operation to prevent issues
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate: 24000});
    try {
      const audioBytes = decode(base64);
      decodeAudioData(audioBytes, audioContext, 24000, 1)
        .then(buffer => {
          if (buffer.duration === Infinity || isNaN(buffer.duration)) {
             logger.warn("Audio duration is Infinity or NaN after decoding, defaulting to 5s.", { audioDuration: buffer.duration });
             resolve(5000); 
          } else {
             resolve(buffer.duration * 1000); // ms
          }
        })
        .catch(e => {
          logger.error("Error decoding audio data for duration calculation, defaulting to 5s.", e);
          resolve(5000); // Fail safe
        })
        .finally(() => {
          // Ensure AudioContext is closed to release resources
          if (audioContext.state !== 'closed') {
            audioContext.close();
          }
        });
    } catch (e) {
      logger.error("Error preparing audio data for decoding, defaulting to 5s.", e);
      if (audioContext.state !== 'closed') {
        audioContext.close();
      }
      resolve(5000);
    }
  });
}

function formatTimeSRT(ms: number): string {
  const date = new Date(0);
  date.setMilliseconds(ms);
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  const milliseconds = date.getUTCMilliseconds().toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds},${milliseconds}`;
}

export async function generateSRT(
  assets: GeneratedAsset[],
  roteiroText: { [key: string]: string }
): Promise<string> {
  let srtContent = "";
  let currentTimeMs = 0;
  let counter = 1;

  // Order of blocks: Hook -> Reading -> Reflection -> Application -> Prayer
  const blockOrder = ['hook', 'leitura', 'reflexao', 'aplicacao', 'oracao'];

  logger.info("Starting SRT generation...");

  for (const blockId of blockOrder) {
    const audioAsset = assets.find(a => a.type === 'audio' && a.block_id === blockId);
    
    if (audioAsset) {
      const duration = await getAudioDuration(audioAsset.data_b64);
      const startTime = currentTimeMs;
      const endTime = currentTimeMs + duration;
      
      const text = roteiroText[blockId] || "";
      const cleanText = text.replace(/[\r\n]+/g, ' ').trim();

      srtContent += `${counter}\n`;
      srtContent += `${formatTimeSRT(startTime)} --> ${formatTimeSRT(endTime)}\n`;
      srtContent += `${cleanText}\n\n`;

      currentTimeMs = endTime;
      counter++;
      logger.info(`SRT block generated for ${blockId}: ${formatTimeSRT(startTime)} --> ${formatTimeSRT(endTime)}`);
    } else {
        logger.warn(`No audio asset found for blockId: ${blockId}, skipping SRT generation for this block.`);
    }
  }
  logger.info("SRT generation complete.");

  // For btoa, ensure the string is correctly encoded to UTF-8 before base64.
  // unescape(encodeURIComponent()) is a common pattern for this.
  return btoa(unescape(encodeURIComponent(srtContent)));
}

export function getBlockName(index: number): string {
  const names = ["hook", "leitura", "reflexao", "aplicacao", "oracao"];
  return names[index];
}

export function mapRoteiroToTextMap(roteiro: any): { [key: string]: string } {
    return {
        'hook': roteiro.hook.text,
        'leitura': roteiro.leitura.text,
        'reflexao': roteiro.reflexao.text,
        'aplicacao': roteiro.aplicacao.text,
        'oracao': roteiro.oracao.text
    };
}