// Adds `webkitAudioContext` to the global Window interface for browser compatibility.
// Consolidate all global Window interface augmentations into one block.
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext; // Make it optional as it's a fallback
    // Removed 'readonly' modifier to resolve "All declarations of 'aistudio' must have identical modifiers" error.
    // This aligns the declaration with other (possibly implicit) declarations that do not include this modifier.
    aistudio: AIStudio; // Declare aistudio property
  }
}

export interface LiturgyData {
  evangelho: string;
  texto_evangelho: string;
  referencia_liturgica: string;
  primeira_leitura: string;
  salmo: string;
  segunda_leitura: string;
  [key: string]: string; // For dynamic keys
}

export interface ScriptBlock {
  text: string;
  prompt: string;
}

export interface Roteiro {
  hook?: ScriptBlock; // Made optional
  leitura: ScriptBlock;
  reflexao?: ScriptBlock; // Made optional
  aplicacao?: ScriptBlock; // Made optional
  oracao?: ScriptBlock; // Made optional
}

export type AssetType = 'image' | 'audio' | 'srt';

export interface GeneratedAsset {
  block_id: string;
  type: AssetType;
  data_b64: string; // Base64 content
}

export interface JobPayload {
  assets: GeneratedAsset[];
  roteiro: Roteiro;
  meta_dados: {
    data: string;
    ref: string;
  };
  leitura_montada: string; // This will now point to roteiro.leitura.text
}

export enum VisualStyle {
  Cinematic = "Cinematic Realistic",
  OilPainting = "Oil Painting",
  Watercolor = "Watercolor",
  Anime = "Anime Style",
  DigitalArt = "Digital Art",
}

export enum VoiceOption {
  Kore = "Kore",
  Alnilam = "Alnilam",
  Puck = "Puck",
  Charon = "Charon",
  Fenrir = "Fenrir"
}

export enum IntroStyle {
  Viral = "Viral (Hook + Curiosity)",
  Liturgical = "Liturgical (Traditional)"
}

export enum ProcessingState {
  Idle,
  FetchingLiturgy,
  GeneratingScript,
  GeneratingMedia,
  Uploading,
  Complete,
  Error
}

// Defines the AIStudio interface for global window object.
export interface AIStudio {
  hasSelectedApiKey: () => Promise<boolean>;
  openSelectKey: () => Promise<void>;
}