import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Roteiro, VisualStyle, IntroStyle, VoiceOption, LiturgyData } from '../types';
import { logger } from './logger';

// --- Liturgy Search Fallback ---

export async function fetchLiturgyFallback(dateStr: string, category: string): Promise<LiturgyData> {
  const modelId = "gemini-2.5-flash"; // Good balance of speed and reasoning for search
  logger.info(`Attempting to fetch liturgy using Gemini Search Fallback for date: ${dateStr}, category: ${category}`);
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); // Initialize here
  const prompt = `
    Find the Catholic Daily Liturgy for date: ${dateStr}.
    I specifically need the full text and reference for: ${category} (e.g., Gospel, First Reading).
    Search on reliable sites like "Canção Nova", "CNBB", or "Vatican News".
    
    IMPORTANT: Return the result strictly as a raw JSON object (no markdown code blocks) with these exact keys:
    - referencia (the bible chapter/verse)
    - texto (the full content of the reading)
    - titulo_liturgico (e.g., "Monday of the 3rd Week of Advent")
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }], // Enable Search Grounding
        // Note: responseMimeType: "application/json" is NOT supported when using tools like googleSearch.
        // We rely on the prompt to enforce JSON format.
      }
    });

    let jsonStr = response.text || "{}";
    
    // Clean up potential markdown formatting (e.g., ```json ... ```)
    jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();

    let result;
    try {
        result = JSON.parse(jsonStr);
        logger.info('Successfully parsed JSON from Gemini Search Fallback.', result);
    } catch (e) {
        logger.error("Failed to parse JSON from Gemini Search Fallback", e, { jsonString: jsonStr });
        throw new Error("Invalid JSON received from AI Search.");
    }

    const mappedData: LiturgyData = {
      evangelho: result.referencia || "Reference not found",
      texto_evangelho: result.texto || "",
      referencia_liturgica: result.titulo_liturgico || "Liturgia Diária (Search)",
      primeira_leitura: "",
      salmo: "",
      segunda_leitura: ""
    };

    if (category.includes('primeira')) {
        mappedData.primeira_leitura = result.referencia;
        mappedData['texto_primeira_leitura'] = result.texto;
    } else if (category.includes('salmo')) {
        mappedData.salmo = result.referencia;
        mappedData['texto_salmo'] = result.texto;
    } else if (category.includes('segunda')) {
        mappedData.segunda_leitura = result.referencia;
        mappedData['texto_segunda_leitura'] = result.texto;
    }
    logger.info('Gemini Search Fallback successful.', mappedData);
    return mappedData;

  } catch (error) {
    logger.error("Gemini Search Fallback Error", error);
    throw new Error("Unable to find liturgy via Search.");
  }
}

// --- Script Generation ---

export async function generateScript(
  reference: string,
  text: string,
  visualStyle: VisualStyle,
  introStyle: IntroStyle
): Promise<Partial<Roteiro> & { prompt_leitura: string }> {
  logger.info('Generating script with Gemini...', { reference, visualStyle, introStyle });
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); // Initialize here
  const systemInstruction = `
    You are a professional Christian video editor and scriptwriter for short-form content (Reels/TikTok).
    
    CONTEXT:
    Reference: ${reference}
    Liturgical Text: "${text.substring(0, 3000)}" (truncated if too long)
    
    STYLE:
    Visuals: ${visualStyle}
    Intro Hook: ${introStyle === IntroStyle.Viral ? "High energy, curiosity loop, viral hook." : "Solemn, respectful, traditional liturgical start."}
    
    TASK:
    Create a script with specific blocks.
    1. hook: Intro/Hook (5-8s)
    2. prompt_leitura: A specific image prompt for the moment the Gospel is being read (Solemn, bible, candles, etc). NO TEXT for this block, only the prompt.
    3. reflexao: Reflection/Homily (20-25s)
    4. aplicacao: Practical Application (20-25s)
    5. oracao: Closing Prayer (15-20s)
    
    For each block (except prompt_leitura), provide 'text' (spoken Portuguese) and 'prompt' (English image description).
    For 'prompt_leitura', provide only the 'prompt' string.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Generate the JSON script for: ${reference}`,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hook: {
              type: Type.OBJECT,
              properties: { text: { type: Type.STRING }, prompt: { type: Type.STRING } }
            },
            prompt_leitura: { type: Type.STRING, description: "Image prompt for the reading section" },
            reflexao: {
               type: Type.OBJECT,
               properties: { text: { type: Type.STRING }, prompt: { type: Type.STRING } }
            },
            aplicacao: {
               type: Type.OBJECT,
               properties: { text: { type: Type.STRING }, prompt: { type: Type.STRING } }
            },
            oracao: {
               type: Type.OBJECT,
               properties: { text: { type: Type.STRING }, prompt: { type: Type.STRING } }
            }
          },
          required: ["hook", "prompt_leitura", "reflexao", "aplicacao", "oracao"]
        }
      }
    });

    const jsonStr = response.text || "{}";
    const result = JSON.parse(jsonStr);
    logger.info('Script generated successfully.', result);
    return result;
  } catch (error) {
    logger.error("Script generation failed", error);
    throw error;
  }
}

// --- Image Generation ---

export async function generateImage(prompt: string, style: VisualStyle, aspectRatio: string): Promise<string> {
  logger.info('Generating image with gemini-2.5-flash-image...', { prompt: prompt.substring(0, 50), style, aspectRatio });
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); // Initialize here
  try {
    const finalPrompt = `${prompt}. Art Style: ${style}. High resolution, 8k, detailed, cinematic lighting, masterpiece.`;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image', // Changed model to gemini-2.5-flash-image
      contents: { 
        parts: [
          { text: finalPrompt },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio as "1:1" | "3:4" | "4:3" | "9:16" | "16:9", // Cast to valid aspectRatio enum values
        },
        // responseMimeType is NOT supported for nano banana series models.
        // responseSchema is NOT supported for nano banana series models.
      },
    });

    // Iterate through all parts to find the image part
    let base64Data: string | undefined;
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        base64Data = part.inlineData.data;
        break;
      }
    }

    if (!base64Data) {
      logger.error("No image data returned from gemini-2.5-flash-image.");
      throw new Error("No image data returned.");
    }
    logger.info('Image generated successfully.');
    return base64Data;
  } catch (error) {
    logger.error("Image generation failed", error, { prompt: prompt.substring(0, 50), style, aspectRatio });
    throw error;
  }
}

// --- TTS Generation ---

export async function generateSpeech(text: string, voiceName: VoiceOption): Promise<string> {
  logger.info('Generating speech with Gemini TTS...', { text: text.substring(0, 50), voiceName });
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); // Initialize here
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName }
          }
        }
      }
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) {
      logger.error("No audio data returned from TTS.");
      throw new Error("No audio data returned.");
    }
    logger.info('Speech generated successfully.');
    return audioData;

  } catch (error) {
    logger.error("TTS generation failed", error, { text: text.substring(0, 50) });
    throw error;
  }
}